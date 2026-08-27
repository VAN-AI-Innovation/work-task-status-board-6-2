/**
 * 이 파일이 지는 것은 둘이다 — **무엇을 받는가**(`roleChangeSchema`)와
 * **무엇을 내보내는가**(`toMemberDirectoryResponse`).
 *
 * 가장 중요한 단언은 「`'admin'`을 받지 않는다」 하나다. DB도 거부하지만 두 곳 다 좁혀
 * 두는 것이 결정이고, 그 결정이 풀렸는지는 여기서만 기계적으로 확인된다.
 */

import { describe, expect, it } from 'vitest';

import { roleChangeSchema, toMemberDirectoryResponse } from '@/lib/api/member-role-schema';

const TARGET = '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f';
const MEMBER_ID = '9a8b7c6d-5e4f-4a3b-8c1d-0e9f8a7b6c5d';

describe('roleChangeSchema', () => {
  it('팀장·부원 둘만 받는다', () => {
    expect(roleChangeSchema.parse({ userId: TARGET, role: 'lead' })).toEqual({
      userId: TARGET,
      role: 'lead',
    });
    expect(roleChangeSchema.parse({ userId: TARGET, role: 'member' }).role).toBe('member');
  });

  it('`admin`을 받지 않는다 — DB만 막게 두지 않는다', () => {
    // 스키마에 그 값이 있으면 다음 사람이 「DB만 고치면 되겠네」라고 읽는다
    expect(() => roleChangeSchema.parse({ userId: TARGET, role: 'admin' })).toThrow();
  });

  it('팀은 선택이다 — 있으면 팀 키만 받는다', () => {
    expect(roleChangeSchema.parse({ userId: TARGET, role: 'lead', teamId: 'shoot' }).teamId).toBe(
      'shoot'
    );
    expect(roleChangeSchema.parse({ userId: TARGET, role: 'lead' }).teamId).toBeUndefined();
    expect(() => roleChangeSchema.parse({ userId: TARGET, role: 'lead', teamId: '편집팀' })).toThrow();
  });

  it('대상은 uuid다', () => {
    expect(() => roleChangeSchema.parse({ userId: 'user-9', role: 'lead' })).toThrow();
  });

  it('모르는 키를 조용히 버리지 않는다', () => {
    expect(() =>
      roleChangeSchema.parse({ userId: TARGET, role: 'lead', status: 'active' })
    ).toThrow();
  });
});

describe('toMemberDirectoryResponse', () => {
  const ROW = {
    user_id: TARGET,
    member_id: MEMBER_ID,
    display_name: '김편집',
    member_name: '편집1',
    email: 'edit@van.test',
    role: 'lead',
    status: 'active',
    team_id: 'edit',
  };

  it('스네이크케이스를 카멜케이스로 옮긴다', () => {
    expect(toMemberDirectoryResponse([ROW])).toEqual({
      members: [
        {
          userId: TARGET,
          memberId: MEMBER_ID,
          displayName: '김편집',
          memberName: '편집1',
          email: 'edit@van.test',
          role: 'lead',
          status: 'active',
          teamId: 'edit',
        },
      ],
    });
  });

  it('계정만 있는 행과 명부에만 있는 행을 둘 다 받는다 — full outer join이다', () => {
    const accountOnly = { ...ROW, member_id: null, member_name: null };
    const rosterOnly = {
      ...ROW,
      user_id: null,
      display_name: null,
      email: null,
      role: null,
      status: null,
    };

    const { members } = toMemberDirectoryResponse([accountOnly, rosterOnly]);

    expect(members[0].memberId).toBeNull();
    expect(members[1].userId).toBeNull();
    expect(members[1].status).toBeNull();
  });

  it('행이 없으면 빈 목록이다 — `null`도 같다', () => {
    expect(toMemberDirectoryResponse([])).toEqual({ members: [] });
    expect(toMemberDirectoryResponse(null)).toEqual({ members: [] });
  });

  it('함수가 칸을 늘리면 조용히 싣지 않고 던진다', () => {
    // 이 응답에는 이메일이 실린다. 모르는 칸이 함께 나가는 일이 없어야 한다 (`S6`)
    expect(() => toMemberDirectoryResponse([{ ...ROW, phone: '010-0000-0000' }])).toThrow();
  });

  it('모르는 역할·상태를 받지 않는다', () => {
    expect(() => toMemberDirectoryResponse([{ ...ROW, role: 'owner' }])).toThrow();
    expect(() => toMemberDirectoryResponse([{ ...ROW, status: 'suspended' }])).toThrow();
  });
});
