/**
 * 쿠키 세션을 **열람자 하나**로 해석한다 (`Viewer`). T8이 지금까지 만든 것은 DB 쪽 절반
 * (정책·계정·구성원)이고, 이 파일이 그 절반을 앱에 잇는다.
 *
 * 세 가지를 여기서 못박는다.
 *
 * 1. **`auth.getUser()`만 쓴다.** 쿠키의 JWT를 **디코드만** 하는 세션 조회 API가 따로 있는데,
 *    그쪽은 서명을 서버에서 확인하지 않는다 — 쿠키를 손으로 만든 사람이 `admin`이 될 수 있다.
 *    `getUser()`는 Auth 서버에 물어본다. 이 프로젝트에서 권한 판정의 출발점이므로 여기서
 *    틀리면 아래 전부가 무의미하다. **그 API 이름은 이 파일에 한 번도 나오지 않는다** —
 *    `viewer-session.test.ts`의 가짜 클라이언트가 그 이름에 덫을 놓아 불리면 실패시키고,
 *    이 파일에 이름이 없다는 것은 grep이 지킨다.
 * 2. **역할은 JWT가 아니라 `profiles`에서 온다.** JWT의 `user_metadata`는 사용자가 고칠 수
 *    있는 자리다. RLS의 `my_role()`(`0003_auth_rls.sql`)도 `profiles`를 보므로, 앱과 DB가
 *    같은 표를 봐야 화면과 데이터가 어긋나지 않는다.
 * 3. **`profiles.status`가 `'active'`가 아니면 `Viewer`가 서지 않는다** (T11 ·
 *    `0005_signup_approval.sql`). DB에서는 `my_role()`·`my_team()`·`my_member_id()` 셋이
 *    같은 게이트를 져서 정책이 전부 막고, 앱은 여기서 같은 사실을 말해 화면이 「부원인데
 *    아무것도 없다」가 아니라 「승인 대기 중」이라고 말할 수 있게 한다.
 *
 * `client`를 **인자로 받는다.** 안에서 만들면 전 갈래를 손으로 지은 가짜로 잴 수 없고,
 * 이 파일의 규율은 `viewer-role.ts`와 같다 — **테스트로 지켜지지 않으면 지켜지지 않는다.**
 *
 * **던지지 않는다.** 어떤 실패도 `anonymous`나 `no_profile`로 접는다. 세션 해석이 예외를
 * 위로 던지면 만료된 토큰 하나가 화면을 백지로 만든다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { SessionAccount, Viewer } from '@/types/auth';
import type { TeamKey } from '@/types/task';

/**
 * 승인을 기다리거나 거절된 계정 (T11). `profiles` 행은 **있고** 역할도 알려진 값인데
 * `status`가 `'active'`가 아니다 — `no_profile`과 뭉개지 않는 이유가 그것이다: 「프로필이
 * 없다」와 「행은 있는데 대기 중이다」는 다른 사고이고 화면이 할 말도 다르다.
 *
 * `teamId`·`displayName`을 싣는 것은 대기 화면이 「마케팅·관리팀 합류를 요청했습니다」라고
 * 그 사람의 이름을 부르며 말해야 하기 때문이다. 둘 다 `profiles`를 읽는 **같은 쿼리**에
 * 컬럼만 더해 얻는다 — 상태를 알려고 왕복을 하나 더 돌지 않는다.
 */
interface WaitingOutcome {
  userId: string;
  email: string;
  /** `profiles.team_id`. 합류를 요청한 팀이며, 알 수 없는 값이면 null이다 */
  teamId: TeamKey | null;
  /** `profiles.display_name`. 아직 안 적었으면 null */
  displayName: string | null;
}

export type SessionOutcome =
  | { status: 'anonymous' }
  /** 로그인은 됐는데 `profiles` 행이 없다. 「미인증」과 다르다 — 로그아웃 버튼이 필요하다 */
  | { status: 'no_profile'; userId: string; email: string }
  | ({ status: 'pending' } & WaitingOutcome)
  | ({ status: 'rejected' } & WaitingOutcome)
  | { status: 'ok'; viewer: Viewer };

const KNOWN_ROLES: readonly ViewerRole[] = ['admin', 'lead', 'member'];
const KNOWN_TEAMS: readonly TeamKey[] = ['edit', 'shoot', 'marketing'];

/**
 * 알 수 없는 문자열을 `ViewerRole`로 흘려보내지 않는다. 흘려보내면 `viewer-scope.ts`의
 * `switch`가 어느 갈래에도 걸리지 않아 **「아무것도 안 보임」**이 되는데, 그 원인은 화면에서
 * 영영 드러나지 않는다. 여기서 `no_profile`로 세워야 사용자가 「프로필이 없다」를 본다.
 */
function toRole(value: unknown): ViewerRole | null {
  return KNOWN_ROLES.find((role) => role === value) ?? null;
}

/** 값은 버리고 역할은 살린다 — 팀이 이상한 것과 로그인이 이상한 것은 다른 사고다 */
function toTeamKey(value: unknown): TeamKey | null {
  return KNOWN_TEAMS.find((team) => team === value) ?? null;
}

/** 빈 문자열은 이름이 아니다 — 화면이 부를 이름이 없으면 null이어야 문구가 갈린다 */
function toDisplayName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function resolveSession(client: SupabaseClient): Promise<SessionOutcome> {
  let userId: string;
  let email: string;

  try {
    const { data, error } = await client.auth.getUser();
    const user = data?.user;
    if (error || !user) return { status: 'anonymous' };
    userId = user.id;
    // 전화 로그인 계정에는 email이 없다. 빈 문자열로 두고 던지지 않는다.
    email = user.email ?? '';
  } catch {
    return { status: 'anonymous' };
  }

  const anonymousProfile: SessionOutcome = { status: 'no_profile', userId, email };

  let role: ViewerRole | null;
  let teamId: TeamKey | null;
  let status: unknown;
  let displayName: string | null;
  try {
    // 자기 행만 읽는다 (`profiles_select_self`). 남의 역할을 읽을 이유가 없다.
    // **한 번에 넷을 읽는다** — 상태를 알려고 왕복을 더 돌지 않는다 (T11).
    const { data, error } = await client
      .from('profiles')
      .select('role, team_id, status, display_name')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return anonymousProfile;
    role = toRole(data.role);
    teamId = toTeamKey(data.team_id);
    status = data.status;
    displayName = toDisplayName(data.display_name);
  } catch {
    return anonymousProfile;
  }

  if (!role) return anonymousProfile;

  /*
   * 상태 축 (T11 · `0005_signup_approval.sql`). **모르는 값은 가장 좁은 쪽으로 접는다** —
   * `'active'`가 아닌 것을 `ok`로 흘려보내면, 나중에 `'suspended'` 같은 값을 더하고 이
   * 파일을 고치지 않은 날 정지된 계정이 그대로 통과한다. `toRole`이 모르는 역할을
   * `no_profile`로 접는 것과 같은 판단이다.
   *
   * 여기서 `members`를 읽지 않는 것도 의도다 — 승인 전에는 붙은 구성원이 없어서 왕복
   * 한 번이 순수한 낭비다.
   */
  if (status !== 'active') {
    const waiting = { userId, email, teamId, displayName };
    return status === 'rejected'
      ? { status: 'rejected', ...waiting }
      : { status: 'pending', ...waiting };
  }

  let memberId: string | null = null;
  /** 같은 행의 이름. 공동 담당 판정이 이름으로 이뤄진다 (`viewer-scope.ts`) */
  let memberName: string | null = null;
  try {
    // **`my_member_id()`·`my_member_name()`과 같은 결정 규칙이어야 한다** — `order by id
    // limit 1` (`0003_auth_rls.sql`·`0013_task_authoring.sql`). 다르면 화면과 DB가 서로
    // 다른 구성원을 「나」로 본다.
    const { data, error } = await client
      .from('members')
      .select('id,name')
      .eq('auth_user_id', userId)
      .order('id')
      .limit(1)
      .maybeSingle();
    // 붙은 행이 없으면 `unknown_owner`다 (결정 D). `ok`이긴 하고, `member` 범위에서 빠진다.
    if (!error && data) {
      memberId = data.id as string;
      // **둘을 짝으로 채운다.** 이름만 있고 id가 없는(또는 그 반대인) 「나」는 없다
      memberName = (data.name as string | null) ?? null;
    }
  } catch {
    memberId = null;
    memberName = null;
  }

  return { status: 'ok', viewer: { userId, email, role, teamId, memberId, memberName } };
}

/**
 * 상단 바가 그릴 것만 뽑는다. 세션이 없으면 `null`이고, 그때 화면은 역할 전환(`?as=`)을
 * 그대로 보여 준다 (`ADR-026` — 세션이 없을 때만 URL이 역할을 정한다).
 *
 * **`no_profile`·`pending`·`rejected`도 계정이다.** 로그인은 됐으므로 로그아웃 버튼이
 * 필요하고, 그것이 없으면 그 계정은 아무것도 못 보는 화면에 갇힌다 (step 10에서 남겨 둔
 * 자리). 셋 다 `role`이 `null`이다 — 역할을 모르는 것과 역할이 아직 서지 않은 것을 화면은
 * 같은 방식으로 그린다.
 */
export function toAccount(outcome: SessionOutcome): SessionAccount | null {
  switch (outcome.status) {
    case 'anonymous':
      return null;
    case 'no_profile':
    case 'pending':
    case 'rejected':
      return { email: outcome.email, role: null };
    case 'ok':
      return { email: outcome.viewer.email, role: outcome.viewer.role };
  }
}
