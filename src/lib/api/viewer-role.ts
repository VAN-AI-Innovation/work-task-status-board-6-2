/**
 * `?as=`를 열람 역할로 해석한다 (`ADR-013`·`S4`).
 *
 * 인증은 T8이다. 그때까지 역할은 URL 쿼리로만 오고, 그것은 **URL만 치면 관리자가 되는 기능**
 * 이기도 하다. 그래서 두 가지를 이 파일에서 못박는다.
 *
 * 1. **기본값은 `member`** — 가장 좁은 권한이다. 인증이 없는 상태에서 기본값이 넓으면
 *    연락처가 아무에게나 기본 노출된다(`S6`). 넓히려면 `?as=admin`을 명시한다.
 *    T8에서 실제 인증이 붙을 때 바뀌는 것은 "누가 admin인가"뿐이고 화면 기본값은 그대로다.
 * 2. **프로덕션 + 실제 저장소에서는 무시** — `NODE_ENV === 'production' && mode !== 'demo'`.
 *    Supabase에 붙는 순간 이 데모 경로가 자동으로 죽는다. 남겨 두면 완전한 인증 우회다.
 *    `fallback`도 memory를 쓰지만 **의도가 아니라 사고**라서 데모로 취급하지 않는다.
 *
 * 환경변수를 직접 읽지 않고 `env`를 인자로 받는다 — 그러지 않으면 프로덕션 갈래를 테스트가
 * 재현할 수 없고, 위 2번은 **테스트로 지켜지지 않으면 지켜지지 않는다**.
 * (`store-factory.ts`가 같은 이유로 `env`를 인자로 받는다.)
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { StorageMode } from '@/lib/store/store-factory';

const KNOWN_ROLES: readonly ViewerRole[] = ['admin', 'lead', 'member'];

export function resolveViewerRole(
  /** `?as=`의 값. 없으면 null */
  asParam: string | null,
  env: { nodeEnv: string | undefined; mode: StorageMode }
): ViewerRole {
  if (env.nodeEnv === 'production' && env.mode !== 'demo') return 'member';

  const matched = KNOWN_ROLES.find((role) => role === asParam);
  return matched ?? 'member';
}
