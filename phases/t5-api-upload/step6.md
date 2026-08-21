# Step 6: task-response + read-context

## 읽어야 할 파일

- `CLAUDE.md` — **API 응답에 `tasks.raw`를 싣지 말 것 (zod 스키마로 강제)**, 계층 경계, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **1**(라우트는 계산 0줄)·**9**(`raw` 없음)·**12**
- `docs/PLAN.md` — 「보안」 `S6`, 「6. 집계·판정」
- `docs/ADR.md` — `ADR-007`(서버 컴포넌트 직접 호출 / API는 클라이언트 상호작용 전용),
  `ADR-006`(집계는 순수 함수)
- `docs/ARCHITECTURE.md` — 「계층 경계」, 「집계·판정」의 리포지토리/도메인 대응표
- T4 산출물 시그니처: `src/lib/domain/task-derive.ts`(`DeriveContext`·`TaskFlags`·`deriveAllFlags`),
  `display-status.ts`, `task-semantic.ts`(`buildSemanticIndex`), `kst-today.ts`(`kstToday`),
  `progress-stats.ts`(`StatsContext`·`TEAM_KEYS`), `alert-rules.ts`(`AlertContext`)
- step 5 산출물: `ViewerRole`·`maskExtras`

## 배경

완료 기준 1은 **"라우트 핸들러가 zod 검증 → lib 호출 → 직렬화 3단계만 수행한다(계산 로직 0줄)"**
이다. 라우트를 9개 쓰기 시작하면 그 규칙은 반드시 무너진다 — 매번 같은 준비 코드를 쓰다 보면
어느 라우트에서 한 줄만 계산하게 된다.

그래서 **라우트가 부를 것을 먼저 만든다.** 라우트에 남는 것은
`파라미터 파싱 → 이 파일의 함수 호출 → Response.json` 세 줄이다.

그리고 `raw` 배제는 **zod로 강제한다** (`CLAUDE.md` CRITICAL). 손으로 빼면 언젠가 빠뜨리고,
빠뜨린 그날 전 조직의 연락처가 API로 나간다. `.strict()` 스키마가 `raw`를 만나면 **런타임에서
터진다** — 조용히 통과하는 것보다 낫다.

## 작업

### 1. `src/types/api.ts` — 응답 타입 (테스트 불필요, `types/`는 가드 예외)

응답 DTO 타입만 둔다. **zod 스키마를 여기 두지 마라** — 스키마는 검증 로직이고 `src/lib/`의
TDD 대상이다.

```ts
export interface ApiMeta {
  /** KST 기준 오늘 `YYYY-MM-DD` */
  today: string;
  /** 마지막으로 시트를 반영한 시각 (ISO) 또는 null */
  lastSyncedAt: string | null;
  driver: 'supabase' | 'memory';
  mode: 'live' | 'demo' | 'fallback';
  readOnly: boolean;
  role: ViewerRole;
}

/** `Task`에서 `raw`를 뺀 것 + 파생 판정. **`raw`가 없다는 것이 이 타입의 요점이다** */
export interface TaskResponse { /* … */ }
export interface TaskDetailResponse { task: TaskResponse; stages: TaskStage[]; }
export interface ApiErrorBody { error: { code: ApiErrorCode; message: string } }
```

### 2. `src/lib/api/task-response.ts` — 테스트를 **먼저** 쓴다

```ts
/** `raw`를 **가질 수 없는** 스키마. `.strict()`라 `raw`가 섞이면 parse가 던진다 */
export const taskResponseSchema: z.ZodType<TaskResponse>;

/** 저장 모델 → 응답. `raw` 제거 + `extras` 마스킹 + 파생 판정 부착 */
export function toTaskResponse(task: Task, flags: TaskFlags, role: ViewerRole): TaskResponse;

/** 배열 전체를 스키마로 통과시킨다. **실패하면 던진다** */
export function toTaskListResponse(
  tasks: readonly Task[],
  flags: ReadonlyMap<string, TaskFlags>,
  role: ViewerRole
): TaskResponse[];
```

규칙:

- `TaskResponse`는 `Task`의 필드에서 **`raw`를 뺀 것** + `flags`(`TaskFlags`) +
  `displayStatus`(`toDisplayStatus`의 결과) + `statusLabel`(`DISPLAY_STATUS_LABELS`의 한글).
- `extras`는 `maskExtras(task.extras, role)`을 거친다. **직접 필터를 쓰지 마라.**
- **`toTaskResponse`는 반드시 `taskResponseSchema.parse(...)`를 통과한 값을 돌려준다.**
  변환만 하고 검증을 건너뛰면 강제가 아니다.
- `stages`는 `TaskStage` 그대로 내보낸다(민감 키가 없다). `TaskEvent`는 내보내지 않는다 —
  변경 필드 이름만 든 이력이라 화면에 쓸 데가 T5에 없다.
- **`displayStatus`를 여기서 계산하지 마라.** `toDisplayStatus`를 부른다.

테스트:

1. `raw`가 든 `Task`를 넣어도 결과에 `raw`가 없다
2. **`taskResponseSchema.parse({ ...정상응답, raw: {...} })`가 던진다** (`.strict()` 확인 —
   이 테스트가 완료 기준 9의 증거다)
3. `member`에게 `extras['출연자 연락처']`의 값이 `null`, `admin`에게는 원본
4. `progress: 0`이 `0`으로 남는다 (`null`로 바뀌지 않는다)
5. `flags`·`displayStatus`·`statusLabel`이 들어 있다
6. `JSON.stringify(응답)`에 `'raw'` 문자열이 없다

### 3. `src/lib/api/read-context.ts` — 테스트를 **먼저** 쓴다

조회 라우트 6개가 공통으로 필요한 준비를 한 번에 한다.

```ts
export interface ReadContext {
  tasks: Task[];
  stages: TaskStage[];
  role: ViewerRole;
  /** 도메인 함수에 그대로 넘긴다. `flags`가 미리 계산돼 있다 */
  ctx: AlertContext & StatsContext;
  meta: ApiMeta;
}

/** `now`와 `searchParams`를 **주입받는다.** 이 함수는 시계도 요청 객체도 모른다 */
export function buildReadContext(
  storage: StorageHandle,
  now: Date,
  params: { as: string | null; filter: TaskFilter }
): Promise<ReadContext>;

/** 쿼리스트링 → `TaskFilter`. **zod로 검증한다** */
export const taskQuerySchema: z.ZodType<{ filter: TaskFilter; overdueOnly: boolean }>;
export function parseTaskQuery(searchParams: URLSearchParams): { filter: TaskFilter; overdueOnly: boolean };
```

규칙:

- `buildReadContext`는 `storage.repo.listTasks(filter)` → `listStages(ids)` →
  `getLastSyncedAt()`를 부르고, `kstToday(now)`로 `today`를 만들고,
  `buildSemanticIndex(null)`로 인덱스를 만든 뒤 `deriveAllFlags`로 플래그를 미리 계산한다.
- **`buildSemanticIndex(null)`을 쓰는 이유를 주석에 남겨라**: T5는 설정 탭 레지스트리를
  저장하지 않기로 했고(step 2), 도메인이 내장 표로 폴백한다.
- `overdueOnly`는 `TaskFilter`에 없다 — **저장소는 판정하지 않는다**(`ADR-006`).
  `deriveTaskFlags`의 `isOverdue`로 **호출자가** 거른다. 그 거르기는
  `buildReadContext`가 해서 라우트로 새지 않게 한다.
- `parseTaskQuery`가 받는 키: `team`(반복 가능)·`status`(반복 가능)·`owner`·`dueFrom`·`dueTo`·
  `search`·`limit`·`overdue`. **알 수 없는 키는 무시**하고, 형식이 틀리면 `VALIDATION_FAILED`를
  던질 수 있도록 zod 에러를 그대로 올린다(라우트가 잡아 400으로 옮긴다).
  `team`은 `'edit'|'shoot'|'marketing'`만, `limit`은 1~1000 정수.
- **`meta.role`은 `resolveViewerRole`의 결과다.** 여기서 다시 판단하지 마라.
- `stages`는 조회한 태스크의 것만 가져온다. `listStages([])`는 `[]`다.

테스트 (`STORAGE_DRIVER=memory`로 만든 `StorageHandle`을 쓴다):

1. `buildReadContext`가 태스크·단계·메타를 채운다. `meta.today`가 주입한 `now`의 KST 날짜다
2. **같은 `now`를 두 번 넣으면 결과가 같다** (시계를 읽지 않는다는 증거)
3. `overdue=1`이면 `isOverdue`인 건만 남는다
4. `parseTaskQuery`: `?team=edit&team=shoot` → `teamKeys: ['edit','shoot']`
5. `?team=hr` → 던진다 / `?limit=0`·`?limit=abc` → 던진다
6. 모르는 키(`?foo=1`)는 무시된다
7. `meta.mode`·`readOnly`가 `storage`의 값과 같다

## Acceptance Criteria

```bash
npx vitest run src/lib/api

# raw 배제가 zod로 강제된다 (둘 다 출력이 있어야 함)
grep -n "strict()" src/lib/api/task-response.ts
grep -n "taskResponseSchema.parse\|schema.parse" src/lib/api/task-response.ts

# 마스킹을 직접 구현하지 않았다 (출력이 있어야 함)
grep -n "maskExtras" src/lib/api/task-response.ts

# 시간을 주입받는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/api/read-context.ts src/lib/api/task-response.ts ; test $? -eq 1

# 집계를 다시 구현하지 않았다 — 도메인을 부른다 (출력이 있어야 함)
grep -n "deriveAllFlags\|buildSemanticIndex\|kstToday" src/lib/api/read-context.ts

# 응답에 raw가 없다 (출력이 비어야 함)
grep -n "raw" src/lib/api/task-response.ts | grep -v "제외\|금지\|없\|raw를" ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - **`raw`가 든 객체를 스키마에 넣으면 실제로 던지는가?** (완료 기준 9의 증거)
   - `member`에게 연락처가 가려지고 `admin`에게 보이는가?
   - `buildReadContext`가 라우트 대신 필터링·플래그 계산을 **전부** 하는가?
     (남는 것이 있으면 라우트가 계산하게 된다 — 완료 기준 1)
   - `progress: 0`이 살아남는가?
   - `src/lib/api/` 파일명이 `src/lib/` 전역에서 유니크한가?
3. `phases/t5-api-upload/index.json`의 step 6을 갱신한다 (형식은 step 0과 동일).

## 금지사항

- `raw`를 손으로 빼고 zod 강제를 생략하지 마라. 이유: 언젠가 빠뜨리고, 그날 연락처가 API로 나간다
  (`CLAUDE.md` CRITICAL).
- 마스킹·상태 매핑·플래그 계산을 이 파일에서 새로 구현하지 마라. 이유: 규칙이 두 곳에 생기면
  화면과 API의 판정이 갈라진다.
- `overdue` 필터를 `TaskFilter`에 넣지 마라. 이유: 저장소는 판정하지 않는다 (`ADR-006`).
- `new Date()`를 부르지 마라. 이유: `CLAUDE.md` CRITICAL — 시계는 라우트가 읽어 주입한다.
- `TaskEvent`를 응답에 싣지 마라. 이유: T5 화면에 쓸 데가 없고, 이력이 노출 면적을 넓힌다.
- 라우트 핸들러를 만들지 마라. 이유: step 7·8의 범위다.
- 설정 탭 레지스트리를 저장하거나 조회하려 하지 마라. 이유: step 2에서 저장하지 않기로 확정했고
  도메인이 내장 표로 폴백한다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
