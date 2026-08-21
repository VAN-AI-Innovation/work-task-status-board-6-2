# Step 10: store-factory + 시드

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, 보안 규칙
- `docs/ADR.md` — **`ADR-004`**(메모리는 시연 안전망), **`ADR-005`**(폴백은 읽기 전용)
- `docs/TICKETS.md` — `## T4` 완료 기준 **9**, 「인터페이스 경계」의 폴백 문단
- `docs/PLAN.md` — 「9. 시연 리스크 완화」 2·3·4번, 「온보딩 여정 — 첫 5분」,
  `A2`(폴백이 쓰기를 삼킨다)
- `docs/ARCHITECTURE.md` — 「저장소 · 시연 안전망」, 「에러 처리」의 코드 목록
  (`STORAGE_READONLY`·`STORAGE_UNAVAILABLE`)
- step 7·9 산출물, `src/lib/sheet/sheet-pipeline.ts`(`parseWorkbook`)
- `scripts/fixtures/build-sample-workbook.mjs` — 이 저장소가 스크립트를 쓰는 방식의 선례

## 배경

T4의 마지막 조각이다. 세 가지를 한다:

1. **드라이버 선택과 읽기 전용 폴백** — `ADR-005`의 실체. Supabase 연결 실패 시 memory로
   전환하되 **쓰기는 막는다.** 폴백 중 쓰기를 메모리에 받으면 사용자는 저장됐다고 믿고
   재시작하면 조용히 사라진다. **조용한 데이터 유실이 조회 불가보다 나쁘다.**
2. **의도된 데모 모드와 장애 폴백의 구분** — 둘 다 memory를 쓰지만 화면 문구가 달라야 한다.
   `STORAGE_DRIVER=memory`는 정상이고, 폴백은 사고다.
3. **시드** — `seed-tasks.json`은 손으로 지은 가짜가 아니라 **픽스처를 파서로 돌려 만든**
   결과물이다 (`PLAN.md` 「9. 시연 리스크 완화」 3번). 심사자가 키 없이 클론해서
   `STORAGE_DRIVER=memory npm run dev`로 바로 데이터를 본다 (완료 기준 9).

## 작업

### 1. `src/lib/store/store-factory.ts` — 테스트를 **먼저** 쓴다

```ts
export type StorageDriver = 'supabase' | 'memory';
export type StorageMode = 'live' | 'demo' | 'fallback';

export interface StorageHandle {
  repo: TaskRepository;
  driver: StorageDriver;
  mode: StorageMode;
  readOnly: boolean;
}

export class StorageReadOnlyError extends Error {
  readonly code = 'STORAGE_READONLY';
}

/** 환경을 **인자로 받는다.** `process.env`를 직접 읽지 않는다 (테스트 가능성) */
export async function createStorage(env: NodeJS.ProcessEnv): Promise<StorageHandle>;

/** 앱이 쓰는 진입점. 한 번만 만들고 재사용한다 */
export async function getStorage(): Promise<StorageHandle>;
```

판정 규칙:

| `STORAGE_DRIVER` | Supabase 연결 | `driver` | `mode` | `readOnly` |
|---|---|---|---|---|
| `memory` | — | `memory` | `demo` | **false** |
| `supabase`(기본) 또는 미설정 | 성공 | `supabase` | `live` | false |
| `supabase`(기본) 또는 미설정 | 실패 | `memory` | `fallback` | **true** |

- 연결 확인은 **가벼운 조회 1회**로 한다 (`teams`를 1행 `select`). 실패·예외·`null` 클라이언트가
  전부 폴백 사유다. 예외를 위로 던지지 마라.
- `readOnly`일 때 쓰기 메서드(`upsertTasks`·`upsertGoalMetrics`·`recordEvents`)는
  **`StorageReadOnlyError`를 던진다.** 읽기는 그대로 동작한다.
  구현은 리포지토리를 감싸는 얇은 래퍼 하나로 한다 — memory 구현을 고치지 마라.
- `getStorage`는 모듈 스코프에 `Promise`를 캐시한다. **연결 실패도 캐시된다** —
  매 요청마다 죽은 DB에 붙으러 가면 화면 전체가 느려진다.
  다시 시도하는 수단(`resetStorage()`)을 하나 두되 테스트 전용임을 주석에 남겨라.
- `mode`가 `demo`인지 `fallback`인지가 배너 문구를 가른다 (`ADR-005`).
  **문구 문자열을 이 파일에 넣지 마라** — 화면 문구는 T6의 일이다. 모드만 알려준다.

### 2. `scripts/fixtures/build-seed-tasks.ts` — 시드 생성기

- `src/lib/fixtures/sample-workbook.xlsx`를 `parseWorkbook`으로 돌린 결과를
  `Task`·`TaskStage`·`GoalMetric` 모양으로 옮겨 `src/lib/fixtures/seed-tasks.json`에 쓴다.
- **id는 결정적으로** 만든다. `crypto.randomUUID()`를 쓰면 재생성할 때마다 diff가 통째로
  바뀌어 리뷰가 불가능하다. `teamId`와 `sourceKey`로 만든 안정 문자열
  (예: `seed-edit-0001`)이면 충분하다. uuid 형식이 필요하면 `sourceKey`의 SHA-256을
  uuid v5 모양으로 잘라 쓰되, **입력이 같으면 항상 같은 값**이어야 한다.
- `lastProgressAt`·`sourceUploadId`는 `null`. 날짜를 박으면 시드가 시간이 지나며
  "장기 미갱신"으로 물든다.
- 실행: `npx vite-node scripts/fixtures/build-seed-tasks.ts`
  (`vite-node`는 vitest와 함께 이미 설치돼 있다. **새 의존성을 추가하지 마라.**)
  `package.json`에 `"seed:build"` 스크립트를 추가한다.
- **`raw`는 시드에서 뺀다.** 픽스처는 익명화됐지만 `raw`는 크고 화면에 쓰이지 않는다.
  `extras`는 남긴다 — 사이드 패널 데모(`UC-15`)가 그걸 쓴다.
- 이 스크립트는 `scripts/` 아래라 `exceljs` 규칙의 예외이지만, **직접 `exceljs`를 import하지 마라.**
  `parseWorkbook`을 부르는 것으로 충분하고, 그래야 "파서가 실제로 돈다"는 주장이 참이 된다.

### 3. `src/lib/fixtures/seed-tasks.json`

생성 결과를 커밋한다. **손으로 고치지 마라** — 고치는 순간 "파서가 만든 결과물"이 아니게 된다.
형태:

```json
{ "generatedFrom": "sample-workbook.xlsx", "tasks": [...], "stages": [...], "goalMetrics": [...] }
```

### 4. `.env.example`

키 값을 **넣지 말고** 이름과 한 줄 설명만 쓴다.

```
STORAGE_DRIVER=memory
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` 줄 위에 "서버 전용. `NEXT_PUBLIC_`을 붙이지 마라" 주석을 단다.
`.env.example`은 `.gitignore`의 `.env*`에 걸린다 — **`!.env.example` 예외를 추가**해
커밋되게 하라. 이 한 줄 외에 `.gitignore`를 건드리지 마라.

### 5. 테스트 케이스 (`src/lib/store/store-factory.test.ts`)

1. `STORAGE_DRIVER=memory` → `driver: 'memory'`, `mode: 'demo'`, `readOnly: false`
2. **`STORAGE_DRIVER=memory`에서 `upsertTasks`가 성공한다** (데모 모드는 쓰기가 된다)
3. Supabase 키가 없는 환경 → `mode: 'fallback'`, `readOnly: true`
4. **`readOnly`에서 `upsertTasks`가 `StorageReadOnlyError`를 던지고 `code`가 `STORAGE_READONLY`**
5. `readOnly`에서 `upsertGoalMetrics`·`recordEvents`도 던진다
6. **`readOnly`에서 `listTasks`·`getTask`·`listStages`는 정상 동작한다**
7. 연결 확인이 예외를 던져도 `createStorage`가 예외를 밖으로 내보내지 않는다
8. `demo`와 `fallback`이 **다른 `mode` 값**이다 (배너 문구를 가르는 근거)
9. **`STORAGE_DRIVER=memory`에서 시드가 로드돼 `listTasks()`가 픽스처 태스크 9건을 낸다**
   (T4 완료 기준 9의 직접 증명)
10. 시드의 `goalMetrics`가 3건이고 `stages`가 편집팀 5건 × 3단계 = 15건이다
11. **시드 JSON에 `raw` 키가 없고, `연락처`·`계정`이 든 `extras`는 값째로 남아 있다**
    (마스킹은 응답 계층의 일이다 — 파싱·저장 단계에서 지우면 admin도 못 본다)
12. `getStorage()`를 두 번 불러도 같은 인스턴스다

## Acceptance Criteria

```bash
npx vitest run src/lib/store/store-factory.test.ts

# 완료 기준 9 — 키 없이 시드가 로드된다
STORAGE_DRIVER=memory npx vitest run src/lib/store/store-factory.test.ts

# 시드가 파서 산출물이다 (생성기를 다시 돌려도 파일이 같아야 한다)
npm run seed:build && git diff --exit-code src/lib/fixtures/seed-tasks.json

# 시드에 raw가 없다 (출력이 비어야 함)
grep -c '"raw"' src/lib/fixtures/seed-tasks.json ; test "$(grep -c '"raw"' src/lib/fixtures/seed-tasks.json)" = "0"

# .env.example이 커밋 대상이고 키 값이 없다
git check-ignore -v .env.example ; test $? -eq 1
grep -nE "eyJ|=.+" .env.example

# NEXT_PUBLIC_ service_role 위반이 없다
npm run guard:env

# 새 의존성이 없다 — step 9의 @supabase/supabase-js 외에 늘지 않았다
git diff HEAD -- package.json

# 회귀 — 전체
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **`STORAGE_DRIVER=memory npm run dev`로 서버를 띄워 부팅이 되는지 확인**한다
   (화면은 T6라 비어 있어도 된다. 확인할 것은 **키 없이 죽지 않는다**는 것이다).
   확인 후 서버를 내린다.
3. 체크리스트:
   - `demo`와 `fallback`이 구분되는가? (`ADR-005`)
   - 폴백에서 쓰기가 정말 막히는가? 읽기는 되는가?
   - 시드가 생성기 재실행으로 재현되는가? (손으로 고치지 않았다는 증거)
   - `.env.example`에 실제 키 값이 없는가?
4. **T4 완료 기준 9개를 하나씩 대조**하고, 각 기준이 어느 테스트로 증명되는지 파일명과
   테스트 이름을 적어라. 증명이 없는 기준이 있으면 그렇다고 명시하라 (T3 step 8의 선례).
5. `phases/t4-store-domain/index.json`의 step 10을 갱신한다:
   - `"summary"`에 **완료 기준 9개 대조표**와 시드 실측 건수를 포함하라.

## 금지사항

- 폴백 상태에서 쓰기를 메모리에 받지 마라. 이유: `ADR-005`, `A2` — 조용한 데이터 유실이다.
- 배너 문구·UI 문자열을 `store-factory.ts`에 넣지 마라. 이유: T6의 일이다. 모드만 알려준다.
- `seed-tasks.json`을 손으로 만들거나 고치지 마라. 이유: "파서가 실제로 돈다"는 주장이 거짓이 된다.
- 시드에 랜덤 id·현재 시각을 넣지 마라. 이유: 재생성 때마다 diff가 통째로 바뀐다.
- 시드의 `extras`에서 개인정보를 지우지 마라. 이유: 마스킹은 응답 계층(T5·T6)의 일이고,
  여기서 지우면 admin도 못 본다. 픽스처는 이미 익명화돼 있다.
- 새 npm 의존성을 추가하지 마라. 이유: `vite-node`는 이미 있다.
- 화면·API 라우트를 만들지 마라. 이유: T5·T6의 범위다.
- `.gitignore`에 `!.env.example` 외의 변경을 하지 마라.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
