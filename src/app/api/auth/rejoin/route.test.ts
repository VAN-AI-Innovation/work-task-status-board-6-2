/**
 * 이 라우트가 지는 것은 넷이다 — **대상을 인자로 받지 않는가** · **사용자 JWT로 나가는가** ·
 * **남의 출처에서 온 폼 전송을 막는가** · **실패를 화면으로 되돌리는가.**
 *
 * `signup/route.test.ts`와 같은 방법으로 돈다: 요청이 평범한 폼이라 가짜 `Request` 하나로
 * 전 갈래를 밟을 수 있고, 같은 방법으로 `curl`도 재요청을 보낼 수 있다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CookieAdapter } from '@/lib/auth/session-client';

let clientIsNull = false;
let rpcFails = false;
let rpcThrows = false;
let seenCall: { fn: string; args: unknown } | null = null;

const BAKED = [{ name: 'sb-access-token', value: 'rotated', options: { path: '/' } }];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'sb-access-token', value: 'existing' }],
  }),
}));

vi.mock('@/lib/auth/session-client', () => ({
  createSessionClient: (adapter: CookieAdapter) => {
    if (clientIsNull) return null;

    return {
      rpc: async (fn: string, args: unknown) => {
        seenCall = { fn, args };
        if (rpcThrows) throw new Error('network');
        if (rpcFails) return { data: null, error: { message: 'not permitted' } };
        adapter.setAll(BAKED);
        return { data: null, error: null };
      },
    };
  },
}));

const { POST } = await import('./route');

function formRequest(body: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/auth/rejoin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

function locationOf(response: Response): string {
  const url = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  clientIsNull = false;
  rpcFails = false;
  rpcThrows = false;
  seenCall = null;
});

describe('POST /api/auth/rejoin', () => {
  it('재요청에 성공하면 대기 화면으로 되돌린다', async () => {
    const response = await POST(formRequest({ teamId: 'shoot' }));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/pending');
  });

  it('DB 함수에 넘기는 것은 팀 하나뿐이다 — **대상 사용자를 넘기지 않는다**', async () => {
    await POST(formRequest({ teamId: 'marketing' }));

    expect(seenCall?.fn).toBe('request_join');
    // 대상은 언제나 `auth.uid()`다. 인자로 받는 순간 남의 상태를 바꾸는 문이 된다
    expect(seenCall?.args).toEqual({ team: 'marketing' });
  });

  it('갱신된 세션 쿠키를 응답에 싣는다 — 잃으면 조용히 로그아웃된다', async () => {
    const response = await POST(formRequest({ teamId: 'edit' }));

    expect(response.headers.getSetCookie().join(';')).toContain('sb-access-token=rotated');
  });

  it('모르는 팀은 DB까지 가지 않는다', async () => {
    const response = await POST(formRequest({ teamId: 'sales' }));

    expect(seenCall).toBeNull();
    expect(locationOf(response)).toBe('/pending?error=invalid');
  });

  it('팀이 없는 본문도 같은 갈래다', async () => {
    expect(locationOf(await POST(formRequest({})))).toBe('/pending?error=invalid');
    expect(seenCall).toBeNull();
  });

  it('폼이 아닌 본문에 던지지 않는다', async () => {
    const request = new Request('http://localhost:3000/api/auth/rejoin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"teamId":"edit"}',
    });

    expect(locationOf(await POST(request))).toBe('/pending?error=invalid');
  });

  it('자격증명이 없으면(데모·미설정) 화면으로 되돌린다', async () => {
    clientIsNull = true;

    expect(locationOf(await POST(formRequest({ teamId: 'edit' })))).toBe('/pending?error=invalid');
  });

  it('DB가 거절하면(대기·승인 상태에서 부른 경우) 화면으로 되돌린다', async () => {
    rpcFails = true;

    expect(locationOf(await POST(formRequest({ teamId: 'edit' })))).toBe('/pending?error=invalid');
  });

  it('예외를 위로 던지지 않는다', async () => {
    rpcThrows = true;

    expect(locationOf(await POST(formRequest({ teamId: 'edit' })))).toBe('/pending?error=invalid');
  });

  it('남의 출처에서 온 폼 전송은 DB까지 가지 않는다 (CSRF)', async () => {
    const response = await POST(
      formRequest({ teamId: 'edit' }, { origin: 'https://evil.example.com', host: 'localhost:3000' })
    );

    expect(seenCall).toBeNull();
    expect(locationOf(response)).toBe('/pending?error=invalid');
  });

  it('우리 화면에서 온 폼 전송은 지나간다', async () => {
    await POST(
      formRequest({ teamId: 'edit' }, { origin: 'http://localhost:3000', host: 'localhost:3000' })
    );

    expect(seenCall?.args).toEqual({ team: 'edit' });
  });

  it('`Origin`이 없는 요청은 지나간다 — `curl` 검증 절차가 살아 있어야 한다', async () => {
    await POST(formRequest({ teamId: 'edit' }, { host: 'localhost:3000' }));

    expect(seenCall?.args).toEqual({ team: 'edit' });
  });
});
