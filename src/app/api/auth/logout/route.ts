/** 인증 라우트도 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { errorResponse } from '@/lib/api/api-error';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

/**
 * 세션을 끊고 로그인 화면으로 보낸다.
 *
 * **`POST` 하나만 내보낸다.** 조회 메서드로도 열어 두면 링크 프리페치나 `<img src=…>` 태그
 * 하나로 남이 나를 로그아웃시킬 수 있다 — CSRF의 가장 값싼 형태다. 그래서 로그아웃 버튼은
 * 링크가 아니라 `<form method="post">`다 (`components/auth/login-form.tsx`).
 *
 * **그래도 `POST` 하나만으로는 부족하다** (T11 step 9). 폼 전송은 남의 페이지에서도 보낼
 * 수 있으므로 출처를 함께 본다 — `same-origin.ts` 하나가 판정을 지고 **`Origin`이 없으면
 * 통과한다**(근거는 그 파일 머리말).
 *
 * ⚠ **출처가 다르면 리다이렉트가 아니라 `403`이다.** 이 라우트만 다른 이유는 실패했을 때
 * 사용자를 보낼 「원래 자리」가 없기 때문이다 — 로그인 화면으로 보내면 세션은 살아 있는데
 * 로그아웃된 것처럼 보이고, **그 착시가 정확히 공격자가 노린 결과다.** 거절은 거절로
 * 보여야 한다.
 *
 * **던지지 않는다.** 여기서 예외가 위로 올라가면 `no_profile` 계정이 로그아웃도 못 하고
 * 리다이렉트 고리에 갇힌다 — 그 갈래를 위해 이 버튼이 있는 것이다.
 *
 * 쿠키를 버퍼에 모았다가 응답에 싣는 방식은 로그인 쪽과 같다. 여기서는 `@supabase/ssr`이
 * 빈 값·`maxAge: 0`으로 덮어써 만료시키므로, 그 값이 응답에 실리지 않으면 **세션이 그대로
 * 남는다.**
 */

interface PendingCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  // 세션에 손대기 전에 본다. 여기서 통과시키면 남의 페이지가 사용자를 로그아웃시킨다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

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

  if (client) {
    try {
      await client.auth.signOut();
    } catch {
      // 붙지 않아도 화면은 로그인으로 보낸다. 쿠키가 남아 있으면 다음 요청에서 만료된
      // 토큰으로 취급되고, 그 갈래는 `viewer-session.ts`가 `anonymous`로 접는다.
    }
  }

  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
