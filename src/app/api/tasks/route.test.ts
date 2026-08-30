/**
 * 이 라우트의 계약은 셋이다.
 *
 * 1. **감사용 원본 행이 응답에 없다** (완료 기준 9 · `S6`). `PLAN.md`「검증 방법」 21번이
 *    `curl /api/tasks | grep 연락처`로 확인하라고 한 것을 여기서 자동으로 지킨다.
 * 2. **역할에 따라 민감 값이 다르다** (완료 기준 12). 같은 URL에 `?as=`만 붙였을 때
 *    실제로 값이 달라져야 한다 — 키 목록을 갖고 있다는 것만으로는 증거가 아니다.
 * 3. **에러 본문에 내부 정보가 없다** (`X1`).
 *
 * 메모리 드라이버에는 시드가 들어 있어 데이터가 있는 상태에서 돈다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerContext } from '@/lib/store/viewer-storage';

import { resetStorage } from '@/lib/store/store-factory';

/**
 * 승인 대기 문(T11 step 9 감사)을 재려면 세션을 갈아 끼워야 한다. `null`이면 **진짜
 * 구현**이 돌아서 기존 테스트가 밟던 경로가 그대로 남는다 (`tasks/[id]`와 같은 모양).
 */
let viewerOverride: ViewerContext | null = null;

vi.mock('@/lib/auth/request-viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-viewer')>();
  return {
    currentViewerContext: async () => viewerOverride ?? (await actual.currentViewerContext()),
  };
});

const { GET, POST } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

interface TaskBody {
  tasks: {
    id: string;
    teamId: string;
    extras: Record<string, unknown>;
    flags: { isOverdue: boolean };
  }[];
  meta: { today: string; role: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/tasks${query}`));
}

async function body(query = ''): Promise<TaskBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as TaskBody;
}

/** 시드 안의 민감 키 하나. 부분 일치 목록(`연락처`)에 걸리는 실제 헤더다 */
const CONTACT_KEY = '섭외 / 출연자 연락처 (내부용)';

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

describe('GET /api/tasks', () => {
  it('200으로 업무 목록과 meta를 준다', async () => {
    const parsed = await body();

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('응답 어디에도 감사용 원본 행이 없다 (완료 기준 9)', async () => {
    expect(JSON.stringify(await body())).not.toContain('"raw"');
  });

  it('?as=admin과 기본(member)에서 민감 키의 값이 다르다 (완료 기준 12)', async () => {
    const asMember = await body();
    const asAdmin = await body('?as=admin');

    const memberTask = asMember.tasks.find((task) => CONTACT_KEY in task.extras);
    const adminTask = asAdmin.tasks.find((task) => CONTACT_KEY in task.extras);

    expect(memberTask).toBeDefined();
    expect(memberTask?.extras[CONTACT_KEY]).toBeNull();
    // 키는 남는다 — "가려졌다"와 "원래 비어 있었다"를 구분하기 위해서다
    expect(adminTask?.extras[CONTACT_KEY]).not.toBeNull();
    expect(asMember.meta.role).toBe('member');
    expect(asAdmin.meta.role).toBe('admin');
  });

  it('?team=edit이면 편집팀만 나온다', async () => {
    const parsed = await body('?team=edit');

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.tasks.every((task) => task.teamId === 'edit')).toBe(true);
  });

  it('?team=hr처럼 없는 팀은 400 VALIDATION_FAILED다', async () => {
    const res = await get('?team=hr');
    const parsed = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(400);
    expect(parsed.error.code).toBe('VALIDATION_FAILED');
  });

  it('?overdue=1이면 전건이 지연이다', async () => {
    const parsed = await body('?overdue=1');

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.tasks.every((task) => task.flags.isOverdue)).toBe(true);
  });

  it('?limit=1이면 1건이다', async () => {
    expect((await body('?limit=1')).tasks).toHaveLength(1);
  });

  it('에러 본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get('?limit=0')).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});

/**
 * 공격 #2 — **승인 대기 계정이 조회 API를 직접 부른다** (T11 step 9 감사).
 *
 * 이 라우트들은 화면이 아니라 `fetch`가 부르는 자리라, `pending-gate`가 `deny`를 내고
 * 그것이 **403 `PENDING_APPROVAL`**로 번역된다. 401이 아닌 이유는 **이 사람이 이미
 * 로그인했다**는 것이다 — 401을 주면 화면이 로그인 폼을 다시 띄우고 같은 계정으로 들어와
 * 같은 화면을 본다 (`ARCHITECTURE.md`「에러 처리」).
 *
 * **저장소에 닿기 전에 접히는 것까지 잰다.** 문이 열린 뒤에 거르면 그것은 문이 아니다 —
 * `repo`를 만지는 순간 던지는 것으로 두어, 데이터를 읽고 나서 감추는 구현으로 바뀌면
 * 이 테스트가 먼저 빨개진다.
 */
describe('GET /api/tasks — 승인 대기 (공격 #2)', () => {
  /** 손대면 던진다. 게이트가 먼저 서면 아무도 이걸 부르지 않는다 */
  const forbiddenRepo = new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`게이트를 지나기 전에 저장소를 만졌다: ${String(prop)}`);
      },
    }
  ) as never;

  const WAITING = [
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
  ] as const;

  it.each(WAITING)('%s 계정은 403 PENDING_APPROVAL이고 저장소에 닿지 않는다', async (_label, session) => {
    viewerOverride = {
      repo: forbiddenRepo,
      session: session as never,
      base: { repo: forbiddenRepo, mode: 'live', readOnly: false } as never,
    };

    const res = await get();
    const parsed = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(403);
    expect(parsed.error.code).toBe('PENDING_APPROVAL');
    // 문구는 사람이 읽는 한국어이고 내부 정보를 담지 않는다 (`X1`)
    expect(parsed.error.message).toMatch(/[가-힣]/);
    expect(JSON.stringify(parsed)).not.toContain('user-1');
  });

  it('?as=admin을 붙여도 대기 계정은 그대로 403이다 — URL이 세션을 이기지 않는다', async () => {
    viewerOverride = {
      repo: forbiddenRepo,
      session: {
        status: 'pending',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      } as never,
      base: { repo: forbiddenRepo, mode: 'live', readOnly: false } as never,
    };

    expect((await get('?as=admin')).status).toBe(403);
  });
});

/**
 * **업무 생성**의 계약은 셋이다.
 *
 * 1. **어느 팀에 만들 수 있는지를 목록으로 본다** (`creatableTeams`) — 팀장은 자기 팀 하나,
 *    어드민은 전 팀, 부원은 없다.
 * 2. **감사 칸을 요청이 정하지 않는다** — `sourceKey`는 서버가 짓고, 시트 탭·행 번호는
 *    저장소가 채운다. 웹에서 만든 업무가 시트 행인 척할 수 없어야 한다.
 * 3. **이름은 id에서 유도한다** — 팀 밖 구성원은 403이다 (`PATCH`와 같은 규율).
 */
describe('POST /api/tasks', () => {
  const MEMBER_EDIT = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const MEMBER_EDIT_2 = 'aaaaaaaa-0000-4000-8000-00000000000b';
  const MEMBER_SHOOT = 'bbbbbbbb-0000-4000-8000-00000000000a';

  interface CreatedCall {
    input: import('@/lib/store/task-repository').TaskCreateInput;
    createdAt: string;
  }

  /** 세션·명부를 손으로 짜 넣고 `createTask` 호출을 기록한다 */
  function stub(options: {
    role: 'admin' | 'lead' | 'member';
    teamId: 'edit' | 'shoot' | 'marketing' | null;
    readOnly?: boolean;
  }): CreatedCall[] {
    const calls: CreatedCall[] = [];

    const repo = {
      listMembers: async () => [
        { id: MEMBER_EDIT, teamId: 'edit', name: '담당자1', authUserId: null },
        { id: MEMBER_EDIT_2, teamId: 'edit', name: '담당자2', authUserId: null },
        { id: MEMBER_SHOOT, teamId: 'shoot', name: '촬영이', authUserId: null },
      ],
      createTask: async (
        input: import('@/lib/store/task-repository').TaskCreateInput,
        createdAt: string
      ) => {
        calls.push({ input, createdAt });
        // 응답 직렬화(`toTaskResponse`)가 `.strict()`라 **온전한 행**을 돌려줘야 한다
        return {
          id: 'created-1',
          departmentId: null,
          delayReason: null,
          raw: {},
          lastProgressAt: createdAt,
          sourceUploadId: null,
          sourceSheetTab: '(웹에서 만든 업무)',
          sourceRowIndex: 0,
          ...input,
        } as never;
      },
      listTasks: async () => [],
      listStages: async () => [],
      listGoalMetrics: async () => [],
      getLastSyncedAt: async () => null,
    } as never;

    viewerOverride = {
      repo,
      session: {
        status: 'ok',
        viewer: {
          userId: 'user-1',
          email: 'x@example.com',
          role: options.role,
          teamId: options.teamId,
          memberId: null,
          memberName: null,
        },
      },
      base: {
        repo,
        driver: 'memory',
        mode: options.readOnly === true ? 'fallback' : 'live',
        readOnly: options.readOnly === true,
      },
    } as never;

    return calls;
  }

  function post(body: unknown): Promise<Response> {
    return POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  async function code(res: Response): Promise<string> {
    return ((await res.json()) as { error: { code: string } }).error.code;
  }

  it('팀장이 자기 팀에 만들면 201이고 자연키를 서버가 짓는다', async () => {
    const calls = stub({ role: 'lead', teamId: 'edit' });

    const res = await post({ teamId: 'edit', title: '새 업무', dueAt: '2026-09-01' });

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].input.teamId).toBe('edit');
    expect(calls[0].input.title).toBe('새 업무');
    expect(calls[0].input.dueAt).toBe('2026-09-01');
    // 시트에서 온 자연키와 절대 부딪히지 않는 모양이다 (`manualSourceKey`)
    expect(calls[0].input.sourceKey).toMatch(/^manual::/);
  });

  it('안 준 칸은 null로 내려간다 — 화면이 기본값을 지어내지 않는다', async () => {
    const calls = stub({ role: 'lead', teamId: 'edit' });

    await post({ teamId: 'edit', title: '새 업무' });

    expect(calls[0].input.status).toBeNull();
    expect(calls[0].input.progress).toBeNull();
    expect(calls[0].input.dueAt).toBeNull();
    expect(calls[0].input.ownerMemberId).toBeNull();
    expect(calls[0].input.coOwnerNames).toEqual([]);
  });

  it('팀장은 남의 팀에 만들지 못한다 → 403이고 쓰기가 나가지 않는다', async () => {
    const calls = stub({ role: 'lead', teamId: 'edit' });

    const res = await post({ teamId: 'shoot', title: '새 업무' });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
    expect(calls).toHaveLength(0);
  });

  it('어드민은 아무 팀에나 만든다', async () => {
    const calls = stub({ role: 'admin', teamId: null });

    expect((await post({ teamId: 'marketing', title: '새 업무' })).status).toBe(201);
    expect(calls[0].input.teamId).toBe('marketing');
  });

  it('부원은 만들지 못한다 → 403', async () => {
    const calls = stub({ role: 'member', teamId: 'edit' });

    expect((await post({ teamId: 'edit', title: '새 업무' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('팀을 모르는 팀장은 만들 곳이 없다 → 403', async () => {
    const calls = stub({ role: 'lead', teamId: null });

    expect((await post({ teamId: 'edit', title: '새 업무' })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('담당자 이름은 명부에서 유도한다 — 클라이언트가 정하지 않는다', async () => {
    const calls = stub({ role: 'lead', teamId: 'edit' });

    await post({
      teamId: 'edit',
      title: '새 업무',
      ownerMemberId: MEMBER_EDIT,
      coOwnerMemberIds: [MEMBER_EDIT_2, MEMBER_EDIT],
    });

    expect(calls[0].input.ownerNameRaw).toBe('담당자1');
    // 주 담당과 겹치는 id는 **지운다** (거부하지 않는다 — 같은 뜻의 두 표현이다)
    expect(calls[0].input.coOwnerNames).toEqual(['담당자2']);
  });

  it('팀 밖 구성원을 담당자로 넣으면 403이다 — 없는 id와 갈라 답하지 않는다', async () => {
    const calls = stub({ role: 'lead', teamId: 'edit' });

    expect(
      (await post({ teamId: 'edit', title: '새 업무', ownerMemberId: MEMBER_SHOOT })).status
    ).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('감사 칸을 실어 보내면 400이다 — 시트 행인 척할 수 없다', async () => {
    const calls = stub({ role: 'admin', teamId: null });

    for (const body of [
      { teamId: 'edit', title: 'x', sourceKey: 'card-a' },
      { teamId: 'edit', title: 'x', sourceSheetTab: '01_편집팀' },
      { teamId: 'edit', title: 'x', raw: {} },
      // 팀 전용 칸은 열려 있지만(`0014`) 민감 키는 그대로 막힌다
      { teamId: 'edit', title: 'x', extras: { '출연자 연락처 (내부용)': '010' } },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it('업무명이 없으면 400이다', async () => {
    const calls = stub({ role: 'admin', teamId: null });

    expect((await post({ teamId: 'edit' })).status).toBe(400);
    expect((await post({ teamId: 'edit', title: '   ' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('읽기 전용에서는 저장소를 건드리기 전에 503이다 (`ADR-005`)', async () => {
    const calls = stub({ role: 'admin', teamId: null, readOnly: true });

    const res = await post({ teamId: 'edit', title: '새 업무' });

    expect(res.status).toBe(503);
    expect(await code(res)).toBe('STORAGE_READONLY');
    expect(calls).toHaveLength(0);
  });

  it('출처가 다르면 403이다 — 남의 페이지가 업무를 밀어 넣지 못한다', async () => {
    const calls = stub({ role: 'admin', teamId: null });

    const res = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost' },
        body: JSON.stringify({ teamId: 'edit', title: '새 업무' }),
      })
    );

    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
