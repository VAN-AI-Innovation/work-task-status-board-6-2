/**
 * 팀의 **URL 슬러그와 한글 이름을 정하는 유일한 곳**이다. `/teams/[teamSlug]`가 경로에서
 * 팀을 읽고, 사이드바·표·필터 바·차트가 여기서 이름을 가져다 쓴다.
 *
 * ## 슬러그는 ASCII다
 *
 * `PLAN.md`가 예시로 `/teams/편집팀`을 적어 뒀지만 **이 화면의 존재 이유가 링크 복사·공유**다
 * (`UC-11`). 한글 경로는 복사하면 `/teams/%ED%8E%B8%EC%A7%91%ED%8C%80`이 되어 사람이 읽을 수
 * 없고, 메신저·이슈 본문에서 줄이 깨진다. 팀 키(`edit`·`shoot`·`marketing`)는 이미 `TeamKey`로
 * 코드 전체에 있으므로 새 어휘를 만드는 것도 아니다.
 *
 * **소문자 한 모양만 받는다.** `EDIT`도 받아 주면 같은 화면의 URL이 두 개가 되고, 공유된
 * 두 링크가 같은 곳을 가리키는지 사람이 매번 확인해야 한다.
 *
 * ## 한글 이름은 여기 하나뿐이다
 *
 * 가운뎃점은 `·`(U+00B7)로 **시트 원문과 같다.** `progress-stats.ts`의 KPI 라벨,
 * `weekly-report.ts`의 팀 이름이 같은 글자를 쓴다 — 한 글자만 달라도 시트 대조가 깨진다.
 * 그래서 화면마다 손으로 적지 않고 이 표에서만 온다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { TeamKey } from '@/types/task';

/** `TeamKey`를 그대로 쓴다. 슬러그를 따로 지으면 외울 것이 하나 늘 뿐이다 */
export const TEAM_SLUGS: Readonly<Record<TeamKey, string>> = {
  edit: 'edit',
  shoot: 'shoot',
  marketing: 'marketing',
};

export const TEAM_LABELS: Readonly<Record<TeamKey, string>> = {
  edit: '편집팀',
  shoot: '촬영·기획팀',
  marketing: '마케팅·관리팀',
};

/**
 * `Map`으로 뒤집는다. 객체 인덱싱이면 `constructor`·`toString` 같은 프로토타입 키가
 * 팀으로 해석된다.
 */
const BY_SLUG = new Map<string, TeamKey>(TEAM_KEYS.map((teamKey) => [TEAM_SLUGS[teamKey], teamKey]));

/** 모르는 값은 `null`. 예외를 던지지 않는다 — 라우트가 `notFound()`로 옮긴다 */
export function toTeamKey(slug: string): TeamKey | null {
  return BY_SLUG.get(slug) ?? null;
}

export function toTeamSlug(teamKey: TeamKey): string {
  return TEAM_SLUGS[teamKey];
}

/** 사이드바·표·차트가 쓰는 한글 이름 */
export function teamLabel(teamKey: TeamKey): string {
  return TEAM_LABELS[teamKey];
}
