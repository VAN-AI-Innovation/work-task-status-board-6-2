/**
 * 업무 패널이 **어떤 칸을 여는가.** 두 물음이 서로 반대 방향이라 한 파일에서 잰다 —
 * 담당자 지정은 위로 열리고(대표·팀장), 상태·진행률은 아래로 열린다(팀장·부원).
 */

import { describe, expect, it } from 'vitest';

import {
  assignableMembers,
  canAssignOwner,
  canEditProgress,
} from '@/lib/domain/task-authoring';
import type { MemberRecord } from '@/types/auth';

describe('canAssignOwner', () => {
  it('대표·실장은 참이다', () => {
    expect(canAssignOwner('admin')).toBe(true);
  });

  it('팀장은 참이다 — 자기 팀 업무를 나눠 주는 사람이다', () => {
    expect(canAssignOwner('lead')).toBe(true);
  });

  it('부원은 거짓이다 — 자기 업무를 남에게 넘기지 못한다', () => {
    expect(canAssignOwner('member')).toBe(false);
  });
});

describe('canEditProgress', () => {
  it('부원은 참이다 — 자기 업무의 진행을 적는 사람이다 (`UC-16`)', () => {
    expect(canEditProgress('member')).toBe(true);
  });

  it('팀장도 참이다', () => {
    expect(canEditProgress('lead')).toBe(true);
  });

  it('대표·실장은 거짓이다 — 손수 적는 자리가 아니다', () => {
    expect(canEditProgress('admin')).toBe(false);
  });

  it('두 값이 세 역할에서 모두 같지는 않다 — 같아지면 이 구분이 사라진 것이다', () => {
    const roles = ['admin', 'lead', 'member'] as const;
    expect(roles.some((role) => canAssignOwner(role) !== canEditProgress(role))).toBe(true);
  });
});

const member = (id: string, name: string, teamId: MemberRecord['teamId']): MemberRecord => ({
  id,
  name,
  teamId,
  authUserId: null,
});

describe('assignableMembers', () => {
  const roster: MemberRecord[] = [
    member('m3', '한민석', 'edit'),
    member('m1', '가나다', 'edit'),
    member('m2', '촬영이', 'shoot'),
  ];

  it('같은 팀 구성원만 남는다', () => {
    expect(assignableMembers(roster, 'edit').map((row) => row.id)).toEqual(['m1', 'm3']);
  });

  it('이름 순으로 세운다 — 저장소가 준 순서를 화면 순서로 삼지 않는다', () => {
    expect(assignableMembers(roster, 'edit').map((row) => row.name)).toEqual(['가나다', '한민석']);
  });

  it('계정이 붙었는지는 보지 않는다 — 담당자는 시트 명부의 이름이다', () => {
    const linked = [...roster, { ...member('m4', '계정있음', 'edit'), authUserId: 'u1' }];
    expect(assignableMembers(linked, 'edit').map((row) => row.id)).toContain('m4');
  });

  it('입력 배열을 뒤집지 않는다', () => {
    const before = roster.map((row) => row.id);
    assignableMembers(roster, 'edit');
    expect(roster.map((row) => row.id)).toEqual(before);
  });

  it('그 팀에 아무도 없으면 빈 배열이다', () => {
    expect(assignableMembers(roster, 'marketing')).toEqual([]);
  });
});
