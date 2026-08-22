/**
 * 차트가 지켜야 할 성질은 「그림이 예쁜가」가 아니라 **「숫자가 표와 같은가」**다.
 * 그래서 여기서 재는 것은 셋이다 — 순서가 고정인가, 칸이 사라지지 않는가,
 * 값의 합이 입력 건수와 같은가.
 */

import { describe, expect, it } from 'vitest';

import type { TeamSummary } from '@/lib/domain/progress-stats';
import {
  buildCompletionBars,
  buildStatusBreakdown,
  STATUS_COLORS,
  STATUS_ORDER,
  toStatusSeries,
  unmeasurableTeams,
} from '@/lib/view/chart-series';
import { teamLabel } from '@/lib/view/team-slug';
import type { DisplayStatus, TeamKey } from '@/types/task';

function tasks(...statuses: DisplayStatus[]): { displayStatus: DisplayStatus }[] {
  return statuses.map((displayStatus) => ({ displayStatus }));
}

function summary(teamKey: TeamKey, completionRate: number | null): TeamSummary {
  return {
    teamKey,
    total: 0,
    active: 0,
    inProgress: 0,
    approvalWaiting: 0,
    reviewWaiting: 0,
    done: 0,
    cancelled: 0,
    overdue: 0,
    dueSoon: 0,
    completionRate,
    delayRate: null,
    avgProgress: null,
    nearestDueAt: null,
  };
}

describe('buildStatusBreakdown', () => {
  it('칸 순서가 고정이다 — 지연이 맨 앞이고 기타가 맨 뒤다', () => {
    expect(STATUS_ORDER).toEqual([
      'overdue',
      'in_progress',
      'review',
      'planned',
      'done',
      'muted',
    ]);

    const breakdown = buildStatusBreakdown(tasks('done', 'overdue'));
    expect(breakdown.segments.map((segment) => segment.status)).toEqual([...STATUS_ORDER]);
  });

  it('라벨을 스스로 짓지 않는다 — 배지와 같은 한글이다', () => {
    const breakdown = buildStatusBreakdown([]);

    expect(breakdown.segments.map((segment) => segment.label)).toEqual([
      '지연',
      '진행',
      '검토',
      '예정',
      '완료',
      '기타',
    ]);
  });

  it('빈 입력에서도 6칸이 남는다 — 칸이 사라지면 색의 뜻이 매번 달라진다', () => {
    const breakdown = buildStatusBreakdown([]);

    expect(breakdown.segments).toHaveLength(6);
    expect(breakdown.total).toBe(0);
    expect(breakdown.segments.map((segment) => segment.value)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  /** 0으로 나누면 `NaN`이 폭으로 들어가 막대가 통째로 사라진다 */
  it('0건이면 비율이 전부 0이다 — 나눗셈이 터지지 않는다', () => {
    const breakdown = buildStatusBreakdown([]);

    expect(breakdown.segments.map((segment) => segment.percent)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('비율의 합이 100이다 — 「무엇의 100%인가」가 성립한다', () => {
    const input = tasks('planned', 'in_progress', 'review', 'done');
    const breakdown = buildStatusBreakdown(input);
    const sum = breakdown.segments.reduce((acc, segment) => acc + segment.percent, 0);

    expect(breakdown.total).toBe(input.length);
    expect(sum).toBeCloseTo(100);
  });

  it('`muted`를 빼지 않는다 — 빼면 합이 조회 건수와 달라진다', () => {
    const input = tasks('planned', 'in_progress', 'review', 'done', 'overdue', 'muted', 'muted');
    const breakdown = buildStatusBreakdown(input);
    const counted = breakdown.segments.reduce((acc, segment) => acc + segment.value, 0);

    expect(counted).toBe(input.length);
    expect(breakdown.segments.find((segment) => segment.status === 'muted')?.value).toBe(2);
  });

  it('색 6개가 서로 다르고 `STATUS_COLORS`에서 온다', () => {
    const colors = buildStatusBreakdown([]).segments.map((segment) => segment.color);

    expect(new Set(colors).size).toBe(6);
    expect(colors).toEqual(STATUS_ORDER.map((status) => STATUS_COLORS[status]));
  });

  it('입력을 건드리지 않는다', () => {
    const input = tasks('done', 'overdue');
    const before = JSON.stringify(input);

    buildStatusBreakdown(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('buildCompletionBars', () => {
  it('완료율이 null인 팀은 막대를 그리지 않는다 — 0%와 「셀 것이 없음」은 다른 사실이다', () => {
    const series = buildCompletionBars([
      summary('edit', 80),
      summary('shoot', null),
      summary('marketing', 0),
    ]);

    expect(series.labels).toEqual([teamLabel('edit'), teamLabel('marketing')]);
    expect(series.values).toEqual([80, 0]);
  });

  it('막대 색은 한 가지 무채색이다 — 완료율은 상태가 아니다', () => {
    const series = buildCompletionBars([summary('edit', 80), summary('shoot', 20)]);

    expect(new Set(series.colors).size).toBe(1);
    expect(series.colors).toHaveLength(series.values.length);
  });

  it('라벨은 `teamLabel`에서 온다 — 축과 표가 같은 이름을 쓴다', () => {
    const series = buildCompletionBars([summary('shoot', 50)]);

    expect(series.labels).toEqual([teamLabel('shoot')]);
    expect(series.labels).not.toEqual(['shoot']);
  });

  it('전부 null이면 빈 시리즈다', () => {
    const series = buildCompletionBars([summary('edit', null), summary('shoot', null)]);

    expect(series.labels).toEqual([]);
    expect(series.values).toEqual([]);
    expect(series.colors).toEqual([]);
  });

  it('입력을 건드리지 않는다', () => {
    const input = [summary('edit', 80), summary('shoot', null)];
    const before = JSON.stringify(input);

    buildCompletionBars(input);
    unmeasurableTeams(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('unmeasurableTeams', () => {
  it('막대에서 빠진 팀을 잡아낸다 — 화면이 「—」로 표시한다', () => {
    const teams = [summary('edit', 80), summary('shoot', null), summary('marketing', null)];

    expect(unmeasurableTeams(teams)).toEqual(['shoot', 'marketing']);
  });

  it('전부 잴 수 있으면 빈 배열이다', () => {
    expect(unmeasurableTeams([summary('edit', 0)])).toEqual([]);
  });
});

/**
 * 스택 바를 버리고 **가로 막대**로 바꾼 뒤(`ADR-019`) 필요해진 변환이다. 세지 않고
 * `buildStatusBreakdown`이 낸 것을 모양만 바꾼다 — 두 번 세면 같은 화면의 두 그림이
 * 다른 숫자를 말한다.
 */
describe('toStatusSeries', () => {
  it('조각 순서·라벨·색을 그대로 옮긴다', () => {
    const breakdown = buildStatusBreakdown(tasks('overdue', 'done', 'done'));
    const series = toStatusSeries(breakdown);

    expect(series.labels).toEqual(breakdown.segments.map((segment) => segment.label));
    expect(series.colors).toEqual(breakdown.segments.map((segment) => segment.color));
  });

  it('값은 비율이 아니라 **건수**다 — 축이 「몇 건」이라고 말한다', () => {
    const breakdown = buildStatusBreakdown(tasks('overdue', 'done', 'done'));
    const series = toStatusSeries(breakdown);

    expect(series.values).toEqual(breakdown.segments.map((segment) => segment.value));
    expect(series.values.reduce((acc, value) => acc + value, 0)).toBe(breakdown.total);
  });

  it('0건 칸도 남는다 — 칸이 사라지면 색의 뜻이 매번 달라진다', () => {
    const series = toStatusSeries(buildStatusBreakdown([]));

    expect(series.labels).toHaveLength(6);
    expect(series.values).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
