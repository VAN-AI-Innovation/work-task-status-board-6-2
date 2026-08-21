/**
 * 시트 `00_통합 대시보드` 5행의 10칸을 **그대로** 뿌린다.
 *
 * 라벨도 순서도 개수도 여기서 정하지 않는다 — `buildKpiStrip`이 확정해 뒀고(`ADR-006`),
 * 화면이 라벨을 다시 지으면 「시트와 1:1로 대응하는가」(T6 완료 기준 1)를 대조할 수 없다.
 * 이 컴포넌트가 아는 것은 `grid-cols-5` 2행이라는 배치뿐이다.
 *
 * **증감 배지를 만들지 않는다.** 비교할 직전 값이 우리 데이터에 없다. 없는 숫자를 그리면
 * 대시보드가 그럴듯하게 거짓말한다.
 */

import type { KpiTile } from '@/lib/domain/progress-stats';
import { formatKpi } from '@/lib/view/kpi-format';

export function KpiStrip({ tiles }: { tiles: KpiTile[] }) {
  return (
    <section>
      <h2 className="sr-only">KPI</h2>
      <div className="grid grid-cols-5 gap-3">
        {tiles.map((tile) => (
          <div key={tile.key} className="border-line bg-panel rounded border p-4">
            <div className="text-ink text-2xl font-semibold tabular-nums">{formatKpi(tile)}</div>
            <div className="text-ink-muted mt-1 text-xs">{tile.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
