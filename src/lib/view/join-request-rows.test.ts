/**
 * 재는 것은 셋이다 — **명부 연결이 저절로 정해지는가** · **팀 이름이 표에서만 오는가** ·
 * **요청 시각이 KST인가.**
 *
 * 연결 규칙이 이 파일의 본체다. 리더가 고르던 `<select>`를 없앴으므로, 잘못 정하면 리더는
 * 고칠 자리 없이 실패(`approve_join`의 `member already linked` · unique 위반)만 본다.
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

describe('toJoinRequestRows — 명부 연결', () => {
  it('같은 팀에 같은 이름의 빈 명부 행이 있으면 그 행에 잇는다', () => {
    const [row] = toJoinRequestRows(
      [request({ displayName: '편집1' })],
      [member({ id: 'm-1', name: '편집1' })]
    );

    expect(row.link).toEqual({ kind: 'existing', memberId: 'm-1', memberName: '편집1' });
  });

  it('이름 앞뒤 공백은 무시하고 맞춘다 — 시트 값에 공백이 흔하다', () => {
    const [row] = toJoinRequestRows(
      [request({ displayName: ' 편집1 ' })],
      [member({ id: 'm-1', name: '편집1  ' })]
    );

    expect(row.link).toMatchObject({ kind: 'existing', memberId: 'm-1' });
  });

  it('이미 다른 계정에 붙은 행에는 잇지 않는다 — `member already linked`가 된다', () => {
    const [row] = toJoinRequestRows(
      [request({ displayName: '편집2' })],
      [member({ id: 'm-2', name: '편집2', authUserId: 'user-9' })]
    );

    expect(row.link).toEqual({ kind: 'new', name: '편집2' });
  });

  it('다른 팀의 같은 이름에는 잇지 않는다 — `member not in target team`이 된다', () => {
    const [row] = toJoinRequestRows(
      [request({ displayName: '촬영1' })],
      [member({ id: 'm-3', teamId: 'shoot', name: '촬영1' })]
    );

    expect(row.link).toEqual({ kind: 'new', name: '촬영1' });
  });

  it('맞는 이름이 없으면 가입 이름으로 명부 행을 새로 만든다', () => {
    const [row] = toJoinRequestRows([request({ displayName: '새내기' })], [member()]);

    expect(row.link).toEqual({ kind: 'new', name: '새내기' });
  });

  it('팀을 모르면 연결이 없다 — 승인 자체가 안 되는 상태다', () => {
    const [row] = toJoinRequestRows([request({ teamId: null })], [member()]);

    expect(row.link).toBeNull();
    expect(row.teamName).toBeNull();
  });

  it('반려된 요청에는 연결이 없다 — 누를 수 있는 버튼이 없다', () => {
    // `approve_join`은 `status = 'pending'`인 대상만 받는다 (`0005` 4-4)
    const [row] = toJoinRequestRows([request({ status: 'rejected' })], [member()]);

    expect(row.link).toBeNull();
    expect(row.status).toBe('rejected');
  });

  it('가입 이름이 없으면 연결이 없다 — 명부에 적을 이름을 지어내지 않는다', () => {
    const [row] = toJoinRequestRows([request({ displayName: null })], []);

    expect(row.link).toBeNull();
  });

  it('가입 이름이 공백뿐이어도 연결이 없다', () => {
    const [row] = toJoinRequestRows([request({ displayName: '   ' })], []);

    expect(row.link).toBeNull();
  });

  it('40자를 넘는 이름은 잘라서 넘긴다 — `members.name`이 40자다 (`0005` 1절)', () => {
    const [row] = toJoinRequestRows([request({ displayName: 'ㄱ'.repeat(41) })], []);

    expect(row.link).toEqual({ kind: 'new', name: 'ㄱ'.repeat(40) });
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
