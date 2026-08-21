import { describe, expect, it } from 'vitest';

import { summarizeGoals, type ComputedGoalMetric } from '@/lib/domain/goal-stats';
import { toGoalRows } from '@/lib/view/goal-view';
import { teamLabel } from '@/lib/view/team-slug';
import type { GoalMetric } from '@/types/goal';
import type { TeamKey } from '@/types/task';

function metric(overrides: Partial<GoalMetric> & { id: string }): GoalMetric {
  return {
    teamId: 'marketing' as TeamKey,
    periodLabel: '2026-07 4주차',
    title: overrides.id,
    goalText: null,
    kpiName: '유입수',
    targetValue: 100,
    actualValue: 82,
    achievementRate: 82,
    prevPeriodDelta: null,
    channel: null,
    ownerMemberId: null,
    ownerNameRaw: null,
    execStatus: null,
    analysis: null,
    wentWell: null,
    needsImprovement: null,
    startedAt: null,
    dueAt: null,
    extras: {},
    sourceUploadId: null,
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 1,
    ...overrides,
  };
}

/** 재계산은 `summarizeGoals`가 진다 — 이 파일은 그 결과를 글자로 바꾸기만 한다 */
function computed(metrics: GoalMetric[]): ComputedGoalMetric[] {
  return summarizeGoals(metrics).items;
}

describe('toGoalRows — 정렬', () => {
  it('팀 순서 → title 코드포인트 순이다. 결정적이다', () => {
    const rows = toGoalRows(
      computed([
        metric({ id: 'z', teamId: 'marketing', title: '나' }),
        metric({ id: 'y', teamId: 'edit', title: '하' }),
        metric({ id: 'x', teamId: 'marketing', title: '가' }),
        metric({ id: 'w', teamId: 'shoot', title: '다' }),
      ])
    );

    expect(rows.map((row) => [row.teamKey, row.title])).toEqual([
      ['edit', '하'],
      ['shoot', '다'],
      ['marketing', '가'],
      ['marketing', '나'],
    ]);
  });

  it('팀 한글 이름을 다시 짓지 않는다', () => {
    const rows = toGoalRows(computed([metric({ id: 'a', teamId: 'shoot' })]));

    expect(rows[0].teamLabel).toBe(teamLabel('shoot'));
  });

  it('입력을 고치지 않는다', () => {
    const items = computed([metric({ id: 'b' }), metric({ id: 'a' })]);
    const snapshot = items.map((item) => item.metric.id);

    toGoalRows(items);

    expect(items.map((item) => item.metric.id)).toEqual(snapshot);
  });
});

describe('toGoalRows — 달성률', () => {
  /** 120%는 이상값이 아니라 정상값이다 (`goal-stats.ts`) */
  it('상한을 두지 않는다 — 120%가 잘리지 않는다', () => {
    const rows = toGoalRows(
      computed([metric({ id: 'a', targetValue: 100, actualValue: 120, achievementRate: 120 })])
    );

    expect(rows[0].rate).toBe('120%');
    expect(rows[0].belowTarget).toBe(false);
  });

  it('미달(100 미만)만 `belowTarget`이다', () => {
    const rows = toGoalRows(
      computed([metric({ id: 'a', targetValue: 100, actualValue: 99, achievementRate: 99 })])
    );

    expect(rows[0].rate).toBe('99%');
    expect(rows[0].belowTarget).toBe(true);
  });

  /** **잴 수 없었을 뿐 미달이 아니다.** 앰버로 칠하면 「모름」이 「나쁨」이 된다 */
  it('달성률이 null이면 `—`이고 미달이 아니다', () => {
    const rows = toGoalRows(
      computed([
        metric({ id: 'a', targetValue: 0, actualValue: 5, achievementRate: null }),
        metric({ id: 'b', targetValue: null, actualValue: null, achievementRate: null }),
      ])
    );

    expect(rows.map((row) => row.rate)).toEqual(['—', '—']);
    expect(rows.every((row) => row.belowTarget === false)).toBe(true);
  });
});

describe('toGoalRows — 시트 값 병기', () => {
  /**
   * **둘 다 보존한다.** 재계산으로 시트 값을 덮으면 불일치가 사라지고, 그 불일치 건수가
   * 파서 정확성의 실측 지표다 (`goal-stats.ts` 머리말).
   */
  it('어긋난 행에서만 `sheetRate`가 채워진다', () => {
    const rows = toGoalRows(
      computed([
        // 재계산 82% vs 시트 95% — 어긋난다
        metric({ id: 'a', title: '가', targetValue: 100, actualValue: 82, achievementRate: 95 }),
        // 재계산 82% vs 시트 82% — 같다
        metric({ id: 'b', title: '나', targetValue: 100, actualValue: 82, achievementRate: 82 }),
      ])
    );

    expect(rows[0].sheetRate).toBe('95%');
    expect(rows[1].sheetRate).toBeNull();
  });

  it('반올림 1포인트 차이는 병기하지 않는다 — 경고가 잡음이 된다', () => {
    const rows = toGoalRows(
      computed([metric({ id: 'a', targetValue: 3, actualValue: 1, achievementRate: 34 })])
    );

    expect(rows[0].rate).toBe('33%');
    expect(rows[0].sheetRate).toBeNull();
  });
});

describe('toGoalRows — 값 없음과 직전 대비', () => {
  it('목표 수치·실적이 없으면 `—`다', () => {
    const rows = toGoalRows(
      computed([metric({ id: 'a', targetValue: null, actualValue: null, kpiName: null, title: null })])
    );

    expect(rows[0].target).toBe('—');
    expect(rows[0].actual).toBe('—');
    expect(rows[0].kpiName).toBe('—');
    expect(rows[0].title).toBe('—');
  });

  /** 시트에 `+3%p`·`▲2`·`유지`가 섞여 들어온다. 파싱하면 그 순간 틀린 해석을 그린다 */
  it('직전 대비는 원문 그대로다', () => {
    const rows = toGoalRows(
      computed([
        metric({ id: 'a', title: '가', prevPeriodDelta: '▲2' }),
        metric({ id: 'b', title: '나', prevPeriodDelta: null }),
        metric({ id: 'c', title: '다', prevPeriodDelta: '   ' }),
      ])
    );

    expect(rows.map((row) => row.delta)).toEqual(['▲2', '—', '—']);
  });
});
