import { describe, expect, it } from 'vitest';

import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import type { SessionOutcome } from '@/lib/auth/viewer-session';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createStorage, type StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { ViewerContext } from '@/lib/store/viewer-storage';
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

function makeHandle(tasks: readonly Task[], stages: readonly TaskStage[] = []): StorageHandle {
  return {
    repo: createMemoryTaskStore({ tasks, stages }),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'demo',
    readOnly: false,
  };
}

/**
 * 로그인하지 않은 조회 문맥. **조회는 `view.repo`로 나가고 `base`는 따라만 다닌다** —
 * `base.repo`를 조회에 쓰면 라이브에서 `service_role`이 RLS를 통째로 우회한다. 그래서
 * 여기서는 둘을 **일부러 다르게** 둔다: `base.repo`는 태스크가 하나도 없는 저장소다.
 */
function makeView(
  tasks: readonly Task[],
  stages: readonly TaskStage[] = [],
  session: SessionOutcome = { status: 'anonymous' }
): ViewerContext {
  return {
    repo: createMemoryTaskStore({ tasks, stages }),
    session,
    base: makeHandle([], []),
  };
}

/** 저장소 핸들 하나를 조회에도 그대로 쓰는 문맥 (`meta`가 그 핸들의 값인지 볼 때) */
function viewOf(base: StorageHandle): ViewerContext {
  return { repo: base.repo, session: { status: 'anonymous' }, base };
}

const signedIn = (role: ViewerRole, over: Partial<{ teamId: Task['teamId'] | null; memberId: string | null }> = {}): SessionOutcome => ({
  status: 'ok',
  viewer: {
    userId: 'u1',
    email: 'u1@example.com',
    role,
    teamId: over.teamId === undefined ? 'edit' : over.teamId,
    memberId: over.memberId === undefined ? 'member-1' : over.memberId,
    memberName: null,
  },
});

const OVERDUE = makeTask({ id: 'task-late', sourceKey: 'edit-late', dueAt: '2026-08-10' });
const ON_TIME = makeTask({ id: 'task-ok', sourceKey: 'edit-ok', dueAt: '2026-09-30' });

describe('buildReadContext', () => {
  it('태스크·단계·메타를 채우고 today가 주입한 now의 KST 날짜다', async () => {
    const view = makeView([ON_TIME], [makeStage('task-ok')]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-ok']);
    expect(context.stages.map((stage) => stage.taskId)).toEqual(['task-ok']);
    expect(context.meta.today).toBe(KST_TODAY);
    expect(context.ctx.today).toBe(KST_TODAY);
  });

  it('같은 now를 두 번 넣으면 결과가 같다 — 시계를 읽지 않는다', async () => {
    const view = makeView([OVERDUE, ON_TIME]);

    const first = await buildReadContext(view, NOW, { as: null, filter: {} });
    const second = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(second.meta).toEqual(first.meta);
    expect(second.tasks).toEqual(first.tasks);
    expect(second.ctx.flags).toEqual(first.ctx.flags);
  });

  it('플래그를 미리 계산해 ctx에 실어 준다 — 라우트가 다시 계산할 일이 없다', async () => {
    const view = makeView([OVERDUE, ON_TIME]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.ctx.flags?.size).toBe(2);
    expect(context.ctx.flags?.get('task-late')?.isOverdue).toBe(true);
    expect(context.ctx.flags?.get('task-ok')?.isOverdue).toBe(false);
  });

  it('overdueOnly면 지연 건만 남는다 — 저장소가 아니라 여기서 거른다', async () => {
    const view = makeView([OVERDUE, ON_TIME], [makeStage('task-late'), makeStage('task-ok')]);

    const context = await buildReadContext(view, NOW, {
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
    const view = makeView([ON_TIME, shoot]);

    const context = await buildReadContext(view, NOW, {
      as: null,
      filter: { teamKeys: ['shoot'] },
    });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-shoot']);
  });

  it('조회한 태스크가 없으면 단계도 비어 있다', async () => {
    const view = makeView([], []);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks).toEqual([]);
    expect(context.stages).toEqual([]);
  });

  it('meta.driver·mode·readOnly가 storage의 값과 같다', async () => {
    // 빈 환경은 이제 **데모**다 (`ADR-029`). 폴백을 재현하려면 「실저장소를 쓰겠다고
    // 적어 두고 키가 없는」 상태를 만들어야 한다 — 이 테스트가 재는 것은 그 갈래가 아니라
    // meta가 storage의 값을 그대로 옮기는가다.
    const fallback = await createStorage({
      STORAGE_DRIVER: 'supabase',
    } as unknown as NodeJS.ProcessEnv);

    const context = await buildReadContext(viewOf(fallback), NOW, { as: null, filter: {} });

    expect(fallback.mode).toBe('fallback');
    expect(context.meta.mode).toBe('fallback');
    expect(context.meta.driver).toBe(fallback.driver);
    expect(context.meta.readOnly).toBe(true);
  });

  it('meta.lastSyncedAt이 저장소의 값이다', async () => {
    const view = makeView([ON_TIME]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.meta.lastSyncedAt).toBeNull();
  });

  it('역할은 ?as=의 해석 결과이고 기본은 member다', async () => {
    const view = makeView([ON_TIME]);

    const asAdmin = await buildReadContext(view, NOW, { as: 'admin', filter: {} });
    const asNothing = await buildReadContext(view, NOW, { as: null, filter: {} });
    const asGarbage = await buildReadContext(view, NOW, { as: 'owner', filter: {} });

    expect(asAdmin.role).toBe('admin');
    expect(asAdmin.meta.role).toBe('admin');
    expect(asNothing.role).toBe('member');
    expect(asGarbage.role).toBe('member');
  });

  it('세션이 있으면 그 역할이 ?as=를 이긴다 — 판정은 resolveViewerRole이 지고 여기는 옮긴다', async () => {
    const view = makeView([ON_TIME], [], signedIn('member'));

    const context = await buildReadContext(view, NOW, { as: 'admin', filter: {} });

    expect(context.role).toBe('member');
    expect(context.meta.role).toBe('member');
  });

  it('조회는 view.repo로 한다 — base.repo(service_role)로 읽으면 RLS가 우회된다', async () => {
    // `makeView`의 `base.repo`는 비어 있다. `base`로 읽으면 0건이 나온다
    const view = makeView([ON_TIME, OVERDUE]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-ok', 'task-late']);
  });

  it('meta.driver·mode·readOnly는 base의 값이다 — 저장소의 성질이지 사용자의 성질이 아니다', async () => {
    const view = makeView([ON_TIME]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.meta.driver).toBe(view.base.driver);
    expect(context.meta.mode).toBe(view.base.mode);
    expect(context.meta.readOnly).toBe(view.base.readOnly);
  });

  it('로그인하지 않았으면 viewer가 null이고 범위를 거르지 않는다', async () => {
    const mine = makeTask({ id: 'task-mine', sourceKey: 'edit-mine', ownerMemberId: 'member-1' });
    const view = makeView([mine, ON_TIME]);

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.viewer).toBeNull();
    expect(context.tasks.map((task) => task.id)).toEqual(['task-mine', 'task-ok']);
  });

  it('member 세션이면 본인 담당 건만 남고 viewer가 실린다 (viewer-scope)', async () => {
    const mine = makeTask({ id: 'task-mine', sourceKey: 'edit-mine', ownerMemberId: 'member-1' });
    const theirs = makeTask({ id: 'task-theirs', sourceKey: 'edit-theirs', ownerMemberId: 'member-2' });
    const view = makeView([mine, theirs, ON_TIME], [], signedIn('member'));

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-mine']);
    expect(context.viewer?.memberId).toBe('member-1');
  });

  /*
   * **팀장의 열람 범위는 전사다** (`0012_lead_org_read.sql` · `viewer-scope.ts`). 좁히는 것은
   * 이제 수정 범위(`taskEditable`)뿐이고, 이 함수는 조회 문맥이라 그것을 걸지 않는다.
   */
  it('lead 세션도 전 팀을 본다 — 좁히는 것은 수정 범위뿐이다', async () => {
    const shoot = makeTask({ id: 'task-shoot', teamId: 'shoot', sourceKey: 'shoot-001' });
    const view = makeView([ON_TIME, shoot], [], signedIn('lead'));

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-ok', 'task-shoot']);
  });

  it('admin 세션은 전부 본다', async () => {
    const shoot = makeTask({ id: 'task-shoot', teamId: 'shoot', sourceKey: 'shoot-001' });
    const view = makeView([ON_TIME, shoot], [], signedIn('admin', { teamId: null }));

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-ok', 'task-shoot']);
  });

  /**
   * **범위를 먼저 거르고 그다음 지연을 거른다.** 순서가 뒤집히면 플래그 표가 범위 밖 건까지
   * 담은 채로 남아 목록과 모수가 어긋나고, 그때 집계가 화면과 갈라진다.
   */
  it('범위 거르기가 overdue 거르기보다 먼저다 — 플래그 표의 모수가 목록과 같다', async () => {
    const myLate = makeTask({
      id: 'task-my-late',
      sourceKey: 'edit-my-late',
      dueAt: '2026-08-10',
      ownerMemberId: 'member-1',
    });
    const theirLate = makeTask({
      id: 'task-their-late',
      sourceKey: 'edit-their-late',
      dueAt: '2026-08-10',
      ownerMemberId: 'member-2',
    });
    const view = makeView(
      [myLate, theirLate, ON_TIME],
      [makeStage('task-my-late'), makeStage('task-their-late')],
      signedIn('member')
    );

    const context = await buildReadContext(view, NOW, { as: null, filter: {}, overdueOnly: true });

    expect(context.tasks.map((task) => task.id)).toEqual(['task-my-late']);
    expect(context.ctx.flags.size).toBe(1);
    expect([...context.ctx.flags.keys()]).toEqual(['task-my-late']);
    expect(context.stages.map((stage) => stage.taskId)).toEqual(['task-my-late']);
  });

  it('범위를 거른 뒤에도 지연이 없으면 플래그 표는 범위 목록과 같다', async () => {
    const mine = makeTask({ id: 'task-mine', sourceKey: 'edit-mine', ownerMemberId: 'member-1' });
    const theirs = makeTask({ id: 'task-theirs', sourceKey: 'edit-theirs', ownerMemberId: 'member-2' });
    const view = makeView([mine, theirs], [], signedIn('member'));

    const context = await buildReadContext(view, NOW, { as: null, filter: {} });

    expect(context.ctx.flags.size).toBe(1);
    expect([...context.ctx.flags.keys()]).toEqual(['task-mine']);
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
