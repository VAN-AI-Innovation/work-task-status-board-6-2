/**
 * 역할이 **무엇을 볼 수 있고 무엇을 고칠 수 있는가**를 정한다 (T8 완료 기준 1). 인자는 둘뿐이고,
 * 저장소·역할 전환 쿼리·환경변수·시계를 보지 않는다 — 판정이므로 도메인이다 (`ADR-006`).
 *
 * ## 열람과 수정이 이제 갈린다
 *
 * 이 파일은 오래도록 **한 함수**였고, 머리말에 「갈릴 근거가 생기면 그때 나눈다」고 적혀
 * 있었다. 지금이 그때다 (`0012_lead_org_read.sql`).
 *
 * 근거는 팀장의 대시보드다. 팀장이 자기 팀만 보면 팀별 현황표와 팀별 완료율이 「우리 팀 N건,
 * 남의 팀 0건」으로 서는데, 0은 화면에서 「없다」로 읽히므로 그 표는 남의 팀에 대해 **틀린
 * 사실**을 말한다. 팀을 끌고 가는 사람은 옆 팀이 어디까지 왔는지를 보고 자기 팀 일정을
 * 잡는다. 그래서 **본다**. 반대로 남의 팀 업무의 담당자를 바꾸거나 지우는 것은 여전히
 * 그 팀장의 일이 아니다 — 그래서 **고치지는 못한다.**
 *
 * | 역할 | 업무 열람 | 업무 수정 | 목표 지표 |
 * |---|---|---|---|
 * | `admin` | 전부 | 전부 | 전부 |
 * | `lead` | **전부** | `teamId`가 있고 같은 팀 | **전부** |
 * | `member` | 담당 건 + 공동 담당 건 | 같은 조건 | `teamId`가 있고 같은 팀 |
 *
 * `member`의 목표 지표만 업무와 규칙이 다르다. **목표 지표에는 담당자 축이 없기 때문이다** —
 * `GoalMetric`은 업무가 아니라 성과 지표이고 팀 단위로 움직인다. 담당자로 걸러 버리면 부원은
 * 「목표 대비 성과」 섹션이 통째로 빈 화면을 본다.
 *
 * ## 공동 담당은 **이름으로** 잰다
 *
 * `tasks.co_owner_names`가 이름 배열이고 id 컬럼을 따로 두지 않았다 — 근거는
 * `0013_task_authoring.sql` 1절에 있다(시트가 이름만 주고, 다음 업로드가 그 칸을 덮는다).
 * 그 대가인 **동명이인**을 팀 대조로 막는다: `members`의 유니크가 `(team_id, name)`이라
 * 팀까지 같아야 같은 사람이다.
 *
 * ## step 4의 RLS 정책은 아래 표와 글자 그대로 대응해야 한다
 *
 * 규칙이 두 곳에 사는 것은 의도다 — 데모·폴백 모드에는 RLS가 없고(메모리 드라이버다) 그래도
 * 역할별로 다르게 보여야 하며, 라이브 모드에서도 화면이 「왜 이것만 보이는가」를 설명하려면
 * JS 쪽에 규칙이 있어야 한다. 대신 두 벌이 어긋나면 데모에서 보이던 것이 라이브에서 사라진다.
 * 지금 대응하는 정책은 `tasks_select_scope`·`tasks_update_scope`(`0013`)와
 * `goal_metrics_select_scope`(`0012`)다.
 *
 * **`ownerMemberId`가 null인 업무는 `member`에게서 빠진다** (`unknown_owner`, `PLAN.md`
 * 「T8 착수 시 확정」 결정 D). 시트 담당자는 자유 입력이라 `members` 행에 안 붙는 이름이
 * 남는데, null을 「내 것」으로 치면 담당자 미상 업무가 계정 연결 안 된 전원에게 열린다.
 * 그래서 `viewer.memberId`·`viewer.teamId`·`viewer.memberName`의 null 가드가 판정보다
 * **먼저** 선다.
 */

import type { Viewer } from '@/types/auth';
import type { GoalMetric } from '@/types/goal';
import type { Task } from '@/types/task';

/** 주 담당이 본인인가. `memberId`가 없으면(`unknown_owner`) 어떤 업무도 본인 것이 아니다 */
function isPrimaryOwner(task: Task, viewer: Viewer): boolean {
  return viewer.memberId !== null && task.ownerMemberId === viewer.memberId;
}

/**
 * 공동 담당에 본인 이름이 있는가. **팀까지 같아야 한다** (머리말의 동명이인).
 * 명부에 안 붙은 계정(`memberName === null`)과 팀 없는 계정은 여기서 먼저 걸린다.
 */
function isCoOwner(task: Task, viewer: Viewer): boolean {
  return (
    viewer.memberName !== null &&
    viewer.teamId !== null &&
    task.teamId === viewer.teamId &&
    task.coOwnerNames.includes(viewer.memberName)
  );
}

/** `member`의 범위. 열람과 수정이 **같다** — 보는 만큼 고친다 */
function isOwnTask(task: Task, viewer: Viewer): boolean {
  return isPrimaryOwner(task, viewer) || isCoOwner(task, viewer);
}

/**
 * **열람 범위.** `Viewer | null`을 받지 않는다 — null은 「데모 모드라 범위가 없다」와
 * 「로그인하지 않았다」 두 가지를 뜻하게 되고 그 둘의 결과는 정반대여야 한다. 어느 쪽인지는
 * 호출부(`buildReadContext`)가 알고 있으므로 그쪽이 판단한다.
 */
export function taskInScope(task: Task, viewer: Viewer): boolean {
  switch (viewer.role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return isOwnTask(task, viewer);
  }
}

/**
 * **수정 범위.** 열람보다 좁은 자리는 `lead` 하나다 (머리말).
 *
 * 「무엇을 고칠 수 있나」를 묻는 곳이 전부 이 함수를 부른다 — 패널의 수정 폼을 그릴지
 * 정하는 대시보드도, 실제로 거부하는 `PATCH`·`DELETE`도. 두 벌이 되면 화면에는 있는데
 * 저장은 안 되는(또는 그 반대인) 칸이 생긴다.
 */
export function taskEditable(task: Task, viewer: Viewer): boolean {
  switch (viewer.role) {
    case 'admin':
      return true;
    case 'lead':
      return viewer.teamId !== null && task.teamId === viewer.teamId;
    case 'member':
      return isOwnTask(task, viewer);
  }
}

export function goalMetricInScope(metric: GoalMetric, viewer: Viewer): boolean {
  switch (viewer.role) {
    case 'admin':
    // 팀장도 전사 목표를 본다 — 업무 열람과 같은 범위여야 한 화면 안에서 섹션마다
    // 보이는 범위가 달라지지 않는다 (`0012`)
    case 'lead':
      return true;
    // `member`는 팀으로 본다 — 목표 지표에는 담당자 축이 없다 (파일 머리말)
    case 'member':
      return viewer.teamId !== null && metric.teamId === viewer.teamId;
  }
}

/** 순서를 그대로 두고 거르기만 한다. 통과한 항목은 사본이 아니라 같은 객체다 */
export function scopeTasks(tasks: readonly Task[], viewer: Viewer): Task[] {
  return tasks.filter((task) => taskInScope(task, viewer));
}

/** 위와 같은 규율. **고칠 수 있는 것만** 남긴다 (패널의 수정 폼이 이 목록을 본다) */
export function scopeEditableTasks(tasks: readonly Task[], viewer: Viewer): Task[] {
  return tasks.filter((task) => taskEditable(task, viewer));
}

export function scopeGoalMetrics(metrics: readonly GoalMetric[], viewer: Viewer): GoalMetric[] {
  return metrics.filter((metric) => goalMetricInScope(metric, viewer));
}
