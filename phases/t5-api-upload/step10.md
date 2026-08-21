# Step 10: empty-state-seed

## 읽어야 할 파일

- `CLAUDE.md` — 계층 경계, 컴포넌트 규칙, `runtime = 'nodejs'`, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **11**(빈 상태 + `[샘플 데이터 불러오기]`)·**12**
  (서버 컴포넌트는 `lib/`를 직접 호출), `## T6`의 범위(**여기서 만들지 않는 것**)
- `docs/PLAN.md` — 「온보딩 여정 — 첫 5분」, 「에러 핸들링」 **`X3`(빈 상태 ≠ 에러 상태)**,
  「9. 시연 리스크 완화」 3·4번
- `docs/ADR.md` — `ADR-007`, `ADR-004`(메모리 드라이버는 시연 안전망), `ADR-005`
- `docs/UI_GUIDE.md` — 「AI 슬롭 안티패턴」, 「버튼」, 「배너」, 「레이아웃」
- `src/lib/store/store-factory.ts` — `createSeededMemoryStore`가 시드를 어떻게 읽는지
- `src/lib/fixtures/seed-tasks.json` — 모양(`tasks`에 `raw`가 없다)

## 배경

**첫 화면이 곧 평가다.** 심사자가 클론해서 열었을 때 백지를 보면 그 뒤는 없다
(`PLAN.md`「온보딩 여정」). 그리고 `X3`이 요구하는 것은 빈 상태 하나가 아니라 **넷의 구분**이다:

```
데이터 없음      → "아직 데이터가 없습니다"  [샘플 데이터 불러오기] [시트 업로드하기]
저장소 연결 실패  → "읽기 전용 — 저장소 연결 실패" 배너
조회 실패        → error.tsx 바운더리 + [다시 시도]
필터 결과 0건    → T6의 범위 (여기서는 만들지 않는다)
```

`STORAGE_DRIVER=memory`에서는 시드가 이미 들어 있어 빈 상태가 안 나온다. **빈 상태가 실제로
뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때**다. 그 경로를 테스트로 재현해야 한다.

**주의 — `/`의 본체는 T6이다.** 이 step은 대시보드를 만들지 않는다. 만들면 T6이 그것을
지우고 다시 짜게 된다. 여기서 만드는 것은 **빈 상태·에러 바운더리·샘플 적재 경로**뿐이고,
데이터가 있을 때의 `/`는 "N건 반영됨 + 링크 두 개"로 **최소**로 둔다.

## 작업

### 1. `src/lib/upload/seed-loader.ts` — 테스트를 **먼저** 쓴다

```ts
/** 시드 JSON → 저장소 입력. `store-factory`의 메모리 초기화와 **다른 경로**다 */
export function buildSeedPayload(): CommitPayload;
```

- `@/lib/fixtures/seed-tasks.json`을 읽어 `TaskUpsertInput[]`·`GoalMetricUpsertInput[]`로 만든다.
- **시드에는 `raw`가 없다**(`store-factory.ts` 주석이 그 이유를 적어 뒀다: 감사용 원본은 실제
  업로드만 만들 수 있다). `raw: {}`로 채운다.
- `id`·`lastProgressAt`은 입력 타입에 없다. `sourceUploadId`는 `null`.
- `stages`는 `seed.stages`를 `taskId`로 묶어 각 태스크의 `stages`에 넣는다.
- **`store-factory.ts`의 `createSeededMemoryStore`와 코드를 공유하려 하지 마라.**
  목적이 다르다 — 하나는 메모리 저장소의 **초기값**이고, 다른 하나는 실제 저장소에 **쓰는
  입력**이다. 이 중복은 의도된 것이고, 이유를 주석에 남겨라.

테스트: 태스크·목표 지표 건수가 시드와 같다 / `raw`가 전부 `{}` / `stages`가 태스크에 붙는다 /
`JSON` 왕복을 견딘다 / `teamId`가 세 팀 안에 든다.

### 2. `POST /api/uploads/seed` — `route.ts` + **같은 폴더의** `route.test.ts`

```
1. storage = await getStorage()
2. storage.readOnly → 503 STORAGE_READONLY
3. payload = buildSeedPayload()
4. record = await storage.uploads.create({ kind:'sheet', filename:'seed-tasks.json',
                                           parseResult: payload, createdAt: now })
5. commitUpload({...}, record.id, now)        ← step 4의 함수를 그대로 쓴다
6. Response.json({ summary })
```

**확정 경로를 재사용하는 것이 요점이다.** 시드 전용 쓰기 경로를 따로 만들면 실제 업로드와
다른 코드가 데이터를 만들게 되고, `PLAN.md`「시연 리스크 완화」 3번("가짜 UI가 아니라 파싱
로직이 실제로 돈다")이 무너진다. **두 번 눌러도 안전하다** — 멱등이라 전건 `unchanged`가 된다.

`export const runtime = 'nodejs'`를 잊지 마라. **이 라우트는 `ARCHITECTURE.md`의 API 목록에
없다** — 「디렉토리 구조」의 `api/` 줄에 `uploads/seed`를 추가하고, `docs/TICKETS.md` T5
「산출물」이나 「리스크·미결」에 "완료 기준 11의 버튼이 쓰기이므로 라우트가 하나 늘었다"를
한 줄 적어라.

테스트: 빈 메모리 저장소(시드 없이 만든 핸들)에서 호출 → 200이고 `listTasks()`가 늘어난다 /
두 번 호출해도 두 번째는 전건 `unchanged` / 읽기 전용에서 503.

### 3. `src/app/page.tsx` — 서버 컴포넌트로 교체

- `getStorage()` → `repo.listTasks({ limit: 1 })`·`getLastSyncedAt()`를 **직접** 부른다
  (`ADR-007`. 자기 API를 `fetch`하지 마라).
- 0건이면 **빈 상태**:
  - "아직 데이터가 없습니다" (`text-neutral-500`, 중앙 정렬 — `UI_GUIDE.md`가 중앙 정렬을
    금지하면서 **빈 상태 화면은 예외**로 뒀다)
  - `[샘플 데이터 불러오기]` — Primary 버튼. 클라이언트 컴포넌트
    `src/components/upload/seed-button.tsx`(`'use client'`)가 `POST /api/uploads/seed` 후
    `router.refresh()`
  - `[시트 업로드하기]` — Secondary, `/upload` 링크
  - **읽기 전용이면 샘플 버튼을 비활성**한다 (쓰기다).
- 1건 이상이면 **최소 화면**: 총 건수, "마지막 반영: N일 전"(5일 초과면 `text-amber-700`),
  `/upload` 링크. **대시보드·KPI·차트·표를 만들지 마라 — T6이다.**
- `mode`에 따른 배너는 step 9와 **같은 문구·같은 색**을 쓴다.
  문구를 두 곳에 복사하게 되면 `src/components/upload/storage-banner.tsx`로 빼서 공유하라.

### 4. `src/app/error.tsx`

- `'use client'`. `X3`의 「조회 실패」 갈래다.
- "화면을 불러오지 못했습니다" + `[다시 시도]`(`reset()`).
- **에러 메시지·스택을 화면에 렌더하지 마라** (`X1`). `digest`도 보여주지 마라.
- `src/app/teams/error.tsx`는 **만들지 마라** — `teams/` 라우트가 T6에서 생긴다.
  없는 디렉토리에 파일을 만들면 빌드가 지저분해진다.

## Acceptance Criteria

```bash
npx vitest run src/lib/upload src/app

# 확정 경로를 재사용한다 (출력이 있어야 함)
grep -n "commitUpload" src/app/api/uploads/seed/route.ts

# 시드 라우트에 자기 테스트가 있다 (출력이 있어야 함)
ls src/app/api/uploads/seed/route.test.ts

# 서버 컴포넌트가 자기 API를 부르지 않는다 (출력이 비어야 함)
grep -n "fetch(" src/app/page.tsx ; test $? -eq 1

# error.tsx가 내부 정보를 노출하지 않는다 (출력이 비어야 함)
grep -nE "error\.message|error\.stack|digest" src/app/error.tsx ; test $? -eq 1

# 대시보드를 만들지 않았다 (출력이 비어야 함 — 차트는 T6)
grep -rn "chart.js\|react-chartjs-2" src/app/page.tsx src/components ; test $? -eq 1

# 안티패턴 (출력이 비어야 함)
grep -rnE "backdrop-blur|bg-gradient|indigo-|violet-|blur-3xl|rounded-2xl" src/app/page.tsx src/app/error.tsx src/components/upload ; test $? -eq 1

# 문서에 늘어난 라우트가 반영됐다 (출력이 있어야 함)
grep -n "uploads/seed" docs/ARCHITECTURE.md

# 회귀 — 전부
npx vitest run

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **온보딩 여정을 처음부터 밟아라** (`PRD.md` 성공 기준 1번의 실체):
   ```bash
   STORAGE_DRIVER=memory npm run dev
   # / 를 연다 → 시드가 있으므로 최소 화면이 뜬다
   ```
   빈 상태를 실제로 보려면 시드 없는 핸들이 필요하다. **테스트로 재현하는 것으로 갈음하되,
   눈으로도 한 번 확인하고 싶다면 시드 파일을 잠깐 옮기지 말고** `page.tsx`의 0건 갈래를
   테스트에서 렌더해 확인하라 (픽스처를 건드리면 다른 테스트가 깨진다).
3. 체크리스트:
   - 0건일 때 빈 상태가, 1건 이상일 때 최소 화면이 뜨는가?
   - `[샘플 데이터 불러오기]`가 **실제 확정 경로**를 통과하는가? (가짜 데이터 주입이 아닌가)
   - 두 번 눌러도 데이터가 두 배가 되지 않는가?
   - 읽기 전용에서 샘플 버튼이 비활성이고 서버도 503으로 거부하는가?
     (**UI 숨김은 방어가 아니다**)
   - `error.tsx`가 스택을 노출하지 않는가?
   - 대시보드를 만들지 않았는가? (T6의 범위를 침범하지 않았는가)
4. **T5 전체 완료 기준 14개를 하나씩 대조하라.** `docs/TICKETS.md`의 T5 완료 기준을 읽으며
   각 항목이 어느 step에서 어떻게 충족됐는지 `summary`에 적어라. 충족되지 않은 항목이 있으면
   `error`로 남기고 무엇이 빠졌는지 쓴다.
5. `phases/t5-api-upload/index.json`의 step 10을 갱신하고, **`phases/index.json`의
   `t5-api-upload` 항목을 `completed`로 바꾼다**(완료 기준 대조에서 빠진 것이 없을 때만).

## 금지사항

- 시드 전용 쓰기 경로를 따로 만들지 마라. 이유: 실제 업로드와 다른 코드가 데이터를 만들면
  "파싱 로직이 실제로 돈다"는 시연 근거가 사라진다 (`PLAN.md` 9-3).
- `/`에 대시보드·KPI 스트립·차트·필터 바를 만들지 마라. 이유: T6의 범위다. 여기서 만들면
  T6이 지우고 다시 짠다.
- `src/app/teams/error.tsx`를 만들지 마라. 이유: `teams/` 라우트가 아직 없다.
- `error.tsx`에 에러 메시지·스택·`digest`를 렌더하지 마라. 이유: `X1` — 내부 정보가 샌다.
- 읽기 전용 모드에서 샘플 적재를 허용하지 마라. 이유: 메모리에 담기고 재시작 때 조용히
  사라진다 (`ADR-005`).
- 버튼 비활성만으로 방어했다고 여기지 마라. 이유: UI 숨김은 방어가 아니다. 서버도 거부해야 한다.
- `store-factory.ts`의 메모리 시드 경로를 `seed-loader`로 바꾸지 마라. 이유: 목적이 다르고,
  바꾸면 T4의 store-factory 테스트가 흔들린다.
- 대시보드용 새 의존성(차트 등)을 import하지 마라. 이유: T6의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
