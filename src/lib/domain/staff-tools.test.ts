/**
 * 재는 것은 하나뿐이다 — **리더 이상의 도구를 누가 여는가.**
 *
 * 세 값을 전부 못박는다. `ViewerRole`이 좁은 유니온이라 이 셋이 전수이고, 값이 하나
 * 늘어나면 `switch`가 컴파일에서 먼저 빨개진다 (`member-admin.test.ts`와 같은 규율).
 */

import { describe, expect, it } from 'vitest';

import {
  canReadWeeklyReport,
  canSeeOrgDashboard,
  canUseDocExtract,
} from '@/lib/domain/staff-tools';

describe('canUseDocExtract', () => {
  it('대표·실장은 참이다', () => {
    expect(canUseDocExtract('admin', true)).toBe(true);
  });

  it('팀장은 참이다 — 팀에 일을 나눠 주는 사람이 뽑는 표다', () => {
    expect(canUseDocExtract('lead', true)).toBe(true);
  });

  it('부원은 거짓이다', () => {
    expect(canUseDocExtract('member', true)).toBe(false);
  });
});

describe('canReadWeeklyReport', () => {
  it('대표·실장은 참이다', () => {
    expect(canReadWeeklyReport('admin', true)).toBe(true);
  });

  it('팀장은 참이다 — 회의에 들고 가는 문서다', () => {
    expect(canReadWeeklyReport('lead', true)).toBe(true);
  });

  it('부원은 거짓이다', () => {
    expect(canReadWeeklyReport('member', true)).toBe(false);
  });
});

/**
 * `team-visibility.ts`와 같은 규칙이다 — 데모에서는 범위가 갈리지 않는다. 이 갈래가 없으면
 * `.env` 없이 클론한 심사자에게 두 화면이 통째로 사라진다 (`PRD.md` 성공 기준 1).
 */
describe('세션이 없으면 좁히지 않는다', () => {
  it('로그인 전에는 세 역할 모두 참이다 — 기본값이 `member`이기 때문이다', () => {
    for (const role of ['admin', 'lead', 'member'] as const) {
      expect(canUseDocExtract(role, false)).toBe(true);
      expect(canReadWeeklyReport(role, false)).toBe(true);
    }
  });

  it('로그인한 부원에게만 거짓이다 — 두 갈래가 실제로 갈린다', () => {
    expect(canUseDocExtract('member', false)).toBe(true);
    expect(canUseDocExtract('member', true)).toBe(false);
  });
});

/**
 * **두 함수가 지금은 같은 답을 낸다.** 그래도 하나로 합치지 않는 이유가 여기 적혀 있다 —
 * 한쪽만 열어 달라는 요구가 오는 날 그 함수 하나만 바뀌어야 한다.
 */
describe('두 도구의 문턱', () => {
  it('지금은 세 역할 모두에서 답이 같다', () => {
    for (const role of ['admin', 'lead', 'member'] as const) {
      expect(canUseDocExtract(role, true)).toBe(canReadWeeklyReport(role, true));
    }
  });
});

/**
 * 전사 대시보드. 위 둘과 같은 물음이라 같은 파일에 있지만, 근거는 「도구」가 아니라
 * **범위**다 — 부원이 보는 전사 화면은 자기 팀을 전사라는 이름으로 다시 보는 자리다.
 */
describe('canSeeOrgDashboard', () => {
  it('팀장·어드민은 연다', () => {
    expect(canSeeOrgDashboard('admin', true)).toBe(true);
    expect(canSeeOrgDashboard('lead', true)).toBe(true);
  });

  it('부원은 못 연다 — 팀 대시보드 하나만 남는다', () => {
    expect(canSeeOrgDashboard('member', true)).toBe(false);
  });

  it('세션이 없으면 좁히지 않는다 — 데모에서 화면이 사라지면 안 된다', () => {
    expect(canSeeOrgDashboard('member', false)).toBe(true);
  });
});
