# Step 4: upload-commit

## 읽어야 할 파일

- `CLAUDE.md` — 비즈니스 로직은 `src/lib/`에만, 결정이 바뀌면 PLAN.md를 먼저 고친다, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **3·4·13·14**와 「리스크·미결」
- `docs/PLAN.md` — 「에러 핸들링」 **`X4`(업로드 실패의 되돌림)**, 「업로드 상태 전이」, `UC-03`·`UC-04`
- `docs/ADR.md` — `ADR-008`(2단계·단일 트랜잭션), `ADR-005`(폴백은 읽기 전용), `ADR-006`
- `docs/ARCHITECTURE.md` — 「에러 처리」 코드 목록, 「저장소 · 시연 안전망」
- T4 산출물: `src/lib/store/task-repository.ts`(`UpsertOptions`·`UpsertResult`),
  `src/lib/store/store-factory.ts`(`StorageReadOnlyError`)
- step 2·3 산출물: `CommitPayload`, `UploadRecordStore`

## 배경

미리보기에서 확정으로 넘어가는 지점이다. 여기서 저장소에 **처음으로** 쓴다.

**원자성 문제를 정직하게 다뤄야 한다.** 완료 기준 14는 "upsert가 단일 트랜잭션으로 묶여 실패 시
부분 반영이 남지 않는다"이고 `X4`는 "메모리 드라이버는 스냅샷 후 교체"라고 적었다. 메모리는
그대로 가능하다. **Supabase는 불가능하다** — `supabase-js`에는 트랜잭션 API가 없고, 진짜
트랜잭션을 걸려면 Postgres 함수(RPC)를 새로 만들어야 한다. 그 길은 (a) `ADR-006`이 SQL로
밀어내지 않기로 한 로직을 SQL로 되돌리고, (b) 새 마이그레이션 적용이라는 **사용자 개입**을
만든다.

**확정 — 두 겹으로 간다.**

1. **메모리 드라이버는 스냅샷-교체로 실제 원자성을 보장한다** (`X4` 원안 그대로).
2. **Supabase는 원자적이지 않다.** `tasks` upsert 1문 + `goal_metrics` upsert 1문 +
   단계 교체(delete/insert) + 이벤트 insert로 나뉜다. 대신 **커밋을 멱등하게** 만든다 —
   실패하면 `parse_result`를 남긴 채 `failed`로 두고, **같은 입력으로 다시 확정하면 정확히
   같은 결과에 수렴한다.** 재시도 경로는 상태 전이도에 이미 있다(`committing → failed →
   previewing`).

멱등이 성립하는 근거: upsert 키가 `(team_id, source_key)`이고, 단계는 통째 교체이며,
이벤트는 `updated`인 건에만 생긴다. 두 번째 시도에서 이미 반영된 건은 `unchanged`가 되고
`last_progress_at`도 움직이지 않는다 (T4 계약 3·5번).

**이 결정을 문서에 반영하라.** `CLAUDE.md`: 결정이 바뀌면 코드보다 PLAN.md를 먼저 고친다.

## 작업

### 1. 문서를 먼저 고친다

- **`docs/PLAN.md` `X4`** — "upsert를 단일 트랜잭션으로 묶는다(메모리 드라이버는 스냅샷 후
  교체)" 문단에, Supabase에는 트랜잭션 API가 없어 **멱등 재시도**로 대신한다는 사실과 그 근거,
  그리고 진짜 트랜잭션이 필요해지면 **RPC로 승격한다**는 후속 경로를 덧붙여라.
  기존 문장을 지우지 말고 이어 쓴다.
- **`docs/TICKETS.md` T5 완료 기준 14** — "단일 트랜잭션"을
  "메모리는 스냅샷-교체로 원자적이고, Supabase는 멱등 재시도로 부분 반영을 수렴시킨다"로
  고치고 근거를 한 줄 붙여라.
- **`docs/ADR.md`** — `ADR-008`의 「트레이드오프」에 이 갭을 한 줄 덧붙여라. ADR 항목을 지우지
  말고 덧붙이기만 한다 (문서 머리말의 규칙).

### 2. `src/lib/store/memory-task-store.ts`에 스냅샷-교체를 얹는다

```ts
/** 실패하면 호출 전 상태로 되돌린다. **메모리 드라이버의 원자성이 이것이다** (X4) */
runAtomically?<T>(fn: () => Promise<T>): Promise<T>;
```

`TaskRepository`에 **선택 메서드**로 추가한다(`runAtomically?`). Supabase 구현은 두지 않는다 —
없으면 호출자가 그냥 `fn()`을 부른다. **인터페이스에 필수로 넣지 마라**: 필수로 만들면 Supabase
구현이 "트랜잭션인 척하는 함수"를 갖게 되고, 그게 이 step에서 가장 피해야 할 거짓말이다.
이 이유를 타입 주석에 남겨라.

메모리 구현: 내부 `Map`들을 깊은 복사해 두고, `fn`이 던지면 복사본으로 되돌린 뒤 예외를
다시 던진다. T4 계약 테스트에 **케이스를 추가**하라 — 중간에 던지는 `fn`을 넣고 저장소가
호출 전과 같은지 확인한다. (`repository-contract.ts`에 항목을 추가하되, `runAtomically`가 없는
구현에서는 건너뛰도록 조건부로 둔다.)

### 3. `src/lib/upload/upload-commit.ts` — 테스트를 **먼저** 쓴다

```ts
export type CommitFailureCode =
  | 'UPLOAD_NOT_FOUND' | 'UPLOAD_ALREADY_COMMITTED' | 'STORAGE_READONLY' | 'STORAGE_UNAVAILABLE';

export type CommitOutcome =
  | { ok: true; summary: UploadSummary }
  | { ok: false; code: CommitFailureCode; message: string };

export function commitUpload(
  deps: { repo: TaskRepository; uploads: UploadRecordStore; readOnly: boolean },
  uploadId: string,
  /** 이벤트·`lastProgressAt`의 타임스탬프. **주입받는다** */
  occurredAt: string
): Promise<CommitOutcome>;
```

순서 — 이대로 한다.

1. `deps.readOnly`면 즉시 `STORAGE_READONLY`. **저장소를 건드리기 전에** 막는다 (`ADR-005`).
2. `uploads.get(id)` → 없으면 `UPLOAD_NOT_FOUND`.
3. `status !== 'previewing'` 이거나 `parseResult === null`이면 `UPLOAD_ALREADY_COMMITTED`.
4. `repo.runAtomically`가 있으면 그 안에서, 없으면 그대로:
   - `repo.upsertTasks(payload.tasks, { uploadId, occurredAt })`
   - `repo.upsertGoalMetrics(payload.goalMetrics, { uploadId, occurredAt })`
   - `repo.recordEvents(taskResult.events)` — **`events`가 비어 있으면 부르지 않는다**
5. 성공 → `uploads.markCommitted(id, summary)`. `null`이 오면(그 사이 누가 확정했다)
   `UPLOAD_ALREADY_COMMITTED`.
6. 어느 단계든 던지면 `uploads.markFailed(id)`를 부르고 `STORAGE_UNAVAILABLE`.
   **`markFailed`가 또 던져도 삼켜라** — 저장소가 죽은 상태에서 그것까지 실패하는 건 정상이고,
   그 예외가 원래 실패를 덮으면 안 된다.
7. `StorageReadOnlyError`(`code === 'STORAGE_READONLY'`)가 올라오면 `STORAGE_READONLY`로 옮긴다.

규칙:

- **어떤 경로에서도 태스크·목표 지표를 삭제하지 않는다.** 워크북에 없는 팀·행은 그대로 둔다.
  이것이 부분 업로드(`UC-04`)의 실체다. `delete`라는 단어가 이 파일에 나오면 안 된다.
- **`occurredAt`을 여기서 만들지 마라.** 라우트가 `new Date().toISOString()`으로 주입한다.
- `summary`는 `UpsertResult`의 숫자와 `payload.teamKeys`로 만든다. **업무명·담당자를 넣지 마라.**
- 실패 메시지는 사용자용 한국어 한 문장이고 원인 문자열을 이어 붙이지 않는다 (`X1`).

테스트 (`memory-task-store` + `createMemoryUploadStore`로 조립한다):

1. 정상 확정 → `ok: true`, `summary.created`가 payload 건수와 같고
   `uploads.get()`의 `status`가 `done`, **`parseResult`가 `null`**
2. **같은 업로드를 두 번 확정 → 두 번째는 `UPLOAD_ALREADY_COMMITTED`**이고
   저장소 건수가 늘지 않는다
3. **같은 payload를 새 업로드 레코드로 다시 확정 → 전건 `unchanged`, 이벤트 0건**
   (`UC-03` — 멱등성의 증거이자 완료 기준 14의 실질)
4. `readOnly: true` → `STORAGE_READONLY`이고 **저장소가 비어 있다**
5. 없는 id → `UPLOAD_NOT_FOUND`
6. `upsertTasks`가 던지는 가짜 repo → `STORAGE_UNAVAILABLE`,
   `uploads.get()`의 `status`가 `failed`이고 **`parseResult`가 살아 있다**
7. **`runAtomically`가 있는 메모리 저장소에서 `upsertGoalMetrics`가 던지면
   태스크 반영도 되돌아간다** (스냅샷-교체 확인)
8. **편집팀만 든 payload를 확정해도 촬영팀 기존 태스크가 그대로 남는다** (`UC-04`,
   완료 기준 4 — **타협 대상이 아니다**)
9. `summary`를 `JSON.stringify`했을 때 업무명·담당자가 없다

## Acceptance Criteria

```bash
npx vitest run src/lib/upload src/lib/store

# 삭제 경로가 없다 (출력이 비어야 함)
grep -nE "delete|remove|clear\(" src/lib/upload/upload-commit.ts ; test $? -eq 1

# 시간을 주입받는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/upload/upload-commit.ts ; test $? -eq 1

# 읽기 전용을 저장소 접근 전에 막는다 — 눈으로 확인하고, 코드가 있는지만 본다 (출력이 있어야 함)
grep -n "STORAGE_READONLY" src/lib/upload/upload-commit.ts

# 실패 시 parse_result가 남는다 (markFailed 호출이 있어야 함)
grep -n "markFailed" src/lib/upload/upload-commit.ts

# 문서가 갱신됐다 (셋 다 출력이 있어야 함)
grep -n "멱등" docs/PLAN.md
grep -n "멱등" docs/TICKETS.md
grep -n "멱등" docs/ADR.md

# 회귀 — T4 계약 테스트가 그대로 통과한다
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - **같은 payload를 다시 확정하면 전건 `unchanged`인가?** (멱등성 = 완료 기준 14의 실질)
   - 두 번째 확정이 `UPLOAD_ALREADY_COMMITTED`인가?
   - 확정 후 `parseResult`가 `null`, 실패 후 `parseResult`가 살아 있는가?
   - **편집팀만 올렸을 때 촬영팀 데이터가 남는가?** (완료 기준 4)
   - 읽기 전용에서 저장소에 아무것도 쓰이지 않는가?
   - `runAtomically`가 `TaskRepository`에 **선택 메서드**로 들어갔는가? (필수면 Supabase가
     거짓말을 하게 된다)
3. `phases/t5-api-upload/index.json`의 step 4를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 원자성 결론(메모리=스냅샷, Supabase=멱등 재시도)과 그 근거, 고친 문서 3곳,
   테스트 개수를 남겨라.

## 금지사항

- Postgres 함수(RPC)나 새 마이그레이션으로 트랜잭션을 만들지 마라. 이유: `ADR-006`이 SQL로
  밀어내지 않기로 한 로직을 되돌리고, 마이그레이션 적용이라는 사용자 개입을 만든다.
  필요해지면 그때 ADR을 고쳐 승격한다.
- Supabase 구현에 "트랜잭션인 척하는" `runAtomically`를 만들지 마라. 이유: 원자성을 보장하지
  않으면서 이름으로 보장하는 척하는 것이 이 step에서 가장 위험한 실수다.
- 확정 경로에서 `delete`를 쓰지 마라. 이유: 부분 업로드에서 다른 팀 데이터가 날아간다 (`UC-04`).
- 실패 시 `parse_result`를 지우지 마라. 이유: 재시도가 불가능해진다 (`X4`).
- `occurredAt`을 함수 안에서 만들지 마라. 이유: `CLAUDE.md` CRITICAL — 시간은 주입받는다.
- 읽기 전용 판단을 이 파일에서 다시 계산하지 마라(`process.env`를 읽지 마라).
  이유: `store-factory`가 이미 `readOnly`를 낸다. 규칙이 두 곳에 생기면 갈라진다.
- `summary`·에러 메시지에 업무명·담당자·셀 값을 담지 마라. 이유: `CLAUDE.md` 보안 규칙.
- 라우트 핸들러·화면을 만들지 마라. 이유: step 7·9의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
