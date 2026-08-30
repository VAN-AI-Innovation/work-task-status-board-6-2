/**
 * 재는 것은 하나다 — **누가 합류 요청을 처리할 수 있는가.**
 *
 * 값 셋짜리 함수에 테스트를 두는 이유는 이 판정이 `/team/requests`의 **404 여부**를 정하기
 * 때문이다. 느슨해지면 부원에게 「팀장 전용 기능이 존재한다」가 새고, 좁아지면 팀장이
 * 자기 팀 요청을 못 본다. 둘 다 화면에서는 조용히 지나간다.
 */

import { describe, expect, it } from 'vitest';

import { canReviewJoinRequests } from '@/lib/domain/join-review';

describe('canReviewJoinRequests', () => {
  it('admin·lead는 처리할 수 있다', () => {
    expect(canReviewJoinRequests('admin')).toBe(true);
    expect(canReviewJoinRequests('lead')).toBe(true);
  });

  it('member는 못 한다 — 이 한 줄이 화면의 404를 정한다', () => {
    expect(canReviewJoinRequests('member')).toBe(false);
  });

  /*
   * DB와 규칙이 두 벌이다(`0005` 4-3의 `can_review_join`). 두 벌인 것은 의도이고
   * — 화면이 「왜 안 보이는가」를 설명하려면 JS 쪽에 규칙이 있어야 한다 — 그래서
   * **역할 축에서만큼은 글자 그대로 같아야 한다.** 팀 대조는 DB만 진다(아래).
   */
  it('팀을 보지 않는다 — 대상이 우리 팀인지는 `can_review_join`이 판정한다', () => {
    expect(canReviewJoinRequests.length).toBe(1);
  });
});
