/**
 * 10칸을 **묶어서** 읽게 만드는 규칙의 검증면.
 *
 * 여기서 지키는 것은 셋이다 — 타일을 **하나도 잃지 않는다**(모르는 키까지), 묶음 안의 순서가
 * 정해져 있다, 색은 **문제일 때만** 붙는다.
 */

import { describe, expect, it } from 'vitest';

import { buildKpiStrip } from '@/lib/domain/progress-stats';
import type { KpiTile } from '@/lib/domain/progress-stats';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { groupKpiTiles, TEAM_TILE_KEYS, toneOf, withoutTeamTiles } from '@/lib/view/kpi-groups';

/** 실제로 화면에 오는 배열. 업무가 0건이어도 10칸은 그대로 나온다 */
const TILES = buildKpiStrip([], {
  today: '2026-08-22',
  semanticIndex: buildSemanticIndex(null),
});

const tile = (key: string, value: number | null): KpiTile => ({
  key,
  label: key,
  value,
  unit: 'count',
});

describe('groupKpiTiles', () => {
  it('타일을 하나도 잃지 않는다', () => {
    const grouped = groupKpiTiles(TILES).flatMap((group) => group.tiles);

    expect(grouped.map((item) => item.key).sort()).toEqual(TILES.map((item) => item.key).sort());
  });

  it('같은 타일이 두 묶음에 들어가지 않는다', () => {
    const keys = groupKpiTiles(TILES).flatMap((group) => group.tiles.map((item) => item.key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('10칸이 네 묶음으로 선다 — 전체·팀별·대기·기한', () => {
    expect(groupKpiTiles(TILES).map((group) => group.key)).toEqual([
      'overview',
      'teams',
      'waiting',
      'deadline',
    ]);
  });

  it('묶음마다 이름이 있다 — 이름 없는 묶음은 그냥 상자 넷이다', () => {
    for (const group of groupKpiTiles(TILES)) {
      expect(group.label).not.toBe('');
    }
  });

  it('빈 묶음은 서지 않는다 — 팀 타일을 뺀 화면에서는 셋이다', () => {
    const groups = groupKpiTiles(withoutTeamTiles(TILES));

    expect(groups.map((group) => group.key)).toEqual(['overview', 'waiting', 'deadline']);
  });

  it('모르는 키도 버리지 않는다 — 맨 뒤 묶음에 남는다', () => {
    const groups = groupKpiTiles([...TILES, tile('brand_new', 3)]);
    const last = groups[groups.length - 1];

    expect(last?.tiles.map((item) => item.key)).toContain('brand_new');
  });

  it('입력 순서가 아니라 묶음이 정한 순서로 선다', () => {
    const groups = groupKpiTiles([...TILES].reverse());

    expect(groups[0]?.tiles.map((item) => item.key)).toEqual(['active_total', 'completion_rate']);
  });

  it('입력 배열을 뒤집지 않는다', () => {
    const before = TILES.map((item) => item.key);
    groupKpiTiles(TILES);

    expect(TILES.map((item) => item.key)).toEqual(before);
  });
});

describe('withoutTeamTiles', () => {
  it('팀별 진행 셋만 빠진다', () => {
    const left = withoutTeamTiles(TILES).map((item) => item.key);

    expect(left).toHaveLength(TILES.length - TEAM_TILE_KEYS.length);
    for (const key of TEAM_TILE_KEYS) expect(left).not.toContain(key);
  });

  it('팀 타일 키가 `buildKpiStrip`이 실제로 내는 키다 — 오타면 아무것도 안 빠진다', () => {
    for (const key of TEAM_TILE_KEYS) {
      expect(TILES.map((item) => item.key)).toContain(key);
    }
  });
});

/**
 * **눈에 띄는 것은 문제뿐이다** (`UI_GUIDE.md`). 0인 지연에 빨강이 붙으면 화면의 절반이
 * 색을 갖고 진짜 신호가 묻힌다.
 */
describe('toneOf', () => {
  it('지연이 한 건이라도 있으면 빨강이다', () => {
    expect(toneOf(tile('overdue', 1))).toBe('late');
  });

  it('마감 임박은 앰버다', () => {
    expect(toneOf(tile('due_soon', 2))).toBe('warn');
  });

  it('0이면 색이 없다', () => {
    expect(toneOf(tile('overdue', 0))).toBe('normal');
    expect(toneOf(tile('due_soon', 0))).toBe('normal');
  });

  it('값이 null이면 색이 없다 — 「셀 수 없다」에 경고를 붙이지 않는다', () => {
    expect(toneOf(tile('overdue', null))).toBe('normal');
  });

  it('나머지 타일은 값이 커도 색이 없다', () => {
    expect(toneOf(tile('active_total', 999))).toBe('normal');
    expect(toneOf(tile('approval_waiting', 12))).toBe('normal');
  });
});
