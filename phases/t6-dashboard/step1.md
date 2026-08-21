# Step 1: dashboard-query

## 읽어야 할 파일

- `CLAUDE.md` — TDD, **`src/lib/` 파일명 전역 유니크**, 비즈니스 로직은 `src/lib/`에만
- `docs/TICKETS.md` — `## T6` 완료 기준 **5**(필터 URL 유지)·**6**(`?owner=`·`?task=` 딥링크)
- `docs/PLAN.md` — 227행(필터를 URL에 두는 이유는 UC-11), 「7. 화면」의 「빠른 조회 UX」
- `src/lib/api/read-context.ts` — **`taskQuerySchema`와 `parseTaskQuery` 전문.**
  이 step의 가장 중요한 입력이다
- `src/types/api.ts` — `TaskResponse`(`displayStatus`·`flags`가 붙어 있다)
- `src/lib/domain/display-status.ts` — `DISPLAY_STATUS_LABELS`

## 배경

T6의 화면 상태는 **전부 URL에 산다** (`UC-11`). 팀장이 "이거 봐" 하고 링크를 던지는 행위가
이 시스템에서 가장 자주 일어나는 조작이고, 그래서 필터·정렬·열린 패널까지 URL이 진다.
서버 컴포넌트가 `searchParams`만 보고 화면을 복원할 수 있어야 한다는 뜻이다.

이 step은 **화면을 만들지 않는다.** URL ↔ 화면 상태 변환을 순수 함수로 확정하고,
뒤의 step 9개가 그 함수만 부르게 만든다. 링크 만드는 코드가 컴포넌트마다 흩어지면
어느 링크는 필터를 지우고 어느 링크는 유지하는 화면이 된다.

### ⚠ 먼저 알아야 할 함정 — `?status=`는 이미 임자가 있다

`read-context.ts`의 `taskQuerySchema`가 `?status=`를 읽어 `TaskFilter.statuses`로 넘긴다.
그 값은 **시트 원문 문자열**(`진행 중`·`승인 대기` …)이고 저장소가 그대로 비교한다.

그런데 화면의 상태 칩은 **5색**(`DisplayStatus`: `planned`·`in_progress`·`review`·`done`·
`overdue`·`muted`)이다. 칩이 `?status=in_progress`를 쓰면 저장소가 원문 `in_progress`를
찾다가 **0건**을 돌려준다. 조용히 빈 화면이 되고, 사용자는 필터가 아니라 데이터를 의심한다.

**확정: 화면의 5색 칩은 `?display=`를 쓴다.** `?status=`는 API 소비자용 원문 필터로
그대로 남긴다. 두 축이 실제로 다른 것이라 이름도 달라야 한다 —
`?status=`는 저장소에서 걸러지고, `?display=`는 **판정을 거친 뒤 화면이** 거른다.
저장소는 판정하지 않기 때문이다 (`ADR-006`).

## 확정 — 이 URL 문법을 여기서 못박는다

| 키 | 값 | 누가 거르나 | 근거 |
|---|---|---|---|
| `team` | `edit`·`shoot`·`marketing` (다중) | 저장소 (`parseTaskQuery`) | |
| `owner` | 담당자 이름 | 저장소 | `UC-14` |
| `dueFrom`·`dueTo` | `YYYY-MM-DD` | 저장소 | |
| `search` | 자유 문자열 | 저장소 | |
| `overdue` | `1`만 (없으면 꺼짐) | `buildReadContext` | `UC-11` |
| **`display`** | `planned`·`in_progress`·`review`·`done`·`overdue`·`muted` (다중) | **화면** | 위 함정 |
| **`sort`** | `due`·`team`·`owner`·`progress`·`status` | **화면** | 기본 `due` |
| `as` | `admin`·`lead`·`member` | `resolveViewerRole` | `ADR-013` |
| **`task`** | 업무 id | **화면** (사이드 패널) | `UC-15` 딥링크 |

- **기본값은 URL에 쓰지 않는다.** `sort=due`는 생략한다. 기본값을 적으면 같은 화면의
  링크가 두 모양으로 돌아다니고, 링크 두 개가 같은 화면인지 사람이 판단할 수 없다.
- **모르는 값은 조용히 버린다.** `?display=purple`은 400이 아니라 무시다. 이 문자열은
  사람이 손으로 편집하는 링크이고, 오타 하나에 화면이 에러가 되면 링크 공유가 무너진다.
  (반대로 `parseTaskQuery`가 던지는 값은 라우트가 400으로 옮긴다 — 그 경계는 그대로 둔다.)
- **키 순서는 고정이다.** 같은 상태가 항상 같은 문자열이어야 링크 비교와 테스트가 성립한다.

## 작업

### 1. `src/lib/view/dashboard-query.ts` — 테스트를 **먼저** 쓴다

`src/lib/view/` 디렉토리를 새로 만든다. 이 디렉토리가 T6의 「화면이 하는 계산」을 전부 진다 —
컴포넌트는 props를 받아 JSX만 뱉는다 (`CLAUDE.md`).

```ts
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
  as: string | null;
  task: string | null;
}

export const DEFAULT_SORT: SortKey = 'due';

/** 모르는 값·빈 값은 버린다. 예외를 던지지 않는다 */
export function parseDashboardQuery(searchParams: URLSearchParams): DashboardQuery;

/** 기본값은 싣지 않는다. 키 순서 고정 */
export function toSearchParams(query: DashboardQuery): URLSearchParams;

/** `patch`를 얹은 링크. `?`가 붙지 않는 경우(전부 기본값)는 pathname만 */
export function buildHref(pathname: string, query: DashboardQuery, patch?: Partial<DashboardQuery>): string;

/** `display` 칩과 화면 필터. **저장소가 거를 수 없는 축**이라 여기서 건다 */
export function applyDisplayFilter<T extends { displayStatus: DisplayStatus }>(
  tasks: readonly T[],
  query: DashboardQuery
): T[];
```

- `parseDashboardQuery`는 **`URLSearchParams`를 받는다.** Next의 `searchParams`
  (`Record<string, string | string[]>`)를 직접 받지 마라 — 다중 값 표현이 라우트마다
  다르고, 테스트가 그 모양을 흉내 내기 시작하면 진짜를 검증하지 못한다.
  서버 컴포넌트가 `new URLSearchParams(...)`로 바꿔 넘긴다. 그 변환 헬퍼도 여기에 둔다:
  `export function toURLSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams`.
- `buildHref`의 `patch`에서 **`null`은 「그 키를 지운다」**는 뜻이다. `undefined`는
  「건드리지 않는다」다. 이 둘을 구분하지 않으면 「필터 하나만 해제」 링크를 만들 수 없다.
- `applyDisplayFilter`는 `display`가 비면 **입력을 그대로** 돌려준다(복사본이어도 된다).
  빈 배열을 「아무것도 안 보임」으로 해석하면 필터를 다 끄는 순간 화면이 빈다.
- **`overdue`와 `display=overdue`를 합치지 마라.** 앞은 저장소를 거친 판정 필터고
  뒤는 5색 칩이다. 둘 다 켜도 결과가 같아지는 것은 우연이고, 하나로 합치면
  `?overdue=1`을 쓰는 기존 링크(`UC-11`)와 칩 UI가 서로를 덮어쓴다.

테스트:

1. 빈 `URLSearchParams` → 전부 기본값 (`sort === 'due'`, 배열은 빈 배열, 나머지 null/false)
2. **왕복**: 임의의 `DashboardQuery` → `toSearchParams` → `parseDashboardQuery`가 같은 값
   (배열 순서 포함). 이 테스트가 완료 기준 5의 실체다
3. 기본값이 URL에 실리지 않는다 (`sort=due`인 쿼리의 `toSearchParams`에 `sort`가 없다)
4. `?display=purple&display=overdue` → `['overdue']` (모르는 값만 버린다)
5. `?team=edit&team=nope` → `['edit']`
6. `?sort=nonsense` → `'due'`
7. `?overdue=0` → `false`, `?overdue=1` → `true`
8. `buildHref('/', q, { team: null })`이 `team`을 지운다 / `{ task: 'abc' }`가 더한다 /
   `{}`가 원본과 같은 문자열을 만든다
9. 전부 기본값이면 `buildHref`가 `'/'`를 돌려준다 (`'/?'`가 아니다)
10. `applyDisplayFilter`: 빈 `display`면 전건 통과 / `['overdue']`면 그 칸만 /
    입력 배열을 고치지 않는다
11. `toURLSearchParams`가 `string[]`·`string`·`undefined` 셋을 다 처리한다

### 2. `src/lib/view/task-sort.ts` — 테스트를 **먼저** 쓴다

```ts
export const SORT_LABELS: Readonly<Record<SortKey, string>>;

/** 결정적 정렬. 입력을 고치지 않고 새 배열을 돌려준다 */
export function sortTasks(tasks: readonly TaskResponse[], key: SortKey): TaskResponse[];
```

정렬 규칙 — **기본은 마감 임박순**이다 (`PLAN.md`「빠른 조회 UX」).

- `due`: `dueAt` 오름차순. **`null`은 맨 뒤.** 마감이 없는 업무를 「가장 급함」으로
  올리면 화면 첫 줄이 영영 그 건들로 채워진다
- `team`: `TEAM_KEYS` 순서(`edit`·`shoot`·`marketing`), 그다음 `due`
- `owner`: `ownerNameRaw` 코드포인트 순, `null`은 뒤, 그다음 `due`
- `progress`: 진행률 내림차순, `null`은 뒤
- `status`: `DisplayStatus` 고정 순서 — `overdue` → `in_progress` → `review` →
  `planned` → `done` → `muted`. **지연이 맨 위다.** 나머지는 급한 순
- **모든 키에서 마지막 동률 판정은 `id` 비교다.** 동률이 남으면 새로고침마다 표가
  흔들리고 스냅샷 테스트도 링크 공유도 못 믿는다
- **`localeCompare`를 쓰지 마라.** 실행 환경에 따라 결과가 달라진다
  (`weekly-report.ts`가 같은 이유로 금지했다)

테스트: 다섯 키 각각의 순서, `null` 뒤로 가기, **입력 배열 불변**, 동률에서 `id` 순,
같은 입력을 두 번 정렬하면 같은 결과, 빈 배열.

## Acceptance Criteria

```bash
npx vitest run src/lib/view

# 화면 계산이 view에 있다 (둘 다 출력이 있어야 함)
ls src/lib/view/dashboard-query.ts src/lib/view/task-sort.ts

# 시간·환경을 읽지 않는다 (출력이 비어야 함)
grep -rn "Date.now()\|new Date()\|localeCompare\|process.env" src/lib/view/ ; test $? -eq 1

# 저장소·라우트를 모른다 — 순수 변환이다 (출력이 비어야 함)
grep -rn "@/lib/store\|next/navigation\|exceljs" src/lib/view/ ; test $? -eq 1

# `?status=`의 의미를 바꾸지 않았다 (출력이 있어야 함)
grep -n "statuses" src/lib/api/read-context.ts

# 회귀
npx vitest run src/lib src/app

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - **왕복 테스트가 있는가?** 없으면 완료 기준 5를 검증할 수단이 없다
   - `?display=`와 `?status=`가 **서로 다른 축**으로 남아 있는가?
   - 기본값이 URL에 실리지 않는가?
   - 모르는 값에 예외를 던지지 않는가?
   - `sortTasks`가 입력을 고치지 않는가?
   - `src/lib/view/`의 새 파일명 2개가 `src/lib/` 전역에서 유니크한가?
3. `phases/t6-dashboard/index.json`의 step 1을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 **`?display=`를 새로 만든 이유**, 내보낸 함수 이름, 정렬 기본값,
   테스트 개수를 남겨라.

## 금지사항

- `?status=`를 5색 값으로 재정의하지 마라. 이유: 저장소가 시트 원문으로 비교하므로
  결과가 조용히 0건이 된다. T5의 API 계약도 함께 깨진다.
- `parseDashboardQuery`에서 예외를 던지지 마라. 이유: 사람이 손으로 고치는 링크다.
  오타 하나에 에러 화면이 되면 링크 공유(`UC-11`)가 무너진다.
- 기본값을 URL에 실지 마라. 이유: 같은 화면의 링크가 여러 모양이 된다.
- 컴포넌트·페이지를 만들지 마라. 이유: step 2 이후의 범위다.
- `next/navigation`을 import하지 마라. 이유: 이 계층은 순수 변환이고, 프레임워크가 끼면
  테스트가 라우터를 흉내 내기 시작한다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
