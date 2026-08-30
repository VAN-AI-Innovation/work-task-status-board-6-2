/**
 * 거절 라우트는 승인과 **같은 규율**을 진다 — 출처를 보고, 모양이 틀리면 400이고, DB가
 * 거절하면 사유를 갈라 알리지 않고, 성공하면 갱신된 목록을 함께 준다.
 *
 * 라우트를 승인과 **나눈 것**이 이 파일이 재는 마지막 한 가지다. `action` 필드 하나로
 * 갈랐다면 오타 한 글자가 승인을 거절로 바꾼다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let rejectResult: { error: unknown } = { error: null };
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return name === 'reject_join' ? rejectResult : listResult;
          },
        }
      : null,
}));

const { POST } = await import('./route');

const USER = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/team/requests/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  rpcCalls = [];
  rejectResult = { error: null };
  listResult = { data: [], error: null };
  hasClient = true;
});

describe('POST /api/team/requests/reject', () => {
  it('대상 하나만 넘긴다 — 승인 인자가 섞이지 않는다', async () => {
    const res = await post({ userId: USER });

    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({ name: 'reject_join', args: { target: USER } });
  });

  it('성공하면 갱신된 요청 목록을 함께 준다', async () => {
    const res = await post({ userId: USER });

    expect(rpcCalls.map((call) => call.name)).toEqual(['reject_join', 'pending_requests']);
    expect(await res.json()).toEqual({ requests: [] });
  });

  it('다른 출처의 요청은 403이고 DB에 닿지 않는다', async () => {
    const res = await post({ userId: USER }, { origin: 'https://evil.example' });

    expect(res.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it('uuid가 아니거나 모르는 키가 섞이면 400이다', async () => {
    expect((await post({ userId: 'nope' })).status).toBe(400);
    expect((await post({ userId: USER, reason: '사유' })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it('DB가 거절하면 사유를 갈라 알리지 않고 403이다', async () => {
    rejectResult = { error: { message: 'not permitted' } };
    const res = await post({ userId: USER });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
  });

  it('자격증명이 없으면 503이다', async () => {
    hasClient = false;

    expect((await post({ userId: USER })).status).toBe(503);
  });
});
