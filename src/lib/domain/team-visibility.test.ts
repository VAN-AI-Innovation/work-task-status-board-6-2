import { describe, expect, it } from 'vitest';

import { canSeeTeam, visibleTeamKeys } from '@/lib/domain/team-visibility';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';

describe('visibleTeamKeys — 로그인했을 때', () => {
  it('대표·실장은 전부 본다', () => {
    expect(visibleTeamKeys('admin', null, true)).toEqual(TEAM_KEYS);
  });

  /*
   * 한동안 팀장에게도 세 탭을 열어 뒀다 (`ADR-040`). **지금은 자기 팀 하나다** — 팀 화면은
   * 「자기 팀을 관리하는 자리」이고 남의 팀 탭은 열어도 하나도 고칠 수 없다(`taskEditable`).
   * 열람 범위(`0012`)와 전사 대시보드는 그대로 두므로, 좁아지는 것은 탭 목록뿐이다.
   */
  it('팀장은 자기 팀 하나다 — 부원과 같은 규칙이다', () => {
    expect(visibleTeamKeys('lead', 'edit', true)).toEqual(['edit']);
    expect(visibleTeamKeys('lead', 'shoot', true)).toEqual(['shoot']);
  });

  it('팀을 모르는 팀장은 하나도 못 본다 — 「모른다」를 「전부」로 접지 않는다', () => {
    expect(visibleTeamKeys('lead', null, true)).toEqual([]);
  });

  it('부원도 자기 팀 하나만 본다 — 팀장과 같은 규칙이다', () => {
    expect(visibleTeamKeys('member', 'marketing', true)).toEqual(['marketing']);
  });

  /**
   * 팀이 없는 계정에 전부를 열면 「모른다」가 「전부」가 된다. 좁은 쪽으로 접는다 —
   * `viewer-scope.ts`의 null 가드와 같은 판단이다.
   */
  it('팀을 모르는 부원은 하나도 못 본다', () => {
    expect(visibleTeamKeys('member', null, true)).toEqual([]);
  });
});

/**
 * `ARCHITECTURE.md`「권한」: **데모에서는 범위가 갈리지 않는다.** 메모리 저장소에는
 * `profiles`도 `members`도 없어 「우리 팀」이라고 부를 대상이 없고, 여기서 좁히면 `.env`
 * 없이 클론한 사람이 팀 메뉴가 하나도 없는 화면을 본다.
 */
describe('visibleTeamKeys — 세션이 없을 때(데모·폴백)', () => {
  it('역할이 무엇이든 전부 본다', () => {
    expect(visibleTeamKeys('member', null, false)).toEqual(TEAM_KEYS);
    expect(visibleTeamKeys('lead', null, false)).toEqual(TEAM_KEYS);
    expect(visibleTeamKeys('admin', null, false)).toEqual(TEAM_KEYS);
  });
});

describe('canSeeTeam', () => {
  it('부원에게 자기 팀은 열리고 남의 팀은 닫힌다', () => {
    expect(canSeeTeam('member', 'edit', true, 'edit')).toBe(true);
    expect(canSeeTeam('member', 'edit', true, 'shoot')).toBe(false);
  });

  it('대표·실장에게는 전부 열린다', () => {
    expect(canSeeTeam('admin', null, true, 'shoot')).toBe(true);
  });

  /** 주소를 직접 쳐도 열리지 않는다 — 사이드바에서 감추는 것으로 갈음하지 않는다 */
  it('팀장에게 남의 팀 화면은 없다', () => {
    expect(canSeeTeam('lead', 'edit', true, 'edit')).toBe(true);
    expect(canSeeTeam('lead', 'edit', true, 'shoot')).toBe(false);
  });

  it('데모에서는 전부 열린다', () => {
    expect(canSeeTeam('member', null, false, 'shoot')).toBe(true);
  });
});
