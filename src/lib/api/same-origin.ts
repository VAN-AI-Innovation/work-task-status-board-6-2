/**
 * 상태를 바꾸는 `POST`가 **우리 화면에서 온 것인지** 본다 (T11).
 *
 * ## 왜 필요한가
 *
 * 이 앱의 인증 라우트는 전부 평범한 폼을 받는다 (`ADR-027`). 폼 전송은 브라우저가
 * 어느 사이트에서든 보낼 수 있고 쿠키가 함께 나가므로, 남의 페이지에 숨겨 둔 `<form
 * action="https://…/api/auth/rejoin" method="post">` 한 장이 로그인한 사람의 팀을 바꾼다.
 * 폼은 커스텀 헤더를 붙일 수 없어서 「JSON만 받는다」 같은 방어가 통하지 않는다 — 남는
 * 것은 **브라우저가 스스로 붙이는 `Origin`을 보는 것**이다.
 *
 * ## `Origin`이 없으면 **통과시킨다**
 *
 * 이 판단이 이 파일에서 가장 되돌리기 쉬운 자리이므로 근거를 남긴다.
 *
 * 이 프로젝트는 인증 흐름을 **`curl`로 검증해 왔다** — `TICKETS.md` T8 완료 기준 2가
 * 「`curl`로 직접 검증한다」를 명시하고, 로그인을 서버 액션이 아니라 라우트 핸들러로 만든
 * 이유가 바로 그것이다 (`login/route.ts` 머리말·`ADR-027`). `curl`은 `Origin`을 붙이지
 * 않는다. 「없으면 거부」로 조이는 순간 **그 검증 절차가 통째로 죽고**, 방어 하나를 얻는
 * 대신 방어를 확인할 방법을 잃는다.
 *
 * 그러고도 CSRF는 막힌다. **브라우저는 cross-site `POST`에 언제나 `Origin`을 붙인다** —
 * 공격자가 그 헤더를 지우거나 위조할 수단이 폼·`fetch` 어디에도 없다. 즉 「없음」은
 * 브라우저가 아니라는 뜻이고, 브라우저가 아니면 남의 쿠키를 실어 보낼 수도 없다.
 *
 * 정리하면 규칙은 둘뿐이다: **없으면 통과, 있는데 다르면 거부.**
 *
 * ## `Host`만 본다
 *
 * `x-forwarded-host`를 보지 않는 것이 의도다. 그 헤더는 프록시가 넣어 주는 값이고, 프록시가
 * 겹쳐 쓰지 않는 배치에서는 **요청자가 정할 수 있는 값**이 된다 — 대조 기준을 공격자가
 * 고를 수 있으면 대조가 아니다. `Host`는 브라우저가 목적지로 채우므로 cross-site 요청에서도
 * 언제나 **우리 호스트**다.
 */

/** `https,http`처럼 겹쳐 쓴 값과 `http:`처럼 콜론이 붙은 값을 같은 모양으로 접는다 */
function normalizeProto(proto: string): string {
  return proto.split(',')[0].trim().replace(/:$/, '').toLowerCase();
}

export function isSameOrigin(
  origin: string | null,
  host: string | null,
  proto: string
): boolean {
  // 헤더가 아예 없다 — `curl`·오래된 클라이언트. 머리말의 근거로 통과시킨다
  if (origin === null) return true;
  // 있는데 대조할 것이 없으면 통과시킬 수 없다. 빈 `Origin`도 「없음」이 아니다
  if (host === null || host.trim().length === 0) return false;

  const expected = `${normalizeProto(proto)}://${host.trim().toLowerCase()}`;
  // 끝 슬래시는 출처의 일부가 아니다. 문자열 `null`(샌드박스 iframe)은 여기서 걸린다
  const actual = origin.trim().replace(/\/$/, '').toLowerCase();

  return actual === expected;
}

/**
 * 라우트가 부르는 자리. 헤더 이름을 아는 곳을 하나로 묶어 둔다 — 라우트마다 적으면
 * 다음 라우트가 `x-forwarded-proto`를 빠뜨리고, 그 실패는 프록시 뒤에서만 나타난다.
 */
export function requestIsSameOrigin(request: Request): boolean {
  const { headers } = request;
  // 프록시 뒤에서는 `request.url`의 스킴이 내부 값(http)이라 겉으로 드러난 것과 다르다
  const proto = headers.get('x-forwarded-proto') ?? new URL(request.url).protocol;

  return isSameOrigin(headers.get('origin'), headers.get('host'), proto);
}
