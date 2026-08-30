/**
 * 재는 것은 하나다 — **주간 보고가 다루는 팀이 누구에게 무엇인가.**
 *
 * 이 판정이 없던 동안 팀장의 보고서에는 세 팀 업무가 섞여 있었다. 열람 범위(`0012`)가
 * 전사라 `read.tasks`가 전사였고, 보고서는 그것을 그대로 요약했기 때문이다.
 */

import { describe, expect, it } from 'vitest';

import { reportTeams, scopeReportInputs, type ReportInputs } from '@/lib/domain/report-scope';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskStage, TeamKey } from '@/types/task';

describe('reportTeams', () => {
  it('어드민은 `null`이다 — 전사를 받는 사람이라 좁힐 것이 없다', () => {
    expect(reportTeams('admin', null, true)).toBeNull();
    expect(reportTeams('admin', 'edit', true)).toBeNull();
  });

  it('팀장은 자기 팀 하나다 — 어드민에게 올리는 것이 그 팀의 보고다', () => {
    expect(reportTeams('lead', 'shoot', true)).toEqual(['shoot']);
    expect(reportTeams('lead', 'edit', true)).toEqual(['edit']);
  });

  it('팀을 모르는 팀장은 빈 배열이다 — 「모른다」를 「전부」로 접지 않는다', () => {
    expect(reportTeams('lead', null, true)).toEqual([]);
  });

  it('부원도 자기 팀이다 — 화면은 없지만 판정이 갈리면 안 된다', () => {
    expect(reportTeams('member', 'edit', true)).toEqual(['edit']);
    expect(reportTeams('member', null, true)).toEqual([]);
  });

  /**
   * 데모에는 `profiles`가 없어 「우리 팀」이라고 부를 대상이 없다. 좁히면 클론한 심사자가
   * **빈 보고서**를 본다 — `team-visibility.ts`가 같은 이유로 같은 갈래를 둔다.
   */
  it('세션이 없으면 좁히지 않는다', () => {
    expect(reportTeams('lead', 'edit', false)).toBeNull();
    expect(reportTeams('member', null, false)).toBeNull();
  });
});

/**
 * **네 축을 한 번에 좁힌다.** 호출부가 따로 거르면 「업무는 우리 팀인데 목표 지표는 전사」인
 * 문서가 만들어지고, 그 문서는 섹션마다 모수가 달라 읽을 수 없다.
 */
describe('scopeReportInputs', () => {
  const task = (id: string, teamId: TeamKey): Task => ({ id, teamId }) as Task;
  const stage = (id: string, taskId: string): TaskStage => ({ id, taskId }) as TaskStage;
  const goal = (teamId: TeamKey): GoalMetric => ({ teamId }) as GoalMetric;
  const event = (taskId: string): TaskEvent => ({ taskId }) as TaskEvent;

  const ALL: ReportInputs = {
    tasks: [task('t1', 'edit'), task('t2', 'shoot')],
    stages: [stage('s1', 't1'), stage('s2', 't2')],
    goals: [goal('edit'), goal('shoot')],
    events: [event('t1'), event('t2')],
  };

  it('그 팀 업무만 남고, 단계·이력은 남은 업무의 것만 남는다', () => {
    const scoped = scopeReportInputs(['edit'], ALL);

    expect(scoped.tasks.map((row) => row.id)).toEqual(['t1']);
    expect(scoped.stages.map((row) => row.id)).toEqual(['s1']);
    expect(scoped.goals.map((row) => row.teamId)).toEqual(['edit']);
    expect(scoped.events?.map((row) => row.taskId)).toEqual(['t1']);
  });

  it('`null`이면 그대로다 — 어드민의 보고서는 전사다', () => {
    expect(scopeReportInputs(null, ALL)).toBe(ALL);
  });

  it('빈 배열이면 아무것도 남지 않는다 — 「다룰 팀이 없다」와 「전부」는 다르다', () => {
    const scoped = scopeReportInputs([], ALL);

    expect(scoped.tasks).toEqual([]);
    expect(scoped.goals).toEqual([]);
    expect(scoped.events).toEqual([]);
  });

  it('이력의 `null`은 빈 배열로 접지 않는다 — 「못 읽었다」와 「0건」은 다르다', () => {
    expect(scopeReportInputs(['edit'], { ...ALL, events: null }).events).toBeNull();
  });
});
