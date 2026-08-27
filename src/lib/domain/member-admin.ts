/**
 * 전사 멤버 목록을 **보고 역할을 바꿀 수 있는 역할**을 정한다 (T11 · `/members`).
 *
 * `join-review.ts`와 나란한 자리이고 같은 규율을 따른다 — 판정이라 `lib/domain`에 있고
 * (`ADR-006`), 화면은 결과를 `notFound()`로 옮길 뿐이며 사이드바는 같은 값으로 항목을
 * 감춘다. **파일을 따로 둔 것은 묻는 질문이 다르기 때문이다**: 저쪽은 「우리 팀에 들어오려는
 * 사람을 받아들일 수 있는가」이고 여기는 「전사 명부를 보고 팀장을 세울 수 있는가」다.
 * 한 파일에 두면 다음에 한쪽 답이 바뀔 때 다른 쪽이 딸려 온다.
 *
 * ## 팀장이 빠지는 것이 이 함수의 전부다
 *
 * `canReviewJoinRequests`는 `lead`에게 참인데 이쪽은 거짓이다. 근거는 취향이 아니라 DB다 —
 * `member_directory()`가 `my_role() = 'admin'`일 때만 행을 내고(`0005` 4-2), `set_role`은
 * admin이 아니면 예외를 던진다(4-6). 팀장에게 화면을 열어 주면 **빈 트리와 403뿐인 버튼**을
 * 보게 된다. 여기서 막는 것은 그 헛걸음을 없애는 일이다.
 *
 * ## 감추는 것은 방어가 아니다
 *
 * 이 값이 거짓일 때 화면을 404로 두는 것은 **정보를 줄이는 것**이지 방어가 아니다 —
 * 403 화면은 「어드민 전용 기능이 존재한다」를 알려 준다. 부원이 주소를 직접 쳐도 위 두
 * 함수가 각각 0행과 예외를 낸다 (`join-review.ts` 머리말과 같은 판단이다).
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

export function canManageMembers(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
      return true;
    // 팀장도 여기서는 부원과 같다 (머리말)
    case 'lead':
    case 'member':
      return false;
  }
}
