/**
 * 이 파일이 재는 것은 넷이다 — **밖으로 나가는 것이 해시 접두사 5글자뿐인가**,
 * **패딩(count 0)을 유출로 오독하지 않는가**, **조회 실패가 통과로 접히는가**,
 * **타임아웃이 걸리는가**.
 *
 * **`fetch`를 주입해 돈다. 실제 네트워크를 타지 않는다.** 타면 이 방어의 검증이 외부
 * 서비스에 묶이고, 그 서비스가 죽는 날 CI가 「검증되지 않은 채로」 초록이 된다.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { isPwnedPassword } from './pwned-password';

const PASSWORD = 'correct horse battery staple';
const DIGEST = createHash('sha1').update(PASSWORD, 'utf8').digest('hex').toUpperCase();
const PREFIX = DIGEST.slice(0, 5);
const SUFFIX = DIGEST.slice(5);

interface Seen {
  url: string;
  headers: Record<string, string>;
  method: string;
  /** 요청 본문. `GET`이라 비어 있어야 한다 */
  body: string;
}

/** 요청을 기록하면서 정해진 본문을 돌려주는 가짜 `fetch` */
function stubFetch(body: string, init: ResponseInit = {}): { fetch: typeof globalThis.fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchStub = (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    seen.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(requestInit?.headers).entries()),
      method: requestInit?.method ?? 'GET',
      body: requestInit?.body === undefined || requestInit?.body === null
        ? ''
        : String(requestInit.body),
    });
    return new Response(body, { status: 200, ...init });
  }) as typeof globalThis.fetch;

  return { fetch: fetchStub, seen };
}

describe('isPwnedPassword — 밖으로 나가는 것', () => {
  it('해시 접두사 5글자만 보낸다 — 비밀번호도 전체 해시도 나가지 않는다', async () => {
    const { fetch, seen } = stubFetch(`${SUFFIX}:5`);
    await isPwnedPassword(PASSWORD, { fetch });

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(seen[0].url).not.toContain(SUFFIX);
    expect(seen[0].url).not.toContain(PASSWORD);
    // 접두사가 정확히 5글자다 — 한 글자만 늘어도 k-익명성의 k가 줄어든다
    expect(seen[0].url.split('/range/')[1]).toHaveLength(5);
  });

  /**
   * 공격 #15 — **URL만 보고 안심하지 않는다.** 접두사를 URL에서 지우면서 본문이나 헤더로
   * 옮기는 「고침」이 들어오면 k-익명성은 그대로 깨지는데 위 단언은 초록으로 남는다.
   * 그래서 나가는 요청 **전체**를 훑는다.
   */
  it('본문에도 헤더에도 비밀번호와 전체 해시가 없다', async () => {
    const { fetch, seen } = stubFetch(`${SUFFIX}:5`);
    await isPwnedPassword(PASSWORD, { fetch });

    const outgoing = [
      seen[0].url,
      seen[0].body,
      ...Object.entries(seen[0].headers).flat(),
    ].join('\n');

    expect(outgoing).not.toContain(PASSWORD);
    expect(outgoing).not.toContain(SUFFIX);
    expect(outgoing).not.toContain(DIGEST);
    // 조회는 GET이고 실어 보낼 본문 자체가 없다
    expect(seen[0].method).toBe('GET');
    expect(seen[0].body).toBe('');
  });

  it('`Add-Padding: true`를 붙인다 — 응답 크기로 결과를 추측당하지 않는다', async () => {
    const { fetch, seen } = stubFetch(`${SUFFIX}:5`);
    await isPwnedPassword(PASSWORD, { fetch });

    const headers = Object.fromEntries(
      Object.entries(seen[0].headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    expect(headers['add-padding']).toBe('true');
  });
});

describe('isPwnedPassword — 대조', () => {
  it('목록에 있으면 true다', async () => {
    const { fetch } = stubFetch(`0000000000000000000000000000000000000:1\r\n${SUFFIX}:1200\r\n`);
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(true);
  });

  it('목록에 없으면 false다', async () => {
    const { fetch } = stubFetch('0000000000000000000000000000000000000:1\r\nAAAAAAAA:2\r\n');
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(false);
  });

  it('접미사 대소문자를 가리지 않는다', async () => {
    const { fetch } = stubFetch(`${SUFFIX.toLowerCase()}:3`);
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(true);
  });

  /**
   * `Add-Padding`이 켜지면 **가짜 항목이 `:0`으로 섞여 온다.** 건수를 보지 않으면 패딩이
   * 곧 오탐이고, 사용자는 멀쩡한 비밀번호를 거부당한다.
   */
  it('건수가 0인 패딩 항목은 유출로 세지 않는다', async () => {
    const { fetch } = stubFetch(`${SUFFIX}:0\r\n`);
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(false);
  });

  it('빈 본문·깨진 줄에도 던지지 않는다', async () => {
    for (const body of ['', '\r\n\r\n', 'garbage', `${SUFFIX}`, `${SUFFIX}:not-a-number`]) {
      const { fetch } = stubFetch(body);
      await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(false);
    }
  });
});

/**
 * **fail-open이다.** 외부 서비스가 죽었다고 회원가입 전체가 멈추면 안 된다 (근거는
 * 구현 파일 머리말). 이 네 갈래가 전부 `false`인 것이 그 결정의 전부다.
 */
describe('isPwnedPassword — 조회 실패는 통과로 접는다', () => {
  it('5xx면 false다', async () => {
    const { fetch } = stubFetch(`${SUFFIX}:9`, { status: 503 });
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(false);
  });

  it('4xx면 false다', async () => {
    const { fetch } = stubFetch('', { status: 429 });
    await expect(isPwnedPassword(PASSWORD, { fetch })).resolves.toBe(false);
  });

  it('네트워크 오류면 false다', async () => {
    const fetchStub = (async () => {
      throw new Error('network');
    }) as typeof globalThis.fetch;

    await expect(isPwnedPassword(PASSWORD, { fetch: fetchStub })).resolves.toBe(false);
  });

  it('본문을 읽다 실패해도 false다', async () => {
    const fetchStub = (async () =>
      ({
        ok: true,
        text: async () => {
          throw new Error('stream');
        },
      }) as unknown as Response) as typeof globalThis.fetch;

    await expect(isPwnedPassword(PASSWORD, { fetch: fetchStub })).resolves.toBe(false);
  });

  it('제한 시간을 넘기면 요청을 끊고 false다', async () => {
    let aborted = false;
    const fetchStub = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      })) as typeof globalThis.fetch;

    await expect(isPwnedPassword(PASSWORD, { fetch: fetchStub, timeoutMs: 5 })).resolves.toBe(
      false
    );
    expect(aborted).toBe(true);
  });
});
