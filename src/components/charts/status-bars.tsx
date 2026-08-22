/**
 * 상태 분포 가로 막대. **스택 바를 대체한다** (`ADR-019`).
 *
 * 스택 바는 세로를 거의 안 먹어서 옆에 세울 카드가 없었다 — 알림처럼 길어지는 카드 옆에
 * 두면 그쪽이 통째로 비었다. 막대 여섯 개는 **세로를 채우고 옆 카드를 따라 늘어난다.**
 * 값이 비율이 아니라 건수라, 조각이 작아도 축을 보고 읽을 수 있다.
 *
 * 값·라벨·색은 `toStatusSeries`가 확정해 넘긴 것이다. 여기서 세지 않는다.
 */

'use client';

import { Bar } from 'react-chartjs-2';

import { registerCharts } from '@/components/charts/chart-registry';
import { CHART_AXIS, CHART_GRID, type ChartSeries } from '@/lib/view/chart-series';

registerCharts();

const OPTIONS = {
  animation: false as const,
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  // 라벨이 y축에 있고 계열이 하나뿐이라 범례가 같은 말을 두 번 한다
  plugins: { legend: { display: false } },
  scales: {
    /*
     * 건수는 정수다. 자동 눈금이 `0.5`를 찍으면 「반 건」이 있는 것처럼 보인다.
     * 격자선은 한 겹이고(`UI_GUIDE.md`) 세로선만 남긴다.
     */
    x: {
      min: 0,
      ticks: { color: CHART_AXIS, precision: 0 },
      grid: { color: CHART_GRID },
    },
    y: { ticks: { color: CHART_AXIS, autoSkip: false }, grid: { display: false } },
  },
};

export function StatusBars({ series }: { series: ChartSeries }) {
  return (
    // 높이는 **고정이 아니라 하한**이다. 옆 카드가 길어지면 막대도 함께 길어진다
    <div className="min-h-[168px] flex-1">
      <Bar
        data={{
          labels: series.labels,
          datasets: [
            {
              label: '건수',
              data: series.values,
              backgroundColor: series.colors,
              borderWidth: 0,
              /*
               * 카드가 옆 알림을 따라 길어지면 막대가 **두꺼워지는 게 아니라 사이가
               * 벌어져야 한다.** 상한이 없으면 막대 여섯이 카드 높이를 나눠 가져 손가락처럼
               * 굵어지고, 그때 이 그림은 데이터가 아니라 벽지처럼 보인다.
               */
              maxBarThickness: 22,
            },
          ],
        }}
        options={OPTIONS}
      />
    </div>
  );
}
