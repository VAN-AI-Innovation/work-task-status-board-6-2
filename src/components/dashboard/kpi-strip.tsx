/**
 * 시트 `00_통합 대시보드` 5행의 10칸을 **네 묶음으로** 뿌린다.
 *
 * 라벨도 순서도 개수도 여기서 정하지 않는다 — 값은 `buildKpiStrip`이, 묶음은
 * `groupKpiTiles`가 확정해 뒀다 (`ADR-006`). 이 컴포넌트가 아는 것은 **묶음 하나가 카드
 * 하나**라는 것과, 묶음의 타일 수만큼 폭을 나눠 갖는다는 배치뿐이다.
 *
 * ## 상자 열 개를 카드 넷으로
 *
 * 예전에는 타일마다 테두리가 있어 5열 두 줄, 상자 열 개가 전부 같은 무게로 섰다. 열 개가
 * 같은 무게면 읽는 사람이 매번 「어느 숫자가 지금 중요한가」를 다시 고른다 — 그것은 요약이
 * 아니라 목록이다. 지금은 테두리가 **묶음에만** 있고 타일은 그 안에서 이름표를 공유한다.
 *
 * 폭은 타일 수에 비례한다(`basis-0` + `grow-[n]`). 묶음마다 칸 폭이 같아야 타일이 어느
 * 묶음에 속하든 같은 크기로 읽힌다 — 묶음을 같은 폭으로 나누면 3칸짜리가 2칸짜리보다 좁아진다.
 *
 * ## 색은 `toneOf`가 정한다
 *
 * 여기서 값을 보고 판단하지 않는다. 지연·마감 임박이 0보다 클 때만 색이 붙고 나머지는
 * 색이 없다 (`UI_GUIDE.md`「눈에 띄는 것은 문제뿐이다」).
 *
 * **증감 배지를 만들지 않는다.** 비교할 직전 값이 우리 데이터에 없다. 없는 숫자를 그리면
 * 대시보드가 그럴듯하게 거짓말한다.
 *
 * `compact`는 `member`의 축약 3칸이다 (`COMPACT_KPI_KEYS`). 셋뿐이라 묶지 않는다 —
 * 묶음 이름표가 타일보다 커진다.
 */

import type { KpiTile } from '@/lib/domain/progress-stats';
import { groupKpiTiles, toneOf, type KpiTone } from '@/lib/view/kpi-groups';
import { formatKpi } from '@/lib/view/kpi-format';

/**
 * Tailwind는 소스를 훑어 클래스를 만든다 — `` `grow-[${n}]` ``은 CSS가 생성되지 않아 폭이
 * 통째로 무너진다 (`section-grid.tsx`의 `SPAN_CLASS`와 같은 이유로 리터럴이다).
 */
const GROW_CLASS: Readonly<Record<number, string>> = {
  1: 'grow-[1]',
  2: 'grow-[2]',
  3: 'grow-[3]',
  4: 'grow-[4]',
};

const COLS_CLASS: Readonly<Record<number, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

const TONE_CLASS: Readonly<Record<KpiTone, string>> = {
  normal: 'text-ink',
  warn: 'text-warn',
  late: 'text-late',
};

function Tile({ tile }: { tile: KpiTile }) {
  return (
    <div className="min-w-0">
      <div className={`text-xl font-semibold tabular-nums ${TONE_CLASS[toneOf(tile)]}`}>
        {formatKpi(tile)}
      </div>
      <div className="text-ink-muted mt-0.5 text-xs break-keep">{tile.label}</div>
    </div>
  );
}

export function KpiStrip({ tiles, compact = false }: { tiles: KpiTile[]; compact?: boolean }) {
  if (compact) {
    return (
      <section>
        <h2 className="sr-only">KPI</h2>
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((tile) => (
            <div key={tile.key} className="border-line bg-panel rounded border px-3 py-2.5">
              <Tile tile={tile} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="sr-only">KPI</h2>
      {/* 좁은 폭에서는 묶음을 세로로 쌓는다 — 넷을 가로로 세우면 타일이 글자 폭보다 좁아진다 */}
      <div className="flex flex-col gap-3 lg:flex-row">
        {groupKpiTiles(tiles).map((group) => (
          <section
            key={group.key}
            className={`border-line bg-panel min-w-0 basis-0 rounded border px-3 py-2.5 ${
              GROW_CLASS[group.tiles.length] ?? 'grow'
            }`}
          >
            {/* 묶음 이름은 타일 라벨보다 작고 흐리다 — 읽는 순서가 값 → 라벨 → 묶음이다 */}
            <h3 className="text-ink-faint text-[11px] font-medium">{group.label}</h3>
            <div className={`mt-1.5 grid gap-3 ${COLS_CLASS[group.tiles.length] ?? 'grid-cols-3'}`}>
              {group.tiles.map((tile) => (
                <Tile key={tile.key} tile={tile} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
