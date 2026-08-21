/**
 * 과제 요구 4번("부서별 목표와 실제 성과 비교")의 계산부. 목표 지표의 달성률을
 * `actual / target`으로 **다시 계산**하고, 시트에 적힌 값과 어긋나면 경고를 남긴다.
 *
 * T3의 `adapter-goal-metrics`는 시트의 `달성률`을 손대지 않고 옮기기만 했다. 이 파일이
 * 그 뒷면이다 — **둘 다 보존한다.** 재계산 값으로 시트 값을 덮어쓰면 불일치가 사라지고,
 * 그 불일치 건수가 파서 정확성의 실측 지표다 (`PLAN.md` 「6. 집계·판정」).
 * 어느 쪽을 화면에 띄울지는 T6가 정한다.
 *
 * 규칙 넷.
 * - **시간을 읽지 않는다.** 달성률은 날짜에 매이지 않아 `now`조차 받지 않는다.
 * - **SQL을 쓰지 않는다.** 집계는 이 파일의 순수 함수다 (`ADR-006`).
 * - **업무 집계에 합치지 않는다.** 목표 지표는 업무가 아니라 성과 지표라서 축이 다르다
 *   (`ADR-002`) — `progress-stats.ts`와 결과가 섞이지 않게 파일부터 나눠 둔다.
 * - **달성률에 상한을 두지 않는다.** 120%는 이상값이 아니라 정상값이다 (T3 결론).
 */

import type { GoalMetric } from '@/types/goal';
import type { ParseWarning } from '@/types/sheet';
import type { TeamKey } from '@/types/task';

/** 팀 요약 정렬 순서. 안정적이어야 스냅샷 비교가 된다 */
const TEAM_ORDER: readonly TeamKey[] = ['edit', 'shoot', 'marketing'];

/**
 * 시트 달성률과의 기본 허용 오차(퍼센트 포인트).
 *
 * 1인 이유는 반올림이다. 시트 수식은 소수 자리를 갖는데 우리는 정수로 접으므로
 * 정상 행에서도 1포인트가 벌어진다. 이걸 불일치로 세면 경고가 잡음이 된다.
 */
const DEFAULT_TOLERANCE_POINTS = 1;

export interface GoalStatsContext {
  /** 시트 달성률과 재계산 값의 허용 오차(퍼센트 포인트). 기본 1 */
  tolerancePoints?: number;
}

export interface ComputedGoalMetric {
  /** 입력 그대로. **시트 값을 고치지 않는다** */
  metric: GoalMetric;
  /** `actual / target * 100`을 반올림한 정수. 계산 불가면 null */
  computedRate: number | null;
  /** 시트에 적힌 달성률 (`metric.achievementRate`) */
  sheetRate: number | null;
  /** 둘 다 있고 차이가 허용 오차를 넘으면 true */
  rateMismatch: boolean;
  /** 목표 달성 여부. `computedRate >= 100`. 계산 불가면 null */
  onTarget: boolean | null;
}

export interface TeamGoalSummary {
  teamKey: TeamKey;
  metricCount: number;
  /** `computedRate`가 있는 것들의 평균(정수). 없으면 **null** (0이 아니다) */
  avgAchievement: number | null;
  onTargetCount: number;
  belowTargetCount: number;
  /** 재계산이 불가능했던 건수 */
  unmeasurableCount: number;
}

export interface GoalStatsResult {
  items: ComputedGoalMetric[];
  byTeam: TeamGoalSummary[];
  warnings: ParseWarning[];
}

/** 좌표와 사유만 담는다. 목표 수치·실적·과제명·담당자는 넣지 않는다 (CLAUDE.md 보안 규칙) */
function goalWarning(code: string, metric: GoalMetric): ParseWarning {
  // `sourceRowIndex`는 파서가 이미 1-based로 올려 둔 값이라 여기서 더하지 않는다.
  return { code, sheet: metric.sourceSheetTab, row: metric.sourceRowIndex };
}

/**
 * 목표 지표를 재계산하고 팀별로 접는다.
 *
 * `metrics`를 고치지 않는다 — 결과의 `metric`은 입력 객체를 그대로 가리킨다.
 */
export function summarizeGoals(
  metrics: readonly GoalMetric[],
  ctx: GoalStatsContext = {}
): GoalStatsResult {
  const tolerance = ctx.tolerancePoints ?? DEFAULT_TOLERANCE_POINTS;
  const warnings: ParseWarning[] = [];

  const items: ComputedGoalMetric[] = metrics.map((metric) => {
    const { targetValue: target, actualValue: actual } = metric;
    const sheetRate = metric.achievementRate;

    let computedRate: number | null = null;
    if (target === 0) {
      // 0으로 나누면 Infinity가 화면까지 흘러간다. 나누기 전에 멈춘다.
      warnings.push(goalWarning('GOAL_TARGET_ZERO', metric));
    } else if (target !== null && actual !== null) {
      computedRate = Math.round((actual / target) * 100);
    }
    // target·actual이 비어 있는 것은 미입력이지 오류가 아니라 경고를 남기지 않는다.

    const rateMismatch =
      computedRate !== null && sheetRate !== null && Math.abs(computedRate - sheetRate) > tolerance;
    if (rateMismatch) {
      warnings.push(goalWarning('GOAL_RATE_MISMATCH', metric));
    }

    return {
      metric,
      computedRate,
      sheetRate,
      rateMismatch,
      onTarget: computedRate === null ? null : computedRate >= 100,
    };
  });

  return { items, byTeam: summarizeByTeam(items), warnings };
}

/** 지표가 있는 팀만 행으로 낸다 — 빈 행을 만들면 화면에 「목표 없음」 팀이 늘어선다 */
function summarizeByTeam(items: readonly ComputedGoalMetric[]): TeamGoalSummary[] {
  const grouped = new Map<TeamKey, ComputedGoalMetric[]>();
  for (const item of items) {
    const bucket = grouped.get(item.metric.teamId);
    if (bucket) bucket.push(item);
    else grouped.set(item.metric.teamId, [item]);
  }

  return TEAM_ORDER.filter((teamKey) => grouped.has(teamKey)).map((teamKey) => {
    const rows = grouped.get(teamKey) as ComputedGoalMetric[];
    const measurable = rows.filter((row) => row.computedRate !== null);

    return {
      teamKey,
      metricCount: rows.length,
      avgAchievement:
        measurable.length === 0
          ? null
          : Math.round(
              measurable.reduce((sum, row) => sum + (row.computedRate as number), 0) /
                measurable.length
            ),
      onTargetCount: rows.filter((row) => row.onTarget === true).length,
      belowTargetCount: rows.filter((row) => row.onTarget === false).length,
      unmeasurableCount: rows.length - measurable.length,
    };
  });
}
