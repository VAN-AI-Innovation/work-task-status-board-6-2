/**
 * 업무를 놓고 **누가 무엇을 할 수 있는가.** 패널이 여는 칸과 화면이 내주는 버튼을 여기서
 * 정한다.
 *
 * | | 담당자 지정 | 내용 수정 | 만들기 | 지우기 |
 * |---|---|---|---|---|
 * | `admin` | ○ | ○ | ○ (아무 팀) | ○ |
 * | `lead` | ○ | ○ | ○ (자기 팀) | ○ |
 * | `member` | ✕ | ○ | ✕ | ✕ |
 *
 * **어느 칸이든 행 범위가 먼저 선다** (`viewer-scope.ts`의 `taskEditable`). 이 파일은
 * 「이 역할에게 그 조작이 존재하는가」만 답하고, 「이 업무가 그 사람 것인가」는 답하지 않는다 —
 * 팀장이 전 팀을 **보게** 된 뒤로 그 둘이 확실히 다른 물음이 됐다 (`0012`).
 *
 * ## 담당자 지정 — 권한이다
 *
 * `canAssignOwner`는 **세 층 중 하나**다. 나머지 둘은 `PATCH /api/tasks/[id]`가 부르는
 * 이 함수와, DB의 `tasks_update_scope`다 — 그 정책의 `with check`가 부원의 업무에서
 * `owner_member_id = my_member_id()`를 요구하므로, 부원이 담당자를 남에게 넘기는 update는
 * DB에서 그 자리에 거부된다 (`0008` 2절). 데모·폴백 모드에는 RLS가 없어 이 함수가 유일한
 * 층이므로, 화면에서 감추는 것으로 갈음하지 않는다.
 *
 * ## 내용 수정 — 권한이 아니라 화면 규칙이다
 *
 * `canEditTaskDetails`는 세 역할 모두 참이다. 서버가 재는 것은 이 값이 아니라 행 범위
 * (`taskEditable`)와 RLS·컬럼 GRANT이고, `PATCH`도 이 함수를 부르지 않는다 — 여기서 재는
 * 것은 「그 칸을 패널에 그릴 것인가」뿐이다.
 *
 * ⚠ **예전 이름은 `canEditProgress`였고 대표·실장에게 거짓이었다.** 근거는 「전사를 보는
 *   자리에 진행률 폼이 있으면 남의 업무 숫자를 대신 적게 된다」였다. 그 폼이 진행률 두 칸이
 *   아니라 **업무 내용**(마감·다음 조치·비고·업무명)을 고치는 자리가 되면서 근거가 사라졌다 —
 *   회의 중에 마감을 옮겨 적는 사람이 바로 대표·실장이다. 함수를 남겨 둔 것은 「화면에서
 *   뺀 것」과 「막은 것」이 **여전히 다른 값이어야** 하기 때문이다: 이 값을 권한 검사로
 *   옮겨 쓰지 않는다.
 *
 * ## 만들기·지우기 — 권한이다
 *
 * 둘 다 부원에게 닫혀 있고, 그 판정은 **세 층**이다: 이 파일(앱), 라우트가 부르는 같은 함수,
 * 그리고 `tasks_insert_scope`·`tasks_delete_scope`(DB, `0013`). 업무를 만드는 것은 「일을
 * 나눠 주는」 일이고 지우는 것은 되돌릴 수 없다 — 둘 다 팀을 끌고 가는 사람의 조작이다
 * (`staff-tools.ts`와 같은 결).
 *
 * **만들 수 있는 팀은 역할마다 다르다** (`creatableTeams`). 팀장이 전 팀을 보게 됐어도
 * 만드는 곳은 자기 팀이다 — 보는 것과 손대는 것을 가르는 `0012`의 규칙 그대로다.
 *
 * ## 고를 수 있는 담당자
 *
 * `assignableMembers`는 **그 업무의 팀**으로만 좁힌다. 팀 밖 사람을 담당자로 넣으면
 * `tasks_update_scope`가 막지는 않지만(팀은 그대로다) 그 업무는 담당자에게 보이지 않는다 —
 * 부원의 열람 조건이 `owner_member_id = my_member_id()`이고 팀 화면은 팀으로 서기 때문이다.
 * 고를 수 없게 두는 편이 정직하다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { MemberRecord } from '@/types/auth';
import type { TeamKey } from '@/types/task';

/** 담당자를 지정·재지정할 수 있는가. **권한이다** (머리말) */
export function canAssignOwner(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}

/** 내용 수정 칸을 **그릴 것인가.** 권한이 아니다 (머리말) */
export function canEditTaskDetails(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
    case 'member':
      return true;
  }
}

/**
 * **부원에게 닫힌 칸.** `canEditTaskDetails`가 「이 역할에게 수정이라는 조작이 있는가」라면,
 * 이쪽은 「그 조작이 **어느 칸까지** 닿는가」다.
 *
 * 가르는 선은 하나다 — 부원은 **자기가 한 일의 사실**을 적고, **조직의 판단**은 적지 않는다.
 *
 * - `dueAt`: 자기 마감을 자기가 미루면 지연 판정이 무의미해진다. 이 화면의 절반이 그 위에 선다.
 * - `priority`·`riskStatus`: 무엇이 급한가·무엇이 위험한가는 팀의 판단이다. 특히 리스크는
 *   **경고 신호**라, 당사자가 지울 수 있으면 신호가 아니다.
 * - `approvalStatus`: 결재 결과다. 당사자가 적으면 승인 절차가 없는 것과 같다.
 * - `assignedAt`: 배정 기록. 사실이 아니라 이력이다.
 * - `title`: 업무의 정체성이고 시트 자연키의 재료다.
 * - `nextActionOwner`: 남에게 일을 넘기는 칸이라 배정 쪽에 가깝다.
 *
 * 반대로 `status`·`progress`·`nextAction`·`nextActionDue`·`delayReason`·`note`와 팀 전용
 * 칸(`extras`)은 **열어 둔다.** 그 칸들이 막히면 부원에게 이 화면은 읽기 전용이고, 특히
 * 지연 사유는 당사자만 아는 값이라 막으면 「지연인데 이유 없음」만 쌓인다.
 *
 * 담당자 두 칸은 여기 없다 — `canAssignOwner`가 이미 진다.
 *
 * ⚠ **화면에서 잠그는 것으로 갈음하지 않는다.** `PATCH /api/tasks/[id]`가 같은 함수를 불러
 *   거부한다. DB에는 이 축의 정책이 없다(컬럼 GRANT는 역할이 아니라 칸 단위라 부원과 팀장을
 *   가르지 못한다) — 그래서 앱 층이 유일한 자물쇠이고, 그만큼 두 곳이 같은 목록을 봐야 한다.
 */
export const MEMBER_LOCKED_FIELDS: readonly string[] = [
  'title',
  'assignedAt',
  'dueAt',
  'priority',
  'riskStatus',
  'approvalStatus',
  'nextActionOwner',
];

/** 그 역할이 **못 고치는** 칸. 팀장·어드민은 빈 목록이다 */
export function lockedTaskFields(role: ViewerRole): readonly string[] {
  switch (role) {
    case 'admin':
    case 'lead':
      return [];
    case 'member':
      return MEMBER_LOCKED_FIELDS;
  }
}

/**
 * 단계 한 줄에서 **부원에게 닫힌 칸.** `MEMBER_LOCKED_FIELDS`와 **같은 선**을 긋는다 —
 * 부원은 자기가 한 일의 사실을 적고, 조직의 판단은 적지 않는다.
 *
 * - `plannedDate`(계획일): 단계의 마감이다. 자기가 미루면 「계획보다 늦었다」 표시가
 *   무의미해진다 (`dueAt`을 잠그는 이유 그대로 · `task-panel.tsx`의 `isLate`).
 * - 나머지 셋(`actualDate`·`confirmStatus`·`content`)은 **연다.** 언제 실제로 했고 무엇을
 *   했는지는 당사자만 아는 값이고, 막으면 편집팀 부원에게 단계 표가 읽기 전용이 된다.
 *
 * ⚠ 업무 쪽과 마찬가지로 **DB에 이 축의 정책이 없다** — 컬럼 GRANT는 칸 단위라 부원과
 *   팀장을 가르지 못한다. 앱 층이 유일한 자물쇠이고, 라우트가 같은 함수를 부른다.
 */
export const MEMBER_LOCKED_STAGE_FIELDS: readonly string[] = ['plannedDate'];

/** 그 역할이 단계에서 **못 고치는** 칸. 팀장·어드민은 빈 목록이다 */
export function lockedStageFields(role: ViewerRole): readonly string[] {
  switch (role) {
    case 'admin':
    case 'lead':
      return [];
    case 'member':
      return MEMBER_LOCKED_STAGE_FIELDS;
  }
}

/** 업무를 만들 수 있는가. **권한이다** (머리말 · `tasks_insert_scope`) */
export function canCreateTask(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}

/** 업무를 지울 수 있는가. **권한이다** (머리말 · `tasks_delete_scope`) */
export function canDeleteTask(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}

/**
 * **어느 팀에 만들 수 있는가.** 화면의 팀 드롭다운이 이 목록으로 서고, 라우트가 같은
 * 함수로 거부한다 — 목록에 없는 팀을 실어 보내면 403이다.
 *
 * 팀을 모르는 팀장에게 전부를 열지 않는다. 「모른다」를 「전부」로 접지 않는 규율은
 * `team-visibility.ts`·`viewer-scope.ts`와 같다.
 */
export function creatableTeams(role: ViewerRole, teamId: TeamKey | null): readonly TeamKey[] {
  if (!canCreateTask(role)) return [];
  if (role === 'admin') return TEAM_KEYS;

  return teamId === null ? [] : [teamId];
}

/**
 * 담당자 후보. 입력 배열을 고치지 않는다 — 정렬은 새 배열에서 한다
 * (`join-request-rows.ts`의 후보 정렬과 같은 규율).
 */
export function assignableMembers(
  members: readonly MemberRecord[],
  teamId: TeamKey
): MemberRecord[] {
  return members
    .filter((member) => member.teamId === teamId)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}
