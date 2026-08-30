/**
 * 전사 멤버 화면(`/members`)에서 **누가 무엇을 열고 바꾸는지**를 정한다 (T11).
 *
 * `join-review.ts`와 나란한 자리이고 같은 규율을 따른다 — 판정이라 `lib/domain`에 있고
 * (`ADR-006`), 화면은 결과를 「패널을 여는 링크인가」·「버튼을 그리는가」로 옮길 뿐이다.
 * **파일을 따로 둔 것은 묻는 질문이 다르기 때문이다**: 저쪽은 「우리 팀에 들어오려는
 * 사람을 받아들일 수 있는가」이고 여기는 「남의 상세를 열고 직책을 바꿀 수 있는가」다.
 * 한 파일에 두면 다음에 한쪽 답이 바뀔 때 다른 쪽이 딸려 온다.
 *
 * ## 보는 것과 바꾸는 것이 다른 질문이다
 *
 * 함수가 둘인 이유가 그것이다. 조직도 **자체는 세 역할이 다 본다** — 「우리 조직에 누가
 * 있는가」는 부원에게도 필요한 사실이라 `canViewMembers`라는 문턱을 없앴다 (`0016`).
 * 갈리는 것은 그 다음 둘이다.
 *
 * - `canOpenMemberPanel` — **그 사람의 상세를 열 수 있는가.** 어드민은 전부, 팀장은 자기
 *   팀, 부원은 **자기 자신뿐**이다. 패널은 업무 진행까지 보여 주는 자리라, 문턱이 카드
 *   목록과 같을 수 없다.
 * - `canManageMembers` — 직책·팀을 바꾸고 내보낼 수 있는가. `set_role`·`remove_member`는
 *   admin이 아니면 예외를 던지므로(`0005` 4-7 · `0006`), 팀장에게 그 버튼을 보여 주면
 *   **403뿐인 버튼**을 누르게 된다.
 *
 * ## 감추는 것은 방어가 아니다
 *
 * 패널을 안 여는 것은 **헛걸음을 없애는 일**이지 방어가 아니다. 진짜 문은 DB다 —
 * 업무는 `tasks_select_scope`가 팀에서 자르고(`0015`), 직책 변경은 `set_role`이 예외를
 * 던지며(`0005` 4-7), 합류 요청은 `pending_requests()`가 대표·팀장만 받는다.
 *
 * ⚠ **이메일은 여기서 가리는 값이 아니다.** 조직도의 이메일은 연락처라 세 역할이 다 본다
 * (`0017` · `ADR-037`). 패널이 막는 것은 그 사람의 **업무 진행**이다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { TeamKey } from '@/types/task';

/** 판정에 쓰는 최소한. 보는 사람도 카드 하나도 「누구·어느 팀」이면 족하다 */
interface Identity {
  userId: string | null;
  teamId: TeamKey | null;
}

/**
 * 이 사람의 **상세 패널을 열 수 있는가** (머리말).
 *
 * 「모른다」를 「전부」로 접지 않는다 — 보는 사람의 팀이나 계정을 모르면 거짓이다.
 * null끼리 맞으면 팀 없는 계정이 팀 없는 사람 전부를 여는 갈래가 생긴다.
 */
export function canOpenMemberPanel(role: ViewerRole, viewer: Identity, node: Identity): boolean {
  switch (role) {
    case 'admin':
      return true;
    case 'lead':
      return viewer.teamId !== null && node.teamId === viewer.teamId;
    case 'member':
      return viewer.userId !== null && node.userId === viewer.userId;
  }
}

/** 직책·팀을 **바꾸고 내보낼 수 있는가.** 여기서 팀장은 부원과 같다 (머리말) */
export function canManageMembers(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
      return true;
    case 'lead':
    case 'member':
      return false;
  }
}
