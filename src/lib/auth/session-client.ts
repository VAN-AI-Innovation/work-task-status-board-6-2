/**
 * anon 키 + 쿠키 세션 클라이언트 (`PLAN.md`「T8 착수 시 확정」 결정 A·B).
 *
 * **`service_role`을 쓰지 않는다.** 이 클라이언트로 나가는 조회에 RLS가 실제로 걸리는 것이
 * `TICKETS.md` T8 완료 기준 5다 — 전부 `service_role`로 처리하면 정책을 만들어도 의미가 없다.
 * `service_role` 경로(업로드 확정·시드)는 `store-factory.ts`가 따로 들고 있다.
 *
 * 쿠키를 직접 굽지 않고 `@supabase/ssr`을 쓰는 이유는 **리프레시 토큰 회전** 하나다.
 * access token은 1시간이면 만료되고, 갱신을 우리가 짜면 「조용히 로그아웃되는 버그」가
 * 이 프로젝트에서 가장 재현하기 어려운 종류가 된다 (결정 A).
 *
 * 환경을 인자로 받는 것은 `store-factory.ts`의 `createClientFrom(env)`과 같은 규율이다 —
 * 환경 전역을 함수 안에서 읽으면 테스트가 자격증명 없는 갈래를 재현할 수 없다.
 * (`src/lib/auth/` 아래에 환경 전역을 읽는 줄이 하나도 없다는 것은 grep이 지킨다.)
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** `@supabase/ssr`의 쿠키 어댑터. Next의 `cookies()` 모양을 그대로 받는다 */
export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
}

/**
 * 자격증명이 없으면 **`null`**이다. 던지지 않는 이유는 그 상태가 사고가 아니라 **데모 모드**
 * 이기 때문이다 — `.env` 없이 클론해 바로 도는 경로가 죽으면 심사자가 아무것도 못 본다
 * (`PRD.md` 성공 기준 1번, 결정 E).
 */
export function createSessionClient(
  cookies: CookieAdapter,
  env: { url?: string; anonKey?: string }
): SupabaseClient | null {
  const { url, anonKey } = env;
  if (!url || !anonKey) return null;

  try {
    return createServerClient(url, anonKey, {
      cookies: {
        getAll: () => cookies.getAll(),
        setAll: (toSet) => {
          try {
            cookies.setAll(toSet);
          } catch {
            // **서버 컴포넌트에서는 쿠키를 쓸 수 없다** — Next가 던진다. 삼켜도 되는 이유는
            // 세션 갱신을 `src/proxy.ts`가 하기 때문이다 (결정 A, step 10). 여기서 던지면
            // 토큰이 갱신될 때마다 화면이 통째로 죽는다.
          }
        },
      },
    });
  } catch {
    // 형식이 깨진 URL은 `createServerClient`가 던진다. 폴백 사유일 뿐 앱을 죽일 이유는 아니다
    // (`store-factory.ts`의 `createClientFrom`과 같은 결).
    return null;
  }
}
