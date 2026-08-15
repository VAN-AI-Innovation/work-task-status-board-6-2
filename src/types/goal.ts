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
