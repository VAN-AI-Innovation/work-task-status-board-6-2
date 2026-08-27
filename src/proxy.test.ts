/**
 * 이 파일이 재는 것은 **응답의 모양**이다 — 어느 경로가 공개인가는 `route-guard.test.ts`가
 * 이미 지고 있으므로 여기서는 그 판정이 리다이렉트·401·통과로 옳게 번역되는지만 본다.
 *
 * 「Next 16의 파일 이름이 `proxy.ts`인가」는 **여기서 잴 수 없다.** 프레임워크가 파일을
 * 집어 가는 규칙이라 단위 테스트로는 재지지 않고, `middleware.ts`로 이름을 바꿔 보면
 * 아무 일도 일어나지 않는다는 것을 라이브에서 확인하는 수밖에 없다 (step 10 변이 확인 1).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let user: { id: string } | null = null;
let getUserCalls = 0;

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => {
        getUserCalls += 1;
        return { data: { user }, error: user ? null : { message: 'no session' } };
      },
    },
  }),
}));

const { proxy, config } = await import('./proxy');

const { NextRequest } = await import('next/server');

function requestFor(path: string): InstanceType<typeof NextRequest> {
  return new NextRequest(`http://localhost:3000${path}`);
}

function locationOf(response: Response): string {
  const url = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
  return `${url.pathname}${url.search}`;
}

function live(): void {
  process.env.STORAGE_DRIVER = 'supabase';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
}

beforeEach(() => {
  user = null;
  getUserCalls = 0;
  live();
});

describe('proxy — 미인증 (T8 완료 기준 7)', () => {
  it('보호 화면을 `/login?next=…`로 보낸다', async () => {
    const response = await proxy(requestFor('/'));

    expect(response?.status).toBe(307);
    expect(locationOf(response as Response)).toBe('/login?next=%2F');
  });

  it('원래 가려던 경로와 쿼리를 `next`에 담는다', async () => {
    const response = await proxy(requestFor('/teams/edit?overdue=1'));

    expect(locationOf(response as Response)).toBe('/login?next=%2Fteams%2Fedit%3Foverdue%3D1');
  });

  /**
   * **`/report`는 보호 목록에 이름이 없어도 보호된다** (T9 결정 N). `route-guard.ts`가
   * 공개 목록 방식이라 새 화면은 생기는 순간 막히고, **역할로는 막지 않는다** — 범위는
   * `viewer-scope.ts`와 RLS가 이미 자른다.
   */
  it('주간 보고 화면도 `/login?next=…`으로 보낸다', async () => {
    const response = await proxy(requestFor('/report?week=2026-08-17'));

    expect(response?.status).toBe(307);
    expect(locationOf(response as Response)).toBe('/login?next=%2Freport%3Fweek%3D2026-08-17');
  });

  /**
   * API에 302를 주면 클라이언트가 따라가서 **로그인 화면 HTML을 JSON으로 파싱하려 든다**.
   * 문구는 `api-error.ts`의 표와 글자까지 같아야 한다.
   */
  it('API는 리다이렉트가 아니라 401 JSON이다', async () => {
    const response = await proxy(requestFor('/api/tasks'));

    expect(response?.status).toBe(401);
    expect(response?.headers.get('location')).toBeNull();
    await expect(response?.json()).resolves.toEqual({
      error: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다.' },
    });
  });
});

describe('proxy — 공개 경로', () => {
  it.each(['/login', '/api/auth/login', '/api/auth/logout', '/api/health'])(
    '`%s`는 미인증이어도 그대로 지나간다',
    async (path) => {
      const response = await proxy(requestFor(path));

      expect(response?.headers.get('location')).toBeNull();
      expect(response?.status).toBe(200);
    }
  );

  /** 세션을 물어보러 가지도 않는다 — 로그인 화면이 Auth 서버에 왕복하면 느려지기만 한다 */
  it('공개 경로에서는 세션을 조회하지 않는다', async () => {
    await proxy(requestFor('/login'));
    expect(getUserCalls).toBe(0);
  });
});

describe('proxy — 로그인 상태', () => {
  it('사용자가 있으면 보호 화면을 그대로 지나간다', async () => {
    user = { id: 'u1' };
    const response = await proxy(requestFor('/teams/edit'));

    expect(response?.headers.get('location')).toBeNull();
    expect(response?.status).toBe(200);
  });

  it('사용자가 있으면 API도 그대로 지나간다', async () => {
    user = { id: 'u1' };
    const response = await proxy(requestFor('/api/tasks'));

    expect(response?.status).toBe(200);
  });
});

describe('proxy — 데모 모드 (결정 E)', () => {
  /** `.env` 없이 클론한 심사자의 경로다. 여기서 막으면 그 사람은 아무것도 못 본다 */
  it('`STORAGE_DRIVER=memory`면 아무 일도 하지 않는다', async () => {
    process.env.STORAGE_DRIVER = 'memory';
    const response = await proxy(requestFor('/'));

    expect(response?.headers.get('location')).toBeNull();
    expect(response?.status).toBe(200);
    expect(getUserCalls).toBe(0);
  });

  it('데모에서는 주간 보고 화면도 그냥 열린다 — 심사자에게는 계정이 없다', async () => {
    process.env.STORAGE_DRIVER = 'memory';
    const response = await proxy(requestFor('/report'));

    expect(response?.status).toBe(200);
    expect(getUserCalls).toBe(0);
  });

  it('자격증명이 없으면 아무 일도 하지 않는다', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await proxy(requestFor('/api/tasks'));

    expect(response?.status).toBe(200);
    expect(getUserCalls).toBe(0);
  });
});

describe('proxy — 규약', () => {
  /** matcher가 없으면 프록시가 CSS·JS·이미지까지 가로채 화면이 통째로 깨진다 */
  it('정적 자산을 matcher에서 뺀다', () => {
    const matcher = [config.matcher].flat().join('|');

    expect(matcher).toContain('_next/static');
    expect(matcher).toContain('_next/image');
    expect(matcher).toContain('favicon.ico');
  });
});
