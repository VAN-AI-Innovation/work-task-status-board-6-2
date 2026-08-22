/**
 * URL ↔ 화면 상태. **T6의 화면 상태는 전부 URL에 산다** (`UC-11`) — 팀장이 "이거 봐" 하고
 * 링크를 던지는 것이 이 시스템에서 가장 자주 일어나는 조작이라, 필터·정렬·열린 패널까지
 * 쿼리스트링이 진다. 서버 컴포넌트가 `searchParams`만 보고 화면을 복원할 수 있어야 한다.
 *
 * 링크 만드는 코드가 컴포넌트마다 흩어지면 어느 링크는 필터를 지우고 어느 링크는 유지하는
 * 화면이 된다. 그래서 변환을 여기 한 곳에 모으고, 화면은 `buildHref`만 부른다.
 *
 * ## `?display=`가 따로 있는 이유
 *
 * `lib/api/read-context.ts`의 `?status=`는 **시트 원문 문자열**(`진행 중`·`승인 대기` …)이고
 * 저장소가 그대로 비교한다. 화면의 상태 칩은 그것이 아니라 **5색**(`DisplayStatus`)이다.
 * 칩이 `?status=in_progress`를 쓰면 저장소가 원문 `in_progress`를 찾다가 **0건**을 돌려주고,
 * 사용자는 필터가 아니라 데이터를 의심한다. 두 축이 실제로 다른 것이라 이름도 다르다 —
 * `?status=`는 저장소가 거르고, `?display=`는 **판정을 거친 뒤 화면이** 거른다.
 * 저장소는 판정하지 않기 때문이다 (`ADR-006`).
 *
 * `?overdue=1`도 `?display=overdue`와 합치지 않는다. 앞은 저장소를 거친 목록에
 * `buildReadContext`가 거는 판정 필터고 뒤는 칩이다. 하나로 합치면 기존 링크(`UC-11`)와
 * 칩 UI가 서로를 덮어쓴다.
 *
 * ## 두 가지 규율
 *
 * - **기본값은 URL에 쓰지 않는다.** `sort=due`는 생략한다. 기본값을 적으면 같은 화면의 링크가
 *   두 모양으로 돌아다니고, 링크 두 개가 같은 화면인지 사람이 판단할 수 없다.
 * - **모르는 값은 조용히 버린다.** `?display=purple`은 400이 아니라 무시다. 사람이 손으로
 *   편집하는 링크라 오타 하나에 화면이 에러가 되면 링크 공유가 무너진다. (반대로
 *   `parseTaskQuery`가 던지는 값은 라우트가 400으로 옮긴다 — 그 경계는 그대로 둔다.)
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { DisplayStatus, TeamKey } from '@/types/task';

export type SortKey = 'due' | 'team' | 'owner' | 'progress' | 'status';

export interface DashboardQuery {
  team: TeamKey[];
  display: DisplayStatus[];
  owner: string | null;
  dueFrom: string | null;
  dueTo: string | null;
  search: string | null;
  overdue: boolean;
  sort: SortKey;
  /** 해석하지 않고 옮기기만 한다. 판정은 `resolveViewerRole`이 진다 (`ADR-013`) */
  as: string | null;
  /** 사이드 패널 딥링크 (`UC-15`) */
  task: string | null;
}

/**
 * `patch`의 `null`은 「그 키를 지운다」, `undefined`는 「건드리지 않는다」다. 둘을 구분하지
 * 않으면 「필터 하나만 해제」 링크를 만들 수 없어서 `Partial<DashboardQuery>`로는 부족하다.
 */
export type DashboardQueryPatch = { [K in keyof DashboardQuery]?: DashboardQuery[K] | null };

/** 빠른 조회의 기본은 마감 임박순이다 (`PLAN.md`「빠른 조회 UX」) */
export const DEFAULT_SORT: SortKey = 'due';

const SORT_KEYS: readonly SortKey[] = ['due', 'team', 'owner', 'progress', 'status'];

/** 다중 값의 **정렬 순서**이기도 하다. 칩을 누른 순서가 링크에 남으면 같은 화면이 여러 문자열이 된다 */
const DISPLAY_KEYS: readonly DisplayStatus[] = [
  'planned',
  'in_progress',
  'review',
  'done',
  'overdue',
  'muted',
];

const DEFAULTS: DashboardQuery = {
  team: [],
  display: [],
  owner: null,
  dueFrom: null,
  dueTo: null,
  search: null,
  overdue: false,
  sort: DEFAULT_SORT,
  as: null,
  task: null,
};

/** 아는 값만, **항상 같은 순서로**, 중복 없이 남긴다 */
function pickKnown<T extends string>(values: string[], allowed: readonly T[]): T[] {
  const seen = new Set(values);
  return allowed.filter((value) => seen.has(value));
}

/** 값이 비어 있으면 키가 없는 것으로 본다 — 필터를 지우면 `?owner=`가 값 없이 남는다 */
function text(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key);
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function parseDashboardQuery(searchParams: URLSearchParams): DashboardQuery {
  const sort = searchParams.get('sort');

  return {
    team: pickKnown(searchParams.getAll('team'), TEAM_KEYS),
    display: pickKnown(searchParams.getAll('display'), DISPLAY_KEYS),
    owner: text(searchParams, 'owner'),
    dueFrom: text(searchParams, 'dueFrom'),
    dueTo: text(searchParams, 'dueTo'),
    search: text(searchParams, 'search'),
    // `?overdue=1`만 켜짐이다. `true`·`yes`까지 받으면 같은 조건이 여러 모양이 된다
    overdue: searchParams.get('overdue') === '1',
    sort: SORT_KEYS.find((key) => key === sort) ?? DEFAULT_SORT,
    as: text(searchParams, 'as'),
    task: text(searchParams, 'task'),
  };
}

/** 기본값은 싣지 않고, 키 순서는 고정이다 — 같은 상태가 항상 같은 문자열이어야 링크 비교가 성립한다 */
export function toSearchParams(query: DashboardQuery): URLSearchParams {
  const params = new URLSearchParams();

  for (const team of pickKnown(query.team, TEAM_KEYS)) params.append('team', team);
  if (query.owner !== null) params.set('owner', query.owner);
  if (query.dueFrom !== null) params.set('dueFrom', query.dueFrom);
  if (query.dueTo !== null) params.set('dueTo', query.dueTo);
  if (query.search !== null) params.set('search', query.search);
  if (query.overdue) params.set('overdue', '1');
  for (const display of pickKnown(query.display, DISPLAY_KEYS)) params.append('display', display);
  if (query.sort !== DEFAULT_SORT) params.set('sort', query.sort);
  if (query.as !== null) params.set('as', query.as);
  if (query.task !== null) params.set('task', query.task);

  return params;
}

function resolve<K extends keyof DashboardQuery>(
  key: K,
  query: DashboardQuery,
  patch: DashboardQueryPatch
): DashboardQuery[K] {
  const value = patch[key];
  if (value === undefined) return query[key];

  // `null`이면 기본값으로 되돌린다 = URL에서 그 키가 사라진다
  return value === null ? DEFAULTS[key] : value;
}

/** `patch`를 얹은 링크. 전부 기본값이면 `?`를 붙이지 않는다 */
export function buildHref(
  pathname: string,
  query: DashboardQuery,
  patch: DashboardQueryPatch = {}
): string {
  const merged: DashboardQuery = {
    team: resolve('team', query, patch),
    display: resolve('display', query, patch),
    owner: resolve('owner', query, patch),
    dueFrom: resolve('dueFrom', query, patch),
    dueTo: resolve('dueTo', query, patch),
    search: resolve('search', query, patch),
    overdue: resolve('overdue', query, patch),
    sort: resolve('sort', query, patch),
    as: resolve('as', query, patch),
    task: resolve('task', query, patch),
  };

  const queryString = toSearchParams(merged).toString();
  return queryString === '' ? pathname : `${pathname}?${queryString}`;
}

/**
 * 「필터」로 세는 키. `sort`·`as`·`task`는 필터가 아니라 각각 보기 방식·역할·열린 패널이라
 * 초기화에서도 살아남는다 — 지연만 보다가 초기화했더니 역할까지 부원으로 돌아가면
 * 사용자는 화면이 고장 났다고 본다.
 */
const FILTER_KEYS = ['team', 'display', 'owner', 'dueFrom', 'dueTo', 'search', 'overdue'] as const;

/** [필터 초기화] 링크의 patch. 화면 두 곳(필터 바·필터 0건 안내)이 같은 것을 써야 한다 */
export const FILTER_RESET_PATCH: DashboardQueryPatch = Object.fromEntries(
  FILTER_KEYS.map((key) => [key, null])
);

/**
 * 걸려 있는 필터 **조건**의 수. 칩 개수가 아니라 조건 개수다 — 팀 둘을 골라도 「팀 필터 1개」다.
 *
 * 화면이 이 숫자를 쓰는 이유는 이 화면의 가장 흔한 사고 때문이다. 필터가 걸린 줄 모르고
 * 「데이터가 없다」고 오해한 사용자는 업로드하러 간다 (`X3`).
 *
 * 세는 방법이 `toSearchParams`인 것도 의도다 — 「URL에 적히는 것」과 「필터로 세는 것」이
 * 같은 함수에서 나오면 둘이 갈라질 수 없다.
 */
export function countActiveFilters(query: DashboardQuery): number {
  const params = toSearchParams({ ...query, sort: DEFAULT_SORT, as: null, task: null });

  return FILTER_KEYS.filter((key) => params.has(key)).length;
}

/**
 * 5색 칩 필터. **저장소가 거를 수 없는 축**이라 여기서 건다 (파일 머리말).
 *
 * `display`가 비면 입력을 그대로 돌려준다. 빈 배열을 「아무것도 안 보임」으로 해석하면
 * 칩을 다 끄는 순간 화면이 빈다.
 */
export function applyDisplayFilter<T extends { displayStatus: DisplayStatus }>(
  tasks: readonly T[],
  query: DashboardQuery
): T[] {
  if (query.display.length === 0) return [...tasks];

  const wanted = new Set<DisplayStatus>(query.display);
  return tasks.filter((task) => wanted.has(task.displayStatus));
}

/**
 * Next의 `searchParams`(`Record<string, string | string[]>`)를 `URLSearchParams`로 옮긴다.
 *
 * `parseDashboardQuery`가 그 모양을 직접 받지 않는 이유다 — 다중 값 표현이 라우트마다 다르고,
 * 테스트가 그 모양을 흉내 내기 시작하면 진짜를 검증하지 못한다.
 */
export function toURLSearchParams(
  searchParams: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, value);
    }
  }

  return params;
}
