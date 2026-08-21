import { describe, expect, it } from 'vitest';

import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createStorage, type StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { Task, TaskStage } from '@/types/task';

/** KST 01:30 = UTC 전날 16:30. 이 값이 `2026-08-21`이면 UTC로 자른 것이 아니다 (`E4`) */
const NOW = new Date('2026-08-20T16:30:00.000Z');
const KST_TODAY = '2026-08-21';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'edit-001',
    title: '브이로그 편집',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-08-01',
    dueAt: '2026-09-30',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: { '출연자 연락처': '010-0000-0000' },
    raw: { 업무명: '브이로그 편집' },
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    ...overrides,
  };
}

function makeStage(taskId: string): TaskStage {
  return {
    id: `stage-${taskId}`,
    taskId,
    seq: 0,
    stageKey: 'concept',
    stageLabel: '컨셉·레퍼런스 (+2일)',
    plannedDate: '2026-08-05',
    actualDate: null,
    content: null,
    confirmStatus: null,
    slaDays: 2,
  };
}

function makeStorage(tasks: readonly Task[], stages: readonly TaskStage[] = []): StorageHandle {
  return {
    repo: createMemoryTaskStore({ tasks, stages }),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'demo',
    readOnly: false,
  };
}

const OVERDUE = makeTask({ id: 'task-late', sourceKey: 'edit-late', dueAt: '2026-08-10' });
const ON_TIME = makeTask({ id: 'task-ok', sourceKey: 'edit-ok', dueAt: '2026-09-30' });

describe('buildReadContext', () => {
  it('태스크·단계·메타를 채우고 today가 주입한 now의 KST 날짜다', async () => {
    const storage = makeStorage([ON_TIME], [makeStage('task-ok')]);

    const context = await buildReadContext(storage, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-ok']);
    expect(context.stages.map((stage) => stage.taskId)).toEqual(['task-ok']);
    expect(context.meta.today).toBe(KST_TODAY);
    expect(context.ctx.today).toBe(KST_TODAY);
  });

  it('같은 now를 두 번 넣으면 결과가 같다 — 시계를 읽지 않는다', async () => {
    const storage = makeStorage([OVERDUE, ON_TIME]);

    const first = await buildReadContext(storage, NOW, { as: null, filter: {} });
    const second = await buildReadContext(storage, NOW, { as: null, filter: {} });

    expect(second.meta).toEqual(first.meta);
    expect(second.tasks).toEqual(first.tasks);
    expect(second.ctx.flags).toEqual(first.ctx.flags);
  });

  it('플래그를 미리 계산해 ctx에 실어 준다 — 라우트가 다시 계산할 일이 없다', async () => {
    const storage = makeStorage([OVERDUE, ON_TIME]);

    const context = await buildReadContext(storage, NOW, { as: null, filter: {} });

    expect(context.ctx.flags?.size).toBe(2);
    expect(context.ctx.flags?.get('task-late')?.isOverdue).toBe(true);
    expect(context.ctx.flags?.get('task-ok')?.isOverdue).toBe(false);
  });

  it('overdueOnly면 지연 건만 남는다 — 저장소가 아니라 여기서 거른다', async () => {
    const storage = makeStorage([OVERDUE, ON_TIME], [makeStage('task-late'), makeStage('task-ok')]);

    const context = await buildReadContext(storage, NOW, {
      as: null,
      filter: {},
      overdueOnly: true,
    });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-late']);
    expect(context.ctx.flags?.size).toBe(1);
    expect(context.stages.map((stage) => stage.taskId)).toEqual(['task-late']);
  });

  it('저장소 필터를 그대로 넘긴다', async () => {
    const shoot = makeTask({ id: 'task-shoot', teamId: 'shoot', sourceKey: 'shoot-001' });
    const storage = makeStorage([ON_TIME, shoot]);

    const context = await buildReadContext(storage, NOW, {
      as: null,
      filter: { teamKeys: ['shoot'] },
    });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-shoot']);
  });

  it('조회한 태스크가 없으면 단계도 비어 있다', async () => {
    const storage = makeStorage([], []);

    const context = await buildReadContext(storage, NOW, { as: null, filter: {} });

    expect(context.tasks).toEqual([]);
    expect(context.stages).toEqual([]);
  });

  it('meta.driver·mode·readOnly가 storage의 값과 같다', async () => {
    const fallback = await createStorage({} as NodeJS.ProcessEnv);

    const context = await buildReadContext(fallback, NOW, { as: null, filter: {} });

    expect(fallback.mode).toBe('fallback');
    expect(context.meta.mode).toBe('fallback');
    expect(context.meta.driver).toBe(fallback.driver);
    expect(context.meta.readOnly).toBe(true);
  });

  it('meta.lastSyncedAt이 저장소의 값이다', async () => {
    const storage = makeStorage([ON_TIME]);

    const context = await buildReadContext(storage, NOW, { as: null, filter: {} });

    expect(context.meta.lastSyncedAt).toBeNull();
  });

  it('역할은 ?as=의 해석 결과이고 기본은 member다', async () => {
    const storage = makeStorage([ON_TIME]);

    const asAdmin = await buildReadContext(storage, NOW, { as: 'admin', filter: {} });
    const asNothing = await buildReadContext(storage, NOW, { as: null, filter: {} });
    const asGarbage = await buildReadContext(storage, NOW, { as: 'owner', filter: {} });

    expect(asAdmin.role).toBe('admin');
    expect(asAdmin.meta.role).toBe('admin');
    expect(asNothing.role).toBe('member');
    expect(asGarbage.role).toBe('member');
  });
});

describe('parseTaskQuery', () => {
  function parse(query: string) {
    return parseTaskQuery(new URLSearchParams(query));
  }

  it('team은 반복 가능하다', () => {
    expect(parse('team=edit&team=shoot').filter.teamKeys).toEqual(['edit', 'shoot']);
  });

  it('status는 반복 가능하다', () => {
    expect(parse('status=진행 중&status=완료').filter.statuses).toEqual(['진행 중', '완료']);
  });

  it('owner·dueFrom·dueTo·search·limit을 옮긴다', () => {
    const { filter } = parse(
      'owner=김편집&dueFrom=2026-08-01&dueTo=2026-08-31&search=브이로그&limit=50'
    );

    expect(filter).toEqual({
      ownerNameRaw: '김편집',
      dueFrom: '2026-08-01',
      dueTo: '2026-08-31',
      search: '브이로그',
      limit: 50,
    });
  });

  it('overdue=1이면 overdueOnly가 true다', () => {
    expect(parse('overdue=1').overdueOnly).toBe(true);
    expect(parse('overdue=0').overdueOnly).toBe(false);
    expect(parse('').overdueOnly).toBe(false);
  });

  it('overdue는 TaskFilter에 들어가지 않는다 — 저장소는 판정하지 않는다', () => {
    expect(parse('overdue=1').filter).toEqual({});
  });

  it('모르는 키는 무시된다', () => {
    expect(parse('foo=1&as=admin&task=abc')).toEqual({ filter: {}, overdueOnly: false });
  });

  it('빈 값은 필터가 없는 것으로 본다', () => {
    expect(parse('owner=&search=&limit=&team=').filter).toEqual({});
  });

  it.each(['team=hr', 'limit=0', 'limit=abc', 'limit=1001', 'limit=1.5', 'overdue=yes'])(
    '%s는 던진다',
    (query) => {
      expect(() => parse(query)).toThrow();
    }
  );

  it.each(['dueFrom=2026/08/01', 'dueTo=8월 1일'])('%s는 던진다', (query) => {
    expect(() => parse(query)).toThrow();
  });

  it('team 하나가 잘못되면 전체가 던진다 — 조용히 걸러내지 않는다', () => {
    expect(() => parse('team=edit&team=hr')).toThrow();
  });
});
