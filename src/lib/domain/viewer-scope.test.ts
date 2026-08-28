import { describe, expect, it } from 'vitest';

import {
  goalMetricInScope,
  scopeEditableTasks,
  scopeGoalMetrics,
  scopeTasks,
  taskEditable,
  taskInScope,
} from '@/lib/domain/viewer-scope';
import type { Viewer } from '@/types/auth';
import type { GoalMetric } from '@/types/goal';
import type { Task, TeamKey } from '@/types/task';

/**
 * 리터럴로만 짓는다 — 픽스처를 읽으면 담당자·팀이 그쪽 사정으로 바뀌는 날 이 테스트가
 * 무엇을 재는지 알 수 없게 된다.
 */
function task(overrides: {
  id: string;
  teamId: TeamKey;
  ownerMemberId: string | null;
  coOwnerNames?: string[];
}): Task {
  return {
    id: overrides.id,
    teamId: overrides.teamId,
    departmentId: null,
    sourceKey: overrides.id,
    title: overrides.id,
    ownerMemberId: overrides.ownerMemberId,
    ownerNameRaw: null,
    coOwnerNames: overrides.coOwnerNames ?? [],
    status: null,
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: null,
    assignedAt: null,
    dueAt: null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 1,
  };
}

function metric(overrides: { id: string; teamId: TeamKey; ownerMemberId: string | null }): GoalMetric {
  return {
    id: overrides.id,
    teamId: overrides.teamId,
    periodLabel: null,
    title: overrides.id,
    goalText: null,
    kpiName: null,
    targetValue: null,
    actualValue: null,
    achievementRate: null,
    prevPeriodDelta: null,
    channel: null,
    ownerMemberId: overrides.ownerMemberId,
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
  };
}

function viewer(overrides: Partial<Viewer> & Pick<Viewer, 'role'>): Viewer {
  return {
    userId: 'u-1',
    email: 'a@b.c',
    teamId: null,
    memberId: null,
    memberName: null,
    ...overrides,
  };
}

const ADMIN = viewer({ role: 'admin', teamId: 'edit', memberId: 'm-admin' });
const ADMIN_NO_TEAM = viewer({ role: 'admin' });
const LEAD_EDIT = viewer({ role: 'lead', teamId: 'edit', memberId: 'm-lead' });
const LEAD_NO_TEAM = viewer({ role: 'lead', memberId: 'm-lead' });
const MEMBER = viewer({ role: 'member', teamId: 'edit', memberId: 'm-1', memberName: '담당자1' });
const MEMBER_UNLINKED = viewer({ role: 'member', teamId: 'edit' });
const LEAD_SHOOT = viewer({ role: 'lead', teamId: 'shoot', memberId: 'm-lead2' });

describe('taskInScope — admin', () => {
  it('다른 팀 업무도 본다', () => {
    expect(taskInScope(task({ id: 't1', teamId: 'shoot', ownerMemberId: 'm-9' }), ADMIN)).toBe(true);
  });

  it('담당자가 연결되지 않은 업무도 본다', () => {
    expect(taskInScope(task({ id: 't2', teamId: 'marketing', ownerMemberId: null }), ADMIN)).toBe(
      true
    );
  });

  it('소속 팀이 없어도(teamId=null) 전부 본다 — 전사 admin이다', () => {
    expect(
      taskInScope(task({ id: 't3', teamId: 'edit', ownerMemberId: 'm-1' }), ADMIN_NO_TEAM)
    ).toBe(true);
  });
});

describe('taskInScope — lead', () => {
  /*
   * **팀장의 열람 범위는 전사다** (`0012_lead_org_read.sql`). 예전에는 자기 팀 하나였는데,
   * 그러면 대시보드의 팀별 현황표가 「우리 팀 N건, 남의 팀 0건」으로 서고 그 표는 남의 팀에
   * 대해 틀린 사실을 말한다. 좁히는 것은 이제 `taskEditable`이 진다.
   */
  it('같은 팀은 본다', () => {
    expect(taskInScope(task({ id: 't1', teamId: 'edit', ownerMemberId: 'm-9' }), LEAD_EDIT)).toBe(
      true
    );
  });

  it('다른 팀도 본다 — 어드민과 같은 현황판을 본다', () => {
    expect(taskInScope(task({ id: 't2', teamId: 'shoot', ownerMemberId: 'm-9' }), LEAD_EDIT)).toBe(
      true
    );
    expect(
      taskInScope(task({ id: 't3', teamId: 'marketing', ownerMemberId: null }), LEAD_EDIT)
    ).toBe(true);
  });

  it('팀이 없는 lead도 본다 — 열람에는 팀 가드가 없다', () => {
    for (const teamId of ['edit', 'shoot', 'marketing'] as const) {
      expect(taskInScope(task({ id: teamId, teamId, ownerMemberId: 'm-9' }), LEAD_NO_TEAM)).toBe(
        true
      );
    }
  });
});

describe('taskEditable — 수정 범위는 열람보다 좁다', () => {
  it('admin은 아무 팀이나 고친다', () => {
    expect(taskEditable(task({ id: 't1', teamId: 'shoot', ownerMemberId: 'm-9' }), ADMIN)).toBe(
      true
    );
    expect(
      taskEditable(task({ id: 't2', teamId: 'marketing', ownerMemberId: null }), ADMIN_NO_TEAM)
    ).toBe(true);
  });

  it('lead는 자기 팀만 고친다 — 보이는 것과 고치는 것이 갈린다', () => {
    const other = task({ id: 't3', teamId: 'shoot', ownerMemberId: 'm-9' });
    expect(taskInScope(other, LEAD_EDIT)).toBe(true);
    expect(taskEditable(other, LEAD_EDIT)).toBe(false);
    expect(taskEditable(other, LEAD_SHOOT)).toBe(true);
  });

  it('팀이 없는 lead는 아무것도 못 고친다', () => {
    for (const teamId of ['edit', 'shoot', 'marketing'] as const) {
      expect(taskEditable(task({ id: teamId, teamId, ownerMemberId: 'm-9' }), LEAD_NO_TEAM)).toBe(
        false
      );
    }
  });

  /*
   * `Task.teamId`는 타입상 `TeamKey`라 위 반복문만으로는 `viewer.teamId !== null` 가드가
   * 밟히지 않는다 — 어느 팀 키든 `null`과 같지 않아서 가드를 지워도 통과한다. 가드가 값을
   * 하는 자리는 **저장소가 `team_id`에 null을 흘리는 런타임**이고, 그때 `null === null`로
   * 팀 없는 lead에게 팀 없는 업무가 열린다. 타입 밖 입력이므로 캐스팅으로만 잴 수 있다.
   */
  it('저장소가 teamId를 null로 흘려도 팀 없는 lead에게 새지 않는다 (null === null 금지)', () => {
    const orphan = { ...task({ id: 't5', teamId: 'edit', ownerMemberId: 'm-9' }), teamId: null };
    expect(taskEditable(orphan as unknown as Task, LEAD_NO_TEAM)).toBe(false);
    expect(taskEditable(orphan as unknown as Task, LEAD_EDIT)).toBe(false);
  });

  it('member의 수정 범위는 열람 범위와 같다 — 보는 만큼 고친다', () => {
    const mine = task({ id: 't6', teamId: 'edit', ownerMemberId: 'm-1' });
    const co = task({ id: 't7', teamId: 'edit', ownerMemberId: 'm-2', coOwnerNames: ['담당자1'] });
    const other = task({ id: 't8', teamId: 'edit', ownerMemberId: 'm-2' });

    for (const item of [mine, co, other]) {
      expect(taskEditable(item, MEMBER)).toBe(taskInScope(item, MEMBER));
    }
    expect(taskEditable(mine, MEMBER)).toBe(true);
    expect(taskEditable(co, MEMBER)).toBe(true);
    expect(taskEditable(other, MEMBER)).toBe(false);
  });
});

describe('taskInScope — member', () => {
  it('본인 건만 본다', () => {
    expect(taskInScope(task({ id: 't1', teamId: 'edit', ownerMemberId: 'm-1' }), MEMBER)).toBe(true);
  });

  it('같은 팀이지만 남의 건은 못 본다', () => {
    expect(taskInScope(task({ id: 't2', teamId: 'edit', ownerMemberId: 'm-2' }), MEMBER)).toBe(
      false
    );
  });

  it('ownerMemberId === null 인 업무는 못 본다 (unknown_owner — 결정 D)', () => {
    expect(taskInScope(task({ id: 't3', teamId: 'edit', ownerMemberId: null }), MEMBER)).toBe(false);
  });

  it('계정이 연결되지 않은 member에게 담당자 미상 업무가 열리지 않는다 (null === null 금지)', () => {
    expect(
      taskInScope(task({ id: 't4', teamId: 'edit', ownerMemberId: null }), MEMBER_UNLINKED)
    ).toBe(false);
  });

  it('계정이 연결되지 않은 member는 담당자가 있는 업무도 못 본다', () => {
    expect(
      taskInScope(task({ id: 't5', teamId: 'edit', ownerMemberId: 'm-1' }), MEMBER_UNLINKED)
    ).toBe(false);
  });

  /*
   * **공동 담당에 이름이 있으면 본다** (`0013_task_authoring.sql`). 예전에는 주 담당 하나만
   * 봤고, 그래서 공동 담당으로 지정된 사람의 화면에는 그 업무가 뜨지 않았다 —
   * 지정 폼이 「이름으로만 남습니다」라고 적어 둔 자리다.
   */
  it('공동 담당에 내 이름이 있으면 남의 건도 본다', () => {
    expect(
      taskInScope(
        task({ id: 't6', teamId: 'edit', ownerMemberId: 'm-2', coOwnerNames: ['담당자1'] }),
        MEMBER
      )
    ).toBe(true);
  });

  it('공동 담당에 없는 이름이면 못 본다', () => {
    expect(
      taskInScope(
        task({ id: 't7', teamId: 'edit', ownerMemberId: 'm-2', coOwnerNames: ['담당자9'] }),
        MEMBER
      )
    ).toBe(false);
  });

  /** 동명이인 방어. `members`의 유니크가 `(team_id, name)`이라 팀이 다르면 같은 이름이 선다 */
  it('다른 팀 업무의 공동 담당에 같은 이름이 있어도 못 본다', () => {
    expect(
      taskInScope(
        task({ id: 't8', teamId: 'shoot', ownerMemberId: 'm-2', coOwnerNames: ['담당자1'] }),
        MEMBER
      )
    ).toBe(false);
  });

  it('명부 이름이 없는(memberName=null) 계정에게는 공동 담당이 열리지 않는다', () => {
    expect(
      taskInScope(
        task({ id: 't9', teamId: 'edit', ownerMemberId: 'm-2', coOwnerNames: ['담당자1'] }),
        MEMBER_UNLINKED
      )
    ).toBe(false);
  });
});

describe('goalMetricInScope', () => {
  it('admin은 전부 본다', () => {
    expect(goalMetricInScope(metric({ id: 'g1', teamId: 'shoot', ownerMemberId: null }), ADMIN)).toBe(
      true
    );
  });

  it('lead도 전부 본다 — 업무 열람과 같은 범위다 (`0012`)', () => {
    expect(
      goalMetricInScope(metric({ id: 'g1', teamId: 'edit', ownerMemberId: null }), LEAD_EDIT)
    ).toBe(true);
    expect(
      goalMetricInScope(metric({ id: 'g2', teamId: 'shoot', ownerMemberId: null }), LEAD_EDIT)
    ).toBe(true);
    expect(
      goalMetricInScope(metric({ id: 'g3', teamId: 'edit', ownerMemberId: null }), LEAD_NO_TEAM)
    ).toBe(true);
  });

  /** `GoalMetric.teamId`도 non-nullable이라 타입 밖 입력으로만 잴 수 있는 가드다 */
  it('저장소가 teamId를 null로 흘려도 팀 없는 member에게 새지 않는다', () => {
    const orphan = { ...metric({ id: 'g1', teamId: 'edit', ownerMemberId: null }), teamId: null };
    expect(
      goalMetricInScope(orphan as unknown as GoalMetric, viewer({ role: 'member', memberId: 'm-1' }))
    ).toBe(false);
  });

  it('member는 담당자가 아니라 **자기 팀**으로 본다 — 목표 지표에는 담당자 축이 없다', () => {
    expect(
      goalMetricInScope(metric({ id: 'g1', teamId: 'edit', ownerMemberId: 'm-2' }), MEMBER)
    ).toBe(true);
    expect(
      goalMetricInScope(metric({ id: 'g2', teamId: 'shoot', ownerMemberId: 'm-1' }), MEMBER)
    ).toBe(false);
  });

  it('팀이 없는 member는 목표 지표를 못 본다', () => {
    expect(
      goalMetricInScope(
        metric({ id: 'g1', teamId: 'edit', ownerMemberId: 'm-1' }),
        viewer({ role: 'member', memberId: 'm-1' })
      )
    ).toBe(false);
  });
});

describe('scopeTasks', () => {
  const tasks: Task[] = [
    task({ id: 'a', teamId: 'edit', ownerMemberId: 'm-1' }),
    task({ id: 'b', teamId: 'edit', ownerMemberId: 'm-2' }),
    task({ id: 'c', teamId: 'shoot', ownerMemberId: 'm-1' }),
    task({ id: 'd', teamId: 'marketing', ownerMemberId: null }),
    task({ id: 'e', teamId: 'edit', ownerMemberId: null }),
  ];

  it('열람은 admin·lead가 같고 member만 좁다 (`0012`)', () => {
    expect(scopeTasks(tasks, ADMIN).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(scopeTasks(tasks, LEAD_EDIT).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // `c`가 남는 것이 요점 — member는 팀이 아니라 담당자로 본다. 다른 팀의 본인 건도 자기 것이다
    expect(scopeTasks(tasks, MEMBER).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('수정 범위는 세 역할이 서로 다르다 — 갈리는 자리가 여기다', () => {
    expect(scopeEditableTasks(tasks, ADMIN).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(scopeEditableTasks(tasks, LEAD_EDIT).map((t) => t.id)).toEqual(['a', 'b', 'e']);
    expect(scopeEditableTasks(tasks, MEMBER).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('원본 배열을 고치지 않는다', () => {
    const input = [...tasks];
    scopeTasks(input, MEMBER);
    expect(input).toHaveLength(5);
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('순서를 바꾸지 않는다', () => {
    const reversed = [...tasks].reverse();
    expect(scopeTasks(reversed, ADMIN).map((t) => t.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(scopeTasks(reversed, MEMBER).map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('빈 배열은 빈 배열이다', () => {
    expect(scopeTasks([], ADMIN)).toEqual([]);
    expect(scopeTasks([], MEMBER)).toEqual([]);
  });

  it('통과한 업무는 같은 객체 그대로 나간다 (사본을 만들지 않는다)', () => {
    expect(scopeTasks(tasks, MEMBER)[0]).toBe(tasks[0]);
  });
});

describe('scopeGoalMetrics', () => {
  const metrics: GoalMetric[] = [
    metric({ id: 'g-edit', teamId: 'edit', ownerMemberId: 'm-1' }),
    metric({ id: 'g-shoot', teamId: 'shoot', ownerMemberId: 'm-1' }),
    metric({ id: 'g-marketing', teamId: 'marketing', ownerMemberId: null }),
  ];

  it('세 역할이 서로 다른 길이를 낸다 — member는 자기 팀 것을 잃지 않는다', () => {
    expect(scopeGoalMetrics(metrics, ADMIN).map((m) => m.id)).toEqual([
      'g-edit',
      'g-shoot',
      'g-marketing',
    ]);
    expect(scopeGoalMetrics(metrics, LEAD_EDIT).map((m) => m.id)).toEqual([
      'g-edit',
      'g-shoot',
      'g-marketing',
    ]);
    expect(scopeGoalMetrics(metrics, MEMBER).map((m) => m.id)).toEqual(['g-edit']);
  });

  it('원본 배열을 고치지 않는다', () => {
    const input = [...metrics];
    scopeGoalMetrics(input, MEMBER);
    expect(input.map((m) => m.id)).toEqual(['g-edit', 'g-shoot', 'g-marketing']);
  });

  it('순서를 바꾸지 않는다', () => {
    const reversed = [...metrics].reverse();
    expect(scopeGoalMetrics(reversed, ADMIN).map((m) => m.id)).toEqual([
      'g-marketing',
      'g-shoot',
      'g-edit',
    ]);
  });

  it('빈 배열은 빈 배열이다', () => {
    expect(scopeGoalMetrics([], LEAD_EDIT)).toEqual([]);
    expect(scopeGoalMetrics([], MEMBER)).toEqual([]);
  });
});
