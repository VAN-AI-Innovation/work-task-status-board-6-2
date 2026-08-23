# Step 8: extract-api

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL**: 라우트는 `src/lib/`를 **호출만 하고 계산하지 않는다** /
  `src/app/api/**`에 `export const runtime = 'nodejs'` 명시 / API 응답에 `tasks.raw`를 싣지 않는다
- `docs/ARCHITECTURE.md` — 계층 경계(「라우트가 하는 일은 zod 검증 → lib 호출 → 직렬화 3단계뿐」),
  라우트 목록, 「에러 처리」 코드 표(step 0이 두 코드를 추가했다)
- `docs/PLAN.md` — step 0이 추가한 **결정 C**(왕복 두 번·무상태) · **결정 D**(에러 코드 2개) · `S1`·`S2`
- `docs/TICKETS.md` — T7 완료 기준 **1**(`.docx`만 받는다)
- 이전 step 산출물: `src/lib/doc/doc-pipeline.ts`, `src/lib/xlsx/assignment-writer.ts`,
  `src/lib/fixtures/sample-workload.docx`
- **본떠야 할 기존 코드**:
  - `src/app/api/uploads/sheet/route.ts` — 파일 업로드 라우트의 형태 (문지기 → 파서 → 직렬화)
  - `src/app/api/uploads/sheet/route.test.ts` — 라우트 테스트의 형태
  - `src/lib/api/api-error.ts` — 코드·상태·문구 표
  - `src/lib/upload/upload-guard.ts` — `checkUpload({filename, bytes, expect:'doc'})`.
    **`.docx` 판정이 이미 구현돼 있다** (확장자 + ZIP 안 `word/document.xml`)
  - `src/lib/api/task-response.ts` — 응답 zod 스키마의 형태(`.strict()`)

## 배경

라우트 둘이다 (결정 C). 저장소를 건드리지 않는다 — `getStorage()`를 부르지 않는다.

```
POST /api/uploads/doc         multipart(file) → { rows, warnings }
POST /api/export/assignment   { rows }        → xlsx 바이트 (attachment)
```

문 앞의 판정은 **이미 있는 것을 쓴다.** `upload-guard.ts`는 처음부터 `expect: 'doc'`을
받도록 만들어졌고(`.docx`의 ZIP 엔트리 시그니처까지 확인한다), 압축 폭탄 3중 상한도 그 안에 있다.
여기서 새로 검사를 만들면 한도가 두 벌이 된다.

`export/assignment`가 **클라이언트가 보낸 행**을 받아 파일을 만든다는 점을 가볍게 보지 마라.
그 행은 신뢰할 수 없는 입력이고, 우리가 만든 xlsx는 사람들에게 배포된다(`S1`).
방어는 `assignment-writer.ts`가 지지만, **모양 검증은 zod가 문 앞에서** 한다.

## 작업

### 1. `src/lib/api/api-error.ts`에 코드 2개를 추가한다

step 0이 `ARCHITECTURE.md`에 확정해 둔 것을 **문구까지 그대로** 옮긴다.

- `API_ERROR_CODES`에 `DOCUMENT_CORRUPT`·`NO_OUTLINE_TASK` 추가
- `API_ERROR_STATUS`: 둘 다 **422**. 근거 주석을 기존 항목과 같은 결로 한 줄 남긴다
  (415는 이미 통과한 상태다 — `.docx`인 것은 맞는데 **내용이 처리 불가**다)
- `API_ERROR_MESSAGES`: `doc-pipeline.ts`의 문장과 **글자까지 같게**
- 기존 코드·문구·상태를 바꾸지 마라

### 2. `src/lib/api/assignment-schema.ts` (+ 테스트를 먼저)

```ts
/** 내려받기 요청 본문. **모르는 키를 통과시키지 않는다** */
export const assignmentExportSchema: z.ZodType<{ rows: AssignmentRow[]; filename?: string }>;
/** 파일명 정리: 경로 구분자·제어문자 제거, 길이 상한, 확장자 강제 */
export function safeDownloadFilename(input: string | undefined, fallback: string): string;
```

- 행 스키마는 `AssignmentRow`의 필드와 1:1이고 `.strict()`다. 문자열 필드에 **길이 상한**을 둔다
  (예: 제목 500자, 세부항목 20,000자). 상한이 없으면 한 요청으로 수백 MB짜리 xlsx를 만들게 할 수 있다
- 행 개수 상한도 둔다 (예: 2,000행). 근거를 주석에 남긴다 — 실측 과제 20건의 100배다
- `safeDownloadFilename`: `/`·`\`·`..`·제어문자·따옴표를 없애고, 비면 `fallback`,
  끝을 `.xlsx`로 강제한다. **`Content-Disposition`에 사용자 문자열을 그대로 넣지 마라** —
  헤더 인젝션 자리다
- 테스트: 정상 · 모르는 키 거부 · 길이 초과 거부 · 행 수 초과 거부 · 파일명 정리 5종

### 3. `src/app/api/uploads/doc/route.ts` (+ 테스트)

```ts
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response>
```

하는 일은 다섯 줄이다. **계산을 쓰지 마라.**

1. `formData()`에서 `file`을 꺼낸다. `File`이 아니면 `VALIDATION_FAILED`
2. `checkUpload({ filename, bytes, expect: 'doc' })` — 실패면 그 코드·문구를 그대로 응답
3. `baseYear`는 **요청 경계에서** 만든다: `Number(kstToday(new Date()).slice(0, 4))`
   (`uploads/sheet/route.ts`와 같은 방식). 폼에 `baseYear`가 실려 오면 그 값을 쓰되
   `1900 ≤ y ≤ 2200` 범위 밖이면 무시하고 오늘 연도를 쓴다
4. `runDocExtract(buffer, { baseYear })`
5. 성공이면 `Response.json({ rows, warnings, baseYear })`

테스트 (`route.test.ts`):

| 요청 | 기대 |
|---|---|
| `sample-workload.docx` | 200, `rows.length >= 1`, 난이도 `中上`인 행이 있다 |
| `sample-workbook.xlsx`를 올림 | **415 `FILE_TYPE_MISMATCH`** ← 완료 기준 1 |
| 확장자만 `.docx`인 텍스트 파일 | 415 (ZIP이 아니다) |
| `file` 없음 | 400 `VALIDATION_FAILED` |
| 4MB 초과 | 413 `FILE_TOO_LARGE` |
| 응답 본문 | 파일명·경로·스택이 들어 있지 않다 |
| 저장소 | `getStorage()`를 부르지 않는다 (`uploads` 행이 생기지 않는다) |

### 4. `src/app/api/export/assignment/route.ts` (+ 테스트)

```ts
export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response>
```

1. `await request.json()` → `assignmentExportSchema.parse` (실패 → `VALIDATION_FAILED` 400)
2. `buildAssignmentWorkbook(rows)`
3. 헤더를 붙여 바이트를 돌려준다

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="assignment.xlsx"; filename*=UTF-8''<encodeURIComponent(name)>
Cache-Control: no-store
```

- ASCII 파일명과 `filename*`을 **둘 다** 준다. 한글 파일명이 그대로 들어가면 헤더가 깨진다
- `catch`는 `toApiErrorCode`를 쓴다. 예외 메시지를 응답에 넣지 마라

테스트:

| 요청 | 기대 |
|---|---|
| 정상 행 2건 | 200, `Content-Type`이 xlsx, 본문 앞 4바이트가 `PK\x03\x04` |
| 모르는 키가 든 행 | 400 `VALIDATION_FAILED` |
| `rows: []` | 200 (헤더만 있는 파일). 빈 배정표를 막는 것은 `doc-pipeline`의 일이다 |
| 행 수 상한 초과 | 400 |
| `filename: "../../etc/passwd"` | 헤더에 경로가 들어가지 않는다 |
| `=cmd\|'/c calc'!A1`이 든 행 | 200이고, 만들어진 파일의 해당 셀에 `'` 프리픽스가 있다 |

## Acceptance Criteria

```bash
npm run test -- src/app/api/uploads/doc src/app/api/export/assignment src/lib/api/assignment-schema.test.ts
npm run lint && npm run build && npm run test
grep -n "runtime = 'nodejs'" src/app/api/uploads/doc/route.ts src/app/api/export/assignment/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 라우트에 계산이 있는가? (조건 분기는 「검증 실패 → 에러 응답」뿐이어야 한다)
   - `.xlsx`를 올렸을 때 거부되는가? (완료 기준 1)
   - `getStorage()`를 부르지 않는가? (결정 C)
   - 에러 응답에 파일명·셀 값·스택이 없는가?
3. `phases/t7-doc-extract/index.json`의 step 8을 갱신한다.

## 금지사항

- `uploads` 행을 만들지 마라. 문서 본문에는 사람 이름이 들어 있고 `parse_result`에 그것이
  통째로 남는다 (`S6`·결정 C).
- 파일 크기·ZIP 검사를 새로 쓰지 마라. `checkUpload`가 이미 한다.
- `api-error.ts`의 기존 항목을 손보지 마라. 추가만 한다.
- 기존 테스트를 깨뜨리지 마라.
