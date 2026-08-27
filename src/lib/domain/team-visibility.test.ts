import { describe, expect, it } from 'vitest';

import { canSeeTeam, visibleTeamKeys } from '@/lib/domain/team-visibility';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';

describe('visibleTeamKeys — 로그인했을 때', () => {
  it('대표·실장은 전부 본다', () => {
    expect(visibleTeamKeys('admin', null, true)).toEqual(TEAM_KEYS);
  });

  it('팀장은 자기 팀 하나만 본다', () => {
    expect(visibleTeamKeys('lead', 'edit', true)).toEqual(['edit']);
  });

  it('부원도 자기 팀 하나만 본다 — 팀장과 같은 규칙이다', () => {
    expect(visibleTeamKeys('member', 'marketing', true)).toEqual(['marketing']);
  });

  /**
   * 팀이 없는 계정에 전부를 열면 「모른다」가 「전부」가 된다. 좁은 쪽으로 접는다 —
   * `viewer-scope.ts`의 null 가드와 같은 판단이다.
   */
  it('팀을 모르는 팀장·부원은 하나도 못 본다', () => {
    expect(visibleTeamKeys('lead', null, true)).toEqual([]);
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
  it('자기 팀은 열리고 남의 팀은 닫힌다', () => {
    expect(canSeeTeam('lead', 'edit', true, 'edit')).toBe(true);
    expect(canSeeTeam('lead', 'edit', true, 'shoot')).toBe(false);
  });

  it('대표·실장에게는 전부 열린다', () => {
    expect(canSeeTeam('admin', null, true, 'shoot')).toBe(true);
  });

  it('데모에서는 전부 열린다', () => {
    expect(canSeeTeam('member', null, false, 'shoot')).toBe(true);
  });
});
