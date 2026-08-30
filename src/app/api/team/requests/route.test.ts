/**
 * 조회 라우트가 지는 계약은 둘이다 — **범위를 앱에서 다시 거르지 않는다**(함수가 이미 좁혔다)
 * 와 **지정하지 않은 키가 응답에 실리지 않는다**(이 응답에는 이메일이 있다 · `S6`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let rpcResult: { data: unknown; error: unknown } = { data: [], error: null };
/** `null`이면 자격증명·쿠키가 없는 환경이다 — 데모로 클론한 심사자의 경로 */
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return rpcResult;
          },
        }
      : null,
}));

const { GET } = await import('./route');

const USER = '11111111-1111-4111-8111-111111111111';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: USER,
    display_name: '신입1',
    email: 'newbie@example.com',
    team_id: 'edit',
    status: 'pending',
    created_at: '2026-08-27T01:02:03.000Z',
    ...overrides,
  };
}

/** 쿼리를 읽지 않는 라우트라 `/api/health`처럼 요청 객체를 받지 않는다 */
function get(): Promise<Response> {
  return GET();
}

beforeEach(() => {
  rpcCalls = [];
  rpcResult = { data: [], error: null };
  hasClient = true;
});

describe('GET /api/team/requests', () => {
  it('사용자 JWT로 pending_requests를 인자 없이 부른다', async () => {
    await get();

    expect(rpcCalls).toEqual([{ name: 'pending_requests', args: undefined }]);
  });

  it('200에 요청 목록이 카멜케이스로 온다', async () => {
    rpcResult = { data: [row()], error: null };
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      requests: [
        {
          userId: USER,
          displayName: '신입1',
          email: 'newbie@example.com',
          teamId: 'edit',
          status: 'pending',
          createdAt: '2026-08-27T01:02:03.000Z',
        },
      ],
    });
  });

  it('함수가 준 행을 역할로 다시 거르지 않는다 — 규칙이 두 벌이 되지 않는다', async () => {
    rpcResult = {
      data: [row({ team_id: 'shoot' }), row({ team_id: null }), row({ status: 'rejected' })],
      error: null,
    };
    const parsed = (await (await get()).json()) as { requests: unknown[] };

    expect(parsed.requests).toHaveLength(3);
  });

  it('보일 것이 없으면 빈 목록이고 200이다 — 그것은 사고가 아니다', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requests: [] });
  });

  it('자격증명이 없으면 503이다 — 붙을 저장소가 없는 것이지 권한 문제가 아니다', async () => {
    hasClient = false;
    const res = await get();

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'STORAGE_UNAVAILABLE'
    );
    expect(rpcCalls).toEqual([]);
  });

  it('DB 오류는 503이다 — 읽기에서 403은 사실이 아니다', async () => {
    rpcResult = { data: null, error: { message: 'connection reset' } };
    const res = await get();

    expect(res.status).toBe(503);
  });

  it('오류 문구에 DB 메시지를 담지 않는다', async () => {
    rpcResult = { data: null, error: { message: 'relation "public.profiles" does not exist' } };

    expect(JSON.stringify(await (await get()).json())).not.toContain('profiles');
  });
});
