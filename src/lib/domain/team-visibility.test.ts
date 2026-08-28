import { describe, expect, it } from 'vitest';

import { canSeeTeam, visibleTeamKeys } from '@/lib/domain/team-visibility';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';

describe('visibleTeamKeys — 로그인했을 때', () => {
  it('대표·실장은 전부 본다', () => {
    expect(visibleTeamKeys('admin', null, true)).toEqual(TEAM_KEYS);
  });

  /*
   * **팀장도 전부 본다** (`0012_lead_org_read.sql`). 열람 범위가 전사로 넓어졌으므로
   * (`viewer-scope.ts`) 팀 메뉴만 하나로 두면 사이드바에 없는 화면의 데이터를 대시보드에서
   * 보는 상태가 된다 — 그 화면은 「왜 이건 보이고 저건 못 여는가」를 설명하지 못한다.
   */
  it('팀장도 전부 본다 — 어드민과 같은 현황판을 본다', () => {
    expect(visibleTeamKeys('lead', 'edit', true)).toEqual(TEAM_KEYS);
    expect(visibleTeamKeys('lead', null, true)).toEqual(TEAM_KEYS);
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

  it('대표·실장·팀장에게는 전부 열린다', () => {
    expect(canSeeTeam('admin', null, true, 'shoot')).toBe(true);
    expect(canSeeTeam('lead', 'edit', true, 'shoot')).toBe(true);
  });

  it('데모에서는 전부 열린다', () => {
    expect(canSeeTeam('member', null, false, 'shoot')).toBe(true);
  });
});
