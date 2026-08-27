/**
 * 승인 라우트가 지는 계약은 넷이다 — **출처를 본다**(폼 한 장으로 남을 승인시킬 수 없다),
 * **모양이 틀리면 400**(권한 문제가 아니다), **거절 사유를 갈라 알리지 않는다**(uuid를 훑어
 * 남의 팀 계정을 세지 못하게), **성공하면 갱신된 목록을 함께 준다**(화면이 계산하지 않는다).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let approveResult: { error: unknown } = { error: null };
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return name === 'approve_join' ? approveResult : listResult;
          },
        }
      : null,
}));

const { POST } = await import('./route');

const USER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/team/requests/approve', {
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
  approveResult = { error: null };
  listResult = { data: [], error: null };
  hasClient = true;
});

describe('POST /api/team/requests/approve', () => {
  it('기존 구성원에 잇는다 — 인자 이름이 SQL과 같고 빠진 쪽은 null이다', async () => {
    const res = await post({ userId: USER, memberId: MEMBER });

    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      name: 'approve_join',
      args: { target: USER, member_id: MEMBER, new_member_name: null },
    });
  });

  it('새 이름으로 구성원을 만든다', async () => {
    await post({ userId: USER, newMemberName: '신입1' });

    expect(rpcCalls[0]).toEqual({
      name: 'approve_join',
      args: { target: USER, member_id: null, new_member_name: '신입1' },
    });
  });

  it('성공하면 갱신된 요청 목록을 함께 준다 — 화면이 다시 계산하지 않는다', async () => {
    listResult = {
      data: [
        {
          user_id: MEMBER,
          display_name: '신입2',
          email: 'n2@example.com',
          team_id: 'edit',
          status: 'pending',
          created_at: '2026-08-27T00:00:00.000Z',
        },
      ],
      error: null,
    };
    const res = await post({ userId: USER, memberId: MEMBER });

    expect(rpcCalls.map((call) => call.name)).toEqual(['approve_join', 'pending_requests']);
    expect((await res.json()) as { requests: { userId: string }[] }).toEqual({
      requests: [
        {
          userId: MEMBER,
          displayName: '신입2',
          email: 'n2@example.com',
          teamId: 'edit',
          status: 'pending',
          createdAt: '2026-08-27T00:00:00.000Z',
        },
      ],
    });
  });

  it('다른 출처의 요청은 403이고 DB에 닿지 않는다', async () => {
    const res = await post({ userId: USER, memberId: MEMBER }, { origin: 'https://evil.example' });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
    expect(rpcCalls).toEqual([]);
  });

  it('같은 출처의 요청은 통과한다', async () => {
    const res = await post({ userId: USER, memberId: MEMBER }, { origin: 'http://localhost' });

    expect(res.status).toBe(200);
  });

  it('둘 다 주거나 둘 다 안 주면 400이다 — 권한 문제가 아니라 모양 문제다', async () => {
    const both = await post({ userId: USER, memberId: MEMBER, newMemberName: '신입1' });
    const neither = await post({ userId: USER });

    expect(both.status).toBe(400);
    expect(await code(both)).toBe('VALIDATION_FAILED');
    expect(neither.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it('JSON이 아닌 본문은 400이다', async () => {
    const res = await post('not json');

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('VALIDATION_FAILED');
  });

  it('모르는 키가 섞이면 400이다 — 승인은 승격이 아니다', async () => {
    const res = await post({ userId: USER, memberId: MEMBER, role: 'admin' });

    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it('DB가 거절하면 사유를 갈라 알리지 않고 전부 403이다', async () => {
    for (const message of ['not permitted', 'member already linked', 'target has no team']) {
      rpcCalls = [];
      approveResult = { error: { message } };
      const res = await post({ userId: USER, memberId: MEMBER });

      expect(res.status).toBe(403);
      expect(await code(res)).toBe('FORBIDDEN');
    }
  });

  it('거절 문구에 DB 메시지를 담지 않는다', async () => {
    approveResult = { error: { message: 'member 22222222 already linked' } };
    const res = await post({ userId: USER, memberId: MEMBER });

    expect(JSON.stringify(await res.json())).not.toContain('22222222');
  });

  it('자격증명이 없으면 503이다', async () => {
    hasClient = false;
    const res = await post({ userId: USER, memberId: MEMBER });

    expect(res.status).toBe(503);
    expect(await code(res)).toBe('STORAGE_UNAVAILABLE');
  });
});
