/**
 * 이 파일이 지키는 축은 셋이다.
 *
 * 1. **시트 값을 덮어쓰지 않는가.** `achievementRate`는 그대로 남고 `computedRate`가
 *    나란히 붙는다. 덮어쓰면 불일치 증거가 사라져 파서 정확성을 잴 수단이 없어진다.
 * 2. **0으로 나눈 값이 새지 않는가.** `target: 0`에서 `Infinity`가 화면까지 흘러가면
 *    JSON 직렬화가 `null`로 바꿔치기해 원인을 못 찾는다.
 * 3. **경고에 값이 새지 않는가.** 좌표(`sheet`·`row`)와 사유(`code`)만 남는다
 *    (CLAUDE.md 보안 규칙).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { summarizeGoals } from '@/lib/domain/goal-stats';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { GoalMetric, ParsedGoalMetric } from '@/types/goal';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

let fixtureMetrics: GoalMetric[];

/** `ParsedGoalMetric`을 저장 모델로 옮긴다. T5 커밋 이전이라 신원·감사 필드는 비어 있다 */
function toGoalMetric(parsed: ParsedGoalMetric, index: number): GoalMetric {
  return {
    id: `goal-${index}`,
    teamId: parsed.teamKey,
    periodLabel: parsed.periodLabel,
    title: parsed.title,
    goalText: parsed.goalText,
    kpiName: parsed.kpiName,
    targetValue: parsed.targetValue,
    actualValue: parsed.actualValue,
    achievementRate: parsed.achievementRate,
    prevPeriodDelta: parsed.prevPeriodDelta,
    channel: parsed.channel,
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    execStatus: parsed.execStatus,
    analysis: parsed.analysis,
    wentWell: parsed.wentWell,
    needsImprovement: parsed.needsImprovement,
    startedAt: parsed.startedAt,
    dueAt: parsed.dueAt,
    extras: parsed.extras,
    sourceUploadId: null,
    sourceSheetTab: parsed.sourceSheetTab,
    sourceRowIndex: parsed.sourceRowIndex,
  };
}

let seq = 0;

function metric(overrides: Partial<GoalMetric> = {}): GoalMetric {
  seq += 1;
  return {
    ...toGoalMetric(
      {
        teamKey: 'marketing',
        periodLabel: null,
        title: null,
        goalText: null,
        kpiName: null,
        targetValue: null,
        actualValue: null,
        achievementRate: null,
        prevPeriodDelta: null,
        channel: null,
        ownerNameRaw: null,
        execStatus: null,
        analysis: null,
        wentWell: null,
        needsImprovement: null,
        startedAt: null,
        dueAt: null,
        extras: {},
        raw: {},
        sourceSheetTab: '03_마케팅·관리팀',
        sourceRowIndex: 20,
      },
      seq
    ),
    ...overrides,
  };
}

beforeAll(async () => {
  const parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  fixtureMetrics = parsed.tabs.flatMap((tab) => tab.goalMetrics).map(toGoalMetric);
});

describe('summarizeGoals — 달성률 재계산', () => {
  it('목표 100·실적 120이면 달성률 120이고 목표를 넘긴 것으로 본다 (상한을 두지 않는다)', () => {
    const result = summarizeGoals([metric({ targetValue: 100, actualValue: 120 })]);

    expect(result.items[0].computedRate).toBe(120);
    expect(result.items[0].onTarget).toBe(true);
  });

  it('목표 50·실적 41이면 82이고 목표 미달이다', () => {
    const result = summarizeGoals([metric({ targetValue: 50, actualValue: 41 })]);

    expect(result.items[0].computedRate).toBe(82);
    expect(result.items[0].onTarget).toBe(false);
  });

  it('목표 40·실적 12인데 시트 달성률이 95면 30으로 재계산하고 불일치 경고를 남긴다', () => {
    const result = summarizeGoals([
      metric({ targetValue: 40, actualValue: 12, achievementRate: 95 }),
    ]);

    expect(result.items[0].computedRate).toBe(30);
    expect(result.items[0].sheetRate).toBe(95);
    expect(result.items[0].rateMismatch).toBe(true);
    expect(result.warnings.filter((w) => w.code === 'GOAL_RATE_MISMATCH')).toHaveLength(1);
  });

  it('시트 값과 재계산 값이 같으면 불일치가 아니고 경고가 없다', () => {
    const result = summarizeGoals([
      metric({ targetValue: 100, actualValue: 100, achievementRate: 100 }),
    ]);

    expect(result.items[0].rateMismatch).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('시트 달성률이 82.5를 반올림한 값이면 소수 자리를 잃은 만큼은 불일치로 보지 않는다', () => {
    // 41/50 = 82, 시트는 83. 기본 허용 오차 1 이내라 통과한다.
    const result = summarizeGoals([
      metric({ targetValue: 50, actualValue: 41, achievementRate: 83 }),
    ]);

    expect(result.items[0].rateMismatch).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('허용 오차를 0으로 좁히면 같은 1포인트 차이가 불일치가 된다 (경계)', () => {
    const result = summarizeGoals([metric({ targetValue: 50, actualValue: 41, achievementRate: 83 })], {
      tolerancePoints: 0,
    });

    expect(result.items[0].rateMismatch).toBe(true);
    expect(result.warnings.filter((w) => w.code === 'GOAL_RATE_MISMATCH')).toHaveLength(1);
  });

  it('시트 달성률이 비어 있으면 비교할 대상이 없어 불일치가 아니다', () => {
    const result = summarizeGoals([
      metric({ targetValue: 50, actualValue: 41, achievementRate: null }),
    ]);

    expect(result.items[0].sheetRate).toBeNull();
    expect(result.items[0].rateMismatch).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('summarizeGoals — 계산 불가', () => {
  it('목표가 0이면 나누지 않고 경고를 남기며 Infinity·NaN이 결과 어디에도 없다', () => {
    const result = summarizeGoals([metric({ targetValue: 0, actualValue: 12 })]);

    expect(result.items[0].computedRate).toBeNull();
    expect(result.items[0].onTarget).toBeNull();
    expect(result.warnings.filter((w) => w.code === 'GOAL_TARGET_ZERO')).toHaveLength(1);

    // JSON.stringify는 Infinity·NaN을 조용히 null로 바꾼다. 직렬화 전 값 자체를 확인한다.
    const numbers = [
      result.items[0].computedRate,
      result.items[0].sheetRate,
      result.byTeam[0].avgAchievement,
    ];
    for (const value of numbers) {
      expect(Number.isFinite(value ?? 0)).toBe(true);
    }
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).toContain('"computedRate":null');
  });

  it('목표가 비면 계산 불가로 세되 경고는 남기지 않는다 — 미입력은 오류가 아니다', () => {
    const result = summarizeGoals([metric({ targetValue: null, actualValue: 12 })]);

    expect(result.items[0].computedRate).toBeNull();
    expect(result.byTeam[0].unmeasurableCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('실적이 비어도 마찬가지다', () => {
    const result = summarizeGoals([metric({ targetValue: 40, actualValue: null })]);

    expect(result.items[0].computedRate).toBeNull();
    expect(result.byTeam[0].unmeasurableCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('summarizeGoals — 경고 형태', () => {
  it('경고에는 code·sheet·row 셋뿐이고 과제명·담당자·수치가 들어 있지 않다', () => {
    const result = summarizeGoals([
      metric({
        targetValue: 40,
        actualValue: 12,
        achievementRate: 95,
        title: '[샘플] 리그램 이벤트',
        ownerNameRaw: '마케터1',
        sourceSheetTab: '03_마케팅·관리팀',
        sourceRowIndex: 23,
      }),
      metric({ targetValue: 0, actualValue: 5, sourceRowIndex: 24 }),
    ]);

    expect(result.warnings).toHaveLength(2);
    for (const warning of result.warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'row', 'sheet']);
    }
    expect(result.warnings[0]).toEqual({
      code: 'GOAL_RATE_MISMATCH',
      sheet: '03_마케팅·관리팀',
      row: 23,
    });
    expect(result.warnings[1].row).toBe(24);

    const serialized = JSON.stringify(result.warnings);
    expect(serialized).not.toContain('리그램');
    expect(serialized).not.toContain('마케터1');
    expect(serialized).not.toContain('95');
    expect(serialized).not.toContain('12');
  });
});

describe('summarizeGoals — 팀 요약', () => {
  it('평균 달성률은 계산 불가 건을 빼고 낸다', () => {
    const result = summarizeGoals([
      metric({ targetValue: 100, actualValue: 120 }),
      metric({ targetValue: 100, actualValue: 80 }),
      metric({ targetValue: null, actualValue: 50 }),
    ]);

    expect(result.byTeam[0].avgAchievement).toBe(100);
    expect(result.byTeam[0].metricCount).toBe(3);
    expect(result.byTeam[0].onTargetCount).toBe(1);
    expect(result.byTeam[0].belowTargetCount).toBe(1);
    expect(result.byTeam[0].unmeasurableCount).toBe(1);
  });

  it('전건이 계산 불가면 평균은 0이 아니라 null이다', () => {
    const result = summarizeGoals([
      metric({ targetValue: null, actualValue: null }),
      metric({ targetValue: 0, actualValue: 3 }),
    ]);

    expect(result.byTeam[0].avgAchievement).toBeNull();
    expect(result.byTeam[0].unmeasurableCount).toBe(2);
  });

  it('지표가 없는 팀의 빈 행을 만들지 않고 TeamKey 순서로 정렬한다', () => {
    const result = summarizeGoals([
      metric({ teamId: 'marketing', targetValue: 10, actualValue: 10 }),
      metric({ teamId: 'edit', targetValue: 10, actualValue: 5 }),
    ]);

    expect(result.byTeam.map((row) => row.teamKey)).toEqual(['edit', 'marketing']);
  });

  it('빈 배열이면 전부 비고 예외가 나지 않는다', () => {
    const result = summarizeGoals([]);

    expect(result.items).toHaveLength(0);
    expect(result.byTeam).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('입력 지표를 고치지 않는다 — 시트 달성률이 재계산 값으로 덮이지 않는다', () => {
    const input = metric({ targetValue: 40, actualValue: 12, achievementRate: 95 });
    const before = JSON.stringify(input);

    const result = summarizeGoals([input]);

    expect(JSON.stringify(input)).toBe(before);
    expect(input.achievementRate).toBe(95);
    expect(result.items[0].metric).toBe(input);
  });
});

describe('summarizeGoals — 픽스처 통합', () => {
  it('픽스처 3건의 재계산 달성률이 120·82·30이고 불일치는 셋째 행 1건뿐이다', () => {
    const result = summarizeGoals(fixtureMetrics);

    expect(result.items.map((item) => item.computedRate)).toEqual([120, 82, 30]);
    expect(result.items.map((item) => item.sheetRate)).toEqual([120, 82, 95]);

    const mismatches = result.warnings.filter((w) => w.code === 'GOAL_RATE_MISMATCH');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].row).toBe(fixtureMetrics[2].sourceRowIndex);
  });

  it('픽스처의 목표 지표는 마케팅팀에만 있으므로 팀 요약이 1행이다', () => {
    const result = summarizeGoals(fixtureMetrics);

    expect(result.byTeam).toHaveLength(1);
    expect(result.byTeam[0].teamKey).toBe('marketing');
    expect(result.byTeam[0].metricCount).toBe(3);
  });
});
