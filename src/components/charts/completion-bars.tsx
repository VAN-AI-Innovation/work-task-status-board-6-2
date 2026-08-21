/**
 * 팀별 완료율 가로 바. 값은 `buildCompletionBars`가, 빠진 팀은 `unmeasurableTeams`가 낸다.
 *
 * **완료율이 `null`인 팀은 막대가 없다.** 0%로 그리면 「완료가 하나도 없는 팀」과
 * 「셀 것이 없는 팀」이 같은 그림이 되므로, 그런 팀은 막대 대신 아래 줄에 「—」로 적는다.
 *
 * ⚠ 팀 이름이 아직 `TeamKey`(`edit`·`shoot`·`marketing`)로 나온다. 한글 이름의 단일 소스는
 * step 6의 `team-slug.ts`이고, 그때 `buildCompletionBars`와 이 줄이 함께 그것을 쓴다.
 */

'use client';

import { Bar } from 'react-chartjs-2';

import { registerCharts } from '@/components/charts/chart-registry';
import { CHART_AXIS, CHART_GRID, type ChartSeries } from '@/lib/view/chart-series';
import type { TeamKey } from '@/types/task';

registerCharts();

const OPTIONS = {
  animation: false as const,
  responsive: true,
  maintainAspectRatio: false,
  // 가로 바
  indexAxis: 'y' as const,
  plugins: {
    legend: {
      position: 'bottom' as const,
      align: 'start' as const,
      labels: { color: CHART_AXIS, boxWidth: 10 },
    },
  },
  scales: {
    // 0~100 고정. 축이 데이터에 맞춰 늘었다 줄면 팀 간 막대 길이를 눈으로 비교할 수 없다
    x: { min: 0, max: 100, ticks: { color: CHART_AXIS }, grid: { color: CHART_GRID } },
    // 격자선은 한 겹이다 (`UI_GUIDE.md`) — 세로선만 남긴다
    y: { ticks: { color: CHART_AXIS }, grid: { display: false } },
  },
};

export function CompletionBars({
  series,
  unmeasurable,
}: {
  series: ChartSeries;
  unmeasurable: TeamKey[];
}) {
  return (
    <div>
      <div className="h-[240px]">
        <Bar
          data={{
            labels: series.labels,
            datasets: [
              {
                label: '완료율 (%)',
                data: series.values,
                backgroundColor: series.colors,
                borderWidth: 0,
              },
            ],
          }}
          options={OPTIONS}
        />
      </div>
      {unmeasurable.length > 0 && (
        <p className="text-ink-muted mt-2 text-xs">
          완료율 — (모수 0): {unmeasurable.join(', ')}
        </p>
      )}
    </div>
  );
}
