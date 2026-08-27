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
          ? { data: { role: 'admin', team_id: null }, error: null }
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
