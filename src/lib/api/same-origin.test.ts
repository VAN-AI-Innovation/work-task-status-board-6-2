/**
 * 이 함수가 지는 것은 하나다 — **브라우저가 남의 사이트에서 보낸 POST를 가려내는가.**
 *
 * 여기서 재는 것 중 가장 중요한 줄은 「`Origin`이 없으면 통과한다」이다. 그 줄이 뒤집히면
 * T8이 세운 `curl` 검증 절차가 통째로 죽으므로, **의도라는 것을 테스트가 말해 둔다** —
 * 다음 사람이 「없으면 거부」로 조이려 할 때 빨개지는 자리가 있어야 한다.
 */

import { describe, expect, it } from 'vitest';

import { isSameOrigin, requestIsSameOrigin } from './same-origin';

describe('isSameOrigin', () => {
  it('같은 출처면 통과한다', () => {
    expect(isSameOrigin('https://board.example.com', 'board.example.com', 'https')).toBe(true);
  });

  it('다른 출처는 거부한다 — cross-site POST가 걸리는 자리다', () => {
    expect(isSameOrigin('https://evil.example.com', 'board.example.com', 'https')).toBe(false);
  });

  it('스킴만 달라도 거부한다', () => {
    expect(isSameOrigin('http://board.example.com', 'board.example.com', 'https')).toBe(false);
  });

  it('포트가 다르면 거부한다 — 같은 호스트의 다른 앱이다', () => {
    expect(isSameOrigin('http://localhost:4000', 'localhost:3000', 'http')).toBe(false);
  });

  it('포트까지 같으면 통과한다', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000', 'http')).toBe(true);
  });

  /** ★ 이 줄을 뒤집으면 `curl`로 인증 흐름을 검증하던 절차가 통째로 죽는다 */
  it('`Origin`이 없으면 통과한다 — `curl`과 오래된 클라이언트의 자리다', () => {
    expect(isSameOrigin(null, 'board.example.com', 'https')).toBe(true);
  });

  it('빈 `Origin`은 없는 것이 아니다 — 거부한다', () => {
    expect(isSameOrigin('', 'board.example.com', 'https')).toBe(false);
  });

  it('문자열 `null` 출처(샌드박스 iframe)는 거부한다', () => {
    expect(isSameOrigin('null', 'board.example.com', 'https')).toBe(false);
  });

  it('`Host`를 모르면 대조할 것이 없다 — 거부한다', () => {
    expect(isSameOrigin('https://board.example.com', null, 'https')).toBe(false);
  });

  it('대소문자와 끝 슬래시는 같은 출처로 본다', () => {
    expect(isSameOrigin('HTTPS://Board.Example.com/', 'board.example.com', 'HTTPS')).toBe(true);
  });

  it('프록시가 겹쳐 쓴 `x-forwarded-proto`는 첫 값만 본다', () => {
    expect(isSameOrigin('https://board.example.com', 'board.example.com', 'https,http')).toBe(true);
  });

  it('`http:`처럼 콜론이 붙은 스킴도 받는다 — `URL.protocol`이 그 모양이다', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000', 'http:')).toBe(true);
  });
});

function post(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/rejoin', { method: 'POST', headers });
}

describe('requestIsSameOrigin', () => {
  it('헤더가 없는 요청은 통과한다 (`curl`)', () => {
    expect(requestIsSameOrigin(post({}))).toBe(true);
  });

  it('`Host`와 `Origin`이 같으면 통과한다', () => {
    expect(
      requestIsSameOrigin(post({ host: 'localhost:3000', origin: 'http://localhost:3000' }))
    ).toBe(true);
  });

  it('남의 출처에서 온 폼 전송은 거부한다', () => {
    expect(
      requestIsSameOrigin(post({ host: 'localhost:3000', origin: 'https://evil.example.com' }))
    ).toBe(false);
  });

  it('프록시 뒤에서는 `x-forwarded-proto`가 스킴을 정한다', () => {
    expect(
      requestIsSameOrigin(
        post({
          host: 'board.example.com',
          origin: 'https://board.example.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe(true);
  });
});
