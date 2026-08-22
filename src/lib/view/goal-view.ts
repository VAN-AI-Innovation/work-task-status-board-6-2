/**
 * 목표 대비 성과 섹션(과제 요구 4번, T6 완료 기준 3)이 그릴 **행을 글자로 바꾸는 곳**.
 * 재계산은 `lib/domain/goal-stats.ts`가 이미 했고 여기서 다시 나누지 않는다.
 *
 * 네 가지를 못박는다.
 *
 * - **달성률에 상한을 두지 않는다.** 120%는 이상값이 아니라 정상값이다.
 * - **시트 값을 재계산 값으로 덮지 않는다.** 화면에 띄우는 것은 재계산값(`computedRate`)이고,
 *   어긋난 행에만 시트 값을 병기한다 — 그 불일치 건수가 파서 정확성의 실측 지표다.
 * - **`prevPeriodDelta`를 파싱하지 않는다.** 시트에 `+3%p`·`▲2`·`유지`가 자유 입력으로
 *   들어 있어서, 해석하는 순간 틀린 화살표를 화면에 그린다. 원문 그대로 옮긴다.
 * - **`belowTarget`은 「잴 수 있었는데 못 미쳤다」다.** `computedRate`가 null인 행은 미달이
 *   아니라 미측정이라 앰버를 붙이지 않는다 — 「모름」을 「나쁨」으로 칠하면 안 된다.
 *
 * 숫자 표기는 `kpi-format.ts`를 쓴다. 여기서 다시 만들면 표와 KPI 타일의 `—` 규칙이 갈라진다.
 */

import type { ComputedGoalMetric } from '@/lib/domain/goal-stats';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { EMPTY, formatCount, formatPercent } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';
import type { TeamKey } from '@/types/task';

export interface GoalRow {
  teamKey: TeamKey;
  teamLabel: string;
  title: string;
  kpiName: string;
  /** 포맷된 문자열. 없으면 `—` */
  target: string;
  actual: string;
  /** `82%` · `120%` · `—` */
  rate: string;
  /** **어긋난 행에만** 값이 있다. 아니면 null */
  sheetRate: string | null;
  /** `prevPeriodDelta` 원문. 없으면 `—` */
  delta: string;
  belowTarget: boolean;
}

/** 팀 순서를 숫자로. 정렬의 첫 축이다 */
const TEAM_RANK = new Map<TeamKey, number>(TEAM_KEYS.map((teamKey, index) => [teamKey, index]));

/** 빈 문자열은 미입력과 같게 본다. `false`·`0`은 여기 오지 않는다 (전부 문자열 필드다) */
function textOr(value: string | null): string {
  return value === null || value.trim() === '' ? EMPTY : value;
}

/**
 * 팀 순서(`TEAM_KEYS`) → `title` 코드포인트 순. **결정적이어야 한다** — 같은 데이터가 새로고침
 * 마다 다른 차례로 늘어서면 사용자가 행을 눈으로 따라갈 수 없다.
 *
 * 로캘 의존 비교(`localeCompare`)를 쓰지 않는다. 실행 환경에 따라 결과가 달라진다.
 */
export function toGoalRows(items: readonly ComputedGoalMetric[]): GoalRow[] {
  /*
   * 입력을 고치지 않으려고 복사본을 정렬한다 (`items.sort()`는 원본 배열을 뒤집는다).
   * 같은 팀에 같은 과제명이 둘일 수 있어서(자연키가 `팀 + 기간 + 과제명`이라 기간이 다르면
   * 통과한다) 마지막 축을 `id`로 둔다 — 없으면 두 행의 차례가 입력 순서에 매인다.
   */
  const sorted = [...items].sort((left, right) => {
    const rank =
      (TEAM_RANK.get(left.metric.teamId) ?? 0) - (TEAM_RANK.get(right.metric.teamId) ?? 0);
    if (rank !== 0) return rank;

    const leftTitle = textOr(left.metric.title);
    const rightTitle = textOr(right.metric.title);
    if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;
    if (left.metric.id === right.metric.id) return 0;
    return left.metric.id < right.metric.id ? -1 : 1;
  });

  return sorted.map((item): GoalRow => {
    const { metric, computedRate } = item;

    return {
      teamKey: metric.teamId,
      teamLabel: teamLabel(metric.teamId),
      title: textOr(metric.title),
      kpiName: textOr(metric.kpiName),
      target: formatCount(metric.targetValue),
      actual: formatCount(metric.actualValue),
      rate: formatPercent(computedRate),
      sheetRate: item.rateMismatch ? formatPercent(item.sheetRate) : null,
      delta: textOr(metric.prevPeriodDelta),
      belowTarget: computedRate !== null && computedRate < 100,
    };
  });
}
