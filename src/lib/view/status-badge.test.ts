/**
 * 이 표가 지는 위험은 「색이 예쁘지 않다」가 아니라 **「화면마다 다른 한글이 뜬다」**다.
 * 표·사이드 패널·알림 패널이 같은 칸을 다른 말로 부르면 사용자는 두 화면이 다른 데이터를
 * 본다고 믿는다. 그래서 재는 것은 셋이다 — 칸이 다 있는가, 라벨이 도메인과 같은가,
 * 색을 갖는 칸이 지연 하나뿐인가.
 */

import { describe, expect, it } from 'vitest';

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import { badgeOf, rowClassOf, STATUS_BADGES } from '@/lib/view/status-badge';
import type { DisplayStatus } from '@/types/task';

const ALL = Object.keys(DISPLAY_STATUS_LABELS) as DisplayStatus[];

describe('STATUS_BADGES', () => {
  it('5색 + 기타 6칸이 빠짐없이 있다', () => {
    expect(Object.keys(STATUS_BADGES).sort()).toEqual(ALL.sort());
  });

  /**
   * 라벨을 여기서 다시 짓지 않는다는 것의 검증면이다. 도메인이 「검토」를 「리뷰」로 바꾸면
   * 배지도 함께 바뀌어야 하고, 그러지 않는 순간 배지와 도넛이 서로 다른 말을 한다.
   */
  it('라벨이 DISPLAY_STATUS_LABELS와 정확히 같다', () => {
    const labels = Object.fromEntries(
      Object.entries(STATUS_BADGES).map(([status, badge]) => [status, badge.label])
    );

    expect(labels).toEqual(DISPLAY_STATUS_LABELS);
  });

  it('색을 갖는 칸은 지연 하나뿐이다 — 나머지는 무채색 토큰만 쓴다', () => {
    const colored = ALL.filter((status) => /late|warn/.test(STATUS_BADGES[status].className));

    expect(colored).toEqual(['overdue']);
  });

  it('배지에 금지 팔레트가 없다 (UI_GUIDE.md 안티패턴 · 토큰 클래스만)', () => {
    for (const status of ALL) {
      expect(STATUS_BADGES[status].className).not.toMatch(
        /purple|violet|indigo|neutral-|bg-white|text-white|red-\d|amber-\d/
      );
    }
  });

  it('badgeOf는 표에 있는 것을 그대로 돌려준다', () => {
    for (const status of ALL) {
      expect(badgeOf(status)).toBe(STATUS_BADGES[status]);
    }
  });
});

describe('rowClassOf', () => {
  it('지연 행에만 좌측 보더가 붙는다', () => {
    expect(rowClassOf('overdue')).toContain('border-l-[3px]');
    expect(rowClassOf('overdue')).toContain('border-l-late-line');
  });

  /**
   * 진행 중이면서 마감이 지난 업무는 이미 `overdue` 칸이다 (`ADR-009`). 다른 칸에도 보더가
   * 붙으면 행 강조가 흔해져 지연이 눈에 안 띈다 — 「눈에 띄는 것은 문제뿐」(`UI_GUIDE.md`).
   */
  it('나머지 다섯 칸은 빈 문자열이다', () => {
    const accented = ALL.filter((status) => rowClassOf(status) !== '');

    expect(accented).toEqual(['overdue']);
  });
});
