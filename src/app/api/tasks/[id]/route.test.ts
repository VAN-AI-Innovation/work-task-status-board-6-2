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

const { DELETE, GET, PATCH } = await import('./route');

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
    memberName: '담당자1',
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

/**
 * **조회도 같은 문을 지난다** (T11). `GET`이 404로 답하면 승인 대기 계정은 「그런 업무가
 * 없다」고 읽고 링크를 의심한다 — 원인은 그 사람의 계정 상태다.
 */
describe('GET /api/tasks/[id] — 승인 대기', () => {
  it('대기 계정에게는 404가 아니라 403 PENDING_APPROVAL이다', async () => {
    stubContext({
      session: {
        status: 'pending',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      },
      found: makeTask(),
    });

    const res = await get(TASK_ID);

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('PENDING_APPROVAL');
  });
});

describe('PATCH /api/tasks/[id] — 인증', () => {
  it('로그인하지 않았으면 401이고 저장소에 쓰지 않는다', async () => {
    const calls = stubContext({ session: { status: 'anonymous' }, found: makeTask() });
    const res = await patch(TASK_ID, { progress: 50 });

    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
    expect(calls).toHaveLength(0);
  });

  /**
   * **셋 다 401이 아니라 403 `PENDING_APPROVAL`이다** (T11). 이 사람들은 **이미 로그인했다** —
   * 401을 주면 화면이 로그인 폼을 다시 띄우고, 같은 계정으로 다시 들어와 같은 화면을 본다.
   * 셋은 `status !== 'ok'`라 아래 401 판정에도 걸리므로, **순서가 곧 문구다**
   * (`route.ts`의 1번 주석 · `pending-gate.ts`).
   */
  it.each([
    ['no_profile', { status: 'no_profile', userId: 'user-1', email: 'x@example.com' }],
    [
      'pending',
      {
        status: 'pending',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      },
    ],
    [
      'rejected',
      {
        status: 'rejected',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      },
    ],
  ] as [string, SessionOutcome][])(
    '%s 세션은 403 PENDING_APPROVAL이고 저장소에 쓰지 않는다',
    async (_label, session) => {
      const calls = stubContext({ session, found: makeTask() });
      const res = await patch(TASK_ID, { progress: 50 });

      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe('PENDING_APPROVAL');
      expect(calls).toHaveLength(0);
    }
  );
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
    // `note`·`extras`는 이제 열려 있다 (`0013`·`0014`). 여전히 닫힌 것은 시트 원본·감사 칸과
    // **민감 키**다 — 연락처·계정이 화면 입력으로 들어오는 길은 그대로 막혀 있다
    ['민감한 팀 전용 칸', { extras: { '출연자 연락처 (내부용)': '010-0000-0000' } }],
    ['감사 칸', { sourceSheetTab: '01_편집팀' }],
    ['팀 바꾸기', { teamId: 'shoot' }],
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

  /**
   * **역할이 못 고치는 칸** (`lockedTaskFields`). 이 축에는 DB 정책이 없어 라우트가 유일한
   * 자물쇠다 — 화면에서 잠그는 것으로 갈음하지 않는다.
   */
  it.each([
    ['마감', { dueAt: '2026-09-01' }],
    ['우선순위', { priority: '높음' }],
    ['리스크', { riskStatus: '주의' }],
    ['승인', { approvalStatus: '승인' }],
    ['배정일', { assignedAt: '2026-08-01' }],
    ['업무명', { title: '새 이름' }],
    ['다음 조치 담당', { nextActionOwner: '담당자2' }],
  ])('member가 %s를 고치려 하면 403이고 쓰기가 나가지 않는다', async (_label, body) => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask(),
    });
    const res = await patch(TASK_ID, body);

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  it('member도 진행을 적는 칸은 고친다 — 막으면 그 화면은 읽기 전용이다', async () => {
    const calls = stubContext({
      session: { status: 'ok', viewer: viewer() },
      found: makeTask(),
      updated: makeTask({ progress: 50 }),
    });

    expect((await patch(TASK_ID, { progress: 50, delayReason: '장비 대여 지연' })).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('lead·admin은 같은 칸을 고친다', async () => {
    for (const role of ['lead', 'admin'] as const) {
      const calls = stubContext({
        session: { status: 'ok', viewer: viewer({ role }) },
        found: makeTask(),
        updated: makeTask({ dueAt: '2026-09-01' }),
      });

      expect((await patch(TASK_ID, { dueAt: '2026-09-01' })).status).toBe(200);
      expect(calls).toHaveLength(1);
    }
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

/**
 * 삭제는 **되돌릴 수 없다.** 그래서 문이 둘이고(역할·행 범위), 실패 갈래를 전부 403으로
 * 접는다 — 「그 id는 있는데 당신 것이 아니다」는 부원에게 전사 업무의 개수를 알려 준다
 * (`S6`).
 */
describe('DELETE /api/tasks/[id]', () => {
  /** `stubContext`는 `deleteTask`를 재지 않는다 — 이 자리에서만 필요한 기록기다 */
  function deleteContext(options: {
    session: SessionOutcome;
    found?: Task | null;
    removed?: boolean;
    readOnly?: boolean;
  }): string[] {
    const calls: string[] = [];
    const base = handle(options.readOnly ?? false);
    const memory = createMemoryTaskStore();

    const repo: TaskRepository = {
      ...memory,
      getTask: async () => options.found ?? null,
      deleteTask: async (id) => {
        calls.push(id);
        return options.removed ?? true;
      },
    };

    viewerOverride = { repo, session: options.session, base };
    return calls;
  }

  function remove(id: string): Promise<Response> {
    return DELETE(new Request(`http://localhost/api/tasks/${id}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id }),
    });
  }

  const OWN = makeTask({ id: TASK_ID, teamId: 'edit', ownerMemberId: 'member-1' });

  it('팀장이 자기 팀 업무를 지우면 204이고 본문이 없다', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'lead' }) },
      found: OWN,
    });

    const res = await remove(TASK_ID);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(calls).toEqual([TASK_ID]);
  });

  it('어드민은 남의 팀 업무도 지운다', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) },
      found: makeTask({ id: TASK_ID, teamId: 'shoot', ownerMemberId: 'member-9' }),
    });

    expect((await remove(TASK_ID)).status).toBe(204);
    expect(calls).toEqual([TASK_ID]);
  });

  it('부원은 자기 업무여도 못 지운다 → 403이고 쓰기가 나가지 않는다', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer() },
      found: OWN,
    });

    const res = await remove(TASK_ID);

    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  /** 팀장이 전 팀을 **보게** 된 뒤로 「보이는데 못 지우는」 업무가 생겼다 (`0012`) */
  it('팀장은 남의 팀 업무를 보더라도 지우지 못한다 → 403', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'lead', teamId: 'edit' }) },
      found: makeTask({ id: TASK_ID, teamId: 'shoot', ownerMemberId: 'member-9' }),
    });

    expect((await remove(TASK_ID)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('없는 업무도 403이다 — 없는 것과 못 지우는 것을 갈라 답하지 않는다 (`S6`)', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) },
      found: null,
    });

    expect((await remove(TASK_ID)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('DB가 0행을 지웠으면 403이다 — 화면이 지우지 못한 것을 지웠다고 말하지 않는다', async () => {
    deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) },
      found: OWN,
      removed: false,
    });

    expect((await remove(TASK_ID)).status).toBe(403);
  });

  it('읽기 전용에서는 저장소를 건드리기 전에 503이다 (`ADR-005`)', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) },
      found: OWN,
      readOnly: true,
    });

    const res = await remove(TASK_ID);

    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('STORAGE_READONLY');
    expect(calls).toHaveLength(0);
  });

  it('로그인하지 않았으면 401이다', async () => {
    const calls = deleteContext({ session: { status: 'anonymous' }, found: OWN });

    const res = await remove(TASK_ID);

    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
    expect(calls).toHaveLength(0);
  });

  it('출처가 다르면 403이다 — 남의 페이지의 요청으로 업무가 사라지지 않는다', async () => {
    const calls = deleteContext({
      session: { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) },
      found: OWN,
    });

    const res = await DELETE(
      new Request(`http://localhost/api/tasks/${TASK_ID}`, {
        method: 'DELETE',
        headers: { origin: 'https://evil.example', host: 'localhost' },
      }),
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
