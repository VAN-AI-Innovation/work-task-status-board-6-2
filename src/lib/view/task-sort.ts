/**
 * 표의 정렬. **결정적이어야 한다** — 동률이 남으면 새로고침마다 표가 흔들리고, 흔들리는 표는
 * 링크를 공유해도 상대가 같은 화면을 못 본다 (`UC-11`). 그래서 모든 키의 마지막 판정은
 * `id` 비교다.
 *
 * **로캘에 기대는 문자열 비교 함수를 쓰지 않는다.** 실행 환경의 로캘 데이터에 따라 결과가
 * 달라져서 서버와 브라우저가 다른 순서를 낼 수 있다 (`weekly-report.ts`가 같은 이유로
 * 금지했다). 코드포인트 비교로 고정한다.
 *
 * 기본이 마감 임박순인 것은 `PLAN.md`「빠른 조회 UX」다. 그래서 `team`·`owner`처럼 묶어서
 * 보는 키도 묶음 **안에서는** 다시 마감 임박순이 된다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { SortKey } from '@/lib/view/dashboard-query';
import type { TaskResponse } from '@/types/api';
import type { DisplayStatus, TeamKey } from '@/types/task';

export const SORT_LABELS: Readonly<Record<SortKey, string>> = {
  due: '마감 임박순',
  team: '팀순',
  owner: '담당자순',
  progress: '진행률순',
  status: '상태순',
};

const TEAM_RANK: ReadonlyMap<TeamKey, number> = new Map(TEAM_KEYS.map((key, index) => [key, index]));

/** 급한 것부터. **지연이 맨 위**이고 끝난 것과 5색 밖(`muted`)이 아래로 물러난다 */
const STATUS_RANK: Readonly<Record<DisplayStatus, number>> = {
  overdue: 0,
  in_progress: 1,
  review: 2,
  planned: 3,
  done: 4,
  muted: 5,
};

/** 코드포인트 비교. 로캘에 기대지 않는다 */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** `null`은 언제나 뒤다 */
function compareNullableText(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;

  return compareText(a, b);
}

/**
 * 마감 임박순. **마감이 없는 업무는 맨 뒤**다 — 「가장 급함」으로 올리면 화면 첫 줄이 영영
 * 그 건들로 채워진다. 기한 미설정은 정렬이 아니라 알림 패널이 드러낸다.
 */
function compareDue(a: TaskResponse, b: TaskResponse): number {
  return compareNullableText(a.dueAt, b.dueAt);
}

const COMPARATORS: Readonly<Record<SortKey, (a: TaskResponse, b: TaskResponse) => number>> = {
  due: compareDue,
  team: (a, b) => teamRank(a.teamId) - teamRank(b.teamId) || compareDue(a, b),
  owner: (a, b) => compareNullableText(a.ownerNameRaw, b.ownerNameRaw) || compareDue(a, b),
  // 진행률은 높은 것부터. 미입력(`null`)은 0이 아니므로 맨 뒤로 보낸다
  progress: (a, b) => compareProgressDesc(a.progress, b.progress) || compareDue(a, b),
  status: (a, b) => STATUS_RANK[a.displayStatus] - STATUS_RANK[b.displayStatus] || compareDue(a, b),
};

function teamRank(teamKey: TeamKey): number {
  return TEAM_RANK.get(teamKey) ?? TEAM_KEYS.length;
}

function compareProgressDesc(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;

  return b - a;
}

/** 입력을 고치지 않고 새 배열을 돌려준다 */
export function sortTasks(tasks: readonly TaskResponse[], key: SortKey): TaskResponse[] {
  const compare = COMPARATORS[key];

  return [...tasks].sort((a, b) => compare(a, b) || compareText(a.id, b.id));
}
