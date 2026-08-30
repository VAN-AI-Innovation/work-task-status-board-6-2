/**
 * 검토 라우트가 지는 계약. 제출 라우트와 셋은 같고(**출처·모양·갱신된 목록**), 하나가
 * 다르다 — **반려에는 사유가 필수이고 그 부재는 403이 아니라 400이다.** 잘못된 것은
 * 권한이 아니라 요청의 모양이고, 어드민이 할 일은 포기가 아니라 사유를 적는 것이다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let rpcCalls: { name: string; args: unknown }[] = [];
let reviewResult: { error: unknown } = { error: null };
let listResult: { data: unknown; error: unknown } = { data: [], error: null };
let hasClient = true;

vi.mock('@/lib/auth/request-viewer', () => ({
  currentSessionClient: async () =>
    hasClient
      ? {
          rpc: async (name: string, args: unknown) => {
            rpcCalls.push({ name, args });
            return name === 'review_report' ? reviewResult : listResult;
          },
        }
      : null,
}));

const { POST } = await import('./route');

const WEEK = '2026-08-24';

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request('http://localhost/api/report/review', {
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
  reviewResult = { error: null };
  listResult = { data: [], error: null };
  hasClient = true;
});

describe('POST /api/report/review', () => {
  it('받아들일 때는 사유가 null로 간다 — 「승인 사유」라는 개념이 없다', async () => {
    const res = await post({ teamId: 'edit', weekStart: WEEK, decision: 'accepted' });

    expect(res.status).toBe(200);
    expect(rpcCalls[0]).toEqual({
      name: 'review_report',
      args: { target_team: 'edit', week: WEEK, decision: 'accepted', review_note: null },
    });
  });

  it('반려는 사유를 함께 보낸다', async () => {
    await post({
      teamId: 'shoot',
      weekStart: WEEK,
      decision: 'rejected',
      reviewNote: '숫자가 지난주 것입니다',
    });

    expect(rpcCalls[0]?.args).toMatchObject({
      target_team: 'shoot',
      decision: 'rejected',
      review_note: '숫자가 지난주 것입니다',
    });
  });

  it('사유 없는 반려는 400이고 RPC를 부르지 않는다', async () => {
    const res = await post({ teamId: 'edit', weekStart: WEEK, decision: 'rejected' });

    expect(res.status).toBe(400);
    expect(await code(res)).toBe('VALIDATION_FAILED');
    expect(rpcCalls).toHaveLength(0);
  });

  it('모르는 결정은 400이다 — 「제출됨」으로 되돌리는 것은 재보고뿐이다', async () => {
    const res = await post({ teamId: 'edit', weekStart: WEEK, decision: 'submitted' });

    expect(res.status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('다른 출처의 요청은 403이고 RPC를 부르지 않는다', async () => {
    const res = await post(
      { teamId: 'edit', weekStart: WEEK, decision: 'accepted' },
      { origin: 'https://evil.test' }
    );

    expect(res.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
  });

  it('DB가 거부하면 403이다 — 자격 미달과 없는 보고를 갈라 알리지 않는다', async () => {
    reviewResult = { error: { message: 'no submission' } };
    const res = await post({ teamId: 'edit', weekStart: WEEK, decision: 'accepted' });

    expect(res.status).toBe(403);
  });

  it('성공하면 갱신된 목록을 함께 준다', async () => {
    listResult = {
      data: [
        {
          team_id: 'edit',
          week_start: WEEK,
          body: '# 보고',
          note: '',
          status: 'rejected',
          review_note: '다시 확인해 주세요',
          submitted_at: '2026-08-27T15:10:00Z',
          reviewed_at: '2026-08-28T01:00:00Z',
        },
      ],
      error: null,
    };

    const res = await post({
      teamId: 'edit',
      weekStart: WEEK,
      decision: 'rejected',
      reviewNote: '다시 확인해 주세요',
    });
    const payload = (await res.json()) as { submissions: { status: string; reviewNote: string }[] };

    expect(rpcCalls[1]).toEqual({ name: 'list_reports', args: { week: WEEK } });
    expect(payload.submissions[0]).toMatchObject({
      status: 'rejected',
      reviewNote: '다시 확인해 주세요',
    });
  });

  it('자격증명이 없으면 503이다', async () => {
    hasClient = false;
    const res = await post({ teamId: 'edit', weekStart: WEEK, decision: 'accepted' });

    expect(res.status).toBe(503);
  });
});
