/**
 * 상세 조회의 계약은 둘이다 — **단계 타임라인이 함께 온다**(`UC-15`)와
 * **없는 id는 404 `TASK_NOT_FOUND`**다. 뒤엣것을 `VALIDATION_FAILED`로 뭉개면 「낡은 링크」와
 * 「잘못된 요청」이 같은 응답이 되고, 화면이 무엇을 안내할지 정할 수 없다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { getStorage, resetStorage } from '@/lib/store/store-factory';
import type { StorageHandle } from '@/lib/store/store-factory';
import type { TaskRepository } from '@/lib/store/task-repository';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { ViewerContext } from '@/lib/store/viewer-storage';
import type { SessionOutcome } from '@/lib/auth/viewer-session';
import type { TaskPatch, Viewer } from '@/types/auth';
import type { Task } from '@/types/task';

/**
 * `PATCH`는 세션·저장소 상태를 갈아 끼워야 재는 것이 대부분이라 문맥을 손으로 짓는다.
 * `null`이면 **진짜 구현**이 돈다 — `GET` 테스트가 지금까지 밟던 경로를 그대로 둔다.
 */
let viewerOverride: ViewerContext | null = null;

vi.mock('@/lib/auth/request-viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-viewer')>();
  return {
    currentViewerContext: async () => viewerOverride ?? (await actual.currentViewerContext()),
  };
});

const { GET, PATCH } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

function get(id: string, query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/tasks/${id}${query}`), {
    params: Promise.resolve({ id }),
  });
}

/** 시드에서 단계가 달린 업무 하나를 고른다 */
async function seededTaskWithStages(): Promise<string> {
  const storage = await getStorage();
  const tasks = await storage.repo.listTasks();
  for (const task of tasks) {
    const stages = await storage.repo.listStages([task.id]);
    if (stages.length > 0) return task.id;
  }
  throw new Error('시드에 단계가 달린 업무가 없다');
}

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  viewerOverride = null;
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/tasks/[id]', () => {
  it('200에 업무와 단계 타임라인이 함께 온다', async () => {
    const id = await seededTaskWithStages();
    const res = await get(id);
    const parsed = (await res.json()) as {
      task: { id: string; flags: unknown; displayStatus: string };
      stages: { taskId: string }[];
      meta: { today: string };
    };

    expect(res.status).toBe(200);
    expect(parsed.task.id).toBe(id);
    expect(parsed.task.flags).toBeDefined();
    expect(parsed.stages.length).toBeGreaterThan(0);
    expect(parsed.stages.every((stage) => stage.taskId === id)).toBe(true);
    expect(parsed.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('응답에 감사용 원본 행이 없다', async () => {
    const id = await seededTaskWithStages();

    expect(JSON.stringify(await (await get(id)).json())).not.toContain('"raw"');
  });

  it('없는 id는 404 TASK_NOT_FOUND다', async () => {
    const res = await get('00000000-0000-4000-8000-000000000000');
    const parsed = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(404);
    expect(parsed.error.code).toBe('TASK_NOT_FOUND');
    expect(parsed.error.message).toMatch(/[가-힣]/);
  });

  it('id 모양이 아니어도 404다 — 있는지 없는지가 답이지 형식이 답이 아니다', async () => {
    expect((await get('not-a-real-id')).status).toBe(404);
  });

  it('에러 본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get('not-a-real-id')).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});

/* ── PATCH ────────────────────────────────────────────────────────────────── */

/**
 * `TICKETS.md` T8 완료 기준 2 — **「`member`가 타인의 태스크에 `PATCH`를 보내면 서버가
 * `FORBIDDEN`으로 거부한다」**. UI 숨김은 방어가 아니므로 여기서 서버만 두고 잰다.
 *
 * 거부 케이스는 상태 코드만이 아니라 **`updateTask`가 불리지 않았다**를 함께 잰다.
 * 코드가 403인데 쓰기는 이미 나간 상황이 실제로 있을 수 있고, 그때 상태 코드는 거짓말이다.
 */

interface UpdateCall {
  id: string;
  patch: TaskPatch;
  updatedAt: string;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'contract::patch',
    title: '샘플 업무',
    ownerMemberId: 'member-1',
    ownerNameRaw: '편집1',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: null,
    dueAt: null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: { '업무명': '샘플 업무' },
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 2,
    ...overrides,
  };
}

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: 'user-1',
    email: 'member@example.com',
    role: 'member',
    teamId: 'edit',
    memberId: 'member-1',
    ...overrides,
  };
}

function handle(readOnly = false): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: readOnly ? 'fallback' : 'live',
    readOnly,
  };
}

/** 세션·저장소를 손으로 짜 넣고 `updateTask` 호출을 기록한다 */
function stubContext(options: {
  session: SessionOutcome;
  /** `getTask`가 돌려줄 값. RLS가 거른 상태를 흉내 내려면 `null` */
  found?: Task | null;
  /** `updateTask`가 돌려줄 값. DB가 막은 상태를 흉내 내려면 `null` */
  updated?: Task | null;
  readOnly?: boolean;
}): UpdateCall[] {
  const calls: UpdateCall[] = [];
  const base = handle(options.readOnly ?? false);
  const memory = createMemoryTaskStore();

  const repo: TaskRepository = {
    ...memory,
    getTask: async () => options.found ?? null,
    updateTask: async (id, patch, updatedAt) => {
      calls.push({ id, patch, updatedAt });
      return options.updated ?? null;
    },
  };

  viewerOverride = { repo, session: options.session, base };
  return calls;
}

function patch(id: string, body: unknown): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

function patchRaw(id: string, body: string): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    { params: Promise.resolve({ id }) }
  );
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const TASK_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('PATCH /api/tasks/[id] — 인증', () => {
  it('로그인하지 않았으면 401이고 저장소에 쓰지 않는다', async () => {
    const calls = stubContext({ session: { status: 'anonymous' }, found: makeTask() });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
    expect(calls).toHaveLength(0);
  });

  it('프로필이 없는 세션도 401이다 — 역할이 없으면 범위를 정할 수 없다', async () => {
    const calls = stubContext({
      session: { status: 'no_profile', userId: 'user-1', email: 'x@example.com' },
      found: makeTask(),
    });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
    expect(calls).toHaveLength(0);
  });
});

describe('PATCH /api/tasks/[id] — 저장소 상태', () => {
  it('읽기 전용 모드는 503이고 쓰기가 나가지 않는다 (`ADR-005`)', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ progress: 50 }),
      readOnly: true,
    });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('STORAGE_READONLY');
    expect(calls).toHaveLength(0);
  });
});

describe('PATCH /api/tasks/[id] — 본문 검증', () => {
  function okContext(): UpdateCall[] {
    return stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ progress: 50 }),
    });
  }

  it.each([
    ['모르는 키', { status: '완료', titel: '오타' }],
    ['허용하지 않는 필드', { note: '메모' }],
    ['빈 객체', {}],
    ['범위를 넘는 진행률', { progress: 101 }],
    ['정수가 아닌 진행률', { progress: 1.5 }],
    ['빈 상태', { status: '' }],
  ])('%s → 400 VALIDATION_FAILED이고 쓰기가 나가지 않는다', async (_label, body) => {
    const calls = okContext();
    const res = await patch(TASK_ID, body);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('본문이 JSON이 아니어도 400이다', async () => {
    const calls = okContext();
    const res = await patchRaw(TASK_ID, '진행 중');

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });
});

describe('PATCH /api/tasks/[id] — 권한 (완료 기준 2)', () => {
  it('member가 남의 건을 고치려 하면 403이다 — RLS가 걸러 보이지 않는다', async () => {
    const calls = stubContext({ session: { status: 'ok', viewer: viewer() }, found: null });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  it('없는 id도 403이다 — 존재 여부를 구분해 답하지 않는다 (`S6`)', async () => {
    stubContext({ session: { status: 'ok', viewer: viewer() }, found: null });

    expect((await patch('00000000-0000-4000-8000-000000000000', { progress: 1 })).status).toBe(403);
  });

  it('저장소가 남의 건을 돌려줘도 앱이 다시 막는다 — RLS가 느슨해진 날의 둘째 층', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask({ ownerMemberId: 'member-99' }),
      updated: makeTask({ ownerMemberId: 'member-99', progress: 50 }),
    });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  it('저장소가 0행을 돌려주면 403이다 — DB가 막았다', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: null,
    });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    // 판정을 통과했으므로 쓰기는 실제로 시도됐다
    expect(calls).toHaveLength(1);
  });

  it('admin은 남의 팀 건도 고친다 — 범위가 전사다', async () => {
    const other = makeTask({ teamId: 'shoot', ownerMemberId: 'member-99' });
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null, memberId: null }) },
      found: other,
      updated: { ...other, status: '완료' },
    });
    const res = await patch(TASK_ID, { status: '완료' });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe('PATCH /api/tasks/[id] — 성공 응답', () => {
  it('본인 건이면 200이고 저장소에 (id, patch, ISO 시각)이 그대로 넘어간다', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ status: '완료', progress: 100 }),
    });
    const res = await patch(TASK_ID, { status: '완료', progress: 100 });
    const parsed = (await res.json()) as {
      task: { id: string; status: string; progress: number; flags: unknown; displayStatus: string };
      meta: { today: string; role: string };
    };

    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { id: TASK_ID, patch: { status: '완료', progress: 100 }, updatedAt: expect.any(String) },
    ]);
    expect(new Date(calls[0].updatedAt).toISOString()).toBe(calls[0].updatedAt);

    // `GET`과 같은 모양이다 — 화면이 두 응답을 같은 코드로 다룬다
    expect(parsed.task.id).toBe(TASK_ID);
    expect(parsed.task.status).toBe('완료');
    expect(parsed.task.progress).toBe(100);
    expect(parsed.task.flags).toBeDefined();
    expect(parsed.task.displayStatus).toBeDefined();
    expect(parsed.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.meta.role).toBe('member');
  });

  it('progress: null은 값을 지운다 — 키 없음과 구분해 넘긴다', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ progress: null }),
    });

    expect((await patch(TASK_ID, { progress: null })).status).toBe(200);
    expect(calls[0].patch).toEqual({ progress: null });
  });

  it('응답에 감사용 원본 행이 없다 (`S6`)', async () => {
    stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ progress: 50 }),
    });
    const text = await (await patch(TASK_ID, { progress: 50 })).text();

    expect(text).not.toContain('"raw"');
    expect(text).not.toContain('업무명');
  });
});
