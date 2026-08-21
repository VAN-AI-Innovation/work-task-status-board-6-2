/**
 * 차트가 지켜야 할 성질은 「그림이 예쁜가」가 아니라 **「숫자가 표와 같은가」**다.
 * 그래서 여기서 재는 것은 셋이다 — 순서가 고정인가, 칸이 사라지지 않는가,
 * 값의 합이 입력 건수와 같은가.
 */

import { describe, expect, it } from 'vitest';

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import type { TeamSummary } from '@/lib/domain/progress-stats';
import {
  buildCompletionBars,
  buildStatusDonut,
  DONUT_ORDER,
  STATUS_COLORS,
  unmeasurableTeams,
} from '@/lib/view/chart-series';
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

describe('buildStatusDonut', () => {
  it('칸 순서가 고정이다 — 지연이 맨 앞이고 기타가 맨 뒤다', () => {
    expect(DONUT_ORDER).toEqual([
      'overdue',
      'in_progress',
      'review',
      'planned',
      'done',
      'muted',
    ]);

    const series = buildStatusDonut(tasks('done', 'overdue'));
    expect(series.labels).toEqual(DONUT_ORDER.map((status) => DISPLAY_STATUS_LABELS[status]));
  });

  it('라벨을 스스로 짓지 않는다 — 배지와 같은 한글이다', () => {
    const series = buildStatusDonut([]);
    expect(series.labels).toEqual(['지연', '진행', '검토', '예정', '완료', '기타']);
  });

  it('빈 입력에서도 6칸이 남는다 — 칸이 사라지면 색의 뜻이 매번 달라진다', () => {
    const series = buildStatusDonut([]);

    expect(series.labels).toHaveLength(6);
    expect(series.values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(series.colors).toHaveLength(6);
  });

  it('건수 0인 칸도 배열에 남는다', () => {
    const series = buildStatusDonut(tasks('overdue', 'overdue'));

    expect(series.values).toEqual([2, 0, 0, 0, 0, 0]);
  });

  it('색 6개가 서로 다르다', () => {
    const series = buildStatusDonut([]);
    expect(new Set(series.colors).size).toBe(6);
  });

  it('`muted`를 빼지 않는다 — 합이 입력 건수와 같아야 「무엇의 100%인가」가 성립한다', () => {
    const input = tasks('planned', 'in_progress', 'review', 'done', 'overdue', 'muted', 'muted');
    const series = buildStatusDonut(input);

    expect(series.values.reduce((acc, value) => acc + value, 0)).toBe(input.length);
    expect(series.values[DONUT_ORDER.indexOf('muted')]).toBe(2);
  });

  it('입력을 건드리지 않는다', () => {
    const input = tasks('done', 'overdue');
    const before = JSON.stringify(input);

    buildStatusDonut(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('색은 `STATUS_COLORS`에서 온다', () => {
    const series = buildStatusDonut([]);
    expect(series.colors).toEqual(DONUT_ORDER.map((status) => STATUS_COLORS[status]));
  });
});

describe('buildCompletionBars', () => {
  it('완료율이 null인 팀은 막대를 그리지 않는다 — 0%와 「셀 것이 없음」은 다른 사실이다', () => {
    const series = buildCompletionBars([
      summary('edit', 80),
      summary('shoot', null),
      summary('marketing', 0),
    ]);

    expect(series.labels).toEqual(['edit', 'marketing']);
    expect(series.values).toEqual([80, 0]);
  });

  it('막대 색은 한 가지 무채색이다 — 완료율은 상태가 아니다', () => {
    const series = buildCompletionBars([summary('edit', 80), summary('shoot', 20)]);

    expect(new Set(series.colors).size).toBe(1);
    expect(series.colors).toHaveLength(series.values.length);
  });

  it('라벨은 아직 `TeamKey`다 — 한글 이름은 step 6의 `team-slug.ts`가 진다', () => {
    const series = buildCompletionBars([summary('shoot', 50)]);
    expect(series.labels).toEqual(['shoot']);
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
