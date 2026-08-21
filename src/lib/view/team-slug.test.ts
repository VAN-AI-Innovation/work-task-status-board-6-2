import { describe, expect, it } from 'vitest';

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import {
  TEAM_LABELS,
  TEAM_SLUGS,
  teamLabel,
  toTeamKey,
  toTeamSlug,
} from '@/lib/view/team-slug';
import type { TeamKey } from '@/types/task';

describe('TEAM_SLUGS · TEAM_LABELS', () => {
  /**
   * **팀이 늘면 이 테스트가 먼저 깨져야 한다.** 표가 셋을 덮지 못하면 새 팀의 화면은
   * 404가 되고, 사이드바에도 줄이 생기지 않아 아무도 그 팀을 열 수 없다.
   */
  it('키가 `TEAM_KEYS`와 정확히 같다 — 두 표 다', () => {
    expect(Object.keys(TEAM_SLUGS).sort()).toEqual([...TEAM_KEYS].sort());
    expect(Object.keys(TEAM_LABELS).sort()).toEqual([...TEAM_KEYS].sort());
  });

  it('슬러그는 ASCII 소문자다 — 복사한 링크가 퍼센트 인코딩으로 깨지지 않아야 한다', () => {
    for (const slug of Object.values(TEAM_SLUGS)) {
      expect(slug).toMatch(/^[a-z]+$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  /**
   * 가운뎃점은 `·`(U+00B7)로 **시트 원문과 같다.** `progress-stats`의 KPI 라벨과
   * `weekly-report`의 팀 이름이 같은 글자를 쓰므로, 한 글자만 달라도 시트 대조가 깨진다.
   * (전체 이름을 여기에 다시 적지 않는다 — 그러면 이 파일이 두 번째 정의가 된다.)
   */
  it('촬영팀 이름의 가운뎃점이 U+00B7이다', () => {
    expect(TEAM_LABELS.shoot.charCodeAt(2)).toBe(0xb7);
    expect(TEAM_LABELS.shoot.startsWith('촬영')).toBe(true);
    expect(TEAM_LABELS.shoot.endsWith('기획팀')).toBe(true);
  });
});

describe('toTeamKey · toTeamSlug', () => {
  it('세 팀이 왕복한다', () => {
    for (const teamKey of TEAM_KEYS) {
      expect(toTeamKey(toTeamSlug(teamKey))).toBe(teamKey);
    }
  });

  it('모르는 값은 `null`이다 — 던지지 않는다', () => {
    expect(toTeamKey('nope')).toBeNull();
    expect(toTeamKey('')).toBeNull();
    expect(toTeamKey('편집팀')).toBeNull();
    // 프로토타입 오염 경로가 팀으로 해석되지 않는다
    expect(toTeamKey('constructor')).toBeNull();
    expect(toTeamKey('toString')).toBeNull();
  });

  /** 같은 화면의 URL이 두 모양이 되면 링크 공유가 갈라진다 (`UC-11`) */
  it('대문자는 받지 않는다 — 소문자 한 모양뿐이다', () => {
    expect(toTeamKey('EDIT')).toBeNull();
    expect(toTeamKey('Shoot')).toBeNull();
  });
});

describe('teamLabel', () => {
  it('한글 이름을 낸다 — 사이드바·표·차트가 같은 글자를 쓴다', () => {
    for (const teamKey of TEAM_KEYS) {
      expect(teamLabel(teamKey)).toBe(TEAM_LABELS[teamKey]);
      expect(teamLabel(teamKey)).not.toBe(TEAM_SLUGS[teamKey]);
    }
  });

  it('팀마다 이름이 다르다', () => {
    const labels = TEAM_KEYS.map((teamKey: TeamKey) => teamLabel(teamKey));
    expect(new Set(labels).size).toBe(TEAM_KEYS.length);
  });
});
