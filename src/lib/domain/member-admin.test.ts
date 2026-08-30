/**
 * 재는 것은 둘이다 — **누구의 상세를 열 수 있는가**와 **누가 직책을 바꾸는가.**
 *
 * 조직도를 「보는가」는 더 이상 여기서 재지 않는다. 세 역할이 다 보기 때문이다 (`0016`) —
 * 갈리는 것은 카드를 눌렀을 때 패널이 열리느냐다.
 *
 * `ViewerRole`이 좁은 유니온이라 세 값이 전수이고, 값이 하나 늘어나면 `switch`가
 * 컴파일에서 먼저 빨개진다.
 */

import { describe, expect, it } from 'vitest';

import { canManageMembers, canOpenMemberPanel } from '@/lib/domain/member-admin';

describe('canManageMembers', () => {
  it('대표·실장만 참이다', () => {
    expect(canManageMembers('admin')).toBe(true);
  });

  it('팀장은 거짓이다 — 「팀원 요청」과 보는 범위가 다르다', () => {
    // `set_role`은 `my_role() = 'admin'`일 때만 통과한다 (`0005` 4-7)
    expect(canManageMembers('lead')).toBe(false);
  });

  it('부원은 거짓이다', () => {
    expect(canManageMembers('member')).toBe(false);
  });
});

/**
 * 패널이 열리는 범위. **셋이 전부 다르다** — 어드민은 전사, 팀장은 자기 팀, 부원은 자기
 * 자신뿐이다. 부원 갈래가 이 파일에서 가장 좁고, 그것이 요점이다.
 */
describe('canOpenMemberPanel', () => {
  const ME = { userId: 'u-me', teamId: 'edit' as const };
  const TEAMMATE = { userId: 'u-mate', teamId: 'edit' as const };
  const STRANGER = { userId: 'u-other', teamId: 'shoot' as const };

  it('대표·실장은 아무나 연다', () => {
    expect(canOpenMemberPanel('admin', ME, STRANGER)).toBe(true);
  });

  it('팀장은 자기 팀만 연다', () => {
    expect(canOpenMemberPanel('lead', ME, TEAMMATE)).toBe(true);
    expect(canOpenMemberPanel('lead', ME, STRANGER)).toBe(false);
  });

  it('부원은 자기 자신만 연다 — 같은 팀 사람도 못 연다', () => {
    expect(canOpenMemberPanel('member', ME, ME)).toBe(true);
    expect(canOpenMemberPanel('member', ME, TEAMMATE)).toBe(false);
    expect(canOpenMemberPanel('member', ME, STRANGER)).toBe(false);
  });

  it('계정 없는 명부 행은 누구의 「자신」도 아니다', () => {
    // `member_directory()`가 full outer join이라 `userId`가 null인 행이 섞여 있다
    expect(canOpenMemberPanel('member', ME, { userId: null, teamId: 'edit' })).toBe(false);
  });

  it('「모른다」를 「전부」로 접지 않는다 — 팀·계정을 모르면 거짓이다', () => {
    expect(canOpenMemberPanel('lead', { userId: 'u-me', teamId: null }, STRANGER)).toBe(false);
    expect(canOpenMemberPanel('member', { userId: null, teamId: 'edit' }, TEAMMATE)).toBe(false);
  });
});
