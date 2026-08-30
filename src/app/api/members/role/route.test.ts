/**
 * 이 라우트가 지는 계약은 다섯이다 — **출처를 본다**(폼 한 장으로 남을 팀장으로 세울 수
 * 없다), **`admin`으로 올릴 수 없다**, **팀은 선택이고 빠지면 `null`로 넘어간다**(규칙은
 * DB가 진다), **DB가 거절하면 사유를 갈라 알리지 않는다**, **성공하면 갱신된 명부를 함께
 * 준다**(화면이 계산하지 않는다).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let setRoleResult: { error: unknown } = { error: null };
let directoryResult: { data: unknown; error: unknown } = { data: [], error: null };
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return name === 'set_role' ? setRoleResult : directoryResult;
          },
        }
      : null,
}));

const { POST } = await import('./route');

const USER = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/members/role', {
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
  setRoleResult = { error: null };
  directoryResult = { data: [], error: null };
  hasClient = true;
});

describe('POST /api/members/role — 무엇을 넘기는가', () => {
  it('인자 이름이 SQL과 글자 그대로 같다', async () => {
    const res = await post({ userId: USER, role: 'lead', teamId: 'shoot' });

    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      name: 'set_role',
      args: { target: USER, new_role: 'lead', new_team: 'shoot' },
    });
  });

  it('팀을 안 보내면 `null`로 넘어간다 — 현재 팀을 쓰는 판단은 DB가 한다', async () => {
    await post({ userId: USER, role: 'member' });

    expect(rpcCalls[0]).toEqual({
      name: 'set_role',
      args: { target: USER, new_role: 'member', new_team: null },
    });
  });

  it('성공하면 갱신된 명부를 함께 준다', async () => {
    directoryResult = {
      data: [
        {
          user_id: USER,
          member_id: null,
          display_name: '김편집',
          member_name: null,
          email: 'edit@van.test',
          role: 'lead',
          status: 'active',
          team_id: 'edit',
        },
      ],
      error: null,
    };

    const res = await post({ userId: USER, role: 'lead' });

    expect(rpcCalls.map((call) => call.name)).toEqual(['set_role', 'member_directory']);
    expect(await res.json()).toEqual({
      members: [
        {
          userId: USER,
          memberId: null,
          displayName: '김편집',
          memberName: null,
          email: 'edit@van.test',
          role: 'lead',
          status: 'active',
          teamId: 'edit',
        },
      ],
    });
  });
});

describe('POST /api/members/role — 거절', () => {
  it('출처가 다르면 403이고 DB를 부르지 않는다', async () => {
    const res = await post({ userId: USER, role: 'lead' }, { origin: 'https://evil.test' });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
    expect(rpcCalls).toEqual([]);
  });

  it('`Origin`이 없는 요청(`curl`)은 통과한다', async () => {
    expect((await post({ userId: USER, role: 'lead' })).status).toBe(200);
  });

  it('`admin`으로 올릴 수 없다 — 400이고 DB에 닿지 않는다', async () => {
    const res = await post({ userId: USER, role: 'admin' });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('VALIDATION_FAILED');
    expect(rpcCalls).toEqual([]);
  });

  it('모양이 틀리면 400이다 — 권한 문구를 주지 않는다', async () => {
    expect(await code(await post('not json'))).toBe('VALIDATION_FAILED');
    expect(await code(await post({ userId: 'user-9', role: 'lead' }))).toBe('VALIDATION_FAILED');
    expect(await code(await post({ userId: USER, role: 'lead', teamId: '편집팀' }))).toBe(
      'VALIDATION_FAILED'
    );
    expect(await code(await post({ userId: USER }))).toBe('VALIDATION_FAILED');
  });

  it('DB가 거절하면 403이다 — 사유를 갈라 알리지 않는다', async () => {
    setRoleResult = { error: { message: 'not permitted' } };

    const res = await post({ userId: USER, role: 'lead' });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
    // 「자격 미달」·「팀이 없다」·「없는 대상」이 전부 같은 답이다
    expect(rpcCalls.map((call) => call.name)).toEqual(['set_role']);
  });

  it('붙을 저장소가 없으면 503이다', async () => {
    hasClient = false;

    expect(await code(await post({ userId: USER, role: 'lead' }))).toBe('STORAGE_UNAVAILABLE');
  });

  it('바꾸고 나서 명부를 읽지 못하면 503이다', async () => {
    directoryResult = { data: null, error: { message: 'boom' } };

    expect(await code(await post({ userId: USER, role: 'lead' }))).toBe('STORAGE_UNAVAILABLE');
  });
});
