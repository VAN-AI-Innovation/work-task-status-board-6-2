/**
 * 역할이 **무엇을 볼 수 있는가**를 정한다 (T8 완료 기준 1). 인자는 둘뿐이고, 저장소·역할 전환 쿼리·
 * 환경변수·시계를 보지 않는다 — 판정이므로 도메인이다 (`ADR-006`).
 *
 * **열람 범위와 수정 범위가 같은 함수다.** 둘을 가를 근거가 지금 없다 — `member`가 볼 수 있는
 * 것은 자기 업무뿐이고 고칠 수 있는 것도 자기 업무뿐이며(`UC-16`), `lead`·`admin`도 마찬가지로
 * 보는 만큼 고친다. 함수를 둘로 나눠 두면 한쪽만 고쳐지는 날이 오고, 그날 서버는 보여주지
 * 않는 업무의 수정을 받아 준다. 갈릴 근거가 생기면 그때 나눈다.
 *
 * **step 4의 RLS 정책은 아래 표와 글자 그대로 대응해야 한다.** 규칙이 두 곳에 사는 것은
 * 의도다 — 데모·폴백 모드에는 RLS가 없고(메모리 드라이버다) 그래도 역할별로 다르게 보여야
 * 하며, 라이브 모드에서도 화면이 「왜 이것만 보이는가」를 설명하려면 JS 쪽에 규칙이 있어야
 * 한다. 대신 두 벌이 어긋나면 데모에서 보이던 것이 라이브에서 사라진다. 그래서 갈래를 셋으로
 * 못박고, SQL을 쓸 때 이 주석을 그대로 옮겨 적는다.
 *
 * | 역할 | 업무 | 목표 지표 |
 * |---|---|---|
 * | `admin` | 전부 | 전부 |
 * | `lead` | `teamId`가 있고 같은 팀 | 같은 조건 |
 * | `member` | `memberId`가 있고 담당자가 본인 | `teamId`가 있고 같은 팀 |
 *
 * `member`의 목표 지표만 업무와 규칙이 다르다. **목표 지표에는 담당자 축이 없기 때문이다** —
 * `GoalMetric`은 업무가 아니라 성과 지표이고 팀 단위로 움직인다. 담당자로 걸러 버리면 부원은
 * 「목표 대비 성과」 섹션이 통째로 빈 화면을 본다.
 *
 * **`ownerMemberId`가 null인 업무는 `member`에게서 빠진다** (`unknown_owner`, `PLAN.md`
 * 「T8 착수 시 확정」 결정 D). 시트 담당자는 자유 입력이라 `members` 행에 안 붙는 이름이
 * 남는데, null을 「내 것」으로 치면 담당자 미상 업무가 계정 연결 안 된 전원에게 열린다.
 * 그래서 `viewer.memberId`·`viewer.teamId`의 null 가드가 판정보다 **먼저** 선다.
 */

import type { Viewer } from '@/types/auth';
import type { GoalMetric } from '@/types/goal';
import type { Task } from '@/types/task';

/**
 * `Viewer | null`을 받지 않는다. null은 「데모 모드라 범위가 없다」와 「로그인하지 않았다」
 * 두 가지를 뜻하게 되고 그 둘의 결과는 정반대여야 한다 — 앞은 전부 보여야 하고 뒤는
 * 아무것도 보이면 안 된다. 어느 쪽인지는 호출부(step 8)가 알고 있으므로 그쪽이 판단한다.
 */
export function taskInScope(task: Task, viewer: Viewer): boolean {
  switch (viewer.role) {
    case 'admin':
      return true;
    case 'lead':
      return viewer.teamId !== null && task.teamId === viewer.teamId;
    case 'member':
      return viewer.memberId !== null && task.ownerMemberId === viewer.memberId;
  }
}

export function goalMetricInScope(metric: GoalMetric, viewer: Viewer): boolean {
  switch (viewer.role) {
    case 'admin':
      return true;
    // `member`도 팀으로 본다 — 목표 지표에는 담당자 축이 없다 (파일 머리말)
    case 'lead':
    case 'member':
      return viewer.teamId !== null && metric.teamId === viewer.teamId;
  }
}

/** 순서를 그대로 두고 거르기만 한다. 통과한 항목은 사본이 아니라 같은 객체다 */
export function scopeTasks(tasks: readonly Task[], viewer: Viewer): Task[] {
  return tasks.filter((task) => taskInScope(task, viewer));
}

export function scopeGoalMetrics(metrics: readonly GoalMetric[], viewer: Viewer): GoalMetric[] {
  return metrics.filter((metric) => goalMetricInScope(metric, viewer));
}
