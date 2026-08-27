/**
 * 재는 것은 하나뿐이다 — **어드민 멤버 화면을 누가 여는가.**
 *
 * 세 값을 전부 못박는다. `ViewerRole`이 좁은 유니온이라 이 셋이 전수이고, 값이 하나
 * 늘어나면 `switch`가 컴파일에서 먼저 빨개진다.
 */

import { describe, expect, it } from 'vitest';

import { canManageMembers } from '@/lib/domain/member-admin';

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
