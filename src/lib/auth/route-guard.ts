/**
 * 「이 요청은 로그인 없이 지나갈 수 있는가」를 정한다. `src/proxy.ts`가 이것을 부르고
 * **응답만** 만든다 (T8 완료 기준 7).
 *
 * 판정을 `proxy.ts`에 직접 쓰지 않는 이유는 하나다 — **거기서는 잴 수 없다.** proxy 파일은
 * 요청·응답 객체를 만들어야 돌아가고, 그러면 「`/api/health`가 공개인가」 같은 한 줄짜리
 * 사실을 확인하는 데 매번 가짜 요청을 지어야 한다. 그 비용이 붙는 순간 규칙은 검사 없이
 * 늘어나고, 어느 날 조용히 대시보드가 열린다.
 *
 * 갈래는 넷이고 위에서부터 먼저 걸리는 것이 이긴다.
 *
 * ```
 * demo-open  데모 모드다. 아무 일도 하지 않는다 (결정 E)
 * public     로그인 없이 열려 있다 — 로그인 화면·인증 라우트·헬스체크·정적 자산
 * api        보호 대상이되 **리다이렉트하지 않는다.** 401 JSON을 준다
 * page       보호 대상. 미인증이면 `/login?next=…`
 * ```
 *
 * **`demo-open`이 맨 위인 것이 요점이다.** `.env` 없이 클론한 심사자에게는 로그인할 계정
 * 자체가 없다 (`PRD.md` 성공 기준 1번 · `PLAN.md`「T8 착수 시 확정」 결정 E). 여기서
 * 리다이렉트하면 그 사람은 빈 로그인 화면 하나만 보고 평가를 끝낸다.
 *
 * **`api`와 `page`를 가르는 이유**: API를 부르는 것은 폼이 아니라 `fetch`다. 302를 주면
 * 클라이언트가 따라가서 **로그인 화면 HTML을 JSON으로 파싱하려 든다** — 그러면 화면에
 * 뜨는 것은 「로그인이 필요합니다」가 아니라 파싱 오류다.
 *
 * 환경을 인자로 받는 것은 `viewer-role.ts`·`store-factory.ts`와 같은 규율이다. 함수 안에서
 * 전역을 읽으면 데모 갈래를 테스트가 재현할 수 없다.
 */

export type RequestClass = 'public' | 'demo-open' | 'page' | 'api';

export interface GuardEnv {
  /** `STORAGE_DRIVER`. `memory`면 의도된 데모다 */
  storageDriver: string | undefined;
  supabaseUrl: string | undefined;
  supabaseAnonKey: string | undefined;
}

/**
 * 정확히 이 경로이거나 그 **아래**여야 공개다. 접두사만 보면 `/api/authorize`가
 * `/api/auth`에 걸려 뚫리고, `/logins`가 `/login`에 걸린다.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth',
  // 인증을 요구하면 감시 도구가 죽는다. 이 라우트는 모드만 답하고 키를 싣지 않는다
  '/api/health',
  '/_next/static',
  '/_next/image',
] as const;

/** `config.matcher`가 이미 뺀 것들이지만 여기서도 공개로 둔다 — 규칙이 한 곳에서 읽혀야 한다 */
const PUBLIC_EXACT = ['/favicon.ico'] as const;

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.some((path) => path === pathname)) return true;

  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * **`store-factory.ts`가 `demo`를 고르는 환경은 여기서도 반드시 `demo-open`이어야 한다.**
 * 어긋나면 저장소는 열려 있는데 proxy가 로그인을 요구하고, 계정이 없는 심사자는 빈 로그인
 * 화면에 갇힌다 (`store-factory.test.ts`가 이 한 방향을 잰다).
 *
 * **반대 방향은 일부러 넓다.** 여기서는 자격증명이 없으면 `STORAGE_DRIVER`와 무관하게 문을
 * 여는데, 그쪽은 `STORAGE_DRIVER=supabase`라고 적힌 경우를 `fallback`(읽기 전용)으로 남긴다
 * (`ADR-029`). 붙을 Auth 서버가 없는데 로그인을 요구하면 아무도 들어올 수 없으므로 문은
 * 열되, 쓰기는 저장소 쪽이 막는다 — `ADR-005` 그대로다.
 */
function isDemo(env: GuardEnv): boolean {
  return env.storageDriver === 'memory' || !env.supabaseUrl || !env.supabaseAnonKey;
}

export function classifyRequest(pathname: string, env: GuardEnv): RequestClass {
  if (isDemo(env)) return 'demo-open';
  if (isPublic(pathname)) return 'public';
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'api';

  return 'page';
}
