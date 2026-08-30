/**
 * 차트에 넘길 **라벨·값·색 배열을 만드는 곳**이다. 그리는 것은 `components/charts/`가 한다.
 *
 * 가르는 이유는 하나다 — **차트 컴포넌트가 세기 시작하면 스택 바의 숫자와 KPI 타일의 숫자가
 * 갈라진다.** 갈라진 두 숫자는 어느 쪽도 못 믿게 되고, 그때 대시보드는 회의 자료로 쓸 수 없다.
 * 여기 있는 것은 전부 순수 함수이며 입력을 건드리지 않는다.
 *
 * 두 가지를 못박는다.
 *
 * - **라벨은 `DISPLAY_STATUS_LABELS`에서 온다.** 차트가 자기 라벨을 지으면 배지와 스택 바가
 *   같은 상태를 다른 말로 부른다 (`UI_GUIDE.md`「상태 5색 구분」).
 * - **`muted`(기타)를 스택 바에서 빼지 않는다.** 5색에 속하지 않지만 건수는 존재하고, 빼면
 *   조각의 합이 전체와 달라져 「이 그림은 무엇의 100%인가」를 아무도 모르게 된다.
 * - **팀 한글 이름을 여기서 짓지 않는다.** `teamLabel`에서 가져온다 — 차트가 자기 표를 들면
 *   같은 팀이 축과 표에서 다른 이름으로 뜬다.
 */

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import type { TeamSummary } from '@/lib/domain/progress-stats';
import { teamLabel } from '@/lib/view/team-slug';
import type { DisplayStatus, TeamKey } from '@/types/task';

export interface ChartSeries {
  labels: string[];
  values: number[];
  colors: string[];
}

/**
 * 흰 패널(`#ffffff`) 위에서 서로 구분되는 값이다 (`UI_GUIDE.md`「차트」).
 *
 * ## 브랜드 남색 한 계열이다
 *
 * 예전에는 무채색 회색 램프였다. 화면의 다른 모든 것(사이드바 활성 항목·버튼·제목·배지)이
 * 브랜드 남색인데 차트만 회색이라, **차트가 이 제품의 것으로 보이지 않았다.** 지금은
 * `--color-brand`(`#1e3a5f`)에서 흰색 쪽으로 물러나는 한 계열이고, 그래서 조각의 진하기가
 * 그대로 「무게」로 읽힌다.
 *
 * 명도 방향은 그대로다 — **진행이 가장 진하고** 완료·기타는 배경 쪽으로 물러난다.
 * `muted`는 5색에 없어 가장 옅은 칸을 받는다.
 *
 * **지연만 다른 색이고, 그 빨강은 톤을 낮췄다** (`#dc2626` → `#b8555c`). 흰 바탕의 순색
 * 빨강은 막대 하나가 화면 전체를 끌어당겨, 옆의 남색 조각들이 배경처럼 보인다. 낮춘 빨강은
 * 남색 계열과 나란히 서면서도 「이것만 다른 것」이라는 사실은 잃지 않는다 — 대비를 색의
 * 채도가 아니라 **색상 자체**가 진다.
 *
 * ⚠ `--color-late`(`#c2181b`)를 여기 쓰지 않는다. 그 토큰은 **글자와 테두리**의 것이라
 *   작은 면적에서 읽히도록 진하고, 막대처럼 넓은 면적에 쓰면 같은 값이 다르게 보인다
 *   (`ADR-018`이 텍스트값과 테두리값을 가른 것과 같은 이유다).
 *
 * **화면 코드에 hex를 두지 않으려고 색이 여기 모여 있다** — Chart.js와 스택 바가 문자열
 * 색을 요구하고, 그것만이 토큰 클래스를 못 쓰는 자리다 (`ADR-018`).
 */
export const STATUS_COLORS: Readonly<Record<DisplayStatus, string>> = {
  in_progress: '#1e3a5f',
  review: '#41618a',
  planned: '#8aa2bd',
  done: '#c3d0de',
  overdue: '#b8555c',
  // 가장 옅은 칸이지만 스택 바의 빈 트랙(`bg-raise` `#f0f2f5`)보다는 진해야 한다 —
  // 같으면 「기타 6건」이 아무것도 없는 것처럼 보인다
  muted: '#dde4ec',
};

export const CHART_GRID = '#e2e5ea';
export const CHART_AXIS = '#697280';

/**
 * 스택 바 조각 순서. **고정이다** — 건수에 따라 순서가 흔들리면 같은 화면을 두 번 볼 때마다
 * 색의 자리가 달라져 눈이 다시 읽어야 한다. 문제(지연)를 맨 앞에, 물러난 것(완료·기타)을 뒤에 둔다.
 */
export const STATUS_ORDER: readonly DisplayStatus[] = [
  'overdue',
  'in_progress',
  'review',
  'planned',
  'done',
  'muted',
];

/**
 * 완료율 막대의 색. **브랜드 남색 하나다.**
 *
 * 예전에는 무채색이었고 근거는 「상태 계열색을 재사용하면 `done` 조각과 같은 것으로
 * 읽힌다」였다. 그 걱정은 남지만 답이 바뀌었다 — 이제 상태 계열 전체가 남색이라 회색으로
 * 피해 봐야 **화면에서 유일하게 회색인 차트**가 될 뿐이다. 대신 `done`(`#c3d0de`)에서 가장
 * 먼 끝, 즉 계열의 가장 진한 값을 쓴다. 두 차트가 나란히 서는 화면에서 이 막대가 완료
 * 조각보다 훨씬 진하므로 같은 것으로 읽히지 않는다.
 */
const BAR_COLOR = '#1e3a5f';

/** 스택 바 한 조각. 화면은 `percent`를 폭으로 그대로 쓴다 — 나눗셈을 컴포넌트에 두지 않는다 */
export interface StatusSegment {
  status: DisplayStatus;
  /** `DISPLAY_STATUS_LABELS`의 한글 */
  label: string;
  value: number;
  /** 0~100. 전체가 0건이면 0이다 */
  percent: number;
  color: string;
}

export interface StatusBreakdown {
  /** 조각 값의 합. 「무엇의 100%인가」를 화면이 적을 수 있게 함께 넘긴다 */
  total: number;
  segments: StatusSegment[];
}

/**
 * 5색 + 기타. 순서는 `STATUS_ORDER`이고 **건수 0인 칸도 남긴다.**
 *
 * 도넛이 아니라 가로 스택 바를 그리므로(`ADR-019`) 비율까지 여기서 낸다 — 컴포넌트가
 * 나누기 시작하면 0건일 때 `NaN`이 폭으로 들어가 막대가 통째로 사라진다.
 */
export function buildStatusBreakdown(
  tasks: readonly { displayStatus: DisplayStatus }[]
): StatusBreakdown {
  const counts = new Map<DisplayStatus, number>(STATUS_ORDER.map((status) => [status, 0]));

  for (const task of tasks) {
    counts.set(task.displayStatus, (counts.get(task.displayStatus) ?? 0) + 1);
  }

  const total = tasks.length;

  return {
    total,
    segments: STATUS_ORDER.map((status) => {
      const value = counts.get(status) ?? 0;

      return {
        status,
        label: DISPLAY_STATUS_LABELS[status],
        value,
        percent: total === 0 ? 0 : (value / total) * 100,
        color: STATUS_COLORS[status],
      };
    }),
  };
}

/**
 * 상태 분포를 가로 막대에 넘길 모양으로 옮긴다. **세지 않는다** — `buildStatusBreakdown`이
 * 낸 조각을 그대로 쓴다. 화면이 다시 세면 같은 카드의 막대와 범례가 다른 숫자를 말한다.
 *
 * 값은 비율이 아니라 **건수**다. 축이 「몇 건」이라고 말하므로 「무엇의 100%인가」를 묻는
 * 스택 바와 달리 조각이 작아도 길이를 읽을 수 있다 (`ADR-019`).
 */
export function toStatusSeries(breakdown: StatusBreakdown): ChartSeries {
  return {
    labels: breakdown.segments.map((segment) => segment.label),
    values: breakdown.segments.map((segment) => segment.value),
    colors: breakdown.segments.map((segment) => segment.color),
  };
}

export function buildCompletionBars(teams: readonly TeamSummary[]): ChartSeries {
  const measurable = teams.filter((team) => team.completionRate !== null);

  return {
    labels: measurable.map((team) => teamLabel(team.teamKey)),
    values: measurable.map((team) => team.completionRate ?? 0),
    colors: measurable.map(() => BAR_COLOR),
  };
}

/** 완료율을 잴 수 없어 막대에서 빠진 팀 */
export function unmeasurableTeams(teams: readonly TeamSummary[]): TeamKey[] {
  return teams.filter((team) => team.completionRate === null).map((team) => team.teamKey);
}
