/**
 * 합류 요청을 **처리할 수 있는 역할**을 정한다 (T11).
 *
 * `lib/domain`에 있는 이유는 이것이 표시 규칙이 아니라 **판정**이기 때문이다 —
 * `viewer-scope.ts`가 「무엇을 볼 수 있는가」를 지는 것과 같은 자리다 (`ADR-006`).
 * 화면(`/members`)은 이 결과로 요청 목록을 그릴지 정한다. 사이드바 항목은 조직도 쪽
 * 판정(`canViewMembers`)이 지므로 여기서 감추는 것은 목록 한 덩어리다.
 *
 * ## 팀을 보지 않는다
 *
 * 인자가 역할 하나뿐이다. 「그 요청자가 우리 팀인가」는 **DB만 판정한다**
 * (`0005` 4-3의 `can_review_join` · 4-1의 `pending_requests`). 팀 대조를 여기서도 하면
 * 규칙이 두 벌이 되는데, 이쪽 벌은 목록을 이미 좁혀 받은 뒤라 **아무것도 더 막지 못하면서**
 * 언젠가 DB 쪽과 어긋난다. 역할 축만 두 벌인 것은 근거가 있다 — 화면이 404를 낼지
 * 정하려면 조회하기 **전에** 알아야 하고, 그 시점에 DB에 물어볼 것이 없다.
 *
 * ## 감추는 것은 방어가 아니다
 *
 * 이 함수가 `true`를 돌려줘도 자격이 없으면 `pending_requests()`가 0행을 내고
 * `approve_join`이 예외를 던진다. 반대로 `false`일 때 화면을 404로 두는 것은 방어가 아니라
 * **정보를 줄이는 것**이다 — 403 화면은 「이 기능이 존재한다」를 알려 준다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

export function canReviewJoinRequests(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    // 부원에게는 이 화면이 **없는 것처럼** 보인다 (머리말)
    case 'member':
      return false;
  }
}
