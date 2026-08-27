/**
 * 유출된 비밀번호를 가입 시점에 걸러 낸다 (T11 step 3).
 *
 * Supabase의 **Leaked password protection은 Pro 플랜 전용**이라 이 프로젝트에서는 켤 수
 * 없다 — 대시보드에서 시도하면 `available on Pro Plans and up`으로 거절당한다
 * (`TICKETS.md` T8 감사 기록의 그 항목이다). 같은 방어를 여기서 직접 진다.
 *
 * ## k-익명성 — 밖으로 나가는 것은 해시 접두사 5글자뿐이다
 *
 * ```
 * 비밀번호 → SHA-1 → 40글자 대문자 16진수
 *                     ├ 앞 5글자  → api.pwnedpasswords.com/range/{prefix} 로 나간다
 *                     └ 뒤 35글자 → 나가지 않는다. 응답 목록과 여기서 대조한다
 * ```
 *
 * **전체 해시를 보내면 이 방어가 곧 유출 경로가 된다.** 접두사 하나에 수백 건이 걸리므로
 * 상대는 「이 사람이 그중 무엇을 쓰는지」를 알 수 없다. 접두사를 한 글자만 늘려도 그 k가
 * 줄어든다 — 5는 API 형식이자 방어의 세기다.
 *
 * SHA-1을 쓰는 것은 약해서가 아니라 **API가 그 형식이기 때문**이다. 저장용 해시가 아니다
 * (비밀번호 저장은 Supabase Auth가 한다).
 *
 * `Add-Padding: true`를 붙이는 이유: 붙이지 않으면 응답 크기가 결과에 따라 달라져,
 * 본문을 못 봐도 **길이만으로** 유출 여부를 추측당한다. 대신 가짜 항목이 `:0`으로 섞여
 * 오므로 **건수를 반드시 본다** — 안 보면 패딩이 곧 오탐이다.
 *
 * ## 조회 실패는 「통과」로 접는다 (fail-open)
 *
 * 타임아웃·네트워크 오류·5xx·깨진 본문이 전부 `false`다. **가용성과 강도를 맞바꾼
 * 판단이다**: 외부 서비스가 죽었다고 회원가입 전체가 멈추면, 그 서비스의 장애가 곧 이
 * 서비스의 장애가 된다. 이 방어는 **덤이지 문이 아니다** — 문은 최소 길이(`signup-schema.ts`)와
 * 승인 절차(`0005`의 `status`)가 진다. 다음 사람이 여기를 fail-closed로 조이려 한다면
 * 그 값이 무엇과 바뀌는지 먼저 본다.
 *
 * ## 규율 둘
 *
 * - **`fetch`를 인자로 받는다.** 안에서 전역을 부르면 테스트가 네트워크를 타고, 그러면
 *   이 방어는 CI에서 검증되지 않는다 (`viewer-role.ts`·`store-factory.ts`가 `env`를
 *   인자로 받는 것과 같은 규율이다).
 * - **비밀번호도 그 해시도 로그·에러 메시지에 남기지 않는다** (`S6`). 이 파일에 로그가
 *   한 줄도 없는 것이 그 규칙이 grep으로 확인되는 이유다.
 */

import { createHash } from 'node:crypto';

const RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';

/** API 형식이자 k-익명성의 k를 정하는 값. 늘리지 않는다 */
const PREFIX_LENGTH = 5;

/** 가입 폼 하나가 기다려 줄 수 있는 시간. 넘기면 통과로 접는다 */
const DEFAULT_TIMEOUT_MS = 2000;

export interface PwnedCheckDeps {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * 응답은 `SUFFIX:COUNT` 줄 목록이다. 대소문자를 가리지 않고, **건수가 0인 줄은 패딩이라
 * 세지 않는다.** 깨진 줄은 조용히 건너뛴다 — 형식 하나 때문에 가입이 막힐 이유가 없다.
 */
function containsSuffix(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const [hash, count] = line.trim().split(':');
    if (hash === undefined || hash.toUpperCase() !== suffix) continue;

    const seen = Number(count);
    if (Number.isFinite(seen) && seen > 0) return true;
  }

  return false;
}

/** 유출 목록에 있으면 `true`. 조회에 실패하면 `false`(fail-open — 머리말 참고) */
export async function isPwnedPassword(password: string, deps: PwnedCheckDeps): Promise<boolean> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = digest.slice(0, PREFIX_LENGTH);
  const suffix = digest.slice(PREFIX_LENGTH);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await deps.fetch(`${RANGE_ENDPOINT}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) return false;

    return containsSuffix(await response.text(), suffix);
  } catch {
    // 사유를 갈라 봐야 할 일이 같다 — 통과시킨다. 잡은 값을 어디에도 적지 않는다 (`S6`)
    return false;
  } finally {
    clearTimeout(timer);
  }
}
