import { describe, expect, it } from 'vitest';

import { SORT_LABELS, sortTasks } from '@/lib/view/task-sort';
import type { TaskResponse } from '@/types/api';
import type { DisplayStatus, TeamKey } from '@/types/task';

interface Seed {
  id: string;
  teamId?: TeamKey;
  ownerNameRaw?: string | null;
  progress?: number | null;
  dueAt?: string | null;
  displayStatus?: DisplayStatus;
}

function makeTask(seed: Seed): TaskResponse {
  return {
    id: seed.id,
    teamId: seed.teamId ?? 'edit',
    departmentId: null,
    sourceKey: seed.id,
    title: seed.id,
    ownerMemberId: null,
    ownerNameRaw: 'ownerNameRaw' in seed ? seed.ownerNameRaw ?? null : '김편집',
    coOwnerNames: [],
    status: null,
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: seed.progress ?? null,
    assignedAt: null,
    dueAt: seed.dueAt ?? null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 1,
    flags: {
      semantic: null,
      dday: null,
      isOverdue: false,
      isDueSoon: false,
      isStale: false,
      hasNoOwner: false,
      hasUnknownOwner: false,
      hasNoDueDate: seed.dueAt == null,
    },
    displayStatus: seed.displayStatus ?? 'planned',
    statusLabel: '예정',
  };
}

function ids(tasks: readonly TaskResponse[]): string[] {
  return tasks.map((task) => task.id);
}

describe('sortTasks', () => {
  it('`due`는 마감 임박순이고 마감 없는 업무가 맨 뒤다', () => {
    const tasks = [
      makeTask({ id: 'c', dueAt: null }),
      makeTask({ id: 'a', dueAt: '2026-08-31' }),
      makeTask({ id: 'b', dueAt: '2026-08-01' }),
    ];

    expect(ids(sortTasks(tasks, 'due'))).toEqual(['b', 'a', 'c']);
  });

  it('`team`은 TEAM_KEYS 순서, 같은 팀 안에서는 마감 임박순', () => {
    const tasks = [
      makeTask({ id: 'm', teamId: 'marketing', dueAt: '2026-08-01' }),
      makeTask({ id: 'e2', teamId: 'edit', dueAt: '2026-08-20' }),
      makeTask({ id: 's', teamId: 'shoot', dueAt: '2026-08-05' }),
      makeTask({ id: 'e1', teamId: 'edit', dueAt: '2026-08-10' }),
    ];

    expect(ids(sortTasks(tasks, 'team'))).toEqual(['e1', 'e2', 's', 'm']);
  });

  it('`owner`는 이름순이고 미지정이 맨 뒤, 같은 담당자 안에서는 마감 임박순', () => {
    const tasks = [
      makeTask({ id: 'none', ownerNameRaw: null, dueAt: '2026-08-01' }),
      makeTask({ id: 'lee', ownerNameRaw: '이촬영', dueAt: '2026-08-02' }),
      makeTask({ id: 'kim2', ownerNameRaw: '김편집', dueAt: '2026-08-20' }),
      makeTask({ id: 'kim1', ownerNameRaw: '김편집', dueAt: '2026-08-03' }),
    ];

    expect(ids(sortTasks(tasks, 'owner'))).toEqual(['kim1', 'kim2', 'lee', 'none']);
  });

  it('`progress`는 내림차순이고 미입력이 맨 뒤다 — 빈칸은 0이 아니다', () => {
    const tasks = [
      makeTask({ id: 'zero', progress: 0 }),
      makeTask({ id: 'none', progress: null }),
      makeTask({ id: 'high', progress: 80 }),
    ];

    expect(ids(sortTasks(tasks, 'progress'))).toEqual(['high', 'zero', 'none']);
  });

  it('`status`는 지연이 맨 위다', () => {
    const tasks = [
      makeTask({ id: 'muted', displayStatus: 'muted' }),
      makeTask({ id: 'done', displayStatus: 'done' }),
      makeTask({ id: 'planned', displayStatus: 'planned' }),
      makeTask({ id: 'review', displayStatus: 'review' }),
      makeTask({ id: 'progress', displayStatus: 'in_progress' }),
      makeTask({ id: 'overdue', displayStatus: 'overdue' }),
    ];

    expect(ids(sortTasks(tasks, 'status'))).toEqual([
      'overdue',
      'progress',
      'review',
      'planned',
      'done',
      'muted',
    ]);
  });

  it('동률은 id로 갈린다 — 새로고침마다 표가 흔들리면 링크를 못 믿는다', () => {
    const tasks = [
      makeTask({ id: 'b', dueAt: '2026-08-01' }),
      makeTask({ id: 'a', dueAt: '2026-08-01' }),
      makeTask({ id: 'c', dueAt: '2026-08-01' }),
    ];

    expect(ids(sortTasks(tasks, 'due'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTasks(tasks, 'status'))).toEqual(['a', 'b', 'c']);
  });

  it('같은 입력을 두 번 정렬하면 같은 결과다', () => {
    const tasks = [
      makeTask({ id: 'b', dueAt: null }),
      makeTask({ id: 'a', dueAt: '2026-08-01' }),
      makeTask({ id: 'c', dueAt: null }),
    ];

    expect(ids(sortTasks(tasks, 'due'))).toEqual(ids(sortTasks(sortTasks(tasks, 'due'), 'due')));
  });

  it('입력 배열을 고치지 않는다', () => {
    const tasks = [makeTask({ id: 'b', dueAt: '2026-08-20' }), makeTask({ id: 'a', dueAt: '2026-08-01' })];
    const snapshot = ids(tasks);

    const sorted = sortTasks(tasks, 'due');

    expect(ids(tasks)).toEqual(snapshot);
    expect(sorted).not.toBe(tasks);
  });

  it('빈 배열도 그대로 통과한다', () => {
    expect(sortTasks([], 'due')).toEqual([]);
  });

  it('정렬 키마다 한글 라벨이 있다 — 드롭다운이 코드값을 보여주면 안 된다', () => {
    expect(Object.keys(SORT_LABELS).sort()).toEqual(['due', 'owner', 'progress', 'status', 'team']);
    for (const label of Object.values(SORT_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
