/**
 * 시트 `00_통합 대시보드` 5행의 10칸을 **그대로** 뿌린다.
 *
 * 라벨도 순서도 개수도 여기서 정하지 않는다 — `buildKpiStrip`이 확정해 뒀고(`ADR-006`),
 * 화면이 라벨을 다시 지으면 「시트와 1:1로 대응하는가」(T6 완료 기준 1)를 대조할 수 없다.
 * 이 컴포넌트가 아는 것은 `grid-cols-5` 2행이라는 배치뿐이다. 타일이 낮은 것은 의도다 —
 * 10칸이 두 줄이라 타일 하나가 20px 커질 때마다 첫 화면이 40px씩 밀린다 (`ADR-019`).
 *
 * **증감 배지를 만들지 않는다.** 비교할 직전 값이 우리 데이터에 없다. 없는 숫자를 그리면
 * 대시보드가 그럴듯하게 거짓말한다.
 *
 * `compact`는 `member`의 축약 3칸이다 (`COMPACT_KPI_KEYS`). **고르는 것은 페이지가 하고**
 * 여기는 3칸을 5열 그리드에 넣지 않도록 배치만 바꾼다 — 남은 두 칸이 빈자리로 남으면 사용자는
 * 타일이 로드에 실패했다고 읽는다.
 */

import type { KpiTile } from '@/lib/domain/progress-stats';
import { formatKpi } from '@/lib/view/kpi-format';

export function KpiStrip({ tiles, compact = false }: { tiles: KpiTile[]; compact?: boolean }) {
  return (
    <section>
      <h2 className="sr-only">KPI</h2>
      <div className={`grid gap-3 ${compact ? 'grid-cols-3' : 'grid-cols-5'}`}>
        {tiles.map((tile) => (
          <div key={tile.key} className="border-line bg-panel rounded border px-3 py-2.5">
            <div className="text-ink text-xl font-semibold tabular-nums">{formatKpi(tile)}</div>
            <div className="text-ink-muted mt-0.5 text-xs">{tile.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
