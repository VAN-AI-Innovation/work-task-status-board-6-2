/** 인증 라우트도 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isBreachedSignup, readSignup, toSignUpCredentials } from '@/lib/api/signup-schema';
import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

/**
 * 사람이 계정을 만드는 자리 (T11). **`login/route.ts`를 그대로 본뜬다** — 서버 액션이
 * 아니라 라우트 핸들러이고, 응답은 항상 `303 See Other`이며, 세션 쿠키는 버퍼에 모았다가
 * 응답에 싣는다. 근거는 그 파일 머리말에 있고 여기서 되풀이하지 않는다 (`ADR-027`).
 *
 * ## 만드는 것은 계정 하나뿐이다
 *
 * `profiles` 행은 **앱이 만들지 않는다.** `auth.users`에 행이 생기면 트리거
 * (`handle_new_user`)가 `role='member'` · `status='pending'`으로 만든다 (`0005` 3절).
 * 앱이 같이 쓰기 시작하면 그 두 값을 앱이 정하게 되고, 그 자리가 곧 권한 상승 경로다.
 *
 * ## `signUp()`이지 관리자 API가 아니다
 *
 * 관리자 쪽(`createUser`)을 쓰려면 `service_role`이 이 경로에 닿아야 하는데, 가입은 **익명 사용자가
 * 부르는 자리**다. 게다가 admin API는 이메일 확인을 건너뛰어 **누구나 남의 이메일로 계정을
 * 선점**할 수 있고 Supabase 내장 rate limit도 우회한다. `signUp`은 둘 다 준다.
 *
 * ## 갈래 다섯
 *
 * ```
 * 본문이 가입 요청이 아님          → /signup?error=invalid
 * 자격증명이 없음(데모·미설정)      → /signup?error=unavailable
 * 유출 목록에 있는 비밀번호        → /signup?error=weak      ★ 계정을 만들지 않는다
 * 가입 실패(사유 불문)             → /signup?error=invalid
 * 가입 성공 + 세션 있음            → /pending  (+ 세션 쿠키)
 * 가입 성공 + 세션 없음            → /signup?sent=1
 * ```
 *
 * **실패 사유를 구분해 알리지 않는다.** 「이미 가입된 이메일」이 다른 답을 주면 이
 * 엔드포인트가 **계정 존재 확인 도구**가 된다. 그래서 가입 실패는 사유 불문 `invalid`
 * 하나로 접는다. 갈라 둔 둘은 계정에 관한 사실이 아니다 — `unavailable`은 운영 상태이고,
 * `weak`는 **입력한 값 자체의 성질**이라 사용자가 고칠 수 있다.
 *
 * `?sent=1`이 있는 이유: Confirm email 설정이 켜져 있으면 `signUp`이 세션을 돌려주지
 * 않는다. **그 설정을 코드가 알 필요가 없게** 응답의 세션 유무로만 가른다.
 *
 * **아무것도 로그에 남기지 않는다** (`S6`). 본문 읽기·유출 대조·payload 만들기가 전부
 * `lib/api/signup-schema.ts`에 있어서 이 파일에는 자격증명 필드 이름조차 나오지 않는다 —
 * 규칙이 grep으로 확인된다.
 */

/** `/signup`이 문구로 바꿔 보여 주는 셋. 그 밖의 값은 화면이 무시한다 */
type SignupFailure = 'invalid' | 'unavailable' | 'weak';

interface PendingCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

/**
 * 실패는 전부 이리로 온다. **400 JSON을 내지 않는다** — 이 엔드포인트를 부르는 것은
 * `fetch`가 아니라 브라우저 폼이고, JSON을 주면 사람이 원문 텍스트를 보게 된다.
 *
 * `?next=`를 다루지 않는 것은 이 라우트에 그것이 없기 때문이다: 가입의 목적지는 언제나
 * `/pending` 하나다 (승인 전에는 갈 수 있는 곳이 거기뿐이다 · `pending-gate.ts`).
 */
function toSignupScreen(request: Request, reason: SignupFailure): NextResponse {
  const destination = new URL('/signup', request.url);
  destination.searchParams.set('error', reason);

  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request): Promise<Response> {
  const signup = await readSignup(request);
  if (signup === null) return toSignupScreen(request, 'invalid');

  /**
   * 세션 쿠키를 **버퍼에 모았다가** 응답에 싣는다. `cookies()`로 직접 쓰면 리다이렉트
   * 응답에 실리는지가 Next의 내부 동작에 달린다 (`login/route.ts`와 같은 이유).
   */
  const pending: PendingCookie[] = [];
  const store = await cookies();
  const adapter: CookieAdapter = {
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (toSet) => {
      pending.push(...toSet);
    },
  };

  const client = createSessionClient(adapter, {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!client) return toSignupScreen(request, 'unavailable');

  // 검증을 통과한 뒤, 계정을 만들기 **전**이다. 뒤에 두면 이미 만들어진 계정을 되돌려야 한다.
  // 붙을 Auth 서버가 없는 환경에서는 여기까지 오지 않는다 — 바깥 호출을 한 번 아낀다.
  if (await isBreachedSignup(signup, { fetch: globalThis.fetch })) {
    return toSignupScreen(request, 'weak');
  }

  let hasSession = false;
  try {
    const { data, error } = await client.auth.signUp(toSignUpCredentials(signup));
    // 사유를 갈라 보지 않는다 — 가르는 순간 계정 존재 확인 도구가 된다
    if (error) return toSignupScreen(request, 'invalid');
    hasSession = data.session !== null && data.session !== undefined;
  } catch {
    return toSignupScreen(request, 'invalid');
  }

  // 확인 메일 갈래. 계정은 만들어졌고 세션만 없다 — 사용자가 할 일은 메일함을 여는 것이다
  if (!hasSession) {
    const sent = new URL('/signup', request.url);
    sent.searchParams.set('sent', '1');
    return NextResponse.redirect(sent, 303);
  }

  const response = NextResponse.redirect(new URL('/pending', request.url), 303);
  for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
