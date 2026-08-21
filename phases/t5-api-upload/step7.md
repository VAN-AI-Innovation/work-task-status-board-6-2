# Step 7: api-upload-routes

## 읽어야 할 파일

- `CLAUDE.md` — **`src/app/api/**`에 `export const runtime = 'nodejs'` 명시**, 계층 경계, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **1·2·3·5·6·7·8·10·13·14**, 「리스크·미결」의 Next 16 `params`
- `docs/PLAN.md` — 「업로드 상태 전이」, `UC-01`~`UC-04`, 「에러 핸들링」 `X1`·`X2`
- `docs/ADR.md` — `ADR-007`(API는 클라이언트 상호작용 전용), `ADR-008`, `ADR-005`
- `docs/ARCHITECTURE.md` — 「계층 경계」·「디렉토리 구조」의 `api/` 줄·「에러 처리」
- step 0~6 산출물 전부. 특히 `checkUpload`·`runWorkbookParse`·`buildUploadPreview`·
  `commitUpload`·`errorResponse`·`getStorage`

## 배경

여기서 라우트가 처음 생긴다. **이 step의 성패는 "라우트에 계산이 0줄인가"** 하나다
(완료 기준 1). 앞의 일곱 step은 전부 이 줄 수를 0으로 만들기 위한 준비였다.

⚠ **`.claude/hooks/tdd-guard.sh`는 `route.ts`를 예외로 두지 않는다.** 예외는
`page.tsx`·`layout.tsx`·`error.tsx`·`components/`·`types/`뿐이다. 즉
**`src/app/api/**/route.ts`를 쓰려면 같은 폴더에 `route.test.ts`가 먼저 있어야 한다.**
가드는 basename만 보므로 `src/__tests__/route.test.ts`를 하나 만들면 **모든 라우트가 무검사로
뚫린다.** 절대 그렇게 하지 마라 — 각 라우트 폴더에 **자기 테스트**를 둔다.

⚠ Next 16에서 동적 세그먼트 `params`는 **Promise**다: `const { id } = await params;`

## 작업

만들 것은 셋이다. 각각 `route.ts` + **같은 폴더의** `route.test.ts`.

```
src/app/api/uploads/sheet/route.ts          POST  파일 → 미리보기
src/app/api/uploads/[id]/commit/route.ts    POST  확정
src/app/api/health/route.ts                 GET   저장소 상태
```

세 파일 모두 첫 줄 근처에 `export const runtime = 'nodejs';`를 둔다 (ExcelJS가 Node 내장
모듈을 쓴다).

### 1. `POST /api/uploads/sheet`

```
1. storage = await getStorage()
2. storage.readOnly → errorResponse('STORAGE_READONLY')      ← 저장소를 건드리기 전에
3. formData()에서 file 꺼내기. 없으면 VALIDATION_FAILED
4. bytes = new Uint8Array(await file.arrayBuffer())
5. checkUpload({ filename: file.name, bytes, expect: 'sheet' })  → ok:false면 그 코드로 응답
6. now = new Date();  baseYear = Number(kstToday(now).slice(0, 4))
7. runWorkbookParse(bytes, { baseYear, limits: WORKBOOK_LIMITS })  → ok:false면 그 코드로 응답
8. existing = await storage.repo.listTasks()                  ← 대조용 읽기. 쓰기 아님
9. buildUploadPreview(parsed, existing, null)                 → NO_KNOWN_TAB이면 422
10. record = await storage.uploads.create({ kind:'sheet', filename: file.name,
                                            parseResult: payload,
                                            createdAt: now.toISOString() })
11. Response.json({ upload: { id, status, filename }, preview }, { status: 200 })
```

**규칙**

- **`file.size`를 믿지 말고 `bytes.length`로 검사하라** — `checkUpload`가 이미 그렇게 한다.
  다만 4MB 상한을 **바이트를 다 읽기 전에** 한 번 더 걸고 싶다면 `file.size`로 조기 거부해도
  된다. 그 경우에도 `checkUpload`를 건너뛰지 마라.
- **`uploads` 행은 미리보기 성공 후에만 만든다.** 거부·파싱 실패는 행을 남기지 않는다.
  `validating`·`parsing`은 클라이언트 화면 상태다 (step 3에서 확정).
- 응답의 `preview`는 `buildUploadPreview`가 준 객체 **그대로**다. 라우트가 숫자를 다시
  더하거나 문구를 만들지 마라.
- `now`를 **여기서** 만든다. 시계를 읽는 것은 요청 경계의 일이고, 그 아래 계층은 전부 주입받는다
  (`CLAUDE.md` CRITICAL의 대상은 도메인 함수다).
- `try/catch`로 전체를 감싸고 예상 못 한 예외는 `STORAGE_UNAVAILABLE`로 접는다.
  **예외 메시지를 응답에 넣지 마라.**

### 2. `POST /api/uploads/[id]/commit`

```ts
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> })
```

```
1. const { id } = await params;   ← Next 16
2. storage = await getStorage()
3. commitUpload({ repo: storage.repo, uploads: storage.uploads, readOnly: storage.readOnly },
                 id, new Date().toISOString())
4. ok:false → errorResponse(code)     (404 / 409 / 503 이 여기서 갈린다)
5. ok:true  → Response.json({ upload: { id, status: 'done' }, summary })
```

본문은 읽지 않는다. **탭 선택 확정은 범위 밖이다** — 부분 업로드는 "파일에 든 탭만 반영"이지
"사용자가 탭을 고른다"가 아니다 (`UC-04`). 본문을 받기 시작하면 스펙이 늘어난다.

### 3. `GET /api/health`

```
{ ok: true, driver, mode, readOnly, lastSyncedAt }
```

`getStorage()`와 `repo.getLastSyncedAt()`만 부른다. **비밀·키·프로젝트 URL을 절대 싣지 마라.**

### 4. 테스트 — 라우트 함수를 직접 부른다

`STORAGE_DRIVER=memory`로 두고 `resetStorage()`를 `beforeEach`에서 부른다
(`store-factory.ts`가 핸들을 캐시한다).

`src/app/api/uploads/sheet/route.test.ts`:

1. **픽스처 xlsx를 `FormData`에 담아 POST → 200**, 본문에
   `preview.totals.created`가 0보다 크고 `upload.id`가 있다 (`UC-01`)
2. **확정 전에는 저장소에 아무것도 없다** — 같은 요청 뒤 `repo.listTasks()`가
   요청 전과 같다 (`UC-02`, 완료 기준 3). **메모리 데모는 시드가 들어 있으므로
   "0건"이 아니라 "요청 전과 같다"로 확인하라**
3. `.docx`로 위장한 픽스처 → **415** `FILE_TYPE_MISMATCH` (완료 기준 5)
4. 4MB + 1바이트 → **413** `FILE_TOO_LARGE`
5. 파일 없는 FormData → **400** `VALIDATION_FAILED`
6. 팀 탭이 없는 워크북 → **422** `NO_KNOWN_TAB` (완료 기준 7)
7. **응답 본문에 스택·`/src/`·시트 값이 없다** (완료 기준 10)

`src/app/api/uploads/[id]/commit/route.test.ts`:

1. sheet 라우트로 미리보기 → commit → **200**, 그 뒤 `repo.listTasks()`가 늘어난다
2. **같은 id로 두 번째 commit → 409** `UPLOAD_ALREADY_COMMITTED`
3. 없는 id → **404**
4. 확정 후 `storage.uploads.get(id)`의 `parseResult`가 **`null`** (완료 기준 13)
5. **편집팀 탭만 든 워크북을 확정해도 다른 팀 태스크 수가 그대로다** (완료 기준 4, `UC-04`)

`src/app/api/health/route.test.ts`: 200이고 `driver`·`mode`가 들어 있으며 본문에
`SUPABASE`·`KEY`·`http` 문자열이 없다.

> 4MB 테스트에서 `new Uint8Array(4*1024*1024+1)`을 만드는 것은 괜찮다(4MB 할당 1회).
> 픽스처를 반복해 이어 붙여 만들지 마라 — 느리고 얻는 것이 같다.

### 5. 문서

`docs/ARCHITECTURE.md`「디렉토리 구조」의 `api/` 줄에 실제 만든 경로가 반영돼 있는지 확인하고
어긋나면 **그 줄만** 고쳐라.

## Acceptance Criteria

```bash
npx vitest run src/app

# 런타임 명시 (3줄 나와야 함)
grep -rn "runtime = 'nodejs'" src/app/api/ | wc -l

# 각 라우트에 자기 테스트가 있다 (3개 나와야 함)
find src/app/api -name "route.test.ts" | wc -l

# 전역 우회 테스트를 만들지 않았다 (출력이 비어야 함)
ls src/__tests__/route.test.ts 2>/dev/null ; test $? -ne 0

# Next 16 params (출력이 있어야 함)
grep -n "await params" src/app/api/uploads/\[id\]/commit/route.ts

# 라우트에 계산이 없다 — 도메인·집계 함수를 직접 부르지 않는다 (출력이 비어야 함)
grep -rnE "deriveTaskFlags|summarizeTeam|collectAlerts|diffTaskFields|toSemantic" src/app/api/uploads/ ; test $? -eq 1

# 라우트가 파서·저장소를 직접 조립하지 않는다 (출력이 비어야 함)
grep -rn "exceljs\|createClient(" src/app/api/ ; test $? -eq 1

# 회귀
npx vitest run

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **세 라우트 파일을 열어 줄 수를 세라.** 각각 60줄을 넘으면 계산이 샌 것이다 —
   샌 로직을 `src/lib/`로 옮기고 테스트를 붙여라 (완료 기준 1).
3. 체크리스트:
   - 미리보기 요청 뒤 저장소가 **요청 전과 같은가?** (완료 기준 3 — 취소 시 무변경)
   - 확정 후 `parse_result`가 비었는가? (완료 기준 13)
   - 두 번째 확정이 409인가?
   - 편집팀만 올려도 다른 팀이 남는가? (완료 기준 4)
   - 세 라우트 모두 `runtime = 'nodejs'`가 있는가?
   - 각 라우트 폴더에 **자기** `route.test.ts`가 있는가? (`src/__tests__/route.test.ts`로
     가드를 뚫지 않았는가)
   - 에러 응답에 스택·내부 경로·셀 값이 없는가? (완료 기준 10)
4. `phases/t5-api-upload/index.json`의 step 7을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 각 라우트 파일의 **줄 수**를 적어라 — 계산 0줄의 증거다.

## 금지사항

- `src/__tests__/route.test.ts`를 만들지 마라. 이유: TDD 가드가 basename만 보므로 모든 라우트가
  무검사로 뚫린다 (`CLAUDE.md` CRITICAL).
- 라우트에서 집계·판정·변환을 하지 마라. 이유: 완료 기준 1이 "계산 로직 0줄"이다.
  필요하면 `src/lib/`에 함수를 만들고 테스트를 붙인 뒤 부른다.
- 라우트에서 `params`를 `await` 없이 쓰지 마라. 이유: Next 16에서 Promise다.
- 파싱 실패·거부에 `uploads` 행을 만들지 마라. 이유: 테이블에 쓰레기가 쌓이고, 그 행에
  개인정보가 든 `parse_result`가 남는다.
- 읽기 전용 모드에서 업로드를 받지 마라. 이유: `ADR-005` — 조용한 데이터 유실이 조회 불가보다 나쁘다.
- 예외 메시지·스택을 응답에 담지 마라. 이유: `X1`·완료 기준 10.
- `service_role` 클라이언트를 라우트에서 직접 만들지 마라. 이유: `store-factory`가 감싼다
  (`CLAUDE.md`: 외부 연동은 `lib/store/`가 감싼다).
- 서버 컴포넌트가 이 라우트들을 `fetch`하게 만들지 마라. 이유: `ADR-007` — 서버 컴포넌트는
  `lib/`를 직접 부른다.
- 확정 API에 탭 선택 본문을 받지 마라. 이유: 부분 업로드는 "파일에 든 탭만 반영"이지
  사용자 선택이 아니다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
