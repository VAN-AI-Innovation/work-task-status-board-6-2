/**
 * 시트의 담당자 **이름**을 `members` 행에 잇는 해석 계층 (`TICKETS.md` T8 범위 In).
 * 업로드를 확정할 때 한 번 돌고, 결과가 `tasks.owner_member_id`다.
 *
 * ### 규율은 「최대한 붙인다」가 아니라 「확실할 때만 붙인다」
 *
 * 시트 담당자는 자유 입력 문자열이라 동명이인·오타·공백·직함이 섞인다. 이름 매칭은 원래
 * 신뢰할 수 없고, 그런데도 **`viewer-scope.ts`는 여기서 붙인 id 하나만 보고 `member` 범위를
 * 정한다** — 잘못 붙은 한 건은 남의 업무를 내 것으로 만들고 그것이 곧 권한 사고다.
 * 그래서 조금이라도 갈리면 붙이지 않고 `null`로 둔다 (`unknown_owner`, `PLAN.md`
 * 「T8 착수 시 확정」 결정 D). 안 붙은 것은 `admin`·`lead`에게 그대로 보인다.
 *
 * 매칭 규칙은 다섯 줄이 전부다.
 *
 * 1. **같은 팀 안에서만** 본다. 팀을 넘나들면 동명이인이 곧바로 사고다.
 * 2. 비교 키는 이름을 `normalizeOwnerName`으로 다듬은 값이다.
 * 3. 이름이 없는 행(`null`·공백뿐)은 붙이지도, `unresolved`로 세지도 않는다.
 * 4. **정규화 후 같은 키가 한 팀에 둘 이상이면 그 키는 통째로 버린다.** 「먼저 온 사람이
 *    이긴다」로 두면 그것이 곧 잘못 붙은 한 건이다.
 * 5. 이미 `ownerMemberId`가 있으면 손대지 않는다.
 *
 * ### 하지 않는 것
 *
 * - **구성원 행을 만들지 않는다.** 시트에 새 이름이 나왔다고 `members`에 넣으면 오타 하나가
 *   신원 테이블에 영구히 남고, 그 행에 나중에 계정이 붙으면 권한이 생긴다. 구성원은 사람이 만든다.
 * - **부분 일치·유사도를 쓰지 않는다.** 정확 일치뿐이다.
 * - **`ownerNameRaw`를 지우거나 바꾸지 않는다.** 원문은 남는다.
 * - **던지지 않는다.** 어떤 입력에도 결과를 돌려준다 (`CLAUDE.md`「파서는 하드 실패시키지 말 것」).
 * - **경고·반환값에 이름을 담지 않는다.** 건수만 돌려준다 (`S6`·`X1`).
 * - 저장소·시계·환경변수를 보지 않는다.
 */

import type { TaskUpsertInput } from '@/lib/store/task-repository';
import type { MemberRecord } from '@/types/auth';
import type { TeamKey } from '@/types/task';

/**
 * 팀 + 정규화된 이름 → 구성원 id. **조회 시점에 다시 정규화한다** — 키를 호출자가 조립하게
 * 두면 시트 값과 구성원 이름이 서로 다른 규칙으로 다듬어지는 날이 온다.
 */
export interface OwnerIndex {
  /** 확실히 한 사람으로 좁혀질 때만 id, 그 밖에는 `null` (없음·정규화 충돌) */
  get(teamId: TeamKey, name: string): string | null;
}

export interface OwnerLinkResult {
  tasks: TaskUpsertInput[];
  /** id가 붙은 건수 */
  linked: number;
  /** 이름은 있는데 못 붙인 건수 (`unknown_owner`) */
  unresolved: number;
}

/** 충돌로 버려진 키. `undefined`(없는 키)와 구별해야 해서 값으로 표시한다 */
const AMBIGUOUS = Symbol('ambiguous');

/**
 * 비교 전에 이름을 다듬는다. `cell-normalizer.ts`에는 대응물이 없다 — 거기 `toText`는
 * 앞뒤 공백만 떼고 내부 공백·유니코드 정규화를 하지 않으며, `row-mapper.ts`의 slug는
 * 소문자화·하이픈화라 사람 이름에 쓸 수 없다.
 *
 * **소문자화하지 않는다.** 한글에 무의미하고, 영문 이름의 대소문자가 서로 다른 사람일 수 있다.
 */
function normalizeOwnerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').normalize('NFC');
}

function indexKey(teamId: TeamKey, normalized: string): string {
  // 구분자는 이름에 절대 등장하지 않는 문자여야 한다 — 그냥 이어 붙이면 팀 키의 끝과
  // 이름의 앞이 뒤섞여 다른 두 사람이 같은 키가 될 수 있다.
  return `${teamId}\u0000${normalized}`;
}

export function buildOwnerIndex(members: readonly MemberRecord[]): OwnerIndex {
  const byKey = new Map<string, string | typeof AMBIGUOUS>();

  for (const record of members) {
    const normalized = normalizeOwnerName(record.name);
    if (normalized === '') continue;

    const key = indexKey(record.teamId, normalized);
    const seen = byKey.get(key);
    if (seen === undefined) {
      byKey.set(key, record.id);
    } else if (seen !== record.id) {
      // 같은 팀에 같은 키가 둘. 어느 쪽도 고르지 않는다
      byKey.set(key, AMBIGUOUS);
    }
  }

  return {
    get(teamId, name) {
      const found = byKey.get(indexKey(teamId, normalizeOwnerName(name)));
      return typeof found === 'string' ? found : null;
    },
  };
}

export function linkOwners(
  tasks: readonly TaskUpsertInput[],
  members: readonly MemberRecord[],
): OwnerLinkResult {
  const index = buildOwnerIndex(members);
  let linked = 0;
  let unresolved = 0;

  const result = tasks.map((task) => {
    if (task.ownerMemberId !== null) return { ...task };

    const name = task.ownerNameRaw === null ? '' : normalizeOwnerName(task.ownerNameRaw);
    // 담당자가 애초에 없는 행이다. 못 붙인 것이 아니라 붙일 것이 없다
    if (name === '') return { ...task };

    const memberId = index.get(task.teamId, name);
    if (memberId === null) {
      unresolved += 1;
      return { ...task };
    }

    linked += 1;
    return { ...task, ownerMemberId: memberId };
  });

  return { tasks: result, linked, unresolved };
}
