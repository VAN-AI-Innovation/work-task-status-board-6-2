/**
 * 완료 기준 7(「`?as=`로 세 역할의 진입 화면이 각각 다르다」)의 검증면이다.
 *
 * 여기서 지키는 것은 둘이다 — **세 배열이 서로 다르다**(같으면 이 기능이 없는 것이다)와
 * **어느 역할에서도 섹션이 사라지지 않는다**(순서를 바꾸는 것은 헤지고 삭제는 권한이다.
 * 권한은 T8이다).
 */

import { describe, expect, it } from 'vitest';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { buildKpiStrip } from '@/lib/domain/progress-stats';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { COMPACT_KPI_KEYS, SECTION_ORDER, sectionsFor } from '@/lib/view/role-layout';

const ROLES: readonly ViewerRole[] = ['admin', 'lead', 'member'];

/** `buildKpiStrip`이 실제로 내는 `key` 값. 태스크가 0건이어도 10칸은 그대로 나온다 */
const KPI_KEYS = buildKpiStrip([], {
  today: '2026-08-22',
  semanticIndex: buildSemanticIndex(null),
}).map((tile) => tile.key);

describe('SECTION_ORDER', () => {
  it('세 역할의 순서가 서로 다르다 — 같으면 역할별 진입 화면이 없는 것이다', () => {
    const rendered = ROLES.map((role) => SECTION_ORDER[role].join('>'));

    expect(new Set(rendered).size).toBe(ROLES.length);
  });

  it('맨 위에 오는 것이 역할마다 다르다', () => {
    expect(SECTION_ORDER.admin[0]).toBe('kpi');
    expect(SECTION_ORDER.lead[0]).toBe('alerts');
    expect(SECTION_ORDER.member[0]).toBe('tasks');
  });

  it('어느 역할도 업무 표를 잃지 않는다', () => {
    for (const role of ROLES) {
      expect(SECTION_ORDER[role]).toContain('tasks');
    }
  });

  it('`member`만 축약 KPI를 쓰고 나머지는 10칸 KPI를 쓴다', () => {
    expect(SECTION_ORDER.member).toContain('kpi_compact');
    expect(SECTION_ORDER.member).not.toContain('kpi');

    for (const role of ['admin', 'lead'] as const) {
      expect(SECTION_ORDER[role]).toContain('kpi');
      expect(SECTION_ORDER[role]).not.toContain('kpi_compact');
    }
  });

  it('역할에 따라 섹션을 삭제하지 않는다 — KPI 칸 수만 다르고 나머지 집합은 같다', () => {
    const rest = (role: ViewerRole): string[] =>
      SECTION_ORDER[role].filter((key) => key !== 'kpi' && key !== 'kpi_compact').sort();

    expect(rest('lead')).toEqual(rest('admin'));
    expect(rest('member')).toEqual(rest('admin'));
  });

  it('같은 섹션이 두 번 들어 있지 않다 — 화면에 두 번 그려진다', () => {
    for (const role of ROLES) {
      expect(new Set(SECTION_ORDER[role]).size).toBe(SECTION_ORDER[role].length);
    }
  });
});

describe('sectionsFor', () => {
  it('역할의 배열을 그대로 돌려준다', () => {
    for (const role of ROLES) {
      expect(sectionsFor(role)).toEqual(SECTION_ORDER[role]);
    }
  });
});

describe('COMPACT_KPI_KEYS', () => {
  it('축약은 3칸이다', () => {
    expect(COMPACT_KPI_KEYS).toHaveLength(3);
  });

  it('`buildKpiStrip`이 실제로 내는 키의 부분집합이다 — 오타면 빈 칸 3개가 뜬다', () => {
    for (const key of COMPACT_KPI_KEYS) {
      expect(KPI_KEYS).toContain(key);
    }
  });

  it('전체 활성·마감 임박·지연이다 — 부원이 진입 3초 안에 보는 셋', () => {
    expect([...COMPACT_KPI_KEYS]).toEqual(['active_total', 'due_soon', 'overdue']);
  });
});
