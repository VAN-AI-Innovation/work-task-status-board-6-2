/**
 * 표가 비었을 때 **왜 비었는지**를 고른다. `X3`의 「빈 상태 ≠ 에러 상태」에서 빈 쪽만 다룬다 —
 * 조회 실패는 `error.tsx`가, 저장소 연결 실패는 배너가 진다.
 *
 * 갈래를 늘린 것이 아니라 **하나를 갈랐다.** T6까지 「데이터 없음」이던 화면이 로그인 뒤에는
 * 두 뜻을 갖는다 — 저장소가 진짜 비었거나, 아니면 그 사람에게 보일 업무가 없거나
 * (`viewer-scope.ts`가 `memberId`가 null인 `member`에게 아무것도 돌려주지 않는다,
 * `PLAN.md` 결정 D). 둘 다 「아직 데이터가 없습니다」로 그리면 부원은 전사 데이터가
 * 멀쩡히 있는데도 시트를 올리러 간다.
 *
 * **컴포넌트가 이 판정을 하지 않는다.** 페이지가 여기서 고른 값을 `EmptyState`에 넘긴다 —
 * 화면이 역할을 다시 해석하기 시작하면 「누가 무엇을 보는가」의 규칙이 셋째 자리에 생긴다.
 */

import type { Viewer } from '@/types/auth';

export type EmptyReason =
  /** 저장소에 아무것도 없다. 진입점(업로드·샘플)을 보여 준다 */
  | 'no-data'
  /** 걸린 필터 때문에 0건이다. 초기화 링크를 보여 준다 */
  | 'no-match'
  /** 로그인은 했는데 시트 담당자와 계정이 이어지지 않았다 (`unknown_owner`) */
  | 'unlinked-member';

/**
 * `unlinked-member`가 **가장 먼저** 선다. 그 사람에게는 필터를 지워도 결과가 달라지지
 * 않으므로 「필터 초기화」를 권하면 헛수고를 시키는 셈이다.
 *
 * `viewer`가 `null`인 것은 「로그인하지 않음」이자 「데모 모드」다. 둘 다 범위가 갈리지
 * 않으므로(`ADR-026` 아래 문단) 필터 유무만 본다.
 */
export function emptyReason(viewer: Viewer | null, activeFilters: number): EmptyReason {
  if (viewer !== null && viewer.role === 'member' && viewer.memberId === null) {
    return 'unlinked-member';
  }

  return activeFilters > 0 ? 'no-match' : 'no-data';
}
