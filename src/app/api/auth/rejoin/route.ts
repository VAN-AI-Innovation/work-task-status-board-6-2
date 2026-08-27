/** 인증 라우트도 Node 런타임으로 통일한다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { teamIdSchema } from '@/lib/api/signup-schema';
import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

/**
 * 거절당한 사람이 **다른 팀으로 다시 요청한다** (T11).
 *
 * ## 왜 `/api/auth` 아래인가
 *
 * `pending-gate.ts`가 `/api/auth/**`를 `allow`로 두기 때문이다. 다른 자리에 두면 대기·거절
 * 사용자의 요청이 게이트에서 `PENDING_APPROVAL`로 막혀 **그 계정이 갇힌다** — 나갈 문
 * (로그아웃)과 다시 두드릴 문(재요청)은 둘 다 그 안에 있어야 한다.
 *
 * ## 사용자 JWT로 나간다. `service_role`이 아니다
 *
 * `request_join`은 **호출자 자신**(`auth.uid()`)의 행만 고치도록 지어져 있다 (`0005` 4-6절).
 * `service_role`로 부르면 `auth.uid()`가 없어 아무 행도 못 찾고, 그것을 고치려는 다음 사람은
 * 함수에 대상 사용자를 인자로 넣는다 — **그 순간 남의 상태를 바꾸는 문이 열린다.** 그래서
 * 이 라우트가 넘기는 인자는 `team` 하나뿐이고, 대상은 언제나 DB가 세션에서 읽는다
 * (`ADR-024`의 판별식 그대로: 올린 사람의 범위 밖 행을 쓰지 않으므로 사용자 JWT다).
 *
 * `profiles`를 앱에서 직접 `update`하지 않는 이유도 같다. `0005`가 `authenticated`에게
 * UPDATE GRANT를 주지 않았으므로 시도해도 실패하고, **실패하는 것이 정상이다** — 상태 전이
 * 규칙(거절된 사람만, `pending`으로만)은 함수 하나가 진다.
 *
 * ## 갈래는 둘뿐이다
 *
 * ```
 * 성공                                   → 303 /pending
 * 그 밖(출처 불일치·본문·자격증명·DB 거절) → 303 /pending?error=invalid
 * ```
 *
 * 사유를 갈라 알리지 않는다. 가입 라우트와 같은 판단이고 (`signup/route.ts`), 여기서는 더
 * 단순하다 — 실패했을 때 사용자가 할 일이 **팀을 다시 고르는 것 하나**라 사유를 나눠도
 * 행동이 갈리지 않는다.
 */

interface PendingCookie {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

function toPendingScreen(request: Request, failed: boolean): NextResponse {
  const destination = new URL('/pending', request.url);
  if (failed) destination.searchParams.set('error', 'invalid');

  return NextResponse.redirect(destination, 303);
}

export async function POST(request: Request): Promise<Response> {
  // 남의 페이지에 숨긴 폼 한 장이 로그인한 사람의 팀을 바꾸는 것을 막는다.
  // `Origin`이 없는 요청(`curl`)은 통과한다 — 근거는 `same-origin.ts` 머리말에 있다.
  if (!requestIsSameOrigin(request)) return toPendingScreen(request, true);

  let teamId: string;
  try {
    // 폼이 아닌 본문은 `formData()`가 던진다. 그것도 「잘못된 입력」이라 같은 갈래로 접는다
    const parsed = teamIdSchema.safeParse((await request.formData()).get('teamId'));
    if (!parsed.success) return toPendingScreen(request, true);
    teamId = parsed.data;
  } catch {
    return toPendingScreen(request, true);
  }

  /**
   * 세션 쿠키를 **버퍼에 모았다가** 응답에 싣는다 (`login/route.ts`와 같은 이유). 이 왕복에서
   * 토큰이 회전하면 갱신된 쿠키가 여기 담기고, 잃으면 사용자는 조용히 로그아웃된다.
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
  if (!client) return toPendingScreen(request, true);

  try {
    // 인자는 팀 하나다. 대상 사용자는 함수가 `auth.uid()`로 읽는다
    const { error } = await client.rpc('request_join', { team: teamId });
    if (error) return toPendingScreen(request, true);
  } catch {
    return toPendingScreen(request, true);
  }

  const response = toPendingScreen(request, false);
  for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);

  return response;
}
