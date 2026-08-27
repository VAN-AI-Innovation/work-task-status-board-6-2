/**
 * **조회 전용** 요청 스코프 저장소 핸들 (`ADR-024`, `PLAN.md`「T8 착수 시 확정」 결정 B).
 *
 * `TICKETS.md` T8 완료 기준 5는 「조회가 사용자 JWT로 나가 RLS가 실제로 걸린다」인데,
 * 지금 조회는 전부 `getStorage()`를 지나고 그것은 **`service_role`을 담은 프로세스 전역
 * 싱글턴**이다. `service_role`은 RLS를 통째로 우회하므로 `0003_auth_rls.sql`의 정책이
 * 조회에 대해서는 한 줄도 걸리지 않는다.
 *
 * **싱글턴에 사용자 토큰을 넣을 수는 없다.** 토큰은 요청마다 다르고, 넣는 순간 한 사용자의
 * 토큰이 다음 요청의 다른 사용자에게 샌다. 그 캐시가 번들마다 갈라져 있던 결함을 T6 감사에서
 * 이미 한 번 고쳤고(`store-factory.ts`의 전역 심볼), 같은 자리에 요청 상태를 얹으면 그 수정이
 * 그대로 사고가 된다. 그래서 이 파일은 **캐시하지 않는다** — 요청당 하나다.
 *
 * **`base`가 함께 실려 다닌다.** 업로드 확정·시드·업로드 이력은 여전히 `service_role`로
 * 나가야 한다 — 확정은 시트 전체를 쓰고 거기에는 올린 사람의 범위 밖 행이 반드시 섞인다
 * (팀장이 전사 시트를 올린다). 조회용 핸들이 그것을 삼키면 호출부가 `getStorage()`를 다시
 * 부르게 되고, 그때 「어느 쪽인가」를 매번 새로 판단해야 한다.
 *
 * **라이브인데 로그인하지 않았어도 JWT 저장소를 쓴다.** 그러면 RLS가 0행을 돌려주고 그것이
 * 정직한 결과다. 여기서 `base.repo`로 되돌리면 「로그인 안 했는데 전부 보인다」가 된다.
 * 반대로 `demo`·`fallback`에서는 세션을 보지 않는다 — 메모리 저장소에는 그 사용자의 행이
 * 없어서 JWT를 실어 봐야 잴 것이 없고, `demo`는 `?as=`가 역할을 정하는 자리다(결정 E).
 *
 * **권한을 판정하지 않는다.** 범위는 `viewer-scope.ts`(앱)와 RLS(DB)가 진다. 세 번째 자리를
 * 만들면 셋이 어긋났을 때 어느 것이 진짜인지 알 수 없다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveSession, type SessionOutcome } from '@/lib/auth/viewer-session';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createSupabaseTaskStore } from '@/lib/store/supabase-task-store';
import type { TaskRepository } from '@/lib/store/task-repository';

export interface ViewerContext {
  /** **조회 전용.** 라이브+세션이면 사용자 JWT를 실은 저장소, 아니면 `base.repo` */
  repo: TaskRepository;
  session: SessionOutcome;
  /** 업로드 확정·시드·업로드 이력이 쓰는 `service_role` 핸들. 그대로 통과시킨다 */
  base: StorageHandle;
}

export async function resolveViewerContext(
  base: StorageHandle,
  client: SupabaseClient | null,
): Promise<ViewerContext> {
  if (base.mode !== 'live' || !client) {
    return { repo: base.repo, session: { status: 'anonymous' }, base };
  }

  return {
    repo: createSupabaseTaskStore(client),
    session: await resolveSession(client),
    base,
  };
}
