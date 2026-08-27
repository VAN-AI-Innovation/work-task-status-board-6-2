/**
 * 로그인 후 돌아갈 경로를 고른다 — **오픈 리다이렉트 방어**.
 *
 * `/api/auth/login`은 `?next=`를 받아 로그인 성공 시 그리로 보낸다. 검사 없이 쓰면
 * `POST /api/auth/login?next=https://evil.com`이 **우리 도메인의 로그인 화면을 거쳐**
 * 남의 사이트로 사람을 보내는 링크가 된다. 피싱이 이 모양을 쓰는 이유는 주소창에 처음
 * 보이는 것이 우리 도메인이기 때문이다.
 *
 * 규칙은 **화이트리스트**다 — 「위험한 모양을 뺀다」가 아니라 「이 모양만 통과시킨다」.
 * 빼는 쪽으로 짜면 `/\evil.com`처럼 브라우저만 아는 형태를 매번 뒤늦게 알게 된다.
 *
 * 통과 조건:
 * 1. `/`로 시작한다 — `https://evil.com`·`javascript:alert(1)`이 여기서 떨어진다
 * 2. 두 번째 글자가 `/`도 `\`도 아니다 — 브라우저는 `//evil.com`과 `/\evil.com`을 **둘 다**
 *    프로토콜 상대 URL로 읽어 다른 호스트로 간다. 첫 글자만 보는 검사는 이것을 놓친다
 * 3. 제어문자(개행·캐리지리턴·탭·NUL)와 공백이 없다 — `Location` 헤더에 개행이 들어가면
 *    응답 헤더를 쪼갤 수 있다
 *
 * 판정을 라우트에 쓰지 않고 여기 두는 것은 **테스트로 지켜지지 않으면 지켜지지 않기**
 * 때문이다 (`viewer-role.ts`·`route-guard.ts`와 같은 규율).
 */

/** 헤더를 쪼개거나 파서를 흔드는 글자들. 정상 경로에는 하나도 없다 */
const UNSAFE_CHARS = /[\u0000-\u0020\u007f]/;

/**
 * 안전하면 그 경로를, 아니면 `fallback`을 돌려준다. **`null`을 내지 않는다** — 호출부가
 * 매번 「없으면 어디로」를 다시 정하면 라우트마다 기본 목적지가 갈린다.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (value.length === 0) return fallback;
  if (value[0] !== '/') return fallback;
  if (value[1] === '/' || value[1] === '\\') return fallback;
  if (UNSAFE_CHARS.test(value)) return fallback;

  return value;
}
