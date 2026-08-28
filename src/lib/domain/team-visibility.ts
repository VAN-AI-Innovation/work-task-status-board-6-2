/**
 * **어느 팀 화면이 이 사람에게 존재하는가.** 사이드바가 항목을 고르고, 팀 화면이
 * `notFound()`를 낼지 정하는 데 같은 값을 쓴다.
 *
 * 판정이라 `lib/domain`에 있다 (`ADR-006`). 화면 둘이 각자 판단하면 사이드바에서는 사라졌는데
 * 주소로는 열리는(또는 그 반대인) 날이 온다.
 *
 * ## 세는 규칙과 보이는 규칙은 다르다
 *
 * 실제 데이터 범위는 `viewer-scope.ts`와 RLS가 이미 진다 — 팀장이 남의 팀 주소를 쳐도
 * 업무는 한 건도 내려오지 않는다. **이 파일이 없애는 것은 「빈 화면」이지 유출이 아니다.**
 * 그래도 필요한 이유는 둘이다: 사이드바에 누를 수 없는 항목이 셋 서 있으면 그것이 곧
 * 「내 것이 아닌 곳」을 매번 확인하게 만들고, 빈 팀 화면은 「데이터가 없다」와 구분되지 않는다.
 *
 * ## 세션이 없으면 좁히지 않는다
 *
 * `ARCHITECTURE.md`「권한」이 못박은 규칙이다 — **데모에서는 범위가 갈리지 않는다.**
 * 메모리 저장소에는 `profiles`도 `members`도 없어 「우리 팀」이라고 부를 대상이 없고,
 * 여기서 좁히면 `.env` 없이 클론한 심사자가 **팀 메뉴가 하나도 없는 화면**을 본다
 * (`PRD.md` 성공 기준 1번). 그래서 `hasSession`이 인자다 — 역할만으로는 그 갈래를 못 가른다.
 *
 * ## 팀을 모르면 하나도 열지 않는다
 *
 * 로그인은 했는데 `teamId`가 null인 **부원**에게 전부를 열면 「모른다」가 「전부」가 된다.
 * 좁은 쪽으로 접는다 — `viewer-scope.ts`의 null 가드와 같은 판단이고, 그쪽도 같은 이유로
 * `viewer.teamId !== null`을 판정보다 **먼저** 세운다.
 *
 * ## 팀장은 전 팀 화면을 갖는다
 *
 * `0012_lead_org_read.sql`이 팀장의 **열람 범위**를 전사로 넓혔다 (`viewer-scope.ts`).
 * 여기를 따라 넓히지 않으면 팀장의 대시보드에는 세 팀의 숫자가 다 뜨는데 사이드바에는 팀
 * 메뉴가 하나뿐인 화면이 된다 — 그 화면은 「왜 이건 보이고 저건 못 여는가」를 설명하지
 * 못한다. **좁히는 것은 여전히 `taskEditable`이 진다**: 남의 팀 화면을 열어도 고칠 수 있는
 * 업무는 하나도 없다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { TeamKey } from '@/types/task';

export function visibleTeamKeys(
  role: ViewerRole,
  /** `profiles.team_id`. 대표·실장은 null일 수 있다 */
  teamId: TeamKey | null,
  /** 로그인한 세션이 있는가. 없으면 데모·폴백이라 좁히지 않는다 */
  hasSession: boolean
): readonly TeamKey[] {
  if (!hasSession) return TEAM_KEYS;
  if (role === 'admin' || role === 'lead') return TEAM_KEYS;

  return teamId === null ? [] : [teamId];
}

export function canSeeTeam(
  role: ViewerRole,
  teamId: TeamKey | null,
  hasSession: boolean,
  target: TeamKey
): boolean {
  return visibleTeamKeys(role, teamId, hasSession).includes(target);
}
