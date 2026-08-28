/**
 * 업무 하나를 놓고 **누가 무엇을 고치는가.** 업무 패널(`UC-15`)이 여는 칸이 둘인데 그 둘의
 * 대상이 정반대라서 한 파일에서 판정한다.
 *
 * | | 담당자 지정 | 상태·진행률 |
 * |---|---|---|
 * | `admin` | ○ | ✕ |
 * | `lead` | ○ | ○ |
 * | `member` | ✕ | ○ |
 *
 * ## 담당자 지정 — 권한이다
 *
 * `canAssignOwner`는 **세 층 중 하나**다. 나머지 둘은 `PATCH /api/tasks/[id]`가 부르는
 * 이 함수와, DB의 `tasks_update_scope`다 — 그 정책의 `with check`가 부원의 업무에서
 * `owner_member_id = my_member_id()`를 요구하므로, 부원이 담당자를 남에게 넘기는 update는
 * DB에서 그 자리에 거부된다 (`0008` 2절). 데모·폴백 모드에는 RLS가 없어 이 함수가 유일한
 * 층이므로, 화면에서 감추는 것으로 갈음하지 않는다.
 *
 * ## 상태·진행률 — 권한이 아니라 화면 규칙이다
 *
 * `canEditProgress`가 대표·실장에게 거짓인 것은 **못 하게 막는 것이 아니다.** 서버는 여전히
 * 받는다 — RLS도 GRANT도 admin의 update를 허용하고, `PATCH`도 이 함수를 부르지 않는다.
 * 여기서 재는 것은 「그 칸을 패널에 그릴 것인가」뿐이다. 진행률을 손수 적는 것은 그 업무를
 * 들고 있는 사람의 일이고(`UC-16`), 전사를 보는 자리에 그 폼이 있으면 남의 업무 숫자를
 * 대신 적게 된다.
 *
 * 그래서 이 함수를 **권한 검사로 옮겨 쓰지 않는다.** 옮기는 순간 「화면에서 뺀 것」과
 * 「막은 것」이 같은 값을 쓰게 되고, 둘 중 하나가 바뀔 때 다른 하나가 조용히 딸려 온다.
 *
 * ## 고를 수 있는 담당자
 *
 * `assignableMembers`는 **그 업무의 팀**으로만 좁힌다. 팀 밖 사람을 담당자로 넣으면
 * `tasks_update_scope`가 막지는 않지만(팀은 그대로다) 그 업무는 담당자에게 보이지 않는다 —
 * 부원의 열람 조건이 `owner_member_id = my_member_id()`이고 팀 화면은 팀으로 서기 때문이다.
 * 고를 수 없게 두는 편이 정직하다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
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

/** 상태·진행률 수정 칸을 **그릴 것인가.** 권한이 아니다 (머리말) */
export function canEditProgress(role: ViewerRole): boolean {
  switch (role) {
    case 'lead':
    case 'member':
      return true;
    case 'admin':
      return false;
  }
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
