import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle, StorageMode } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import { resolveViewerContext } from '@/lib/store/viewer-storage';

interface FakeCalls {
  /** 세션을 실제로 해석했는지. `resolveSession`이 부르는 유일한 auth API다 */
  getUser: number;
}

/**
 * 손으로 지은 가짜 클라이언트. `resolveSession`을 mock으로 갈아끼우지 않는 이유는
 * 그러면 「세션을 해석했다」가 아니라 mock이 불렸다를 재게 되기 때문이다.
 */
function fakeClient(spec: { user?: boolean } = {}): { client: SupabaseClient; calls: FakeCalls } {
  const signedIn = spec.user ?? true;
  const calls: FakeCalls = { getUser: 0 };

  const chain = (table: string) => {
    const self = {
      select: () => self,
      eq: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () =>
        table === 'profiles'
          ? // 실제 행에는 status가 반드시 있다 (`not null default 'active'` · T11).
            // 빠뜨리면 이 가짜가 승인 대기 계정을 흉내 내게 된다.
            { data: { role: 'admin', team_id: null, status: 'active', display_name: null }, error: null }
          : { data: { id: 'member-1' }, error: null },
    };
    return self;
  };

  const client = {
    auth: {
      getUser: async () => {
        calls.getUser += 1;
        return signedIn
          ? { data: { user: { id: 'user-1', email: 'admin@example.com' } }, error: null }
          : { data: { user: null }, error: null };
      },
    },
    from: (table: string) => chain(table),
  } as unknown as SupabaseClient;

  return { client, calls };
}

/**
 * `listEvents`만 답하는 가짜. 위 `fakeClient`의 체인은 `maybeSingle`로 끝나는 세션 조회용이라
 * `order`에서 끝나는 이 질의를 태울 수 없다. 어느 테이블을 지났는지 기록한다 —
 * 「무엇을 돌려받았나」만 재면 그 값이 어느 클라이언트에서 왔는지 알 수 없다.
 */
function eventClient(): { client: SupabaseClient; calls: { tables: string[] } } {
  const calls = { tables: [] as string[] };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@example.com' } }, error: null }),
    },
    from: (table: string) => {
      calls.tables.push(table);
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        gte: () => self,
        lt: () => self,
        maybeSingle: async () => ({ data: null, error: null }),
        order: async () => ({
          data: [
            {
              id: 'event-1',
              task_id: 'task-1',
              upload_id: null,
              changed_fields: ['status'],
              occurred_at: '2026-08-27T00:00:00+00:00',
            },
          ],
          error: null,
        }),
      };
      return self;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

/** 진짜 구현을 담는다 — 껍데기를 캐스팅으로 지으면 `repo`가 바뀌었는지만 재고 끝난다 */
function fakeHandle(mode: StorageMode): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: mode === 'live' ? 'supabase' : 'memory',
    mode,
    readOnly: mode === 'fallback',
  };
}

describe('resolveViewerContext', () => {
  it('라이브 + 세션 클라이언트면 조회 저장소를 그 클라이언트로 새로 만든다', async () => {
    const base = fakeHandle('live');
    const { client, calls } = fakeClient();

    const ctx = await resolveViewerContext(base, client);

    expect(ctx.repo).not.toBe(base.repo);
    // 세션을 실제로 해석했다 — 인자로 받은 클라이언트로
    expect(calls.getUser).toBe(1);
    expect(ctx.session).toEqual({
      status: 'ok',
      viewer: {
        userId: 'user-1',
        email: 'admin@example.com',
        role: 'admin',
        teamId: null,
        memberId: 'member-1',
      },
    });
  });

  it('라이브인데 자격증명이 없으면 기존 저장소를 쓰고 미인증이다', async () => {
    const base = fakeHandle('live');

    const ctx = await resolveViewerContext(base, null);

    expect(ctx.repo).toBe(base.repo);
    expect(ctx.session).toEqual({ status: 'anonymous' });
  });

  it('라이브 + 미인증이어도 JWT 저장소를 쓴다 — RLS가 0행을 돌려주는 것이 정직하다', async () => {
    const base = fakeHandle('live');
    const { client, calls } = fakeClient({ user: false });

    const ctx = await resolveViewerContext(base, client);

    // 여기서 base.repo로 되돌리면 「로그인 안 했는데 전부 보인다」가 된다.
    expect(ctx.repo).not.toBe(base.repo);
    expect(ctx.session).toEqual({ status: 'anonymous' });
    expect(calls.getUser).toBe(1);
  });

  it('데모 모드에서는 클라이언트가 있어도 세션을 보지 않는다', async () => {
    const base = fakeHandle('demo');
    const { client, calls } = fakeClient();

    const ctx = await resolveViewerContext(base, client);

    // 메모리 저장소에는 그 사용자의 행이 없다. JWT를 실어 봐야 잴 것이 없다.
    expect(ctx.repo).toBe(base.repo);
    expect(ctx.session).toEqual({ status: 'anonymous' });
    expect(calls.getUser).toBe(0);
  });

  it('폴백에서도 클라이언트가 있어도 세션을 보지 않는다', async () => {
    const base = fakeHandle('fallback');
    const { client, calls } = fakeClient();

    const ctx = await resolveViewerContext(base, client);

    expect(ctx.repo).toBe(base.repo);
    expect(ctx.session).toEqual({ status: 'anonymous' });
    expect(calls.getUser).toBe(0);
  });

  it('모든 갈래에서 base가 그대로 통과한다 — 업로드 경로는 여전히 service_role이다', async () => {
    for (const mode of ['live', 'demo', 'fallback'] as const) {
      const base = fakeHandle(mode);
      const { client } = fakeClient();

      for (const ctx of [
        await resolveViewerContext(base, client),
        await resolveViewerContext(base, null),
      ]) {
        expect(ctx.base).toBe(base);
        expect(ctx.base.uploads).toBe(base.uploads);
        expect(ctx.base.repo).toBe(base.repo);
        expect(ctx.base.driver).toBe(base.driver);
        expect(ctx.base.mode).toBe(mode);
        expect(ctx.base.readOnly).toBe(mode === 'fallback');
      }
    }
  });

  it('이력 조회가 사용자 JWT 클라이언트로 나간다 — service_role 핸들을 타지 않는다', async () => {
    // `0004_events_policy.sql`의 `task_events_select_via_task`는 **authenticated 정책**이다.
    // 이 조회가 `base.repo`(service_role)로 새면 정책이 통째로 우회되고, 그 실패는
    // 에러가 아니라 **에러 없이 더 많이 보이는** 모양으로 나타난다 (`ADR-024`·`ADR-028`).
    const base = fakeHandle('live');
    const { client, calls } = eventClient();

    const ctx = await resolveViewerContext(base, client);
    // 세션 해석이 지나간 테이블은 여기서 잘라 낸다 — 재려는 것은 그 뒤의 이력 조회다
    calls.tables.length = 0;
    const events = await ctx.repo.listEvents();

    // 조회가 인자로 받은 클라이언트를 지났다
    expect(calls.tables).toEqual(['task_events']);
    expect(events).toEqual([
      { id: 'event-1', taskId: 'task-1', uploadId: null, changedFields: ['status'], occurredAt: '2026-08-27T00:00:00.000Z' },
    ]);
    // 같은 호출을 service_role 핸들에 걸면 이 행이 없다 — 두 경로가 실제로 다르다
    expect(await base.repo.listEvents()).toEqual([]);
  });

  it('캐시하지 않는다 — 같은 인자로 두 번 부르면 두 번 만든다', async () => {
    const base = fakeHandle('live');
    const { client, calls } = fakeClient();

    const first = await resolveViewerContext(base, client);
    const second = await resolveViewerContext(base, client);

    expect(second).not.toBe(first);
    expect(second.repo).not.toBe(first.repo);
    // 요청마다 다른 사용자다. 세션 해석을 재사용하면 남의 세션을 물려받는다.
    expect(calls.getUser).toBe(2);
  });
});
