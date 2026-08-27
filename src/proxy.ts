/**
 * 로그아웃 상태에서 보호된 라우트에 닿지 못하게 막는다 (T8 완료 기준 7).
 *
 * **Next 16에서 이 파일의 이름은 `proxy.ts`다.** 15까지의 `middleware.ts`는 폐기됐고,
 * 이름이 틀리면 프레임워크가 **아무 말 없이 집어 가지 않는다** — 테스트는 전부 통과하는데
 * 브라우저에서는 대시보드가 그냥 열린다. 실제로 그 상태를 확인하는 유일한 방법은 이름을
 * 바꿔 보고 미인증 요청이 200을 내는지 재는 것이다 (`node_modules/next/dist/docs/
 * 01-app/01-getting-started/16-proxy.md`).
 *
 * **하는 일은 둘뿐이다.**
 *
 * 1. **세션 갱신** — `auth.getUser()`가 리프레시 토큰 회전을 굴린다. access token은 1시간
 *    이면 만료되고, 그 갱신이 없으면 「한 시간 뒤에 조용히 로그아웃되는」 버그가 된다.
 * 2. **미인증 리다이렉트** — 사용자가 없으면 `/login?next=<원래 경로>`.
 *
 * **보호 목록이 없는 것이 의도다.** `route-guard.ts`는 **공개 목록**만 갖고 나머지를 전부
 * 보호한다. 그래서 화면이 새로 생기면 그 순간 이미 보호된다 — 주간 보고 전용 화면
 * (`/report`, T9)도 여기에 이름을 더할 것이 없다. 보호 목록 방식이었다면 새 화면을 만들 때마다
 * 한 줄을 더해야 하고, 그 한 줄을 잊은 화면이 로그인 없이 열린다. **잊어서 뚫리는 쪽이
 * 아니라 잊어서 막히는 쪽**을 고른 것이다 (`/report` 갈래는 `proxy.test.ts`가 잰다).
 *
 * **판정은 여기서 하지 않는다.** 어느 경로가 공개인가·데모인가는 `lib/auth/route-guard.ts`가
 * 순수 함수로 지고, 이 파일은 그것을 부르고 응답만 만든다. 테스트로 지켜지지 않는 규칙은
 * 지켜지지 않는데, proxy 파일 안에서는 규칙 한 줄을 재는 데 매번 가짜 요청을 지어야 한다.
 *
 * **DB를 조회하지 않는다.** `profiles`도 읽지 않는다 — Next 문서가 「Proxy는 느린 데이터
 * 조회용이 아니다」라고 못박고 있고, 역할 판정은 `resolveSession`이 자기 자리에서 이미 한다.
 * 여기서 아는 것은 「사용자가 있느냐」 하나다.
 *
 * `runtime`을 내보내지 않는다 — Proxy는 Node 런타임이 기본이고, 그 설정을 쓰면 Next가 던진다.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { errorResponse } from '@/lib/api/api-error';
import { classifyRequest } from '@/lib/auth/route-guard';

export async function proxy(request: NextRequest): Promise<Response> {
  const kind = classifyRequest(request.nextUrl.pathname, {
    storageDriver: process.env.STORAGE_DRIVER,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  // 데모 모드와 공개 경로는 Auth 서버에 왕복하지도 않는다
  if (kind === 'demo-open' || kind === 'public') return NextResponse.next({ request });

  /**
   * `@supabase/ssr`이 토큰을 갱신하면 새 쿠키를 여기로 준다. **요청과 응답 양쪽에** 실어야
   * 한다 — 요청 쪽은 이 요청을 이어받을 서버 컴포넌트가 읽고, 응답 쪽은 브라우저가 받는다.
   */
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    // 위 `classifyRequest`가 자격증명 없는 갈래를 이미 `demo-open`으로 걸러 냈다
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    }
  );

  // ⚠ **`createServerClient`와 `getUser()` 사이에 코드를 넣지 마라.** 사이에 무엇이 들어가면
  // 세션 갱신이 그 코드보다 늦어져, 드물지만 진단하기 어려운 로그아웃이 생긴다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return response;

  if (kind === 'api') {
    // 폼이 아니라 `fetch`가 부르는 자리다. 302를 주면 클라이언트가 따라가서 로그인 화면
    // HTML을 JSON으로 파싱하려 든다. 문구는 `api-error.ts`의 표에서 그대로 온다.
    return errorResponse('UNAUTHENTICATED');
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(loginUrl);
}

/**
 * matcher가 없으면 프록시가 **모든** 요청에 붙어 CSS·JS·이미지까지 가로챈다. 그러면
 * 로그인 화면 자체가 스타일 없이 뜬다.
 *
 * 값은 상수여야 한다 — 빌드 시각에 정적으로 읽히므로 변수를 쓰면 조용히 무시된다.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
