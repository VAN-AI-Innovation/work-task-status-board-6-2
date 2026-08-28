/**
 * 업무 패널이 **어떤 칸을 여는가.** 두 물음이 서로 반대 방향이라 한 파일에서 잰다 —
 * 담당자 지정은 위로 열리고(대표·팀장), 상태·진행률은 아래로 열린다(팀장·부원).
 */

import { describe, expect, it } from 'vitest';

import {
  assignableMembers,
  canAssignOwner,
  canCreateTask,
  canDeleteTask,
  canEditTaskDetails,
  creatableTeams,
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

describe('canEditTaskDetails', () => {
  /*
   * 예전 이름은 `canEditProgress`였고 대표·실장에게 **거짓**이었다 — 「전사를 보는 자리에
   * 그 폼이 있으면 남의 업무 숫자를 대신 적게 된다」가 근거였다. 그 판단을 뒤집는다:
   * 이제 이 폼은 진행률 칸이 아니라 **업무 내용을 고치는 자리**이고(마감·다음 조치·비고),
   * 회의 중에 그것을 고쳐 적는 사람이 대표·실장이다.
   *
   * 세 역할이 모두 참이므로 **역할은 더 이상 이 폼의 문이 아니다.** 문은 행 범위 하나뿐이고
   * (`taskEditable`), 그래서 이 함수는 「이 역할에게 이 폼이 존재하는가」만 남는다.
   */
  it('세 역할 모두 참이다 — 문은 역할이 아니라 행 범위다', () => {
    expect(canEditTaskDetails('member')).toBe(true);
    expect(canEditTaskDetails('lead')).toBe(true);
    expect(canEditTaskDetails('admin')).toBe(true);
  });
});

describe('canCreateTask · canDeleteTask', () => {
  it('대표·실장과 팀장은 만들고 지운다', () => {
    for (const role of ['admin', 'lead'] as const) {
      expect(canCreateTask(role)).toBe(true);
      expect(canDeleteTask(role)).toBe(true);
    }
  });

  it('부원은 둘 다 못 한다 — 나눠 주는 일도, 되돌릴 수 없는 일도 아니다', () => {
    expect(canCreateTask('member')).toBe(false);
    expect(canDeleteTask('member')).toBe(false);
  });
});

describe('creatableTeams', () => {
  it('대표·실장은 아무 팀에나 만든다', () => {
    expect(creatableTeams('admin', null)).toEqual(['edit', 'shoot', 'marketing']);
    expect(creatableTeams('admin', 'edit')).toEqual(['edit', 'shoot', 'marketing']);
  });

  it('팀장은 자기 팀 하나뿐이다 — 보는 범위가 전사여도 만드는 곳은 자기 팀이다', () => {
    expect(creatableTeams('lead', 'shoot')).toEqual(['shoot']);
  });

  it('팀을 모르는 팀장은 만들 곳이 없다 — 「모른다」를 「전부」로 접지 않는다', () => {
    expect(creatableTeams('lead', null)).toEqual([]);
  });

  it('부원은 만들 곳이 없다', () => {
    expect(creatableTeams('member', 'edit')).toEqual([]);
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
