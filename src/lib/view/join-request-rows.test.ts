/**
 * 재는 것은 셋이다 — **후보가 좁혀지는가** · **팀 이름이 표에서만 오는가** ·
 * **요청 시각이 KST인가.**
 *
 * 후보 규칙이 이 파일의 본체다. 이미 다른 계정에 붙은 명부 행을 후보에 남기면 리더가
 * 눌러 본 **뒤에야** 실패를 안다 (`approve_join`의 `member already linked`).
 */

import { describe, expect, it } from 'vitest';

import { toJoinRequestRows } from '@/lib/view/join-request-rows';
import type { MemberRecord } from '@/types/auth';
import type { JoinRequest } from '@/types/api';

function request(overrides: Partial<JoinRequest> = {}): JoinRequest {
  return {
    userId: 'user-1',
    displayName: '새내기',
    email: 'newbie@van.test',
    teamId: 'edit',
    status: 'pending',
    createdAt: '2026-08-25T15:10:00Z',
    ...overrides,
  };
}

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return { id: 'm-1', teamId: 'edit', name: '편집1', authUserId: null, ...overrides };
}

describe('toJoinRequestRows — 후보', () => {
  it('요청자의 팀에서 계정이 붙지 않은 명부 행만 후보다', () => {
    const [row] = toJoinRequestRows(
      [request()],
      [
        member({ id: 'm-1', name: '편집1' }),
        // 이미 남에게 붙었다 — 승인하면 `member already linked`로 튕긴다
        member({ id: 'm-2', name: '편집2', authUserId: 'user-9' }),
        // 다른 팀 — `member not in target team`이다
        member({ id: 'm-3', teamId: 'shoot', name: '촬영1' }),
      ]
    );

    expect(row.candidates).toEqual([{ id: 'm-1', name: '편집1' }]);
  });

  it('후보를 이름순으로 세운다 — 명부 순서는 저장소가 정할 일이 아니다', () => {
    const [row] = toJoinRequestRows(
      [request()],
      [member({ id: 'm-2', name: '하늘' }), member({ id: 'm-1', name: '가람' })]
    );

    expect(row.candidates.map((candidate) => candidate.name)).toEqual(['가람', '하늘']);
  });

  it('팀을 모르면 후보가 없다 — 승인 자체가 안 되는 상태다', () => {
    const [row] = toJoinRequestRows([request({ teamId: null })], [member()]);

    expect(row.candidates).toEqual([]);
    expect(row.teamName).toBeNull();
  });

  it('반려된 요청에는 후보를 싣지 않는다 — 누를 수 있는 버튼이 없다', () => {
    // `approve_join`은 `status = 'pending'`인 대상만 받는다 (`0005` 4-4)
    const [row] = toJoinRequestRows([request({ status: 'rejected' })], [member()]);

    expect(row.candidates).toEqual([]);
    expect(row.status).toBe('rejected');
  });
});

describe('toJoinRequestRows — 나머지 칸', () => {
  it('팀 이름은 `teamLabel()`에서만 온다', () => {
    const [row] = toJoinRequestRows([request({ teamId: 'marketing' })], []);

    expect(row.teamName).toBe('마케팅·관리팀');
  });

  it('요청 시각을 KST 날짜로 옮긴다 — UTC로 자르면 하루가 어긋난다', () => {
    // 2026-08-25T15:10Z는 KST로 8/26 00:10이다
    const [row] = toJoinRequestRows([request()], []);

    expect(row.requestedOn).toBe('2026-08-26');
  });

  it('읽을 수 없는 시각은 null이다 — 지어내지 않는다', () => {
    const [row] = toJoinRequestRows([request({ createdAt: 'nope' })], []);

    expect(row.requestedOn).toBeNull();
  });

  it('이름·이메일은 그대로 옮긴다. 없으면 없는 채로 둔다', () => {
    const [row] = toJoinRequestRows(
      [request({ displayName: null, email: null })],
      []
    );

    expect(row).toMatchObject({ userId: 'user-1', displayName: null, email: null });
  });

  it('목록 순서를 바꾸지 않는다 — `pending_requests()`가 이미 정렬해 준다', () => {
    const rows = toJoinRequestRows(
      [request({ userId: 'a' }), request({ userId: 'b' })],
      []
    );

    expect(rows.map((row) => row.userId)).toEqual(['a', 'b']);
  });
});
