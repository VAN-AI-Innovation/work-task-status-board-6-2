# Step 3: upload-record-store

## 읽어야 할 파일

- `CLAUDE.md` — `src/services/`를 쓰지 않는다(외부 연동은 `lib/store/`가 감싼다), 보안 규칙, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **3**(확정 전 무변경)·**13**(확정 후 `parse_result`를 비운다)
- `docs/ADR.md` — `ADR-008`(미리보기→확정 2단계), `ADR-005`(폴백은 읽기 전용), `ADR-004`
- `docs/PLAN.md` — 「보안」 `S6`(`parse_result`에 개인정보가 통째로 들어간다),
  「아키텍처 검증」 `A8`, 「업로드 상태 전이」
- `docs/ARCHITECTURE.md` — 「데이터 흐름」의 미리보기→확정 설명, 「저장소 · 시연 안전망」
- `supabase/migrations/0001_init.sql`의 `uploads` 테이블 **정의와 그 위 주석**
- T4 산출물: `src/lib/store/store-factory.ts`(`StorageHandle`·`createStorage`·`getStorage`),
  `src/lib/store/memory-task-store.ts`(깊은 복사 규칙),
  `src/lib/store/supabase-task-store.ts`(매퍼·에러 처리 방식)
- step 2 산출물: `CommitPayload`

## 배경

`ADR-008`의 2단계는 **서버 세션 상태 없이** 성립해야 한다. 파싱 결과를 메모리에 들고 있으면
서버리스 인스턴스가 바뀌는 순간 확정이 실패한다. 그래서 `uploads.parse_result`에 넣는다.

`TaskRepository`는 업무만 안다. 업로드 레코드는 **다른 종류의 저장소**이고, 인터페이스를
따로 둔다 — `TaskRepository`에 메서드를 더하면 T4의 계약 테스트 19항목이 전부 흔들린다.

이 step의 급소 둘.

1. **`parse_result`는 개인정보 덩어리다** (`S6`). 원본 행이 통째로 들어 있다.
   **확정 즉시 비우고 `summary`만 남긴다** (완료 기준 13). 이건 성능이 아니라 보안 조치다.
2. **같은 업로드를 두 번 확정하면 안 된다.** 사용자가 버튼을 두 번 누르는 일은 반드시 일어난다.
   `get` → 검사 → `update` 사이에 경합이 있으므로 **조건부 갱신**으로 막는다.

## 작업

### 1. `src/lib/store/upload-record-store.ts` — 테스트를 **먼저** 쓴다

한 파일에 인터페이스와 구현 둘을 담는다. `task-repository`와 달리 계약 테스트를 별도 파일로
빼지 않는다 — 메서드가 4개뿐이고, 파일을 셋으로 쪼개면 읽는 비용이 값어치를 넘는다.
**다만 두 구현은 같은 테스트 함수를 공유하라** (`describeUploadStoreContract(label, create)`를
같은 파일에서 export하고 테스트가 두 번 부른다). 복사한 순간 계약이 아니게 된다.

```ts
/** 0001_init.sql의 check 제약과 같아야 한다 */
export type UploadStatus =
  | 'validating' | 'parsing' | 'previewing' | 'committing' | 'done' | 'failed';

export interface UploadSummary {
  created: number;
  updated: number;
  unchanged: number;
  goalMetricsCreated: number;
  goalMetricsUpdated: number;
  warningCount: number;
  teamKeys: string[];
}

export interface UploadRecord {
  id: string;
  kind: 'sheet' | 'doc';
  filename: string | null;
  status: UploadStatus;
  /** 확정 후에는 **반드시 null**이다 (S6·완료 기준 13) */
  parseResult: CommitPayload | null;
  summary: UploadSummary | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface UploadRecordStore {
  create(input: {
    kind: 'sheet' | 'doc';
    filename: string | null;
    parseResult: CommitPayload;
    createdAt: string;
  }): Promise<UploadRecord>;

  get(id: string): Promise<UploadRecord | null>;

  /** `previewing`인 행만 `done`으로 옮기고 `parse_result`를 **비운다**.
   *  조건에 안 맞으면(없음·이미 확정됨) `null` — 호출자가 409를 낸다 */
  markCommitted(id: string, summary: UploadSummary): Promise<UploadRecord | null>;

  /** 확정 실패. `parse_result`는 **남긴다** — 재시도가 같은 입력으로 돌아야 한다 */
  markFailed(id: string): Promise<UploadRecord | null>;
}

export function createMemoryUploadStore(): UploadRecordStore & { clear(): void };
export function createSupabaseUploadStore(client: SupabaseClient): UploadRecordStore;
```

규칙:

- **행은 `previewing`부터 만든다.** `validating`·`parsing`은 클라이언트 화면 상태이고 DB에
  행이 생기기 전이다 (`0001_init.sql` 주석이 `idle`·`rejected`에 대해 이미 같은 말을 한다).
  파싱에 실패한 업로드가 테이블에 쓰레기를 쌓지 않는다. **이 결정을 파일 주석에 남기고,
  `0001_init.sql`의 `uploads` 위 주석에도 한 줄 덧붙여라** (SQL 본문은 고치지 마라 —
  이미 적용된 마이그레이션이다).
- 메모리 구현: `Map`이면 충분하다. **읽기·쓰기 모두 깊은 복사**한다
  (`memory-task-store`와 같은 이유 — 호출자가 고쳐도 저장소가 오염되면 안 된다).
  id는 `crypto.randomUUID()`.
- Supabase 구현: `parse_result`·`summary`는 `jsonb`라 그대로 넣고 받는다.
  `markCommitted`는 **`.eq('status', 'previewing')`을 붙인 update**로 경합을 막고,
  `.select()`가 0행이면 `null`을 돌려준다.
  에러는 `Error`로 던지되 **메시지에 파일명·행 내용을 담지 마라** (테이블 이름과 동작까지만).
- `markCommitted`는 `parse_result`를 **`null`로 명시적으로 덮는다.** 지우는 것을 잊으면
  완료 기준 13이 깨지고 개인정보가 남는다.

`describeUploadStoreContract`가 검증할 것:

1. `create` → `get`이 같은 레코드를 준다. `status`가 `previewing`이고 `parseResult`가 살아 있다
2. `get('없는id')` → `null`
3. `markCommitted` 후 `status: 'done'`, **`parseResult === null`**, `summary`가 들어 있다
4. **`markCommitted`를 두 번 부르면 두 번째는 `null`** (중복 확정 방어)
5. `markFailed` 후 `status: 'failed'`이고 **`parseResult`가 그대로 살아 있다** (재시도 가능)
6. `markFailed` 후 `markCommitted`가 성공하지 않는다 (`previewing`이 아니므로 `null`)
7. 저장소가 돌려준 레코드를 호출자가 고쳐도 저장소 내부가 바뀌지 않는다
8. `createdAt`이 인자로 준 값 그대로다 (**저장소가 시계를 읽지 않는다**)

Supabase 쪽 테스트는 `describe.skipIf(!canRun)`로 감싸라 —
`src/lib/store/supabase-task-store.test.ts`가 쓰는 방식과 **같게** 한다.
격리는 `filename`을 `'contract::'`로 시작하게 만들고 `reset`이 그 접두사 행만 지운다.
**필터 없는 `delete()`를 쓰지 마라.**

### 2. `src/lib/store/store-factory.ts`를 넓힌다

```ts
export interface StorageHandle {
  repo: TaskRepository;
  uploads: UploadRecordStore;   // ← 추가
  driver: StorageDriver;
  mode: StorageMode;
  readOnly: boolean;
}
```

- `live` → `createSupabaseUploadStore(client)`
- `demo`·`fallback` → `createMemoryUploadStore()`
- **`fallback`에서 업로드 레코드 쓰기를 따로 막지 마라.** 읽기 전용 모드에서는 업로드 경로
  **전체**를 라우트가 `503 STORAGE_READONLY`로 거부한다 (step 7). 여기서 또 막으면 같은 규칙이
  두 곳에 생긴다. 이 이유를 주석에 남겨라.
- `store-factory.test.ts`에 `uploads`가 모드별로 올바른 구현인지 확인하는 케이스를 **추가**한다.
  기존 케이스를 고치지 마라.
- `docs/ARCHITECTURE.md`의 `lib/store/` 트리에 `upload-record-store`를 넣어라 (**트리 줄만**).

## Acceptance Criteria

```bash
npx vitest run src/lib/store

# 두 구현이 같은 계약을 통과한다 (2건 이상 나와야 함)
grep -rn "describeUploadStoreContract" src/lib/store/

# 확정 시 parse_result를 비운다 (출력이 있어야 함)
grep -n "parseResult: null\|parse_result: null" src/lib/store/upload-record-store.ts

# 중복 확정을 조건부 갱신으로 막는다 (출력이 있어야 함)
grep -n "previewing" src/lib/store/upload-record-store.ts

# 필터 없는 delete가 없다 (출력이 비어야 함)
grep -nE "\.delete\(\)\s*$|\.delete\(\)\.then" src/lib/store/upload-record-store.ts ; test $? -eq 1

# 저장소가 시계를 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/store/upload-record-store.ts ; test $? -eq 1

# 저장소가 판정하지 않는다 (출력이 비어야 함)
grep -nE "isOverdue|toSemantic|diffTaskFields|buildUploadPreview" src/lib/store/upload-record-store.ts ; test $? -eq 1

# 회귀 — T4 계약 테스트가 그대로 통과한다
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. Supabase 자격증명이 `.env.local`에 있으면 supabase 갈래도 **실제로 돌려** 계약이 통과하는지
   확인한다. 없으면 `skipIf`로 건너뛰되 **`completed`로 적어도 된다** —
   step 3의 본체는 인터페이스와 메모리 구현이고, supabase 갈래는 T4 step 9에서 이미 확보한
   연결 위에 얹는 것이다. 단 **건너뛴 사실을 `summary`에 명시하라.**
3. 체크리스트:
   - `markCommitted` 후 `parseResult`가 정말 `null`인가? (완료 기준 13 = 개인정보 조치)
   - 두 번째 `markCommitted`가 `null`인가?
   - `markFailed`가 `parseResult`를 남기는가? (남기지 않으면 재시도가 불가능해진다)
   - `StorageHandle.uploads`가 세 모드에서 각각 올바른 구현인가?
   - `ARCHITECTURE.md` 트리에 `upload-record-store`가 있는가? (트리 줄만 고쳤는가)
4. `phases/t5-api-upload/index.json`의 step 3을 갱신한다 (형식은 step 0과 동일).

## 금지사항

- `TaskRepository`에 업로드 메서드를 더하지 마라. 이유: T4 계약 테스트 19항목과 두 구현이
  전부 흔들린다.
- 확정 후 `parse_result`를 남기지 마라. 이유: 원본 행에 실명·연락처·문의자 계정이 있다 (`S6`).
- `markFailed`에서 `parse_result`를 지우지 마라. 이유: 재시도가 같은 입력으로 돌아야 한다
  (상태 전이도의 `committing → failed → previewing` 경로).
- `get` 결과만 보고 확정을 승인하지 마라. 이유: 버튼 두 번 클릭이 경합을 만든다. 조건부 갱신으로 막는다.
- 저장소 안에서 `new Date()`를 부르지 마라. 이유: `CLAUDE.md` CRITICAL — 시간은 주입받는다.
- 계약 테스트를 구현별로 복사하지 마라. 이유: 복사한 순간 계약이 아니게 된다.
- 새 마이그레이션 파일을 만들거나 `0001_init.sql`의 SQL 본문을 고치지 마라. 이유: `uploads`
  테이블은 이미 있고 스키마 변경이 필요 없다. 이미 적용된 파일을 고치면 두 환경이 갈라진다.
- 업로드 확정 로직(upsert 호출)을 여기 넣지 마라. 이유: step 4의 범위다. 이 파일은 레코드만 안다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
