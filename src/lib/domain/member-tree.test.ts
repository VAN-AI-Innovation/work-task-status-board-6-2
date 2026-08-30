import { describe, expect, it } from 'vitest';

import { buildMemberTree, type DirectoryRow } from '@/lib/domain/member-tree';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';

/** 행 하나를 만든다. 기본은 「계정이 붙은 편집팀 부원」이고 필요한 칸만 덮어쓴다 */
function row(overrides: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    userId: 'u-1',
    memberId: 'm-1',
    displayName: '가나',
    memberName: '가나',
    email: 'a@example.com',
    role: 'member',
    status: 'active',
    teamId: 'edit',
    ...overrides,
  };
}

function namesOf(nodes: readonly { name: string | null }[]): (string | null)[] {
  return nodes.map((node) => node.name);
}

describe('buildMemberTree', () => {
  it('빈 입력이면 팀 셋이 전부 빈 가지로 남는다', () => {
    const tree = buildMemberTree([]);

    expect(tree.teams.map((branch) => branch.teamId)).toEqual([...TEAM_KEYS]);
    expect(tree.teams.every((branch) => branch.leads.length === 0)).toBe(true);
    expect(tree.teams.every((branch) => branch.members.length === 0)).toBe(true);
    expect(tree.unassigned).toEqual([]);
  });

  it('사람이 있는 팀만 남기지 않는다 — 빈 팀도 가지로 선다', () => {
    const tree = buildMemberTree([row({ teamId: 'edit' })]);

    // 「그 팀이 없다」와 「그 팀에 사람이 없다」가 화면에서 같아 보이면 안 된다
    expect(tree.teams).toHaveLength(TEAM_KEYS.length);
    const shoot = tree.teams.find((branch) => branch.teamId === 'shoot');
    expect(shoot).toEqual({ teamId: 'shoot', leads: [], members: [] });
  });

  it('팀 순서는 행이 오는 순서가 아니라 TEAM_KEYS 순서다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', teamId: 'marketing' }),
      row({ userId: 'u-2', memberId: 'm-2', teamId: 'shoot' }),
      row({ userId: 'u-3', memberId: 'm-3', teamId: 'edit' }),
    ]);

    expect(tree.teams.map((branch) => branch.teamId)).toEqual(['edit', 'shoot', 'marketing']);
  });

  it('lead는 leads로, 그 밖은 members로 간다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', role: 'lead', displayName: '리더', memberName: '리더' }),
      row({ userId: 'u-2', memberId: 'm-2', role: 'member', displayName: '부원', memberName: '부원' }),
    ]);

    const edit = tree.teams[0];
    expect(namesOf(edit.leads)).toEqual(['리더']);
    expect(namesOf(edit.members)).toEqual(['부원']);
  });

  it('리더가 없는 팀은 leads가 빈 배열이다 — 화면이 「리더 없음」이라고 말할 수 있어야 한다', () => {
    const tree = buildMemberTree([row({ role: 'member' })]);

    const edit = tree.teams[0];
    expect(edit.leads).toEqual([]);
    expect(edit.members).toHaveLength(1);
  });

  it('한 팀에 리더가 둘이어도 깨지지 않는다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', role: 'lead', displayName: '나', memberName: '나' }),
      row({ userId: 'u-2', memberId: 'm-2', role: 'lead', displayName: '다', memberName: '다' }),
    ]);

    expect(namesOf(tree.teams[0].leads)).toEqual(['나', '다']);
  });

  it('admin은 팀이 있어도 어느 가지에도 들어가지 않는다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', role: 'admin', teamId: 'edit', displayName: '대표' }),
    ]);

    expect(tree.teams.every((branch) => branch.leads.length + branch.members.length === 0)).toBe(true);
    expect(namesOf(tree.unassigned)).toEqual(['대표']);
    // 원래 팀 값은 지우지 않는다 — 가지를 안 줬을 뿐이다
    expect(tree.unassigned[0].teamId).toBe('edit');
  });

  it('team_id가 null인 대기 계정은 unassigned로 간다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-9', memberId: null, role: 'member', status: 'pending', teamId: null, displayName: '신규' }),
    ]);

    expect(namesOf(tree.unassigned)).toEqual(['신규']);
    expect(tree.unassigned[0].status).toBe('pending');
  });

  it('대기·반려 계정도 트리에 남고 상태를 그대로 싣는다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: null, status: 'pending', displayName: '대기' }),
      row({ userId: 'u-2', memberId: null, status: 'rejected', displayName: '반려' }),
      row({ userId: 'u-3', memberId: 'm-3', status: 'active', displayName: '정상' }),
    ]);

    // 이름순(대기 · 반려 · 정상)이라 상태 순서가 아니다 — 그래도 셋 다 남는다
    expect(tree.teams[0].members.map((node) => node.status)).toEqual(['pending', 'rejected', 'active']);
  });

  it('계정이 없는 명부 행(role null)은 부원 자리에 선다', () => {
    const tree = buildMemberTree([
      row({ userId: null, memberId: 'm-7', displayName: null, memberName: '시트이름', email: null, role: null, status: null }),
    ]);

    const edit = tree.teams[0];
    expect(edit.leads).toEqual([]);
    expect(namesOf(edit.members)).toEqual(['시트이름']);
    expect(edit.members[0].role).toBeNull();
    expect(edit.members[0].status).toBeNull();
  });

  it('name은 displayName을 먼저 보고, 없으면 memberName이다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', displayName: '본인이름', memberName: '시트이름' }),
      row({ userId: 'u-2', memberId: 'm-2', displayName: null, memberName: '시트만' }),
    ]);

    expect(namesOf(tree.teams[0].members)).toEqual(['본인이름', '시트만']);
  });

  it('이름이 둘 다 없으면 null이고 목록의 끝에 선다', () => {
    const tree = buildMemberTree([
      row({ userId: 'u-1', memberId: 'm-1', displayName: null, memberName: null }),
      row({ userId: 'u-2', memberId: 'm-2', displayName: '하', memberName: '하' }),
      row({ userId: 'u-3', memberId: 'm-3', displayName: '가', memberName: '가' }),
    ]);

    expect(namesOf(tree.teams[0].members)).toEqual(['가', '하', null]);
  });

  it('입력 순서를 섞어도 같은 트리가 나온다', () => {
    const rows: DirectoryRow[] = [
      row({ userId: 'u-1', memberId: 'm-1', displayName: '다', memberName: '다', role: 'lead' }),
      row({ userId: 'u-2', memberId: 'm-2', displayName: '가', memberName: '가', teamId: 'shoot' }),
      row({ userId: 'u-3', memberId: 'm-3', displayName: '나', memberName: '나', role: 'admin' }),
      row({ userId: 'u-4', memberId: 'm-4', displayName: '라', memberName: '라' }),
      row({ userId: 'u-5', memberId: null, displayName: null, memberName: null, teamId: null }),
    ];

    const forward = buildMemberTree(rows);
    const backward = buildMemberTree([...rows].reverse());
    const shuffled = buildMemberTree([rows[2], rows[4], rows[0], rows[3], rows[1]]);

    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it('이름이 같으면 안정 키로 갈라 세운다 — 순서를 섞어도 같다', () => {
    const rows: DirectoryRow[] = [
      row({ userId: 'u-b', memberId: 'm-b', displayName: '동명', memberName: '동명' }),
      row({ userId: 'u-a', memberId: 'm-a', displayName: '동명', memberName: '동명' }),
    ];

    const forward = buildMemberTree(rows);
    const backward = buildMemberTree([...rows].reverse());

    expect(forward.teams[0].members.map((node) => node.userId)).toEqual(['u-a', 'u-b']);
    expect(backward).toEqual(forward);
  });

  it('입력 배열을 고치지 않는다', () => {
    const rows: DirectoryRow[] = [
      row({ userId: 'u-2', memberId: 'm-2', displayName: '하', memberName: '하' }),
      row({ userId: 'u-1', memberId: 'm-1', displayName: '가', memberName: '가' }),
    ];
    const snapshot = structuredClone(rows);

    buildMemberTree(rows);

    expect(rows).toEqual(snapshot);
    expect(rows[0].userId).toBe('u-2');
  });
});
