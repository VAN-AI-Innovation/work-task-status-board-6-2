/**
 * 로그아웃이 지는 것은 둘이다 — **세션 쿠키를 실제로 지우는가**, 그리고
 * **`POST`로만 열려 있는가.**
 *
 * 뒤쪽이 이 파일에서 가장 중요하다. 조회 메서드로 열어 두면 링크 프리페치나 `<img>` 태그
 * 하나로 남이 나를 로그아웃시킬 수 있다 (CSRF의 가장 값싼 형태).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CookieAdapter } from '@/lib/auth/session-client';

let clientIsNull = false;
let signOutThrows = false;
let signOutCalls = 0;

/** `@supabase/ssr`이 세션을 끊을 때 하는 일 — 빈 값으로 덮어써 쿠키를 만료시킨다 */
const CLEARED = [
  { name: 'sb-access-token', value: '', options: { path: '/', maxAge: 0 } },
  { name: 'sb-refresh-token', value: '', options: { path: '/', maxAge: 0 } },
];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'sb-access-token', value: 'access' }],
  }),
}));

vi.mock('@/lib/auth/session-client', () => ({
  createSessionClient: (adapter: CookieAdapter) => {
    if (clientIsNull) return null;

    return {
      auth: {
        signOut: async () => {
          signOutCalls += 1;
          if (signOutThrows) throw new Error('network');
          adapter.setAll(CLEARED);
          return { error: null };
        },
      },
    };
  },
}));

const routeModule = await import('./route');

function locationOf(response: Response): string {
  const url = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
  return `${url.pathname}${url.search}`;
}

function request(): Request {
  return new Request('http://localhost:3000/api/auth/logout', { method: 'POST' });
}

beforeEach(() => {
  clientIsNull = false;
  signOutThrows = false;
  signOutCalls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

describe('POST /api/auth/logout', () => {
  it('세션을 끊고 303으로 로그인 화면에 보낸다', async () => {
    const response = await routeModule.POST(request());

    expect(signOutCalls).toBe(1);
    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login');
  });

  it('세션 쿠키를 지우는 값을 응답에 싣는다', async () => {
    const response = await routeModule.POST(request());
    const setCookie = response.headers.getSetCookie().join('\n');

    expect(setCookie).toContain('sb-access-token=');
    expect(setCookie).toContain('Max-Age=0');
  });

  /**
   * **조회 메서드를 내보내지 않는다.** 하나라도 있으면 `<img src="/api/auth/logout">`가
   * 남을 로그아웃시키는 링크가 된다.
   */
  it('POST 말고는 아무 핸들러도 내보내지 않는다', () => {
    expect(Object.keys(routeModule).filter((name) => name === name.toUpperCase())).toEqual([
      'POST',
    ]);
  });

  it('자격증명이 없어도 로그인 화면으로 보낸다 — 데모에서도 막다른 길이 없다', async () => {
    clientIsNull = true;
    const response = await routeModule.POST(request());

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login');
  });

  /** 여기서 던지면 `no_profile` 계정이 로그아웃도 못 하고 고리에 갇힌다 */
  it('세션을 끊다 예외가 나도 던지지 않는다', async () => {
    signOutThrows = true;
    const response = await routeModule.POST(request());

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login');
  });
});

/**
 * 공격 #8 — `POST`로 좁힌 것만으로는 부족하다. 폼 전송은 **남의 페이지에서도** 보낼 수
 * 있으므로(`<form action="…/api/auth/logout">`에 자동 submit) 출처를 함께 본다.
 *
 * ⚠ **이 라우트만 리다이렉트가 아니라 `403`이다.** 실패했을 때 사용자를 보낼 「원래 자리」가
 * 없기 때문이다 — 로그인 화면으로 보내면 세션은 살아 있는데 로그아웃된 것처럼 보이고,
 * **그 착시가 정확히 공격자가 노린 결과다.** 거절은 거절로 보여야 한다.
 */
describe('POST /api/auth/logout — 출처 (T11 step 9)', () => {
  function withOrigin(origin: string): Request {
    return new Request('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: { origin, host: 'localhost:3000' },
    });
  }

  it('다른 출처의 폼은 403이고 세션에 손대지 않는다', async () => {
    const response = await routeModule.POST(withOrigin('https://evil.example'));
    const parsed = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(403);
    expect(parsed.error.code).toBe('FORBIDDEN');
    expect(parsed.error.message).toMatch(/[가-힣]/);
    // 급소 — signOut이 불리지 않았고 쿠키를 지우는 값도 실리지 않았다
    expect(signOutCalls).toBe(0);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('같은 출처의 폼은 통과한다', async () => {
    const response = await routeModule.POST(withOrigin('http://localhost:3000'));

    expect(signOutCalls).toBe(1);
    expect(locationOf(response)).toBe('/login');
  });

  it('`Origin`이 없는 요청(`curl`)은 통과한다 — T8의 검증 절차가 죽지 않는다', async () => {
    const response = await routeModule.POST(request());

    expect(signOutCalls).toBe(1);
    expect(response.status).toBe(303);
  });
});
