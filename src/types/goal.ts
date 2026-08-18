/**
 * 목표 지표 파싱 산출물. **업무가 아니라 성과 지표**라서 `task.ts`와 분리한다 —
 * 진행 상태·마감·담당자 축이 아니라 목표값 대 실적값 축으로 움직인다 (ARCHITECTURE.md 데이터 모델).
 */

import type { ExtraValue, TeamKey } from '@/types/task';

export interface ParsedGoalMetric {
  teamKey: TeamKey;
  /** 예: `2026-07 4주차` */
  periodLabel: string | null;
  title: string | null;
  goalText: string | null;
  kpiName: string | null;
  targetValue: number | null;
  actualValue: number | null;
  /** **퍼센트 수치**(120·82·95). 시트 값을 보존만 한다 — 재계산·불일치 판정은 T4다 */
  achievementRate: number | null;
  prevPeriodDelta: string | null;
  channel: string | null;
  ownerNameRaw: string | null;
  execStatus: string | null;
  analysis: string | null;
  wentWell: string | null;
  needsImprovement: string | null;
  startedAt: string | null;
  dueAt: string | null;
  extras: Record<string, ExtraValue>;
  raw: Record<string, ExtraValue>;
  sourceSheetTab: string;
  /** 1-based */
  sourceRowIndex: number;
}

export interface ParsedTeamPeriodGoal {
  teamKey: TeamKey;
  periodLabel: string | null;
  goalText: string | null;
  riskText: string | null;
}

/**
 * 저장소에 들어갔다 나온 성과 지표.
 *
 * `raw`를 두지 않는다 — `ParsedGoalMetric.raw`는 파싱 감사용이고, 지표는 `extras`만으로
 * 복원 가능하다. 업무(`Task`)와 달리 원본 행을 통째로 보관할 이유가 없다.
 */
export interface GoalMetric {
  id: string;
  teamId: TeamKey;
  periodLabel: string | null;
  title: string | null;
  goalText: string | null;
  kpiName: string | null;
  targetValue: number | null;
  actualValue: number | null;
  /** **시트에 적힌 달성률.** 재계산은 `goal-stats.ts`가 따로 하고 이 값은 보존한다 */
  achievementRate: number | null;
  prevPeriodDelta: string | null;
  channel: string | null;
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
  execStatus: string | null;
  analysis: string | null;
  wentWell: string | null;
  needsImprovement: string | null;
  startedAt: string | null;
  dueAt: string | null;
  extras: Record<string, ExtraValue>;
  sourceUploadId: string | null;
  sourceSheetTab: string;
  sourceRowIndex: number;
}

export interface TeamPeriodGoal {
  id: string;
  teamId: TeamKey;
  periodLabel: string | null;
  goalText: string | null;
  riskText: string | null;
}
