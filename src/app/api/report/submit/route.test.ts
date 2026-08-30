/**
 * 제출 라우트가 지는 계약은 넷이다 — **출처를 본다**(폼 한 장으로 남의 팀 보고를 올릴 수
 * 없다), **팀을 받지 않는다**(`my_team()`이 정한다), **모양이 틀리면 400**(권한 문제가
 * 아니다), **성공하면 갱신된 목록을 함께 준다**(화면이 상태를 스스로 바꾸지 않는다).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let submitResult: { error: unknown } = { error: null };
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return name === 'submit_report' ? submitResult : listResult;
          },
        }
      : null,
}));

const { POST } = await import('./route');

const WEEK = '2026-08-24';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/report/submit', {
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
  submitResult = { error: null };
  listResult = { data: [], error: null };
  hasClient = true;
});

describe('POST /api/report/submit', () => {
  it('인자 이름이 SQL과 같다', async () => {
    const res = await post({ weekStart: WEEK, body: '# 보고', note: '장비 지연' });

    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      name: 'submit_report',
      args: { week: WEEK, body: '# 보고', note: '장비 지연' },
    });
  });

  it('특이사항을 안 보내면 빈 문자열로 간다 — 「안 적었다」와 「빈 값」을 가르지 않는다', async () => {
    await post({ weekStart: WEEK, body: '# 보고' });

    expect(rpcCalls[0]?.args).toMatchObject({ note: '' });
  });

  it('팀을 실어 보내면 400이다 — 팀은 `my_team()`이 정한다', async () => {
    const res = await post({ weekStart: WEEK, body: '# 보고', teamId: 'shoot' });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('VALIDATION_FAILED');
    expect(rpcCalls).toHaveLength(0);
  });

  it('빈 본문은 400이다 — 권한 문제가 아니라 모양 문제다', async () => {
    const res = await post({ weekStart: WEEK, body: '   ' });

    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('JSON이 아니면 400이다', async () => {
    expect((await post('not json')).status).toBe(400);
  });

  it('다른 출처의 요청은 403이고 RPC를 부르지 않는다', async () => {
    const res = await post({ weekStart: WEEK, body: '# 보고' }, { origin: 'https://evil.test' });

    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('DB가 거부하면 403이다 — 사유를 갈라 알리지 않는다', async () => {
    submitResult = { error: { message: 'not permitted' } };
    const res = await post({ weekStart: WEEK, body: '# 보고' });

    expect(res.status).toBe(403);
    expect(await code(res)).toBe('FORBIDDEN');
  });

  it('성공하면 갱신된 목록을 함께 준다 — 화면이 상태를 스스로 바꾸지 않는다', async () => {
    listResult = {
      data: [
        {
          team_id: 'edit',
          week_start: WEEK,
          body: '# 보고',
          note: '',
          status: 'submitted',
          review_note: null,
          submitted_at: '2026-08-27T15:10:00Z',
          reviewed_at: null,
        },
      ],
      error: null,
    };

    const res = await post({ weekStart: WEEK, body: '# 보고' });
    const payload = (await res.json()) as { submissions: { teamId: string; status: string }[] };

    expect(rpcCalls[1]).toEqual({ name: 'list_reports', args: { week: WEEK } });
    expect(payload.submissions).toEqual([
      expect.objectContaining({ teamId: 'edit', status: 'submitted' }),
    ]);
  });

  it('자격증명이 없으면 503이다 — 부를 함수가 없다', async () => {
    hasClient = false;
    const res = await post({ weekStart: WEEK, body: '# 보고' });

    expect(res.status).toBe(503);
    expect(await code(res)).toBe('STORAGE_UNAVAILABLE');
  });
});
