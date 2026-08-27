/**
 * 「승인을 기다리는 계정이 이 요청을 지나갈 수 있는가」를 정한다 (T11).
 *
 * **`route-guard.ts`와 축이 다르다.** 그쪽이 묻는 것은 「로그인 없이 열려 있는가」이고
 * 여기가 묻는 것은 「로그인은 했는데 아직 범위가 없는 사람이 지나갈 수 있는가」다. 둘을
 * 한 함수에 합치지 않는 이유는 **아는 것이 다르기** 때문이다 — `route-guard`는 `proxy`가
 * 부르고 `proxy`는 **DB를 조회하지 않는다**(`ARCHITECTURE.md`「권한」·Next 문서의
 * 「Proxy는 느린 데이터 조회용이 아니다」). 대기 여부는 `profiles` 행을 읽어야 알고, 그
 * 조회는 `resolveSession`이 자기 자리에서 이미 한다.
 *
 * 그래서 이 파일은 **판정만** 진다. `redirect()`도 `Response`도 만들지 않는다 —
 * 호출부(`request-viewer.ts`)가 화면이면 리다이렉트로, API면 403으로 번역한다.
 *
 * ```
 * ok · anonymous                → allow    앞단(proxy·resolveSession)이 이미 처리한 상태다
 * /pending 또는 그 아래           → allow    ★ 자기 자신을 막으면 리다이렉트 고리가 된다
 * /api/auth/** (로그아웃·재요청)  → allow    나갈 문을 막으면 그 계정이 갇힌다
 * pending·rejected·no_profile + /api/**  → deny
 * pending·rejected·no_profile + 그 밖     → redirect '/pending'
 * ```
 *
 * **`no_profile`을 같이 태우는 것이 의도다.** 트리거(`handle_new_user`)가 어떤 이유로 실패해
 * `profiles` 행이 없는 계정은 지금까지 「부원인데 아무것도 없는」 화면에 갇혀 있었다.
 * `/pending`이 그 계정에도 할 말을 갖는다.
 *
 * **`deny`가 401이 아니라 403으로 번역되는 이유**: 401은 「로그인하라」는 뜻인데 이 사람은
 * 이미 로그인했다. 401을 주면 화면이 로그인 폼을 다시 띄우고, 사용자는 같은 계정으로
 * 다시 들어와 같은 화면을 본다.
 */

import type { SessionOutcome } from '@/lib/auth/viewer-session';

export type GateDecision =
  | { kind: 'allow' }
  /** 화면. `to`로 보낸다 */
  | { kind: 'redirect'; to: string }
  /** API. 403 `PENDING_APPROVAL` */
  | { kind: 'deny' };

export const PENDING_PATH = '/pending';

/**
 * 대기 중에도 지나갈 수 있는 자리. **정확히 이 경로이거나 그 아래**여야 한다 —
 * 단순 `startsWith`로 두면 `/pendings`와 `/api/authorize`가 함께 뚫린다
 * (`route-guard.ts`의 `isPublic`과 같은 규칙이다).
 */
const ESCAPE_PREFIXES = [PENDING_PATH, '/api/auth'] as const;

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function gateForSession(outcome: SessionOutcome, pathname: string): GateDecision {
  if (outcome.status === 'ok' || outcome.status === 'anonymous') return { kind: 'allow' };
  if (ESCAPE_PREFIXES.some((prefix) => isUnder(pathname, prefix))) return { kind: 'allow' };
  if (isUnder(pathname, '/api')) return { kind: 'deny' };

  return { kind: 'redirect', to: PENDING_PATH };
}
