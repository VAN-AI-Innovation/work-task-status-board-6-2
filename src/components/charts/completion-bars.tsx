/**
 * 팀별 완료율 가로 바. 값은 `buildCompletionBars`가, 빠진 팀은 `unmeasurableTeams`가 낸다.
 *
 * **완료율이 `null`인 팀은 막대가 없다.** 0%로 그리면 「완료가 하나도 없는 팀」과
 * 「셀 것이 없는 팀」이 같은 그림이 되므로, 그런 팀은 막대 대신 아래 줄에 「—」로 적는다.
 *
 * 팀 이름은 `teamLabel`에서 온다 — 막대 축과 이 줄이 같은 표를 쓴다.
 */

'use client';

import { Bar } from 'react-chartjs-2';

import { registerCharts } from '@/components/charts/chart-registry';
import { CHART_AXIS, CHART_GRID, type ChartSeries } from '@/lib/view/chart-series';
import { teamLabel } from '@/lib/view/team-slug';
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
    /*
     * 격자선은 한 겹이다 (`UI_GUIDE.md`) — 세로선만 남긴다.
     * `autoSkip: false`가 중요하다: 차트가 낮으면 Chart.js가 축 라벨을 **말없이 건너뛰고**,
     * 그러면 완료율 0%라 막대도 없는 팀이 화면에서 통째로 사라진 것처럼 보인다.
     */
    y: { ticks: { color: CHART_AXIS, autoSkip: false }, grid: { display: false } },
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
    <div className="flex h-full flex-col">
      {/*
       * 높이가 **고정이 아니라 하한**이다. 옆 카드가 길어져 이 칸이 늘어나면 막대도 함께
       * 길어진다 — `maintainAspectRatio: false`라 컨테이너를 그대로 따른다. 늘어난 자리를
       * 빈칸으로 두지 않으려는 것이고, 240px 고정이던 시절에는 그 반대(빈 여백)였다.
       */}
      <div className="min-h-[128px] flex-1">
        <Bar
          data={{
            labels: series.labels,
            datasets: [
              {
                label: '완료율 (%)',
                data: series.values,
                backgroundColor: series.colors,
                borderWidth: 0,
                // 상태 분포와 같은 이유로 두께 상한을 둔다 (`status-bars.tsx`)
                maxBarThickness: 22,
              },
            ],
          }}
          options={OPTIONS}
        />
      </div>
      {unmeasurable.length > 0 && (
        <p className="text-ink-muted mt-2 text-xs">
          완료율 — (모수 0): {unmeasurable.map(teamLabel).join(', ')}
        </p>
      )}
    </div>
  );
}
