/**
 * 명부 행 목록을 **팀 → 리더 → 부원**의 트리로 세운다 (T11 · 어드민 멤버 관리).
 *
 * 입력은 `member_directory()`가 내는 행이다 (`0005_signup_approval.sql` 4-2). 그 함수는
 * `profiles`와 `members`를 **full outer join**해서 낸다 — 그래서 계정만 있고 명부에 안 붙은
 * 사람(`memberId === null`)과 명부에만 있고 계정이 없는 사람(`userId === null`)이 **둘 다**
 * 정상 입력이다. 둘 다 null인 행은 나오지 않는다.
 *
 * ## 트리는 SQL이 만들지 않는다
 *
 * 함수는 정렬된 평면 행만 준다. 묶는 것은 여기다 — 집계·판정은 `lib/domain/`의 JS 순수
 * 함수로 한다는 규칙 그대로다 (`ADR-006`). 저장소·환경변수·시계를 보지 않는다. 지금은 시각을
 * 쓸 일이 없고, 「최근 가입순」이 필요해지면 `now`를 **인자로 받는다** (CLAUDE.md CRITICAL).
 *
 * ## 빈 팀을 지우지 않는다
 *
 * 사람이 하나도 없는 팀도 가지로 남는다. 지우면 화면에서 **「그 팀이 없다」와 「그 팀에 사람이
 * 없다」가 같아 보인다** — 알림 패널이 0건 묶음을 남기는 것과 같은 이유다 (`UI_GUIDE.md`).
 * 팀 순서도 행이 오는 순서가 아니라 `TEAM_LABELS`의 키 순서다: DB의 `order by`가 바뀌면
 * 화면의 팀 순서가 조용히 따라 바뀌는데, 그 변화는 아무도 알아채지 못한다.
 *
 * ## `admin`은 팀 아래 놓지 않는다
 *
 * `profiles.team_id`는 `admin`에게 null일 수 있고(`0003_auth_rls.sql`), 무엇보다 전사를 보는
 * 사람이라 팀 가지에 넣으면 **없는 상하관계가 생긴다.** `unassigned`로 보낸다. 팀을 못 붙인
 * 대기 계정도 같은 자리로 간다 — 트리거가 `user_metadata`의 팀을 `teams`에 실재할 때만
 * 넣기 때문에(`0005` 3절) 실제로 생기는 상태다.
 *
 * ## 대기·반려도 트리에 남는다
 *
 * `status`를 그대로 실어 넘긴다. 여기서 걸러 버리면 어드민이 **「승인을 기다리는 사람이
 * 있다」는 사실을 이 화면에서 못 본다.** 흐리게 그릴지 배지를 붙일지는 화면이 정한다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { TeamKey } from '@/types/task';

/** `profiles.status`. 계정이 없는 명부 행은 `null`이다 */
export type MemberStatus = 'pending' | 'active' | 'rejected';

/** `member_directory()` 한 행. 카멜케이스로 옮긴 것 말고는 그대로다 */
export interface DirectoryRow {
  /** `auth.users.id`. 계정이 없는 명부 구성원은 null */
  userId: string | null;
  /** `members.id`. 계정만 있고 명부에 안 붙은 사람은 null */
  memberId: string | null;
  /** 가입할 때 본인이 적은 이름 */
  displayName: string | null;
  /** `members.name` — 시트에서 온 이름 */
  memberName: string | null;
  email: string | null;
  role: ViewerRole | null;
  status: MemberStatus | null;
  teamId: TeamKey | null;
}

/**
 * 한 사람. 입력 행을 **버리지 않고** 이름 한 칸을 더한 것이다 — 화면이 `displayName`과
 * `memberName` 중 무엇을 그릴지 매번 고르면 목록마다 다른 이름이 서고, 정렬 기준도 함께
 * 갈린다. 둘 다 없으면 `null`이다: 「(이름 없음)」 같은 문구를 여기서 지어내지 않는다.
 */
export interface MemberNode extends DirectoryRow {
  name: string | null;
}

export interface TeamBranch {
  teamId: TeamKey;
  /**
   * **배열인 것이 의도다.** 한 팀에 리더가 둘일 수 있는지 지금 규칙이 정하지 않았고, 배열이면
   * 둘이 생겨도 화면이 깨지지 않는다. `leads.length === 0`이면 화면이 「리더 없음」이라고
   * 말할 수 있다 — 그것도 사실이다.
   */
  leads: MemberNode[];
  members: MemberNode[];
}

export interface MemberTree {
  /** 언제나 `TEAM_KEYS` 전부. 사람이 없는 팀도 빈 가지로 남는다 (머리말) */
  teams: TeamBranch[];
  /** 팀이 없는 사람 — `admin`, `team_id`가 null인 대기 계정 */
  unassigned: MemberNode[];
}

function toNode(row: DirectoryRow): MemberNode {
  return { ...row, name: row.displayName ?? row.memberName };
}

/**
 * 같은 두 행을 갈라 세우는 마지막 기준. 행 하나에는 `userId`·`memberId` 중 적어도 하나가
 * 있으므로(full outer join) 서로 다른 두 행의 키는 다르다.
 */
function stableKey(node: MemberNode): string {
  return `${node.userId ?? ''}:${node.memberId ?? ''}`;
}

/** 이름 없는 사람을 앞에 세우지 않는다 — 목록의 첫 줄은 읽히는 이름이어야 한다 */
function compareNodes(a: MemberNode, b: MemberNode): number {
  if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
  const byName = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
  return byName !== 0 ? byName : stableKey(a).localeCompare(stableKey(b));
}

/**
 * 입력 배열을 고치지 않는다 — 정렬은 새로 만든 배열에서 한다. 같은 행을 순서만 섞어 넣어도
 * 같은 트리가 나온다.
 */
export function buildMemberTree(rows: readonly DirectoryRow[]): MemberTree {
  const branches = new Map<TeamKey, TeamBranch>(
    TEAM_KEYS.map((teamKey) => [teamKey, { teamId: teamKey, leads: [], members: [] }])
  );
  const unassigned: MemberNode[] = [];

  for (const row of rows) {
    const node = toNode(row);
    // `admin`은 팀 가지에 넣지 않는다 (머리말). 모르는 팀 키도 여기서 걸러진다 — 가지가 없다
    const branch = node.role === 'admin' || node.teamId === null ? undefined : branches.get(node.teamId);

    if (branch === undefined) {
      unassigned.push(node);
    } else if (node.role === 'lead') {
      branch.leads.push(node);
    } else {
      branch.members.push(node);
    }
  }

  for (const branch of branches.values()) {
    branch.leads.sort(compareNodes);
    branch.members.sort(compareNodes);
  }
  unassigned.sort(compareNodes);

  return { teams: [...branches.values()], unassigned };
}
