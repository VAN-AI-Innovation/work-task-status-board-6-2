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
import {
  COMPACT_KPI_KEYS,
  DASHBOARD_LAYOUT,
  dashboardLayoutFor,
  FIXED_HEIGHT,
  DETAIL_LABELS,
  layoutFor,
  TEAM_PAGE_LAYOUT,
  SECTION_ORDER,
  SECTION_SPAN,
  SECTION_ZONE,
  sectionsFor,
  type SectionKey,
} from '@/lib/view/role-layout';

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

/**
 * `ADR-019`의 검증면. 여기서 재는 것은 **「예쁘게 놓였나」가 아니라 셋**이다 —
 * 섹션이 하나도 빠지지 않는가, 역할별로 맨 위에 오는 것이 여전히 다른가,
 * 한 행이 12칸을 넘지 않는가.
 */
/**
 * 세로로 쌓인 칸에서 **남는 높이를 먹지 않는 섹션**. KPI 타일이 옆 카드 높이에 맞춰 늘어나면
 * 숫자 하나가 뜬 빈 상자가 된다 — 아래에 쌓인 차트가 그 높이를 가져가야 한다.
 */
describe('FIXED_HEIGHT', () => {
  it('KPI 두 종류만 높이를 고정한다', () => {
    expect([...FIXED_HEIGHT].sort()).toEqual(['kpi', 'kpi_compact']);
  });
});

describe('SECTION_ZONE · SECTION_SPAN', () => {
  const ALL_KEYS = SECTION_ORDER.admin.concat('kpi_compact');

  it('모든 섹션이 zone과 폭을 갖는다 — 빠지면 화면에서 조용히 사라진다', () => {
    for (const key of ALL_KEYS) {
      expect(SECTION_ZONE[key]).toBeDefined();
      expect(SECTION_SPAN[key]).toBeGreaterThan(0);
    }
  });

  it('어떤 섹션도 12칸을 넘지 않는다', () => {
    for (const key of ALL_KEYS) {
      expect(SECTION_SPAN[key]).toBeLessThanOrEqual(12);
    }
  });

  it('업무 표만 `table` zone이고, 접히는 것은 목표·브리핑·승인 대기다', () => {
    const zoneOf = (zone: string): SectionKey[] =>
      ALL_KEYS.filter((key) => SECTION_ZONE[key] === zone).sort();

    expect(zoneOf('table')).toEqual(['tasks']);
    expect(zoneOf('detail')).toEqual(['approvals', 'briefing', 'goals']);
  });
});

describe('layoutFor', () => {
  it('섹션을 하나도 잃지 않는다 — 배치는 레이아웃이고 삭제는 권한이다 (T8)', () => {
    for (const role of ROLES) {
      const placed = layoutFor(role).flatMap((row) => row.cells.flatMap((cell) => cell.keys));

      expect(placed.sort()).toEqual([...SECTION_ORDER[role]].sort());
    }
  });

  it('한 행의 폭 합이 12를 넘지 않는다', () => {
    for (const role of ROLES) {
      for (const row of layoutFor(role)) {
        const used = row.cells.reduce((acc, cell) => acc + cell.span, 0);

        expect(used).toBeLessThanOrEqual(12);
      }
    }
  });

  /**
   * 짝(`groups`)이 없으면 한 행은 zone 하나다. 짝은 zone을 섞을 수 있다 — 팀 화면의
   * 「상태 분포 + 목표 대비 성과」가 그 경우이고, 그 예외는 아래 화면별 옵션에서 잰다.
   */
  it('짝을 주지 않으면 한 행에는 zone이 하나뿐이다', () => {
    for (const role of ROLES) {
      for (const row of layoutFor(role)) {
        const zones = row.cells.flatMap((cell) => cell.keys).map((key) => SECTION_ZONE[key]);

        expect(new Set(zones)).toEqual(new Set([row.zone]));
      }
    }
  });

  /**
   * 완료 기준 7이 묻는 것은 **「무엇이 맨 위냐」**다. zone 순서를 역할 배열에서 유도하므로
   * `SECTION_ORDER`의 첫 섹션이 곧 화면의 첫 섹션이어야 한다.
   */
  it('맨 위에 오는 섹션이 역할 배열의 첫 섹션과 같다', () => {
    for (const role of ROLES) {
      expect(layoutFor(role)[0]?.cells[0]?.keys[0]).toBe(SECTION_ORDER[role][0]);
    }
  });

  it('업무 표는 맨 아래다 — `member`만 예외로 맨 위다', () => {
    for (const role of ['admin', 'lead'] as const) {
      const rows = layoutFor(role);
      expect(rows[rows.length - 1]?.cells[0]?.keys[0]).toBe('tasks');
    }

    expect(layoutFor('member')[0]?.cells[0]?.keys[0]).toBe('tasks');
  });

  it('zone이 흩어지지 않는다 — 같은 zone의 행이 이어서 나온다', () => {
    for (const role of ROLES) {
      const zones = layoutFor(role).map((row) => row.zone);
      const collapsed = zones.filter((zone, index) => zone !== zones[index - 1]);

      expect(collapsed).toEqual([...new Set(zones)]);
    }
  });

  /**
   * **짝은 데이터의 성질에서 온다.** 팀별 현황(표)과 팀별 완료율(그림)은 같은 팀 축을 두
   * 방식으로 보는 둘이고, 알림과 상태 분포는 「지금 문제」와 「전체 그림」이다. 자동 배치는
   * 빈칸을 줄일 뿐 이 짝을 모르므로 화면이 정한다 (`DASHBOARD_LAYOUT`).
   */
  it('대시보드의 두 짝이 각각 한 행에 선다', () => {
    for (const role of ROLES) {
      const rowOf = (key: SectionKey): SectionKey[] | undefined =>
        layoutFor(role, DASHBOARD_LAYOUT)
          .find((row) => row.cells.some((cell) => cell.keys.includes(key)))
          ?.cells.flatMap((cell) => cell.keys);

      expect(rowOf('teams')).toEqual(['teams', 'completion']);
      expect(rowOf('alerts')).toEqual(
        // `member`의 축약 KPI는 상태 분포 위에 쌓여 같은 행에 들어온다
        role === 'member' ? ['alerts', 'kpi_compact', 'charts'] : ['alerts', 'charts']
      );
    }
  });

  it('짝 행에는 다른 섹션이 끼어들지 않는다 — 화면이 의도한 조합이다', () => {
    for (const role of ROLES) {
      for (const row of layoutFor(role, DASHBOARD_LAYOUT)) {
        const keys = row.cells.flatMap((cell) => cell.keys);
        if (!keys.includes('alerts')) continue;

        for (const key of keys) expect(['alerts', 'kpi_compact', 'charts']).toContain(key);
      }
    }
  });

  /**
   * **알림과 상태 분포는 폭이 같다.** 「지금 문제」와 「전체 그림」은 어느 쪽도 곁다리가
   * 아니라서, 한쪽이 좁으면 그쪽이 부속처럼 읽힌다.
   */
  it('알림과 상태 분포가 같은 폭으로 선다', () => {
    for (const role of ROLES) {
      const row = layoutFor(role, DASHBOARD_LAYOUT).find((item) =>
        item.cells.some((cell) => cell.keys.includes('alerts'))
      );
      const spanOf = (key: SectionKey): number | undefined =>
        row?.cells.find((cell) => cell.keys.includes(key))?.span;

      expect(spanOf('alerts')).toBe(6);
      expect(spanOf('charts')).toBe(6);
    }
  });

  /**
   * `member`의 축약 KPI 3칸은 **상태 분포 바로 위**에 같은 폭으로 쌓인다 — 12칸을 혼자
   * 쓰면 타일 셋이 화면 폭만큼 벌어지고, 알림 옆은 그만큼 비어 있다.
   */
  it('축약 KPI가 상태 분포 위 같은 칸에 쌓인다', () => {
    const row = layoutFor('member', DASHBOARD_LAYOUT).find((item) =>
      item.cells.some((cell) => cell.keys.includes('kpi_compact'))
    );

    expect(row?.cells.map((cell) => cell.keys)).toEqual([['alerts'], ['kpi_compact', 'charts']]);
  });

  /** 10칸짜리 전체 KPI는 그대로 한 행을 다 쓴다 — 6칸에 5열 그리드를 넣지 않는다 */
  it('`admin`·`lead`의 전체 KPI는 12칸을 유지한다', () => {
    for (const role of ['admin', 'lead'] as const) {
      const row = layoutFor(role, DASHBOARD_LAYOUT).find((item) =>
        item.cells.some((cell) => cell.keys.includes('kpi'))
      );

      expect(row?.cells).toEqual([{ keys: ['kpi'], span: 12 }]);
    }
  });

  it('접히는 셋이 한 행에 나란히 선다', () => {
    for (const role of ROLES) {
      const detail = layoutFor(role, DASHBOARD_LAYOUT).filter((row) => row.zone === 'detail');

      expect(detail).toHaveLength(1);
      expect(detail[0]?.cells).toHaveLength(3);
    }
  });
});

/**
 * 팀 화면은 **섹션이 더 적고 폭도 다르다** — 전사 요약표·승인 대기함·브리핑이 없어서
 * 대시보드의 폭 조합(12 / 7+5 / 12)이 그대로면 알림 옆 7칸이 빈 채로 남는다. 그래서
 * `only`로 걸러 내고 `spans`로 그 화면의 폭을 준다. 규칙(zone 순서·행 폭)은 그대로다.
 */
describe('layoutFor — 화면별 옵션', () => {
  const TEAM_ONLY = TEAM_PAGE_LAYOUT.only ?? [];

  const placed = (role: ViewerRole): SectionKey[] =>
    layoutFor(role, TEAM_PAGE_LAYOUT).flatMap((row) =>
      row.cells.flatMap((cell) => cell.keys)
    );

  it('`only`에 없는 섹션은 배치되지 않는다', () => {
    for (const role of ROLES) {
      expect(placed(role).every((key) => TEAM_ONLY.includes(key))).toBe(true);
      expect(placed(role)).not.toContain('briefing');
    }
  });

  it('`only`로 걸러도 그 화면에 있는 섹션은 하나도 잃지 않는다', () => {
    for (const role of ROLES) {
      const expected = SECTION_ORDER[role].filter((key) => TEAM_ONLY.includes(key));

      expect(placed(role).sort()).toEqual([...expected].sort());
    }
  });

  it('`spans`가 폭을 덮어쓴다 — 덮지 않은 섹션은 기본값 그대로다', () => {
    const cells = layoutFor('admin', TEAM_PAGE_LAYOUT).flatMap((row) => row.cells);
    const spanOf = (key: SectionKey): number | undefined =>
      cells.find((cell) => cell.keys[0] === key)?.span;

    expect(spanOf('charts')).toBe(6);
    expect(spanOf('charts')).not.toBe(SECTION_SPAN.charts);
    expect(spanOf('kpi')).toBe(SECTION_SPAN.kpi);
  });

  /**
   * **두 화면의 배치가 같아야 한다.** 같은 사람이 대시보드에서 팀 화면으로 넘어갈 때 카드가
   * 자리를 바꾸면 매번 어디를 봐야 하는지 다시 찾는다. 값이 갈리는 것은 `only`(그릴 수 있는
   * 섹션) 하나뿐이고, 폭과 짝은 같은 값을 쓴다.
   */
  it('팀 화면의 폭과 요약 행 짝이 대시보드와 같다', () => {
    // 요약 행 셋만 비교한다 — 목표 대비 성과는 팀 화면에서만 6칸이다(접히는 카드가 하나뿐)
    for (const key of ['alerts', 'charts', 'kpi_compact'] as const) {
      expect(TEAM_PAGE_LAYOUT.spans?.[key]).toBe(DASHBOARD_LAYOUT.spans?.[key]);
    }
    expect(TEAM_PAGE_LAYOUT.spans?.goals).toBe(TEAM_PAGE_LAYOUT.spans?.alerts);
    expect(DASHBOARD_LAYOUT.spans?.goals).toBeUndefined();
    // 대시보드에만 있는 짝은 「팀별 현황 + 완료율」 하나이고, 요약 행 짝은 두 화면이 공유한다
    expect(DASHBOARD_LAYOUT.groups).toEqual(
      expect.arrayContaining([...(TEAM_PAGE_LAYOUT.groups ?? [])])
    );
  });

  it('알림 오른쪽 칸에 축약 KPI와 상태 분포가 세로로 쌓인다 — 대시보드와 같은 모양이다', () => {
    const row = layoutFor('member', TEAM_PAGE_LAYOUT).find((item) =>
      item.cells.some((cell) => cell.keys.includes('alerts'))
    );

    expect(row?.cells.map((cell) => cell.keys)).toEqual([['alerts'], ['kpi_compact', 'charts']]);
  });

  /** 축약 KPI가 없는 역할에서는 짝에서 그것만 빠지고 나머지는 그대로 선다 */
  it('admin·lead에서는 오른쪽 칸이 상태 분포 하나로 줄어든다', () => {
    for (const role of ['admin', 'lead'] as const) {
      const row = layoutFor(role, TEAM_PAGE_LAYOUT).find((item) =>
        item.cells.some((cell) => cell.keys.includes('charts'))
      );

      expect(row?.cells.every((cell) => !cell.keys.includes('kpi_compact'))).toBe(true);
    }
  });

  it('한 섹션이 두 번 그려지지 않는다 — 세로로 쌓인 목표가 접힌 행에 또 나오면 안 된다', () => {
    for (const role of ROLES) {
      expect(new Set(placed(role)).size).toBe(placed(role).length);
    }
  });

  /**
   * `first`가 들어온 뒤 바뀐 자리다. 첫 줄은 세 역할이 같고(업무 표), **차이는 그 다음
   * 줄부터** 남는다 — 완료 기준 7이 재는 것은 여전히 성립한다.
   */
  it('세 역할 모두 업무 표가 맨 위다', () => {
    for (const role of ROLES) {
      expect(layoutFor(role, TEAM_PAGE_LAYOUT)[0]?.cells[0]?.keys[0]).toBe('tasks');
    }
  });

  it('업무 표 아래의 순서는 역할마다 여전히 다르다', () => {
    const second = (role: ViewerRole): SectionKey | undefined =>
      layoutFor(role, TEAM_PAGE_LAYOUT)[1]?.cells[0]?.keys[0];

    expect(second('admin')).toBe('kpi');
    expect(second('lead')).toBe('alerts');
    expect(second('member')).toBe('alerts');
  });
});

/**
 * `first`는 **순서만** 바꾼다. 더하지도 빼지도 않는다는 것이 여기서 지키는 전부이고,
 * 그래야 배치 규칙(zone·폭·짝)이 이 옵션을 몰라도 된다.
 */
describe('layoutFor — first', () => {
  it('적은 섹션이 맨 앞에 선다', () => {
    for (const role of ROLES) {
      const rows = layoutFor(role, { first: ['alerts'] });

      expect(rows[0]?.cells[0]?.keys[0]).toBe('alerts');
    }
  });

  it('섹션을 더하지도 빼지도 않는다', () => {
    for (const role of ROLES) {
      const keysOf = (screen: Parameters<typeof layoutFor>[1]): SectionKey[] =>
        layoutFor(role, screen).flatMap((row) => row.cells.flatMap((cell) => cell.keys)).sort();

      expect(keysOf({ first: ['tasks'] })).toEqual(keysOf({}));
    }
  });

  it('그 화면에 없는 섹션을 적어도 끌어오지 않는다', () => {
    const rows = layoutFor('admin', { only: ['kpi', 'tasks'], first: ['briefing', 'tasks'] });
    const keys = rows.flatMap((row) => row.cells.flatMap((cell) => cell.keys));

    expect(keys).toEqual(['tasks', 'kpi']);
  });

  it('앞으로 끌어올린 뒤에도 남은 순서는 그대로다', () => {
    const rest = layoutFor('admin', { first: ['tasks'] })
      .flatMap((row) => row.cells.flatMap((cell) => cell.keys))
      .filter((key) => key !== 'tasks');

    expect(rest[0]).toBe('kpi');
  });

  /** 두 화면이 같은 값을 쓴다 — 한쪽만 올리면 화면을 옮길 때 업무 표가 위아래로 뛴다 */
  it('대시보드와 팀 화면 모두 업무 표를 맨 위로 올린다', () => {
    for (const role of ROLES) {
      expect(layoutFor(role, DASHBOARD_LAYOUT)[0]?.cells[0]?.keys[0]).toBe('tasks');
      expect(layoutFor(role, TEAM_PAGE_LAYOUT)[0]?.cells[0]?.keys[0]).toBe('tasks');
    }
    expect(DASHBOARD_LAYOUT.first).toEqual(TEAM_PAGE_LAYOUT.first);
  });
});

/**
 * 「부원의 대시보드에서 전사 비교를 뺀다」의 검증면. 재는 것은 **셋 다 갈래가 있다**는
 * 것이다 — 부원+세션에서만 빠지고, 데모에서는 그대로이며, 다른 역할은 손대지 않는다.
 */
describe('dashboardLayoutFor', () => {
  const placed = (role: ViewerRole, hasSession: boolean): SectionKey[] =>
    layoutFor(role, dashboardLayoutFor(role, hasSession)).flatMap((row) =>
      row.cells.flatMap((cell) => cell.keys)
    );

  it('로그인한 부원에게서 팀별 현황·완료율이 빠진다', () => {
    expect(placed('member', true)).not.toContain('teams');
    expect(placed('member', true)).not.toContain('completion');
  });

  it('부원의 나머지 섹션은 그대로다 — 뺀 것은 그 둘뿐이다', () => {
    const expected = SECTION_ORDER.member.filter(
      (key) => key !== 'teams' && key !== 'completion'
    );

    expect(placed('member', true).sort()).toEqual([...expected].sort());
  });

  it('세션이 없으면 좁히지 않는다 — 데모에서는 역할 기본값이 `member`다', () => {
    expect(placed('member', false)).toContain('teams');
    expect(placed('member', false)).toContain('completion');
  });

  it('대표·팀장은 로그인해도 그대로다 — 전사 비교의 모수가 맞는 자리다', () => {
    for (const role of ['admin', 'lead'] as const) {
      expect(placed(role, true)).toContain('teams');
      expect(placed(role, true)).toContain('completion');
      expect(dashboardLayoutFor(role, true)).toBe(DASHBOARD_LAYOUT);
    }
  });

  it('걸러도 업무 표는 여전히 맨 위다 — 화면 옵션 둘이 함께 산다', () => {
    expect(layoutFor('member', dashboardLayoutFor('member', true))[0]?.cells[0]?.keys[0]).toBe(
      'tasks'
    );
  });
});

describe('DETAIL_LABELS', () => {
  it('접히는 섹션 셋의 이름이 다 있다 — 이름이 없으면 접힌 줄이 비어 보인다', () => {
    const detail = SECTION_ORDER.admin.filter((key) => SECTION_ZONE[key] === 'detail');

    for (const key of detail) {
      expect(DETAIL_LABELS[key]).toBeTruthy();
    }
  });
});
