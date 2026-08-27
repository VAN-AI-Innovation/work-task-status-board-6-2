/** 인증 라우트도 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { readCredentials } from '@/lib/api/credentials-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

/**
 * 사람이 처음으로 로그인하는 자리. **서버 액션이 아니라 라우트 핸들러다.**
 *
 * 서버 액션으로 만들면 요청 본문이 Next 내부 포맷이라 `curl`로 로그인할 수 없고, 그러면
 * T8 완료 기준 2(「`member`가 타인의 태스크에 `PATCH`를 보내면 서버가 거부한다」)를
 * **티켓이 정한 방법으로** 증명할 수 없다 — 세션 쿠키를 만들 길이 없기 때문이다.
 * 덤으로 JS 없이도 로그인이 된다: 로그인 화면은 평범한 `<form method="post">`다.
 *
 * **응답은 항상 `303 See Other`다.** 폼 제출의 결과를 `POST`로 남겨 두면 뒤로 가기가
 * 재제출을 부른다.
 *
 * **실패 사유를 구분해 알리지 않는다.** 「없는 계정」과 「비밀번호 틀림」이 다른 답을 주면
 * 이 엔드포인트가 계정 존재 확인 도구가 된다. 그래서 둘 다 `?error=invalid`이고, 다른
 * 사유는 **자격증명이 아예 없어 붙을 곳이 없는 경우**(`unavailable`) 하나뿐이다 —
 * 그것은 사용자가 고칠 수 있는 일이 아니라 운영 상태라 문구가 달라야 한다.
 *
 * **남의 페이지에서 밀어 넣은 폼은 받지 않는다** (T11 step 9). 로그인은 「상태를 바꾸는
 * `POST`」다 — 공격자가 자기 계정으로 피해자를 **로그인시켜** 그 뒤의 활동을 자기 계정에
 * 쌓게 만드는 것이 login CSRF이고, 이 앱에서는 그 계정으로 올린 시트가 남는다. 판정은
 * `same-origin.ts` 하나가 지고 **`Origin`이 없으면 통과한다** — 그 근거(`curl` 검증 절차)는
 * 그 파일 머리말에 있다.
 *
 * **아무것도 로그에 남기지 않는다** (`S6`). 검증과 본문 읽기가 `lib/api/credentials-schema.ts`에
 * 있어서 이 파일에는 자격증명 필드 이름조차 나오지 않는다 — 규칙이 grep으로 확인된다.
 */

/** `/login`이 문구로 바꿔 보여 주는 두 값. 그 밖의 값은 화면이 무시한다 */
type LoginFailure = 'invalid' | 'unavailable';

interface PendingCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

/**
 * 실패는 전부 이리로 온다. **400 JSON을 내지 않는다** — 이 엔드포인트를 부르는 것은
 * `fetch`가 아니라 브라우저 폼이고, JSON을 주면 사람이 원문 텍스트를 보게 된다.
 *
 * 안전한 `next`는 되싣는다: 다시 로그인했을 때 원래 가려던 곳으로 가야 한다. 위험한 값은
 * 이미 `safeRedirectPath`가 `/`로 접었고, `/`는 기본값이라 굳이 붙이지 않는다.
 */
function toLoginScreen(request: Request, reason: LoginFailure, next: string): NextResponse {
  const destination = new URL('/login', request.url);
  destination.searchParams.set('error', reason);
  if (next !== '/') destination.searchParams.set('next', next);

  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request): Promise<Response> {
  const next = safeRedirectPath(new URL(request.url).searchParams.get('next'));

  // 출처가 다르면 **자격증명을 읽기도 전에** 접는다. 사유는 갈라 알리지 않는다 — 다른 실패와
  // 같은 `invalid`다 (사유가 갈리면 그 차이가 곧 정보다)
  if (!requestIsSameOrigin(request)) return toLoginScreen(request, 'invalid', next);

  const credentials = await readCredentials(request);
  if (credentials === null) return toLoginScreen(request, 'invalid', next);

  /**
   * 세션 쿠키를 **버퍼에 모았다가** 응답에 싣는다. `cookies()`로 직접 쓰면 리다이렉트
   * 응답에 실리는지가 Next의 내부 동작에 달리는데, 그 동작이 바뀌면 「로그인은 성공했는데
   * 로그인되지 않은」 상태가 조용히 생긴다. 여기서 명시적으로 옮기면 그 자리가 보인다.
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
  if (!client) return toLoginScreen(request, 'unavailable', next);

  try {
    const { error } = await client.auth.signInWithPassword(credentials);
    if (error) return toLoginScreen(request, 'invalid', next);
  } catch {
    // 네트워크가 끊겼든 자격증명이 틀렸든 **같은 답을 준다.** 사유가 갈리면 그 차이로
    // 계정의 존재를 셀 수 있다.
    return toLoginScreen(request, 'invalid', next);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
