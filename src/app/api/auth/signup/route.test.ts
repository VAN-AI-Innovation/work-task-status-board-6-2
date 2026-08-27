/**
 * 이 라우트가 지는 것은 넷이다 — **`signUp`으로 만드는가(admin API가 아니라)** ·
 * **실패 사유를 흘리지 않는가** · **Auth에 나가는 metadata가 두 키뿐인가** ·
 * **이메일 확인 설정을 코드가 알지 않고도 두 갈래가 갈리는가.**
 *
 * `login/route.test.ts`와 같은 방법으로 돈다: 요청이 평범한 폼이라 가짜 `Request` 하나로
 * 전 갈래를 밟을 수 있고, 같은 방법으로 `curl`도 가입할 수 있다.
 *
 * **유출 검사는 mock한다.** 실제 네트워크를 타면 이 스위트가 외부 서비스에 묶인다
 * (대조 자체는 `lib/auth/pwned-password.test.ts`가 가짜 `fetch`로 잰다).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CookieAdapter } from '@/lib/auth/session-client';

let clientIsNull = false;
let signUpFails = false;
let signUpThrows = false;
/** Confirm email이 켜져 있으면 `signUp`이 세션을 돌려주지 않는다 */
let sessionReturned = true;
let breached = false;
let seenArgs: Record<string, unknown> | null = null;
let capturedAdapter: CookieAdapter | null = null;

const BAKED = [
  { name: 'sb-access-token', value: 'access', options: { path: '/', httpOnly: true } },
  { name: 'sb-refresh-token', value: 'refresh', options: { path: '/', httpOnly: true } },
];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'existing', value: '1' }],
  }),
}));

vi.mock('@/lib/auth/pwned-password', () => ({
  isPwnedPassword: async () => breached,
}));

vi.mock('@/lib/auth/session-client', () => ({
  createSessionClient: (adapter: CookieAdapter) => {
    capturedAdapter = adapter;
    if (clientIsNull) return null;

    return {
      auth: {
        signUp: async (args: Record<string, unknown>) => {
          seenArgs = args;
          if (signUpThrows) throw new Error('network');
          if (signUpFails) return { data: {}, error: { message: 'User already registered' } };
          if (!sessionReturned) return { data: { user: {}, session: null }, error: null };
          adapter.setAll(BAKED);
          return { data: { user: {}, session: {} }, error: null };
        },
      },
    };
  },
}));

const { POST } = await import('./route');

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const VALID = {
  displayName: '홍길동',
  email: 'a@example.com',
  password: 'ttoktokpassphrase',
  teamId: 'edit',
};

function formRequest(body: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

function locationOf(response: Response): string {
  const url = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
  return `${url.pathname}${url.search}`;
}

beforeEach(() => {
  clientIsNull = false;
  signUpFails = false;
  signUpThrows = false;
  sessionReturned = true;
  breached = false;
  seenArgs = null;
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

describe('POST /api/auth/signup — 성공', () => {
  it('세션이 오면 303으로 `/pending`에 보내고 쿠키를 싣는다', async () => {
    const response = await POST(formRequest(VALID));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/pending');

    const setCookie = response.headers.getSetCookie().join('\n');
    expect(setCookie).toContain('sb-access-token=access');
    expect(setCookie).toContain('sb-refresh-token=refresh');
  });

  /**
   * Confirm email이 켜져 있으면 세션이 없다. **그 설정을 코드가 알 필요가 없게**
   * 응답의 세션 유무로만 가른다.
   */
  it('세션이 없으면 `/signup?sent=1`이다 — 확인 메일 갈래', async () => {
    sessionReturned = false;
    const response = await POST(formRequest(VALID));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/signup?sent=1');
    expect(response.headers.getSetCookie().join('\n')).not.toContain('sb-access-token');
  });

  it('Auth에 나가는 metadata는 `display_name`·`team_id` 둘뿐이다', async () => {
    await POST(formRequest({ ...VALID, teamId: 'marketing', role: 'admin', status: 'active' }));

    const options = seenArgs?.options as { data: Record<string, unknown> };
    expect(options.data).toEqual({ display_name: '홍길동', team_id: 'marketing' });
    expect(seenArgs).not.toHaveProperty('role');
  });

  it('요청에 이미 있던 쿠키를 읽는다', async () => {
    await POST(formRequest(VALID));
    expect(capturedAdapter?.getAll()).toEqual([{ name: 'existing', value: '1' }]);
  });
});

describe('POST /api/auth/signup — 실패', () => {
  it('가입에 실패하면 `/signup?error=invalid`다', async () => {
    signUpFails = true;
    const response = await POST(formRequest(VALID));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/signup?error=invalid');
  });

  /**
   * **이 단언이 이 파일의 급소다.** 「이미 가입된 이메일」과 「그 밖의 실패」가 다른 답을
   * 주면 이 엔드포인트가 **계정 존재 확인 도구**가 된다.
   */
  it('이미 있는 계정과 그 밖의 실패가 같은 답을 받는다', async () => {
    signUpFails = true;
    const taken = await POST(formRequest(VALID));
    signUpThrows = true;
    const other = await POST(formRequest(VALID));

    expect(locationOf(taken)).toBe(locationOf(other));
  });

  it('예외가 나도 던지지 않고 `invalid`로 접는다', async () => {
    signUpThrows = true;
    await expect(POST(formRequest(VALID))).resolves.toHaveProperty('status', 303);
  });

  it.each([
    ['이메일 형식이 아니면', { email: 'not-an-email' }],
    ['비밀번호가 짧으면', { password: 'short' }],
    ['모르는 팀이면', { teamId: 'sales' }],
    ['이름이 비면', { displayName: '  ' }],
  ])('%s Auth에 닿기 전에 `invalid`다', async (_label, patch) => {
    const response = await POST(formRequest({ ...VALID, ...patch }));

    expect(locationOf(response)).toBe('/signup?error=invalid');
    expect(seenArgs).toBeNull();
  });

  it('폼이 아닌 본문도 400 JSON이 아니라 `invalid` 리다이렉트다 — 사용자는 브라우저다', async () => {
    const response = await POST(
      new Request('http://localhost:3000/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"email":"a@example.com"}',
      })
    );

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/signup?error=invalid');
  });

  it('자격증명이 없으면 `unavailable`이다 — `invalid`와 구분한다', async () => {
    clientIsNull = true;
    const response = await POST(formRequest(VALID));

    expect(locationOf(response)).toBe('/signup?error=unavailable');
  });
});

/**
 * `weak`만은 `invalid`와 구분한다. 계정의 존재를 알려주는 정보가 아니라 **입력한 비밀번호
 * 자체의 성질**이고, 사용자가 고칠 수 있는 일이다.
 */
describe('POST /api/auth/signup — 유출된 비밀번호', () => {
  it('유출 목록에 있으면 `/signup?error=weak`이고 계정을 만들지 않는다', async () => {
    breached = true;
    const response = await POST(formRequest(VALID));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/signup?error=weak');
    expect(seenArgs).toBeNull();
  });

  it('유출 검사가 통과하면 계정이 만들어진다', async () => {
    breached = false;
    await POST(formRequest(VALID));

    expect(seenArgs).not.toBeNull();
  });
});

/**
 * 공격 #8 — 남의 사이트가 피해자의 브라우저로 **계정을 양산**한다. 가입은 인증이 필요 없는
 * 자리라 「세션을 훔친다」가 아니라 **쓰레기를 밀어 넣는** 공격이고, 그 계정 하나하나가
 * 리더의 승인 목록에 쌓여 사람의 손을 요구한다.
 */
describe('POST /api/auth/signup — 출처 (T11 step 9)', () => {
  function withOrigin(request: Request, origin: string): Request {
    const headers = new Headers(request.headers);
    headers.set('origin', origin);
    headers.set('host', 'localhost:3000');

    return new Request(request, { headers });
  }

  it('다른 출처의 폼은 본문에 닿기도 전에 `invalid`이고 계정을 만들지 않는다', async () => {
    const response = await POST(withOrigin(formRequest(VALID), 'https://evil.example'));

    expect(response.status).toBe(303);
    expect(locationOf(response)).toBe('/signup?error=invalid');
    // 급소 — Auth로 아무것도 나가지 않았고 세션 쿠키도 실리지 않았다
    expect(seenArgs).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('같은 출처의 폼은 통과한다', async () => {
    const response = await POST(withOrigin(formRequest(VALID), 'http://localhost:3000'));

    expect(locationOf(response)).toBe('/pending');
    expect(seenArgs).not.toBeNull();
  });

  it('`Origin`이 없는 요청(`curl`)은 통과한다 — T8의 검증 절차가 죽지 않는다', async () => {
    const response = await POST(formRequest(VALID));

    expect(locationOf(response)).toBe('/pending');
  });

  it('거절도 사유를 갈라 알리지 않는다 — 출처 불일치와 가입 실패가 같은 답이다', async () => {
    signUpFails = true;
    const failed = await POST(formRequest(VALID));
    signUpFails = false;
    const crossSite = await POST(withOrigin(formRequest(VALID), 'https://evil.example'));

    expect(locationOf(crossSite)).toBe(locationOf(failed));
  });
});
