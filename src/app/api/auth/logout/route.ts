/** 인증 라우트도 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

/**
 * 세션을 끊고 로그인 화면으로 보낸다.
 *
 * **`POST` 하나만 내보낸다.** 조회 메서드로도 열어 두면 링크 프리페치나 `<img src=…>` 태그
 * 하나로 남이 나를 로그아웃시킬 수 있다 — CSRF의 가장 값싼 형태다. 그래서 로그아웃 버튼은
 * 링크가 아니라 `<form method="post">`다 (`components/auth/login-form.tsx`).
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
