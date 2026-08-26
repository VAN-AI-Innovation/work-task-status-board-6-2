/**
 * 이 요청의 조회 문맥을 만든다. **Next의 `cookies()`를 만지는 유일한 자리다.**
 *
 * 아래 계층은 전부 인자를 받도록 지어져 있다 — `createSessionClient`는 쿠키 어댑터와 환경을,
 * `resolveSession`은 클라이언트를, `resolveViewerContext`는 저장소와 클라이언트를 받는다.
 * 그래야 각 갈래를 손으로 지은 가짜로 잴 수 있기 때문이고, 그 대가로 **어딘가 한 곳은
 * 진짜 환경을 만져야 한다.** 그 한 곳이 여기다 — `process.env`도 `cookies()`도 이 파일에서
 * 끝난다 (`getStorage()`가 같은 이유로 `process.env`를 혼자 읽는다).
 *
 * `src/proxy.ts`(step 10)는 이 함수를 쓰지 않는다. 요청 객체의 쿠키를 직접 다루고 응답에
 * 갱신된 쿠키를 실어야 해서 어댑터 모양이 다르다 — 하나로 묶으면 그 차이가 감춰진다.
 *
 * **던지지 않는다.** `cookies()`는 요청 스코프 밖에서 던지는데, 그것을 위로 올리면 화면이
 * 통째로 백지가 된다. 쿠키를 못 읽으면 세션이 없는 것이고, 세션이 없는 것은 사고가 아니다.
 */

import { cookies } from 'next/headers';

import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';
import { getStorage } from '@/lib/store/store-factory';
import { resolveViewerContext, type ViewerContext } from '@/lib/store/viewer-storage';

async function requestCookies(): Promise<CookieAdapter | null> {
  try {
    // Next 16에서 `cookies()`는 Promise다
    const store = await cookies();

    return {
      getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) store.set({ name, value, ...options });
      },
    };
  } catch {
    return null;
  }
}

export async function currentViewerContext(): Promise<ViewerContext> {
  const base = await getStorage();
  const adapter = await requestCookies();

  const client =
    adapter === null
      ? null
      : createSessionClient(adapter, {
          url: process.env.NEXT_PUBLIC_SUPABASE_URL,
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        });

  return resolveViewerContext(base, client);
}
