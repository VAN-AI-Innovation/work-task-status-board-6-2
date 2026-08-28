/**
 * 합류 요청 목록을 화면이 그대로 그릴 수 있는 행으로 옮긴다 (T11 · `/members` 아래).
 *
 * `lib/view`에 있는 이유는 `goal-view.ts`·`alert-groups.ts`와 같다 — **표시 규칙**이고,
 * 그 덕에 화면(`page.tsx`)에는 계산이 한 줄도 없고 컴포넌트는 props를 받아 JSX만 뱉는다.
 *
 * ## 명부 연결을 **여기서 정한다** — 리더가 고르지 않는다
 *
 * 예전에는 화면에 `<select>`가 있어서 리더가 시트 담당자 행을 골라 승인했다. 그 칸을 없앴다:
 * 실제로 리더가 답할 수 있는 질문은 「이 사람을 받아들일까」 하나이고, 「시트의 어느 줄에
 * 붙일까」는 **이름을 보면 정해지는 것**이라 사람에게 물을 일이 아니었다. 승인 한 번에
 * 드롭다운을 열게 만드는 비용은 매번 드는데, 고르는 값은 열에 아홉 뻔했다.
 *
 * 그래서 규칙을 하나로 못박는다.
 *
 * - 같은 팀에 **이름이 같고 계정이 안 붙은** 명부 행이 있으면 → 그 행에 잇는다.
 * - 없으면 → 가입할 때 적은 이름으로 **새 행을 만든다**.
 *
 * 이름 비교는 앞뒤 공백을 뗀 뒤 한다. 앞의 갈래가 필요한 이유는 `members`에
 * `unique (team_id, name)`이 걸려 있기 때문이다 — 같은 이름으로 새 행을 만들면 **승인이
 * 예외로 튕긴다** (`0005` 4-4). 이미 남에게 붙은 행과 다른 팀 행은 각각
 * `member already linked`·`member not in target team`이라 뒤 갈래로 보낸다.
 *
 * ⚠ 이름이 시트와 다르면 새 행이 생기고, 그 사람은 자기 업무를 못 본다(`unknown_owner`).
 *   그것은 **조용한 실패가 아니다** — 대시보드가 「담당자로 연결된 계정이 없다」고 말하고,
 *   고치는 자리는 `/members`다. 승인 화면에서 미리 맞히려다 틀리는 것보다 낫다.
 *
 * **팀을 모르는 요청·반려된 요청·이름이 없는 요청에는 연결이 없다**(`link === null`).
 * 앞의 둘은 `approve_join`이 `target has no team`·`pending`이 아님으로 막고, 마지막은
 * 명부에 적을 이름을 여기서 지어낼 수 없기 때문이다.
 *
 * ## 지어내지 않는다
 *
 * 팀 이름은 `teamLabel()`에서만 오고(`team-slug.ts`), 읽을 수 없는 시각은 `null`이다.
 * 이름·이메일이 비어 있으면 비운 채로 넘긴다 — 「(이름 없음)」 같은 문구를 고르는 것은
 * 화면의 몫이고, 여기서 채워 넣으면 없는 값이 있는 값처럼 저장된다.
 */

import { kstDateOf } from '@/lib/domain/kst-today';
import { teamLabel } from '@/lib/view/team-slug';
import type { JoinRequest, JoinRequestStatus } from '@/types/api';
import type { MemberRecord } from '@/types/auth';

/**
 * 승인이 명부에 하는 일. `approve_join`의 인자 둘(`member_id`·`new_member_name`) 중
 * **정확히 하나**에 대응한다 (`0005` 4-4) — 그 배타성이 타입에 그대로 있어야 화면이
 * 둘 다 보내거나 둘 다 빠뜨릴 수 없다.
 *
 * `authUserId`를 담지 않는다. 브라우저로 나가는 값이다 (`S6`).
 */
export type JoinLink =
  | { kind: 'existing'; memberId: string; memberName: string }
  | { kind: 'new'; name: string };

export interface JoinRequestRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  /** 한글 팀 이름. 트리거가 팀을 못 붙였으면 `null`이다 (`0005` 3절) */
  teamName: string | null;
  status: JoinRequestStatus;
  /** KST `YYYY-MM-DD`. 파싱 불가면 `null` */
  requestedOn: string | null;
  /** 승인이 명부에 할 일. **`null`이면 승인할 수 없는 요청이다** (머리말) */
  link: JoinLink | null;
}

/** `members.name`·`profiles.display_name`의 상한과 같다 (`0005` 1절) */
const NAME_MAX_LENGTH = 40;

function linkFor(request: JoinRequest, members: readonly MemberRecord[]): JoinLink | null {
  if (request.status !== 'pending' || request.teamId === null) return null;

  const wanted = request.displayName?.trim() ?? '';
  // 이름이 없으면 새 행도 못 만들고(`new_member_name`이 필수다) 맞출 이름도 없다
  if (wanted === '') return null;

  const matched = members.find(
    (member) =>
      member.teamId === request.teamId &&
      member.authUserId === null &&
      member.name.trim() === wanted
  );

  return matched === undefined
    ? { kind: 'new', name: wanted.slice(0, NAME_MAX_LENGTH) }
    : { kind: 'existing', memberId: matched.id, memberName: matched.name };
}

/**
 * **목록 순서를 바꾸지 않는다.** `pending_requests()`가 `created_at, id`로 이미 정렬해 준다
 * (`0005` 4-1) — 여기서 다시 세우면 서버가 본 순서와 화면이 그린 순서가 갈린다.
 */
export function toJoinRequestRows(
  requests: readonly JoinRequest[],
  members: readonly MemberRecord[]
): JoinRequestRow[] {
  return requests.map((request) => ({
    userId: request.userId,
    displayName: request.displayName,
    email: request.email,
    teamName: request.teamId === null ? null : teamLabel(request.teamId),
    status: request.status,
    requestedOn: kstDateOf(request.createdAt),
    link: linkFor(request, members),
  }));
}
