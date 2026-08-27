/**
 * 재는 것은 하나뿐이다 — **어드민 멤버 화면을 누가 여는가.**
 *
 * 세 값을 전부 못박는다. `ViewerRole`이 좁은 유니온이라 이 셋이 전수이고, 값이 하나
 * 늘어나면 `switch`가 컴파일에서 먼저 빨개진다.
 */

import { describe, expect, it } from 'vitest';

import { canManageMembers, canViewMembers } from '@/lib/domain/member-admin';

describe('canManageMembers', () => {
  it('대표·실장만 참이다', () => {
    expect(canManageMembers('admin')).toBe(true);
  });

  it('팀장은 거짓이다 — 「팀원 요청」과 보는 범위가 다르다', () => {
    // `member_directory()`는 `my_role() = 'admin'`일 때만 행을 낸다 (`0005` 4-2)
    expect(canManageMembers('lead')).toBe(false);
  });

  it('부원은 거짓이다', () => {
    expect(canManageMembers('member')).toBe(false);
  });
});

/**
 * 보는 것과 바꾸는 것이 갈린 자리. 팀장은 조직도를 보되 직책을 바꾸지 못한다 —
 * 근거는 DB다 (`member_directory()`는 lead를 받고 `set_role`은 admin만 받는다).
 */
describe('canViewMembers', () => {
  it('대표·실장은 본다', () => {
    expect(canViewMembers('admin')).toBe(true);
  });

  it('팀장도 본다 — 여기서 `canManageMembers`와 갈린다', () => {
    expect(canViewMembers('lead')).toBe(true);
    expect(canManageMembers('lead')).toBe(false);
  });

  it('부원은 못 본다', () => {
    expect(canViewMembers('member')).toBe(false);
  });
});
