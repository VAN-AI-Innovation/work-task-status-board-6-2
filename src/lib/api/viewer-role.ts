/**
 * 이 요청의 열람 역할을 정한다 — **세션이 먼저이고 `?as=`는 그다음이다**
 * (`ADR-013`·`ADR-026`·`S4`, `PLAN.md`「T8 착수 시 확정」 결정 E).
 *
 * 판정 순서는 셋이고 위에서부터 먼저 걸리는 것이 이긴다.
 *
 * ```
 * 세션이 있으면              → 세션의 role이 이긴다. ?as=는 무시된다 (개발 환경에서도)
 * 세션이 없고 프로덕션+실저장소 → member        (S4)
 * 세션이 없고 데모·폴백        → ?as= 해석      (ADR-013)
 * ```
 *
 * 1. **세션이 이긴다.** 로그인한 사람의 역할은 `profiles`에서 오고(`viewer-session.ts`), 그
 *    표는 RLS의 `my_role()`이 보는 것과 같다. 「프로덕션에서만 `?as=`를 무시」로 두면 개발
 *    서버에서 로그인한 `member`가 `?as=admin`으로 남의 팀을 읽는다. **세션이 있는데 URL이
 *    이기는 경우는 없다.** `no_profile`은 세션으로 치지 않는다 — 역할을 모르는 상태라
 *    아래 규칙으로 내려간다(그래서 프로덕션+실저장소에서는 `member`다).
 * 2. **프로덕션 + 실제 저장소에서는 `?as=`를 무시** — `NODE_ENV === 'production' && mode !== 'demo'`.
 *    Supabase에 붙는 순간 이 데모 경로가 자동으로 죽는다. 남겨 두면 완전한 인증 우회다.
 *    `fallback`도 memory를 쓰지만 **의도가 아니라 사고**라서 데모로 취급하지 않는다.
 * 3. **기본값은 `member`** — 가장 좁은 권한이다. 기본값이 넓으면 연락처가 아무에게나 기본
 *    노출된다(`S6`). 넓히려면 `?as=admin`을 명시한다.
 *
 * **데모 모드에서 `?as=`가 바꾸는 것은 범위가 아니다.** 메모리 저장소에는 붙일 팀도 구성원도
 * 없어서 `?as=lead`에 줄 「우리 팀」이 없다 — 바뀌는 것은 섹션 배치와 민감 `extras` 마스킹
 * 뿐이고, **범위 구분은 로그인했을 때만 일어난다**(`viewer-scope.ts`와 RLS). 흉내에 범위를
 * 주면 「권한이 있는 척」이 된다.
 *
 * 환경변수를 직접 읽지 않고 `env`를 인자로 받는다 — 그러지 않으면 프로덕션 갈래를 테스트가
 * 재현할 수 없고, 위 2번은 **테스트로 지켜지지 않으면 지켜지지 않는다**.
 * (`store-factory.ts`가 같은 이유로 `env`를 인자로 받는다.) 세션도 같은 이유로 인자다.
 */

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { StorageMode } from '@/lib/store/store-factory';

const KNOWN_ROLES: readonly ViewerRole[] = ['admin', 'lead', 'member'];

export function resolveViewerRole(
  /** `?as=`의 값. 없으면 null */
  asParam: string | null,
  env: { nodeEnv: string | undefined; mode: StorageMode },
  /** 이 요청의 세션. `ok`이면 그 역할이 무조건 이긴다 */
  session: SessionOutcome
): ViewerRole {
  if (session.status === 'ok') return session.viewer.role;

  if (env.nodeEnv === 'production' && env.mode !== 'demo') return 'member';

  const matched = KNOWN_ROLES.find((role) => role === asParam);
  return matched ?? 'member';
}
