/**
 * 상태 분포 가로 막대. **스택 바를 대체한다** (`ADR-019`). 값이 비율이 아니라 건수라,
 * 조각이 작아도 축을 보고 읽을 수 있다.
 *
 * ## 높이가 고정이다
 *
 * 처음에는 옆 카드를 따라 늘어나게 뒀다 — 알림이 길어지는 카드였기 때문이다. 알림 묶음을
 * 접고 나서 그 전제가 뒤집혔다. **이제 늘어나는 쪽은 이 차트다.** 그리고 늘어나는 방식이
 * 문제였다: 부모 높이가 내용으로 정해지는 flex 칸 안에서 `responsive` 캔버스는 제 크기를
 * 다시 부모에 되먹여, 막대 여섯 개짜리 그림이 500px 넘게 자란다. 그 아래로 옆의 알림 카드가
 * 통째로 빈 채 끌려 나온다.
 *
 * 그래서 높이를 **확정 값**으로 준다 (`min-h` + `flex-1`이 아니다). 막대 여섯 줄과 x축이
 * 들어갈 만큼이고, 그 이상은 데이터가 아니라 여백이다.
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
    // 막대 여섯 줄(20px) + x축 눈금. 캔버스가 부모를 밀어내지 않도록 **확정 높이**로 둔다
    <div className="h-[152px]">
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
               * 상한이 없으면 막대 여섯이 카드 높이를 나눠 가져 손가락처럼 굵어지고, 그때
               * 이 그림은 데이터가 아니라 벽지처럼 보인다. 높이를 줄인 지금은 이 값이
               * **막대 사이 간격을 지키는 쪽**으로 일한다.
               */
              maxBarThickness: 16,
            },
          ],
        }}
        options={OPTIONS}
      />
    </div>
  );
}
