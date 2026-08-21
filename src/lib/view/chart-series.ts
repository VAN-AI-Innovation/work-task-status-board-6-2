/**
 * 차트에 넘길 **라벨·값·색 배열을 만드는 곳**이다. 그리는 것은 `components/charts/`가 한다.
 *
 * 가르는 이유는 하나다 — **차트 컴포넌트가 세기 시작하면 도넛의 숫자와 KPI 타일의 숫자가
 * 갈라진다.** 갈라진 두 숫자는 어느 쪽도 못 믿게 되고, 그때 대시보드는 회의 자료로 쓸 수 없다.
 * 여기 있는 것은 전부 순수 함수이며 입력을 건드리지 않는다.
 *
 * 두 가지를 못박는다.
 *
 * - **라벨은 `DISPLAY_STATUS_LABELS`에서 온다.** 차트가 자기 라벨을 지으면 배지와 도넛이
 *   같은 상태를 다른 말로 부른다 (`UI_GUIDE.md`「상태 5색 구분」).
 * - **`muted`(기타)를 도넛에서 빼지 않는다.** 5색에 속하지 않지만 건수는 존재하고, 빼면
 *   조각의 합이 전체와 달라져 「이 그림은 무엇의 100%인가」를 아무도 모르게 된다.
 *
 * ⚠ **팀 한글 이름을 여기서 짓지 않는다.** `buildCompletionBars`는 `TeamKey`를 라벨로 낸다.
 * 한글 이름의 단일 소스는 step 6이 만들 `team-slug.ts`이고, 지금 여기에 임시 표를 두면
 * 그때 두 곳이 되어 갈라진다. **step 6이 이 함수의 라벨을 `team-slug.ts`로 바꾼다.**
 */

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import type { TeamSummary } from '@/lib/domain/progress-stats';
import type { DisplayStatus, TeamKey } from '@/types/task';

export interface ChartSeries {
  labels: string[];
  values: number[];
  colors: string[];
}

/**
 * 패널 배경(`#14171c`) 위에서 서로 구분되는 값이다 (`UI_GUIDE.md`「차트」).
 * 라이트 값의 단순 반전이 아니며, `muted`는 5색에 없어 가장 어두운 칸을 받는다.
 */
export const STATUS_COLORS: Readonly<Record<DisplayStatus, string>> = {
  planned: '#4b535f',
  in_progress: '#e8eaed',
  review: '#9aa1ab',
  done: '#2b313a',
  overdue: '#ef4444',
  muted: '#1f242b',
};

export const CHART_GRID = '#262b33';
export const CHART_AXIS = '#9aa1ab';

/**
 * 도넛 조각 순서. **고정이다** — 건수에 따라 순서가 흔들리면 같은 화면을 두 번 볼 때마다
 * 색의 자리가 달라져 눈이 다시 읽어야 한다. 문제(지연)를 맨 앞에, 물러난 것(완료·기타)을 뒤에 둔다.
 */
export const DONUT_ORDER: readonly DisplayStatus[] = [
  'overdue',
  'in_progress',
  'review',
  'planned',
  'done',
  'muted',
];

/**
 * 완료율 막대의 색. 상태 계열색을 재사용하지 않는다 — 완료율은 상태가 아니라 크기라서,
 * 예컨대 `done` 색을 쓰면 「완료 조각과 같은 것」으로 읽힌다. 무채색 한 가지로 둔다.
 */
const BAR_COLOR = '#9aa1ab';

/** 5색 + 기타. 순서는 `DONUT_ORDER`이고 **건수 0인 칸도 남긴다** */
export function buildStatusDonut(
  tasks: readonly { displayStatus: DisplayStatus }[]
): ChartSeries {
  const counts = new Map<DisplayStatus, number>(DONUT_ORDER.map((status) => [status, 0]));

  for (const task of tasks) {
    counts.set(task.displayStatus, (counts.get(task.displayStatus) ?? 0) + 1);
  }

  return {
    labels: DONUT_ORDER.map((status) => DISPLAY_STATUS_LABELS[status]),
    values: DONUT_ORDER.map((status) => counts.get(status) ?? 0),
    colors: DONUT_ORDER.map((status) => STATUS_COLORS[status]),
  };
}

/**
 * 팀별 완료율. `completionRate`가 `null`인 팀은 **막대를 만들지 않는다** —
 * 0%로 그리면 「완료가 하나도 없는 팀」과 「셀 것이 없는 팀」이 같은 그림이 된다.
 * 빠진 팀은 `unmeasurableTeams`가 따로 내고 화면이 「—」로 표시한다.
 */
export function buildCompletionBars(teams: readonly TeamSummary[]): ChartSeries {
  const measurable = teams.filter((team) => team.completionRate !== null);

  return {
    labels: measurable.map((team) => team.teamKey),
    values: measurable.map((team) => team.completionRate ?? 0),
    colors: measurable.map(() => BAR_COLOR),
  };
}

/** 완료율을 잴 수 없어 막대에서 빠진 팀 */
export function unmeasurableTeams(teams: readonly TeamSummary[]): TeamKey[] {
  return teams.filter((team) => team.completionRate === null).map((team) => team.teamKey);
}
