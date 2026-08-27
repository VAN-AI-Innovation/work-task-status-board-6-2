/**
 * 이 판정이 답하는 것은 하나다 — **표가 비었을 때 사용자에게 무엇을 시킬 것인가.**
 * 「업로드하세요」 · 「필터를 지우세요」 · 「계정 연결이 필요합니다」는 할 일이 서로 다르고,
 * 틀린 문구를 띄우면 사용자는 멀쩡한 데이터를 두고 엉뚱한 곳으로 간다 (`X3`).
 */

import { describe, expect, it } from 'vitest';

import { emptyReason } from '@/lib/view/empty-reason';
import type { Viewer } from '@/types/auth';

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: 'user-1',
    email: 'someone@example.com',
    role: 'member',
    teamId: 'edit',
    memberId: 'member-1',
    ...overrides,
  };
}

describe('emptyReason', () => {
  it('세션이 없으면 필터 유무만 본다', () => {
    expect(emptyReason(null, 0)).toBe('no-data');
    expect(emptyReason(null, 2)).toBe('no-match');
  });

  it('계정이 붙은 사람은 역할과 무관하게 같은 두 갈래다', () => {
    for (const role of ['admin', 'lead', 'member'] as const) {
      expect(emptyReason(viewer({ role }), 0)).toBe('no-data');
      expect(emptyReason(viewer({ role }), 1)).toBe('no-match');
    }
  });

  /*
   * `member`이면서 `memberId`가 없으면 **보일 수 있는 업무가 애초에 없다**
   * (`viewer-scope.ts`의 null 가드 · `PLAN.md` 결정 D). 「아직 데이터가 없습니다」를 띄우면
   * 그 사람은 전사 데이터가 있는데도 시트를 올리러 간다.
   */
  it('담당자에 연결되지 않은 member는 원인을 따로 말한다', () => {
    expect(emptyReason(viewer({ memberId: null }), 0)).toBe('unlinked-member');
  });

  it('그 사람에게는 필터를 지워도 달라지지 않으므로 문구가 그대로다', () => {
    expect(emptyReason(viewer({ memberId: null }), 3)).toBe('unlinked-member');
  });

  it('admin·lead는 `memberId`가 없어도 이 문구를 보지 않는다 — 그들에게 빈 표는 다른 뜻이다', () => {
    expect(emptyReason(viewer({ role: 'admin', memberId: null }), 0)).toBe('no-data');
    expect(emptyReason(viewer({ role: 'lead', memberId: null }), 0)).toBe('no-data');
    expect(emptyReason(viewer({ role: 'lead', memberId: null }), 1)).toBe('no-match');
  });
});
