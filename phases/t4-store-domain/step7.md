# Step 7: task-repository + memory-task-store

## 읽어야 할 파일

- `CLAUDE.md` — `src/services/`를 쓰지 않는다, 파일명 전역 유니크, TDD
- `docs/ADR.md` — **`ADR-004`**(메모리 드라이버는 이관 경로가 아니라 시연 안전망),
  **`ADR-006`**(리포지토리는 저장·조회만), `ADR-008`(미리보기→확정 2단계)
- `docs/TICKETS.md` — `## T4` **「인터페이스 경계」 블록 전체**와 완료 기준 **8**,
  「리스크·미결」의 `last_progress_at` 갱신 조건, `UC-03`·`UC-04`
- `docs/ARCHITECTURE.md` — 「집계·판정」의 리포지토리/도메인 대응표, 「디렉토리 구조」
- `docs/PLAN.md` — 「9. 시연 리스크 완화」 1번
- step 0 산출물: `Task`·`TaskStage`·`TaskEvent`·`GoalMetric`

## 배경

저장소 계약을 확정하고 **먼저 통과하는 구현 하나**를 만든다. Supabase 구현(step 9)은
같은 계약 테스트를 다시 통과해야 하고, 그게 T4 완료 기준 8이다.

계약 테스트를 별도 파일로 빼는 이유: 두 구현이 **같은 코드**를 통과해야 의미가 있다.
테스트를 복사해 두면 시간이 지나면서 갈라지고, 갈라진 순간 계약이 아니게 된다.

**`last_progress_at` 갱신 조건이 이 step의 급소다** (`TICKETS.md` T4 「리스크·미결」).
같은 파일을 다시 올렸을 때 갱신되면 "장기 미갱신" 판정이 영원히 안 뜬다.

## 작업

### 1. `src/lib/store/task-repository.ts` — 테스트를 **먼저** 쓴다

```ts
export interface TaskFilter {
  teamKeys?: readonly TeamKey[];
  /** `source_key` 지정 조회 (업로드 확정 시 기존 건 대조) */
  sourceKeys?: readonly string[];
  ownerNameRaw?: string;
  /** `YYYY-MM-DD`. 양끝 포함 */
  dueFrom?: string;
  dueTo?: string;
  /** 시트 원문 상태. semantic 필터는 도메인이 걸러낸다 (리포지토리는 판정하지 않는다) */
  statuses?: readonly string[];
  /** 업무명·담당자 부분 일치 (대소문자 무시) */
  search?: string;
  limit?: number;
}

/** `upsertTasks`가 받는 입력. `id`·`lastProgressAt`은 저장소가 정한다 */
export type TaskUpsertInput = Omit<Task, 'id' | 'lastProgressAt'>;
export type GoalMetricUpsertInput = Omit<GoalMetric, 'id'>;

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  /** 실제로 값이 바뀐 건에 대해서만 만들어진 이벤트 */
  events: TaskEvent[];
}

export interface UpsertOptions {
  uploadId?: string | null;
  /** 이벤트·`lastProgressAt`의 타임스탬프. **주입받는다** */
  occurredAt: string;
}

export interface TaskRepository {
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  upsertTasks(tasks: readonly TaskUpsertInput[], options: UpsertOptions): Promise<UpsertResult>;
  listStages(taskIds: readonly string[]): Promise<TaskStage[]>;
  listGoalMetrics(filter?: { teamKeys?: readonly TeamKey[]; periodLabel?: string }): Promise<GoalMetric[]>;
  upsertGoalMetrics(metrics: readonly GoalMetricUpsertInput[], options: UpsertOptions): Promise<{ created: number; updated: number; unchanged: number }>;
  recordEvents(events: readonly Omit<TaskEvent, 'id'>[]): Promise<void>;
  getLastSyncedAt(): Promise<string | null>;
}

/** 두 구현이 **같은 필터 의미**를 갖도록 하는 기준 구현. 계약 테스트가 이것으로 기대값을 만든다 */
export function matchesTaskFilter(task: Task, filter?: TaskFilter): boolean;

/** 변경 감지 대상 필드. 여기 없는 필드가 바뀌어도 "변경"이 아니다 */
export const TASK_DIFF_FIELDS: readonly (keyof Task)[];

/** 바뀐 필드 **이름만** 돌려준다. 값은 담지 않는다 */
export function diffTaskFields(prev: Task, next: TaskUpsertInput): string[];
```

`upsertTasks`에 `stages`가 없는 것에 주의하라. `TaskUpsertInput`에 `stages` 필드를 넣지 말고,
단계는 **`Task`에 딸린 별도 인자**로 받아라 —
`upsertTasks(tasks, options)` 시그니처를 유지하려면 `TaskUpsertInput`에
`stages: readonly Omit<TaskStage, 'id' | 'taskId'>[]`를 포함시키는 편이 단순하다. **후자를 택한다.**
그 이유(단계는 태스크와 같은 트랜잭션에서 통째로 교체돼야 한다)를 주석에 남겨라.

### 2. `TASK_DIFF_FIELDS`와 `diffTaskFields` — `last_progress_at`의 근거

포함: `title` `ownerNameRaw` `coOwnerNames` `status` `approvalStatus` `priority` `riskStatus`
`progress` `assignedAt` `dueAt` `nextAction` `nextActionOwner` `nextActionDue` `delayReason`
`note` `extras`

**제외**: `id` `teamId` `departmentId` `sourceKey` `ownerMemberId` `raw` `lastProgressAt`
`sourceUploadId` `sourceSheetTab` `sourceRowIndex`

제외 근거를 주석에 남겨라:
- `sourceUploadId`·`sourceRowIndex`는 **같은 내용이라도 매번 바뀐다.** 포함하면 재업로드가
  전건 "변경"이 되고 `UC-03`("변경 M건만 표시")과 장기 미갱신 판정이 동시에 무너진다.
- `raw`는 `extras`와 내용이 겹치고 크다. `extras`만 보면 충분하다.
- `coOwnerNames`·`extras`는 **깊은 비교**를 해야 한다. 배열·객체를 `!==`로 비교하면
  매번 다르다고 나온다. `JSON.stringify` 비교로 충분하다 —
  객체 키 순서가 흔들릴 수 있으므로 키를 정렬한 뒤 비교하라.
- `progress`의 `0`과 `null`은 **다른 값**이다. `==`·falsy 비교를 쓰지 마라.

`upsertTasks` 규칙:
- 기존 건이 없으면 `created`, 있고 `diffTaskFields`가 비어 있지 않으면 `updated`,
  비어 있으면 `unchanged`.
- **`lastProgressAt`은 `updated`인 건에만 `options.occurredAt`으로 갱신한다.**
  `created`인 건은 `occurredAt`으로 초기화하고, `unchanged`인 건은 **손대지 않는다.**
- `TaskEvent`는 `updated`인 건에만 만든다. `changedFields`는 `diffTaskFields`의 결과다.
- 단계는 태스크마다 **통째로 교체**한다 (delete-then-insert). 단계 변경은 `changedFields`에
  넣지 않는다 — 단계 diff까지 하면 복잡도가 값어치를 넘는다. 이 결정을 주석에 남겨라.
- 키는 `(teamId, sourceKey)`다. 같은 배열 안에 같은 키가 두 번 오면 **뒤엣것이 이긴다**
  (마지막 쓰기 승리, `PLAN.md` 「엣지 케이스」).

### 3. `src/lib/store/repository-contract.ts` — 두 구현이 함께 통과할 계약

```ts
export interface RepositoryFixture {
  create(): Promise<TaskRepository>;
  /** 각 테스트 전에 저장소를 비운다 */
  reset(repo: TaskRepository): Promise<void>;
}

/** vitest `describe` 블록을 만든다. 두 구현이 이 함수 하나를 각자 호출한다 */
export function describeRepositoryContract(label: string, fixture: RepositoryFixture): void;
```

이 파일은 `vitest`를 import한다. **제품 코드에서 import하지 마라** — 계약 테스트 전용이며
`src/lib/store/`에 두는 이유는 두 구현 테스트가 나란히 쓰기 때문이다.
`ARCHITECTURE.md`의 `lib/store/` 트리에 `repository-contract`를 추가하라 (**트리 줄만** 고친다).

계약 항목 — 최소 이만큼:

1. 빈 저장소에서 `listTasks()` → `[]`, `getTask('없는id')` → `null`
2. 신규 2건 upsert → `created: 2, updated: 0, unchanged: 0`, `listTasks()`가 2건
3. **같은 입력을 그대로 다시 upsert → `unchanged: 2`, 이벤트 0건,
   `lastProgressAt`이 1차 때 값 그대로**
4. **한 건의 `progress`만 바꿔 upsert → `updated: 1, unchanged: 1`,
   이벤트 1건이고 `changedFields`가 `['progress']`, 그 건의 `lastProgressAt`만 갱신**
5. **`sourceRowIndex`·`sourceUploadId`만 바뀐 재업로드 → `unchanged`** (행이 밀려도 변경이 아니다)
6. `progress`를 `0`에서 `null`로 바꾸면 `updated` (0과 null 구분)
7. `extras`의 키 하나가 바뀌면 `updated`, 키 순서만 다르면 `unchanged`
8. 같은 `(teamId, sourceKey)`가 배열 안에 두 번 → 1건만 남고 뒤엣것이 이긴다
9. **다른 팀의 같은 `sourceKey`는 별개 태스크다** (키가 `(teamId, sourceKey)`이므로)
10. `listTasks` 필터: `teamKeys` / `sourceKeys` / `dueFrom`·`dueTo`(양끝 포함) /
    `ownerNameRaw` / `statuses` / `search`(대소문자 무시 부분 일치) / `limit`
    — **각 필터 결과가 `matchesTaskFilter`로 만든 기대값과 같다**
11. `listStages`가 넘긴 `taskIds`의 단계만, `seq` 오름차순으로 돌려준다
12. **단계가 통째로 교체된다** — 3단계짜리를 2단계로 다시 올리면 2건만 남는다
13. `listStages([])` → `[]`
14. `upsertGoalMetrics` 신규/변경/무변경이 `(teamId, periodLabel, title)` 기준으로 갈린다
15. `listGoalMetrics` 필터가 동작한다
16. `recordEvents` 후 이벤트가 조회 가능하다 —
    조회 수단이 인터페이스에 없으므로 **`recordEvents`는 예외 없이 끝나는 것만** 확인한다
17. `getLastSyncedAt()`은 빈 저장소에서 `null`, upsert 후에는 `options.occurredAt`
18. **`upsertTasks([], ...)`가 예외 없이 `{created:0, updated:0, unchanged:0}`을 낸다**
    (부분 업로드에서 빈 탭이 온다, `UC-04`)
19. 저장소가 돌려준 객체를 호출자가 고쳐도 저장소 내부가 오염되지 않는다
    (메모리 구현에서 참조를 그대로 넘기면 깨진다)

### 4. `src/lib/store/repository-contract.test.ts`

계약 스위트 자체가 쓸모 있는지 확인한다. **일부러 틀린 가짜 리포지토리**를 만들어
계약이 실패하는지 본다 — 예를 들어 `unchanged`를 항상 `updated`로 세는 구현.
`describeRepositoryContract`를 직접 부르면 실패가 스위트를 깨뜨리므로,
계약 항목을 함수로 노출해 `expect(...).rejects`/`toThrow`로 확인하거나,
**계약 검증 로직을 `assertRepositoryContract(repo)` 같은 비-`describe` 함수로 분리**하고
`describeRepositoryContract`는 그것을 `it`로 감싸기만 하게 구성하라. 후자를 권한다.

### 5. `src/lib/store/memory-task-store.ts` — 테스트를 **먼저** 쓴다

```ts
export function createMemoryTaskStore(seed?: {
  tasks?: readonly Task[];
  stages?: readonly TaskStage[];
  goalMetrics?: readonly GoalMetric[];
}): TaskRepository & { clear(): void };
```

- 저장은 배열·`Map`이면 충분하다. 인덱스를 최적화하지 마라 (수백~수천 행 규모다).
- **id는 `crypto.randomUUID()`로 만든다.** 순번 카운터를 쓰면 재시작 후 id가 충돌한다.
- **읽기·쓰기 모두 깊은 복사**해서 주고받는다. 참조를 그대로 넘기면 계약 항목 19가 깨진다.
- `listTasks`는 `matchesTaskFilter`를 그대로 쓴다. 필터를 다시 구현하지 마라.
- 정렬은 결정적으로: `teamId` → `sourceKey`.
- `memory-task-store.test.ts`에서 `describeRepositoryContract('memory', ...)`를 호출한다.

## Acceptance Criteria

```bash
npx vitest run src/lib/store

# 계약 테스트가 실제로 두 곳에서 쓰일 준비가 됐다 (출력이 있어야 함)
grep -n "describeRepositoryContract" src/lib/store/memory-task-store.test.ts

# 리포지토리가 판정하지 않는다 (출력이 비어야 함)
grep -nE "isOverdue|completionRate|toSemantic|toDisplayStatus" src/lib/store/*.ts ; test $? -eq 1

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/store/*.ts ; test $? -eq 1

# 제품 코드가 계약 스위트를 import하지 않는다 (출력이 비어야 함)
grep -rn "repository-contract" src/lib/store/memory-task-store.ts src/lib/store/task-repository.ts ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 같은 파일 재업로드가 `unchanged`이고 `lastProgressAt`이 안 바뀌는가? (계약 3·5번)
   - `progress` `0`과 `null`이 구분되는가?
   - 계약 스위트가 **틀린 구현을 실제로 잡는가?** (`repository-contract.test.ts`)
   - `src/lib/store/` 파일명이 `src/lib/` 전역에서 유니크한가?
   - `ARCHITECTURE.md` 트리에 `repository-contract`가 반영됐는가? (트리 줄만 고쳤는가)
3. `phases/t4-store-domain/index.json`의 step 7을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 계약 항목 수, `TASK_DIFF_FIELDS`에서 제외한 필드와 그 이유, 테스트 개수를 포함하라.

## 금지사항

- 리포지토리에서 집계·판정을 하지 마라. 이유: `ADR-006`, `CLAUDE.md` CRITICAL.
- `@supabase/supabase-js`를 설치하거나 import하지 마라. 이유: step 9의 범위다.
- 마이그레이션 SQL을 쓰지 마라. 이유: step 8의 범위다.
- `store-factory`·`seed-tasks.json`을 만들지 마라. 이유: step 10의 범위다.
- 계약 테스트를 구현별로 복사하지 마라. 이유: 복사한 순간 계약이 아니게 된다.
- `TaskEvent.changedFields`에 값(before/after)을 담지 마라. 이유: 이력 테이블이 개인정보 사본이 된다.
- 메모리 구현에 인덱스·캐시를 만들지 마라. 이유: 수백~수천 행 규모다 (`ADR-006`).
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
