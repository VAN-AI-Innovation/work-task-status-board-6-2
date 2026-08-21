/**
 * 상태 분포 도넛. 조각 수·라벨·색·값은 전부 `buildStatusDonut`이 확정해 넘긴 것이고,
 * 이 컴포넌트는 **세지 않는다** (`CLAUDE.md` — 컴포넌트는 props 받아 JSX만 뱉는다).
 *
 * 중앙에 큰 숫자를 넣지 않는다 — 플러그인이나 절대배치 오버레이가 필요한데, 같은 숫자가
 * 이미 KPI 타일에 있다. 애니메이션은 꺼져 있다 (`UI_GUIDE.md` — 매번 튀면 도구가 아니다).
 */

'use client';

import { Doughnut } from 'react-chartjs-2';

import { registerCharts } from '@/components/charts/chart-registry';
import { CHART_AXIS, CHART_GRID, type ChartSeries } from '@/lib/view/chart-series';

registerCharts();

const OPTIONS = {
  animation: false as const,
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: {
      position: 'bottom' as const,
      align: 'start' as const,
      labels: { color: CHART_AXIS, boxWidth: 10 },
    },
  },
};

export function StatusDonut({ series }: { series: ChartSeries }) {
  return (
    // `maintainAspectRatio: false`와 짝인 고정 높이. 없으면 리사이즈마다 높이가 자란다
    <div className="h-[240px]">
      <Doughnut
        data={{
          labels: series.labels,
          datasets: [
            {
              label: '건수',
              data: series.values,
              backgroundColor: series.colors,
              // 조각 사이를 가르는 한 겹. 기본값이 흰색이라 다크에서 그대로 두면 테두리가 튄다
              borderColor: CHART_GRID,
              borderWidth: 1,
            },
          ],
        }}
        options={OPTIONS}
      />
    </div>
  );
}
