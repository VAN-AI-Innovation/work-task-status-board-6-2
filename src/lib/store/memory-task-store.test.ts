import { describe, expect, it } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { describeRepositoryContract } from '@/lib/store/repository-contract';
import type { TaskUpsertInput } from '@/lib/store/task-repository';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskStage } from '@/types/task';

describeRepositoryContract('memory', {
  create: async () => createMemoryTaskStore(),
  reset: async (repo) => {
    (repo as ReturnType<typeof createMemoryTaskStore>).clear();
  },
});

function taskInput(overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'card-a',
    title: '카드뉴스 A',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-07-20',
    dueAt: '2026-07-27',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    sourceUploadId: 'upload-1',
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    stages: [],
    ...overrides,
  };
}

function seedTask(overrides: Partial<Task> = {}): Task {
  const copy: Record<string, unknown> = { ...taskInput() };
  delete copy.stages;
  return {
    ...(copy as Omit<Task, 'id' | 'lastProgressAt'>),
    id: 'seed-1',
    lastProgressAt: '2026-07-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('createMemoryTaskStore', () => {
  it('시드 없이 만들면 비어 있다', async () => {
    const store = createMemoryTaskStore();
    expect(await store.listTasks()).toEqual([]);
    expect(await store.listGoalMetrics()).toEqual([]);
    expect(await store.getLastSyncedAt()).toBeNull();
  });

  it('시드로 태스크·단계·목표 지표를 미리 채운다 (STORAGE_DRIVER=memory 데모)', async () => {
    const stage: TaskStage = {
      id: 'stage-1',
      taskId: 'seed-1',
      seq: 0,
      stageKey: 'concept',
      stageLabel: '컨셉·레퍼런스',
      plannedDate: '2026-07-21',
      actualDate: null,
      content: null,
      confirmStatus: null,
      slaDays: 2,
    };
    const metric: GoalMetric = {
      id: 'goal-1',
      teamId: 'marketing',
      periodLabel: '2026-07 4주차',
      title: '인스타 팔로워 증대',
      goalText: null,
      kpiName: null,
      targetValue: 100,
      actualValue: 120,
      achievementRate: 120,
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
      sourceRowIndex: 25,
    };

    const store = createMemoryTaskStore({ tasks: [seedTask()], stages: [stage], goalMetrics: [metric] });

    expect(await store.listTasks()).toHaveLength(1);
    expect(await store.listStages(['seed-1'])).toHaveLength(1);
    expect(await store.listGoalMetrics()).toHaveLength(1);
    expect(await store.getTask('seed-1')).not.toBeNull();
  });

  it('시드 배열을 나중에 고쳐도 저장소가 따라 바뀌지 않는다', async () => {
    const seed = seedTask();
    const store = createMemoryTaskStore({ tasks: [seed] });
    seed.title = '밖에서 고친 제목';
    expect((await store.listTasks())[0].title).toBe('카드뉴스 A');
  });

  it('clear()가 전부 비운다', async () => {
    const store = createMemoryTaskStore({ tasks: [seedTask()] });
    await store.upsertTasks([taskInput({ sourceKey: 'other' })], { occurredAt: '2026-07-27T09:00:00.000Z' });

    store.clear();

    expect(await store.listTasks()).toEqual([]);
    expect(await store.listStages(['seed-1'])).toEqual([]);
    expect(await store.listGoalMetrics()).toEqual([]);
    expect(await store.getLastSyncedAt()).toBeNull();
  });

  it('id를 순번이 아니라 uuid로 만든다', async () => {
    const store = createMemoryTaskStore();
    await store.upsertTasks([taskInput()], { occurredAt: '2026-07-20T09:00:00.000Z' });
    const [task] = await store.listTasks();
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('목록 순서가 입력 순서와 무관하게 팀·자연키 순으로 결정된다', async () => {
    const store = createMemoryTaskStore();
    await store.upsertTasks(
      [
        taskInput({ teamId: 'shoot', sourceKey: 'b' }),
        taskInput({ teamId: 'edit', sourceKey: 'z' }),
        taskInput({ teamId: 'edit', sourceKey: 'a' }),
      ],
      { occurredAt: '2026-07-20T09:00:00.000Z' },
    );

    expect((await store.listTasks()).map((task) => `${task.teamId}:${task.sourceKey}`)).toEqual([
      'edit:a',
      'edit:z',
      'shoot:b',
    ]);
  });

  it('무변경 건도 감사 필드(업로드 id·행 번호)는 최신 업로드로 갱신한다', async () => {
    const store = createMemoryTaskStore();
    await store.upsertTasks([taskInput()], { occurredAt: '2026-07-20T09:00:00.000Z' });
    await store.upsertTasks([taskInput({ sourceUploadId: 'upload-2', sourceRowIndex: 12 })], {
      occurredAt: '2026-07-27T09:00:00.000Z',
    });

    const [task] = await store.listTasks();
    expect(task.sourceUploadId).toBe('upload-2');
    expect(task.sourceRowIndex).toBe(12);
    expect(task.lastProgressAt).toBe('2026-07-20T09:00:00.000Z');
  });
});
