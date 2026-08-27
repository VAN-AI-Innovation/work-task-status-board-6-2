/**
 * 이 파일이 재는 것은 셋이다 — **「정확히 하나」가 앱에서도 막히는가**(DB 함수가 이미 막지만
 * 400이 500보다 정직하다), **DB 행이 응답 모양으로 옮겨지는가**, 그리고 **지정하지 않은 키가
 * 응답에 실릴 수 없는가**(이 응답에는 이메일이 있다 · `S6`).
 */

import { describe, expect, it } from 'vitest';

import {
  approveSchema,
  rejectSchema,
  toJoinRequestsResponse,
} from '@/lib/api/join-request-schema';

const USER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

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

describe('approveSchema', () => {
  it('구성원 id 하나만 있으면 통과한다', () => {
    expect(approveSchema.parse({ userId: USER, memberId: MEMBER })).toEqual({
      userId: USER,
      memberId: MEMBER,
    });
  });

  it('새 이름 하나만 있으면 통과하고 앞뒤 공백을 턴다', () => {
    expect(approveSchema.parse({ userId: USER, newMemberName: '  신입1  ' })).toEqual({
      userId: USER,
      newMemberName: '신입1',
    });
  });

  it('둘 다 주면 거부한다 — 어느 쪽 의도였는지 추측하지 않는다', () => {
    expect(
      approveSchema.safeParse({ userId: USER, memberId: MEMBER, newMemberName: '신입1' }).success
    ).toBe(false);
  });

  it('둘 다 없으면 거부한다', () => {
    expect(approveSchema.safeParse({ userId: USER }).success).toBe(false);
  });

  it('uuid가 아닌 대상은 거부한다', () => {
    expect(approveSchema.safeParse({ userId: 'nope', memberId: MEMBER }).success).toBe(false);
  });

  it('빈 이름·40자 초과 이름은 거부한다', () => {
    expect(approveSchema.safeParse({ userId: USER, newMemberName: '   ' }).success).toBe(false);
    expect(approveSchema.safeParse({ userId: USER, newMemberName: '가'.repeat(41) }).success).toBe(
      false
    );
  });

  it('모르는 키는 거부한다 — 조용히 버리면 클라이언트가 틀린 모양으로 200을 받는다', () => {
    expect(
      approveSchema.safeParse({ userId: USER, memberId: MEMBER, role: 'admin' }).success
    ).toBe(false);
  });
});

describe('rejectSchema', () => {
  it('대상 하나만 받는다', () => {
    expect(rejectSchema.parse({ userId: USER })).toEqual({ userId: USER });
    expect(rejectSchema.safeParse({ userId: USER, reason: '사유' }).success).toBe(false);
    expect(rejectSchema.safeParse({}).success).toBe(false);
  });
});

describe('toJoinRequestsResponse', () => {
  it('스네이크케이스 행을 응답 모양으로 옮긴다', () => {
    expect(toJoinRequestsResponse([row()])).toEqual({
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

  it('행이 없거나 null이면 빈 목록이다 — 리더에게 보일 것이 없는 것은 사고가 아니다', () => {
    expect(toJoinRequestsResponse([])).toEqual({ requests: [] });
    expect(toJoinRequestsResponse(null)).toEqual({ requests: [] });
  });

  it('이름·이메일·팀이 비어 있어도 통과한다 — 트리거가 null로 접는 자리다', () => {
    expect(
      toJoinRequestsResponse([row({ display_name: null, email: null, team_id: null })]).requests[0]
    ).toMatchObject({ displayName: null, email: null, teamId: null });
  });

  it('거절 상태도 목록에 남는다', () => {
    expect(toJoinRequestsResponse([row({ status: 'rejected' })]).requests[0].status).toBe(
      'rejected'
    );
  });

  it('모르는 팀 값은 던진다 — 조용히 통과시키면 화면이 없는 팀을 그린다', () => {
    expect(() => toJoinRequestsResponse([row({ team_id: 'sales' })])).toThrow();
  });

  it('함수가 내지 않기로 한 상태는 던진다', () => {
    expect(() => toJoinRequestsResponse([row({ status: 'active' })])).toThrow();
  });

  it('DB 행에 모르는 칸이 붙으면 던진다 — 조용히 통과하는 것보다 낫다', () => {
    expect(() => toJoinRequestsResponse([row({ phone: '010-0000-0000' })])).toThrow();
  });
});
