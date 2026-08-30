/**
 * KPI 10칸을 **묶어서** 읽게 만든다.
 *
 * ## 왜 묶는가
 *
 * 시트 `00_통합 대시보드` 5행의 10칸을 그대로 뿌리는 것이 `buildKpiStrip`이고 그 순서에는
 * 뜻이 있다 (`ADR-006` — 화면이 라벨을 다시 짓지 않는다). 그런데 **5열 두 줄로 깔면 열 개가
 * 전부 같은 무게로 서서**, 읽는 사람이 「지금 문제인 숫자」와 「그냥 규모인 숫자」를 매번
 * 다시 고른다. 상자가 열 개면 그것은 요약이 아니라 목록이다.
 *
 * 그래서 **세는 것은 그대로 두고 묶기만 한다.** 라벨도 값도 단위도 `buildKpiStrip`이 낸
 * 것이고 이 파일은 그 배열을 네 뭉치로 나눌 뿐이다 — 여기서 다시 세면 같은 라벨이 두 값을
 * 갖는다.
 *
 * | 묶음 | 답하는 질문 |
 * |---|---|
 * | 전체 | 얼마나 있고 얼마나 끝났나 |
 * | 팀별 진행 | 어디가 무겁나 |
 * | 대기 | 남이 붙잡고 있는 것 |
 * | 기한 | 언제까지인가 — **문제가 나오는 자리다** |
 *
 * ## 잃지 않는다
 *
 * 표에 없는 키가 와도 버리지 않고 맨 뒤 묶음에 남긴다. `buildKpiStrip`이 칸을 하나 늘리는
 * 날 이 파일을 고치지 않으면 그 칸이 **화면에서 조용히 사라지는데**, 아무도 알아채지 못한다.
 * 빈 묶음은 반대로 세우지 않는다 — 팀 화면은 팀별 진행 셋을 빼고 부르기 때문이다
 * (`withoutTeamTiles`).
 *
 * ## 색은 문제에만
 *
 * `toneOf`가 색을 갖는 것은 지연과 마감 임박 둘뿐이고 그나마 **0이면 없다**
 * (`UI_GUIDE.md`「눈에 띄는 것은 문제뿐이다」). 승인 대기·수정 요청도 할 일이지만 그것은
 * 아직 늦은 것이 아니라서 색을 주지 않는다 — 색이 「할 일」로 넓어지는 순간 화면의 절반이
 * 색을 갖고, 그때 빨강은 아무 뜻도 없다.
 */

import type { KpiTile } from '@/lib/domain/progress-stats';

/**
 * 팀별 진행 셋. **팀 화면에서 빼는 대상이다** — 편집팀 화면의 「촬영·기획팀 진행 0」은
 * 정보가 아니라 그 화면에서 늘 0인 칸이다 (팀 화면은 경로가 팀을 이미 좁혔다).
 *
 * 키를 손으로 적는 자리가 여기 하나뿐이고, 테스트가 `buildKpiStrip`의 실제 키와 대조한다.
 */
export const TEAM_TILE_KEYS: readonly string[] = ['edit_active', 'shoot_active', 'marketing_active'];

/** `normal` 말고는 문제라는 뜻이다. 화면이 색을 고르는 근거가 이 값 하나여야 한다 */
export type KpiTone = 'normal' | 'warn' | 'late';

export interface KpiGroup {
  key: string;
  /** 묶음 위에 작게 적는 이름. 빈 문자열을 두지 않는다 */
  label: string;
  tiles: KpiTile[];
}

/** 묶음 정의. **순서가 곧 화면 순서**이고, 묶음 안의 키 순서도 여기가 정한다 */
const GROUPS: readonly { key: string; label: string; keys: readonly string[] }[] = [
  { key: 'overview', label: '전체', keys: ['active_total', 'completion_rate'] },
  { key: 'teams', label: '팀별 진행', keys: TEAM_TILE_KEYS },
  { key: 'waiting', label: '대기', keys: ['approval_waiting', 'rework'] },
  { key: 'deadline', label: '기한', keys: ['due_this_week', 'due_soon', 'overdue'] },
];

/** 표에 없는 키가 모이는 자리. 이름이 「기타」인 것도 사실이다 — 지어내지 않는다 */
const LEFTOVER = { key: 'other', label: '기타' };

export function groupKpiTiles(tiles: readonly KpiTile[]): KpiGroup[] {
  const byKey = new Map(tiles.map((tile) => [tile.key, tile]));
  const groups: KpiGroup[] = [];

  for (const group of GROUPS) {
    const picked = group.keys.flatMap((key) => {
      const tile = byKey.get(key);
      if (tile === undefined) return [];
      byKey.delete(key);
      return [tile];
    });

    // 빈 묶음은 세우지 않는다 — 이름만 있고 아래가 빈 칸은 「불러오지 못했다」로 읽힌다
    if (picked.length > 0) groups.push({ ...group, tiles: picked });
  }

  const leftover = [...byKey.values()];
  if (leftover.length > 0) groups.push({ ...LEFTOVER, tiles: leftover });

  return groups;
}

/** 팀 화면이 쓰는 목록. 입력 배열은 고치지 않는다 */
export function withoutTeamTiles(tiles: readonly KpiTile[]): KpiTile[] {
  return tiles.filter((tile) => !TEAM_TILE_KEYS.includes(tile.key));
}

export function toneOf(tile: KpiTile): KpiTone {
  // `null`은 「셀 수 없다」다 (`KpiTile.value`). 모르는 것에 경고 색을 주지 않는다
  if (tile.value === null || tile.value <= 0) return 'normal';
  if (tile.key === 'overdue') return 'late';
  if (tile.key === 'due_soon') return 'warn';
  return 'normal';
}
