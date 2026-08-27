/**
 * 합류 요청 목록을 화면이 그대로 그릴 수 있는 행으로 옮긴다 (T11 · `/team/requests`).
 *
 * `lib/view`에 있는 이유는 `goal-view.ts`·`alert-groups.ts`와 같다 — **표시 규칙**이고,
 * 그 덕에 화면(`page.tsx`)에는 계산이 한 줄도 없고 컴포넌트는 props를 받아 JSX만 뱉는다.
 *
 * ## 후보를 좁히는 것이 이 파일의 본체다
 *
 * 승인 화면의 `<select>`에 서는 것은 **그 요청자의 팀에 속하고 아직 계정이 붙지 않은**
 * 명부 행뿐이다. `approve_join`도 나머지를 거부하지만(`member not in target team` ·
 * `member already linked`), 거부는 **누른 뒤에** 온다 — 고를 수 있게 두면 리더는 실패를
 * 겪고 나서야 규칙을 배운다. 두 벌인 것은 의도다: DB가 진짜 문이고 여기는 문 앞의 안내다.
 *
 * **팀을 모르는 요청과 반려된 요청에는 후보가 없다.** 앞은 `approve_join`이
 * `target has no team`으로 막고, 뒤는 대상이 `pending`이 아니라 승인 자체가 성립하지 않는다
 * (`0005` 4-4). 누를 수 없는 자리에 고를 것을 두지 않는다.
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

/** `<select>`의 한 칸. `authUserId`를 브라우저로 내보내지 않는다 (`S6`) */
export interface MemberCandidate {
  id: string;
  name: string;
}

export interface JoinRequestRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  /** 한글 팀 이름. 트리거가 팀을 못 붙였으면 `null`이다 (`0005` 3절) */
  teamName: string | null;
  status: JoinRequestStatus;
  /** KST `YYYY-MM-DD`. 파싱 불가면 `null` */
  requestedOn: string | null;
  /** 「기존 명부 행에 잇기」의 후보. 반려·팀 미상이면 빈 배열이다 (머리말) */
  candidates: readonly MemberCandidate[];
}

function candidatesFor(request: JoinRequest, members: readonly MemberRecord[]): MemberCandidate[] {
  if (request.status !== 'pending' || request.teamId === null) return [];

  return members
    .filter((member) => member.teamId === request.teamId && member.authUserId === null)
    .map((member) => ({ id: member.id, name: member.name }))
    // 저장소가 준 순서를 화면 순서로 삼지 않는다 — 같은 목록이 요청마다 달리 서면 잘못 고른다
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
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
    candidates: candidatesFor(request, members),
  }));
}
