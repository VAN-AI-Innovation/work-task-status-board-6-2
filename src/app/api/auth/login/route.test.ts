/**
 * 이 라우트가 지는 것은 셋이다 — **쿠키를 굽는가 · 실패 사유를 흘리지 않는가 ·
 * `?next=`로 남의 사이트에 보내지 않는가.**
 *
 * 서버 액션이 아니라 라우트 핸들러인 이유가 여기서도 보인다: 요청이 평범한 폼이라
 * 가짜 `Request` 하나로 전 갈래를 밟을 수 있고, 같은 방법으로 `curl`도 로그인할 수 있다
 * (T8 완료 기준 2의 검증 수단).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CookieAdapter } from '@/lib/auth/session-client';

/** `createSessionClient`가 무엇을 받았고 로그인이 어떻게 끝나는지를 이 셋으로 조종한다 */
let clientIsNull = false;
let signInFails = false;
let signInThrows = false;
let seenCredentials: { email: string; password: string } | null = null;
let capturedAdapter: CookieAdapter | null = null;

/** `@supabase/ssr`이 세션 쿠키를 구울 때 부르는 자리. 성공 갈래에서만 불린다 */
const BAKED = [
  { name: 'sb-access-token', value: 'access', options: { path: '/', httpOnly: true } },
  { name: 'sb-refresh-token', value: 'refresh', options: { path: '/', httpOnly: true } },
];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'existing', value: '1' }],
  }),
}));

vi.mock('@/lib/auth/session-client', () => ({
  createSessionClient: (adapter: CookieAdapter) => {
    capturedAdapter = adapter;
    if (clientIsNull) return null;

    return {
      auth: {
        signInWithPassword: async (credentials: { email: string; password: string }) => {
          seenCredentials = credentials;
          if (signInThrows) throw new Error('network');
          if (signInFails) return { data: {}, error: { message: 'Invalid credentials' } };
          adapter.setAll(BAKED);
          return { data: { session: {} }, error: null };
        },
      },
    };
  },
}));

const { POST } = await import('./route');

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function formRequest(body: Record<string, string>, search = ''): Request {
  return new Request(`http://localhost:3000/api/auth/login${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

/** cross-site 폼 전송을 흉내 낸다. 브라우저가 스스로 붙이는 헤더다 */
function withOrigin(request: Request, origin: string): Request {
  const headers = new Headers(request.headers);
  headers.set('origin', origin);
  headers.set('host', 'localhost:3000');

  return new Request(request, { headers });
}

/** `Location`은 절대 URL이다. 비교는 경로+쿼리로 한다 */
function locationOf(response: Response): string {
  const raw = response.headers.get('location') ?? '';
  const url = new URL(raw, 'http://localhost:3000');
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  clientIsNull = false;
  signInFails = false;
  signInThrows = false;
  seenCredentials = null;
  capturedAdapter = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_KEY;
});

describe('POST /api/auth/login — 성공', () => {
  it('303으로 `/`에 보내고 세션 쿠키를 응답에 싣는다', async () => {
    const response = await POST(formRequest({ email: 'a@example.com', password: 'pw' }));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/');

    // 쿠키가 응답에 실리지 않으면 로그인은 「성공했는데 로그인되지 않은」 상태가 된다
    const setCookie = response.headers.getSetCookie().join('\n');
    expect(setCookie).toContain('sb-access-token=access');
    expect(setCookie).toContain('sb-refresh-token=refresh');
  });

  it('폼 값을 그대로 넘긴다', async () => {
    await POST(formRequest({ email: 'a@example.com', password: 'pw' }));
    expect(seenCredentials).toEqual({ email: 'a@example.com', password: 'pw' });
  });

  it('요청에 이미 있던 쿠키를 읽는다', async () => {
    await POST(formRequest({ email: 'a@example.com', password: 'pw' }));
    expect(capturedAdapter?.getAll()).toEqual([{ name: 'existing', value: '1' }]);
  });

  it('안전한 `?next=`는 그대로 목적지가 된다', async () => {
    const response = await POST(
      formRequest({ email: 'a@example.com', password: 'pw' }, '?next=%2Fteams%2Fedit%3Fx%3D1')
    );

    expect(locationOf(response)).toBe('/teams/edit?x=1');
  });
});

describe('POST /api/auth/login — 오픈 리다이렉트', () => {
  /** `safe-redirect.ts`가 판정을 지고, 여기서는 **라우트가 그것을 실제로 부르는지**를 잰다 */
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)'])(
    '`?next=%s`는 `/`로 떨어진다',
    async (next) => {
      const response = await POST(
        formRequest(
          { email: 'a@example.com', password: 'pw' },
          `?next=${encodeURIComponent(next)}`
        )
      );

      expect(response.status).toBe(303);
      expect(locationOf(response)).toBe('/');
      expect(response.headers.get('location')).not.toContain('evil.com');
    }
  );
});

describe('POST /api/auth/login — 실패', () => {
  it('자격증명이 틀리면 `/login?error=invalid`다', async () => {
    signInFails = true;
    const response = await POST(formRequest({ email: 'a@example.com', password: 'wrong' }));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login?error=invalid');
  });

  /**
   * **사유를 구분해 알리지 않는다.** 「없는 계정」과 「비밀번호 틀림」이 다른 답을 주면
   * 이 엔드포인트가 계정 존재 확인 도구가 된다.
   */
  it('없는 계정과 틀린 비밀번호가 같은 답을 받는다', async () => {
    signInFails = true;
    const missing = await POST(formRequest({ email: 'nobody@example.com', password: 'pw' }));
    const wrong = await POST(formRequest({ email: 'a@example.com', password: 'wrong' }));

    expect(locationOf(missing)).toBe(locationOf(wrong));
  });

  it('로그인 중 예외가 나도 던지지 않고 `invalid`로 접는다', async () => {
    signInThrows = true;
    const response = await POST(formRequest({ email: 'a@example.com', password: 'pw' }));

    expect(locationOf(response)).toBe('/login?error=invalid');
  });

  it('이메일 형식이 아니면 저장소에 닿기 전에 `invalid`다', async () => {
    const response = await POST(formRequest({ email: 'not-an-email', password: 'pw' }));

    expect(locationOf(response)).toBe('/login?error=invalid');
    expect(seenCredentials).toBeNull();
  });

  it('비밀번호가 비면 `invalid`다', async () => {
    const response = await POST(formRequest({ email: 'a@example.com', password: '' }));

    expect(locationOf(response)).toBe('/login?error=invalid');
    expect(seenCredentials).toBeNull();
  });

  it('폼이 아닌 본문도 400 JSON이 아니라 `invalid` 리다이렉트다 — 사용자는 브라우저다', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"email":"a@example.com"}',
      })
    );

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login?error=invalid');
  });

  it('자격증명이 없으면 `unavailable`이다 — `invalid`와 구분한다', async () => {
    clientIsNull = true;
    const response = await POST(formRequest({ email: 'a@example.com', password: 'pw' }));

    expect(locationOf(response)).toBe('/login?error=unavailable');
  });

  /** 실패해도 원래 가려던 곳은 잃지 않는다 — 다시 로그인하면 거기로 간다 */
  it('실패 리다이렉트가 안전한 `next`를 보존한다', async () => {
    signInFails = true;
    const response = await POST(
      formRequest({ email: 'a@example.com', password: 'x' }, '?next=%2Fupload')
    );

    expect(locationOf(response)).toBe('/login?error=invalid&next=%2Fupload');
  });

  it('실패 리다이렉트가 위험한 `next`를 되싣지 않는다', async () => {
    signInFails = true;
    const response = await POST(
      formRequest({ email: 'a@example.com', password: 'x' }, '?next=%2F%2Fevil.com')
    );

    expect(locationOf(response)).toBe('/login?error=invalid');
  });
});

/**
 * 공격 #8 — 남의 사이트에 숨긴 `<form action="…/api/auth/login">`이 피해자의 브라우저로
 * 공격자 계정에 로그인시킨다(login CSRF). 그 뒤 피해자가 올리는 시트는 **공격자 계정에**
 * 쌓인다. 브라우저는 cross-site `POST`에 언제나 `Origin`을 붙이므로 그것으로 갈린다.
 */
describe('POST /api/auth/login — 출처 (T11 step 9)', () => {
  it('다른 출처의 폼은 자격증명에 닿기도 전에 `invalid`다', async () => {
    const response = await POST(
      withOrigin(formRequest({ email: 'a@example.com', password: 'pw' }), 'https://evil.example')
    );

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/login?error=invalid');
    // 세션이 만들어지지 않았다 — 쿠키도 Auth 호출도 없다
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(seenCredentials).toBeNull();
  });

  it('같은 출처의 폼은 통과한다', async () => {
    const response = await POST(
      withOrigin(formRequest({ email: 'a@example.com', password: 'pw' }), 'http://localhost:3000')
    );

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/');
  });

  it('`Origin`이 없는 요청(`curl`)은 통과한다 — T8의 검증 절차가 죽지 않는다', async () => {
    const response = await POST(formRequest({ email: 'a@example.com', password: 'pw' }));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/');
  });

  it('거절도 사유를 갈라 알리지 않는다 — 출처 불일치와 틀린 비밀번호가 같은 답이다', async () => {
    signInFails = true;
    const wrongPassword = await POST(formRequest({ email: 'a@example.com', password: 'pw' }));
    signInFails = false;
    const crossSite = await POST(
      withOrigin(formRequest({ email: 'a@example.com', password: 'pw' }), 'https://evil.example')
    );

    expect(locationOf(crossSite)).toBe(locationOf(wrongPassword));
  });
});
