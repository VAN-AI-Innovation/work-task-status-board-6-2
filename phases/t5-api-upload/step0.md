# Step 0: upload-guard

## 읽어야 할 파일

- `CLAUDE.md` — 보안·데이터 규칙, TDD, **`src/lib/` 파일명 전역 유니크**
- `docs/TICKETS.md` — `## T5` 전체. 특히 완료 기준 **5**(4MB·ZIP 내부 엔트리 판별)와
  **6**(압축 폭탄 3중 상한, **셀 상한을 이 티켓에서 확정**)
- `docs/PLAN.md` — 「보안」의 `S2`(압축 폭탄)·`S3`(매직넘버로는 구분 불가), 「아키텍처 검증」의 `A7`
- `scripts/smoke/RESULT.md` — 「S2 한도 판정」 표 전체와 「T5에 주는 결론」 3번
- `docs/ARCHITECTURE.md` — 「에러 처리」의 코드 목록
- `src/lib/sheet/workbook-reader.ts` 55~60행 — `rowCount`를 `worksheet.dimensions`로 잡는 부분.
  **이 프로젝트의 `SheetGrid.rowCount × columnCount`는 이미 `dimensions` 사각형이다.**

## 배경

T5는 파일이 들어오는 문이다. 문에서 막지 못하면 뒤의 모든 step이 신뢰할 수 없는 입력 위에서 돈다.

막아야 할 것이 셋이다.

1. **크기** — 4MB. `A7`에서 확정됐고 실측이 0.10MB라 여유가 크다.
2. **정체** — `.xlsx`와 `.docx`는 **둘 다 `PK\x03\x04`로 시작하는 ZIP**이라 매직넘버로는 구분되지
   않는다 (`S3`). ZIP 내부에 `xl/workbook.xml`이 있으면 xlsx, `word/document.xml`이 있으면 docx다.
3. **팽창** — 수십 KB가 수 GB로 풀리는 압축 폭탄 (`S2`). 4MB 상한은 **압축된 크기**만 막는다.

그리고 이 step에서 **T5 완료 기준 6의 셀 상한을 확정한다.** T1 실측에서 원래 문구
(`행 × 열 ≤ 20,000 셀/시트`)가 **정상 업무 파일을 압축 폭탄으로 오탐했다** —
`00_통합 대시보드`의 `rowCount × columnCount`가 26,026이다. 원인은 데이터가 아니라 내보내기
형식이다(Google Sheets가 기본 1000행 그리드를 통째로 내보낸다). **오탐하는 방어는 방어가 아니라
장애다** — 사용자는 정상 파일이 거부되면 이 시스템을 쓰지 않는다.

## 확정 — 이 숫자를 여기서 못박는다

| 항목 | 값 | 근거 |
|---|---|---|
| 업로드 크기 | **4 MB** | `A7` 확정. 실측 0.10MB (2.4%) |
| 압축 해제 총량 | **50 MB** | `S2` 원안 유지. 4MB 압축 상한과 짝지으면 **팽창비 12.5:1 상한**이 자동으로 걸린다 |
| ZIP 엔트리 수 | **512개** | 실측 xlsx는 15개 남짓. 엔트리 수 폭발로 중앙 디렉토리 순회 자체가 느려지는 것을 막는 상한 |
| 시트 수 | **20개** | `S2` 원안 유지. 실측 5개 |
| **셀 수 / 시트** | **100,000** | 아래 |
| **셀 수 / 워크북** | **300,000** | 아래 |
| 파싱 타임아웃 | **8초** | `S2` 원안 유지 (step 1에서 적용) |

**세는 기준은 `dimensions` 사각형이다** — `SheetGrid.rowCount × columnCount`.
`workbook-reader.ts`가 이미 `worksheet.dimensions`로 이 값을 잡고 있으므로 **새로 세는 코드가
필요 없다.** ExcelJS의 `worksheet.rowCount`(서식만 있는 행까지 세는 값)를 쓰지 마라.

숫자의 근거:

- 실측 최대 시트는 `02_촬영·기획팀`의 **4,260셀**(`dimensions` 기준). 100,000은 그 **23배**다.
- Google Sheets의 기본 그리드는 **1000행 × 26열 = 26,000**이다. 한 탭만 내보낸 파일이
  빈 그리드를 통째로 달고 와도 통과해야 한다. 20,000은 이 선 아래라 처음부터 성립하지 않았다.
- 실측 워크북 전체는 `dimensions` 기준 **8,732셀**. 300,000은 그 **34배**다.
- **워크북 합계 상한이 따로 필요한 이유**: 시트당 상한만 두면 20시트 × 100,000 = **2,000,000셀**이
  통과한다. 셀 하나가 객체 하나라 그 지점에서 메모리가 죽는다.
- `dimensions`는 워크북 안의 XML 속성이라 **위조할 수 있다.** 그래서 이 상한 하나에 의존하지
  않는다 — 압축 해제 총량 50MB(ZIP 중앙 디렉토리 기준)와 4MB 압축 상한이 위조된 `dimensions`를
  뒷받침할 실제 바이트가 존재하지 않게 만든다. **T1이 권한 (a)+(b) 조합이 이것이다.**

## 작업

### 1. `src/lib/upload/upload-limits.ts` — 테스트를 **먼저** 쓴다

`src/lib/upload/` 디렉토리를 새로 만든다.

```ts
/** 압축된 업로드 본문 상한. Vercel 서버리스 본문 한도(4.5MB)보다 확실히 아래다 (A7) */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** ZIP 중앙 디렉토리가 신고한 해제 총량 상한 (S2) */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 512;

export interface WorkbookLimits {
  maxSheets: number;
  /** `dimensions` 사각형 기준. `worksheet.rowCount`가 아니다 */
  maxCellsPerSheet: number;
  maxCellsPerWorkbook: number;
}

export const WORKBOOK_LIMITS: WorkbookLimits = {
  maxSheets: 20,
  maxCellsPerSheet: 100_000,
  maxCellsPerWorkbook: 300_000,
};

export const PARSE_TIMEOUT_MS = 8_000;
```

**숫자 옆에 근거를 주석으로 남겨라.** 위 표의 실측값(4,260 / 8,732 / 26,000)을 주석에 적어
두면 다음 사람이 상한을 만졌을 때 무엇이 깨지는지 안다. 근거 없는 상수는 부채다.

테스트(`upload-limits.test.ts`)는 **상수 사이의 불변식**을 검증한다. 값을 그대로 다시 적는
테스트는 쓸모가 없다.

1. `MAX_UPLOAD_BYTES < MAX_ARCHIVE_UNCOMPRESSED_BYTES` (압축본이 해제본보다 크면 앞뒤가 안 맞는다)
2. `WORKBOOK_LIMITS.maxCellsPerSheet > 26_000` — **Google Sheets 기본 그리드가 통과한다.**
   이 테스트가 T1이 발견한 오탐의 회귀 테스트다
3. `WORKBOOK_LIMITS.maxCellsPerWorkbook >= WORKBOOK_LIMITS.maxCellsPerSheet`
4. `WORKBOOK_LIMITS.maxCellsPerWorkbook < WORKBOOK_LIMITS.maxSheets * WORKBOOK_LIMITS.maxCellsPerSheet`
   — 워크북 합계 상한이 실제로 조이는지 (같거나 크면 있으나 마나다)
5. `PARSE_TIMEOUT_MS < 10_000` (Vercel 함수 타임아웃보다 짧다)

### 2. `src/lib/upload/zip-inspector.ts` — 테스트를 **먼저** 쓴다

압축을 **풀지 않고** ZIP 중앙 디렉토리만 읽는다. 엔트리 이름과 신고된 해제 크기가 거기 있다.

```ts
export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipInspection {
  entries: ZipEntry[];
  /** 엔트리들의 `uncompressedSize` 합 */
  totalUncompressedSize: number;
  /** ZIP64 등으로 크기를 신고하지 않은 아카이브. **신뢰하지 않고 거부한다** */
  untrusted: boolean;
}

/** ZIP이 아니거나 구조가 깨졌으면 `null`. **예외를 던지지 않는다** */
export function inspectZip(bytes: Uint8Array): ZipInspection | null;
```

구현 규칙:

1. 끝에서부터 **EOCD 시그니처 `0x06054b50`**(리틀엔디언 `50 4b 05 06`)을 찾는다. ZIP 주석이
   최대 65,535바이트라 **뒤에서 65,557바이트**까지만 훑는다. 파일 전체를 역순 스캔하지 마라.
2. EOCD에서 중앙 디렉토리 엔트리 수(offset 10, 2바이트)와 시작 오프셋(offset 16, 4바이트)을 읽는다.
3. 각 중앙 디렉토리 헤더(시그니처 `0x02014b50`, 고정 46바이트)에서
   `compressedSize`(offset 20)·`uncompressedSize`(offset 24)·`fileNameLength`(28)·
   `extraFieldLength`(30)·`fileCommentLength`(32)를 읽고, 이름은 UTF-8로 디코드한다.
4. **ZIP64 방어**: 엔트리 수가 `0xffff`이거나 어느 크기 필드가 `0xffffffff`이면 실제 값이
   extra field 안에 있다. **그 필드를 파싱하지 말고 `untrusted: true`로 표시하라.**
   step 1이 이것을 `ARCHIVE_LIMIT_EXCEEDED`로 거부한다. 4MB 업무 파일에 ZIP64가 나올 이유가
   없고, **파싱기를 하나 더 만드는 것보다 거부하는 쪽이 안전하다.**
5. 오프셋이 버퍼 밖을 가리키거나 시그니처가 안 맞으면 **`null`**. 예외를 던지지 마라.
6. **엔트리 이름을 파일 시스템에 쓰지 않으므로 경로 순회(`../`) 검사는 하지 않는다.**
   이름은 종류 판별에만 쓴다. 이 사실을 주석에 남겨라 — 다음 사람이 압축을 풀기 시작하면
   그때 필요해진다.
7. 상한 초과 여부를 **판단하지 않는다.** 그건 step 0-3(`upload-guard`)의 일이다.
   이 파일은 사실만 보고한다.

테스트:

1. `src/lib/fixtures/sample-workbook.xlsx`를 읽어 `inspectZip`이 `null`이 아니고,
   엔트리 이름에 **`xl/workbook.xml`이 있다**
2. `totalUncompressedSize > 0`이고 파일 크기보다 크다 (압축돼 있으니 당연하다)
3. ZIP이 아닌 바이트(`Uint8Array.from([1,2,3])`, `'hello'`) → `null`
4. 픽스처 바이트를 앞에서 잘라낸 것 → `null` (예외를 던지지 않는다)
5. 빈 배열 → `null`

### 3. `src/lib/upload/upload-guard.ts` — 테스트를 **먼저** 쓴다

```ts
export type UploadKind = 'sheet' | 'doc';

export type UploadRejectCode =
  | 'FILE_TOO_LARGE' | 'FILE_TYPE_MISMATCH' | 'ARCHIVE_LIMIT_EXCEEDED' | 'VALIDATION_FAILED';

export type UploadCheck =
  | { ok: true; kind: UploadKind }
  | { ok: false; code: UploadRejectCode; message: string };

/** 인스펙션만 보고 한도·정체를 판정한다. **테스트가 합성 ZIP 없이 한도를 검증할 수 있게** 분리했다 */
export function checkArchive(inspection: ZipInspection, expect: UploadKind): UploadCheck;

export function checkUpload(input: {
  filename: string;
  bytes: Uint8Array;
  expect: UploadKind;
}): UploadCheck;
```

`checkUpload`의 검사 **순서가 곧 방어다.** 순서를 바꾸지 마라.

1. `filename`이 비었거나 `bytes.length === 0` → `VALIDATION_FAILED`
2. `bytes.length > MAX_UPLOAD_BYTES` → `FILE_TOO_LARGE`
   — **ZIP을 열기 전에** 막는다. 큰 파일을 훑고 나서 거부하면 상한의 의미가 절반이다
3. 확장자 1차 필터: `sheet`는 `.xlsx`만, `doc`는 `.docx`만. 나머지(`.xls`·`.csv`·`.txt`)는
   `FILE_TYPE_MISMATCH`. 대소문자를 무시한다
4. `inspectZip` → `null`이면 `FILE_TYPE_MISMATCH`
   — **`WORKBOOK_CORRUPT`가 아니다.** ZIP도 아닌 파일은 손상이 아니라 종류가 틀린 것이다
5. `checkArchive`로 넘긴다

`checkArchive`:

- `untrusted` → `ARCHIVE_LIMIT_EXCEEDED`
- `entries.length > MAX_ARCHIVE_ENTRIES` → `ARCHIVE_LIMIT_EXCEEDED`
- `totalUncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES` → `ARCHIVE_LIMIT_EXCEEDED`
- 엔트리 이름에 `xl/workbook.xml`이 있으면 `sheet`, `word/document.xml`이 있으면 `doc`.
  **둘 다 없으면** `FILE_TYPE_MISMATCH`, **`expect`와 다르면** `FILE_TYPE_MISMATCH`
- 통과하면 `{ ok: true, kind }`

`message`는 **사용자에게 보여줄 한국어 한 문장**이다 (`X1`).
**파일명·엔트리 이름·바이트 내용·숫자 이외의 것을 담지 마라.** 예:
`'파일이 너무 큽니다. 4MB 이하로 올려 주세요.'` /
`'엑셀(.xlsx) 파일이 아닙니다. 시트를 .xlsx로 내보내 다시 올려 주세요.'`

테스트:

1. 픽스처 + `expect: 'sheet'` → `ok: true, kind: 'sheet'`
2. **픽스처 + `expect: 'doc'` → `FILE_TYPE_MISMATCH`** (`S3`의 핵심 — ZIP 매직넘버는 같다)
3. `new Uint8Array(MAX_UPLOAD_BYTES + 1)` → `FILE_TOO_LARGE`
4. 확장자 `.txt`·`.xls`·`.csv` → `FILE_TYPE_MISMATCH`
5. ZIP이 아닌 바이트 + `.xlsx` → `FILE_TYPE_MISMATCH`
6. 빈 바이트 → `VALIDATION_FAILED`
7. `checkArchive`에 **객체 리터럴로** 만든 인스펙션을 넣어:
   `untrusted: true` / 엔트리 513개 / `totalUncompressedSize = 50MB + 1` 각각 →
   `ARCHIVE_LIMIT_EXCEEDED`. 정확히 상한값이면 통과한다(경계는 **이하**가 허용이다)
8. `word/document.xml`만 든 인스펙션 + `expect: 'sheet'` → `FILE_TYPE_MISMATCH`
9. 어느 쪽 엔트리도 없는 인스펙션 → `FILE_TYPE_MISMATCH`
10. 모든 거부의 `message`에 **파일명이 들어 있지 않다**

### 4. 문서를 고친다 — 코드보다 먼저다

`CLAUDE.md`가 "결정이 바뀌면 코드보다 PLAN.md를 먼저 고친다"라고 정한다.

- **`docs/PLAN.md`의 `S2`** — 「확정 — 3중 상한」 코드 블록의 `셀 수/시트 ≤ 20,000 ※ 세는 기준
  미확정` 줄을 위 표의 확정값으로 교체하고, 「⚠ 실측 판정 (T1)」 블록 끝에 **T5에서 무엇으로
  확정했는지와 그 근거**(dimensions 기준 + 상한 상향 + 50MB가 위조를 뒷받침한다)를 덧붙여라.
  **기존 실측 기록은 지우지 마라** — 왜 숫자가 바뀌었는지가 거기 있다.
- **`docs/TICKETS.md`의 T5 완료 기준 6** — `셀 상한`을 확정 숫자로 바꾸고
  "이 티켓에서 먼저 확정한다"를 "확정: `dimensions` 사각형 기준 시트당 100,000 / 워크북 300,000"으로
  바꾼다.
- 두 문서의 숫자가 **서로 다르면 안 된다.** 고친 뒤 `grep`으로 확인하라.

## Acceptance Criteria

```bash
npx vitest run src/lib/upload

# 오탐 회귀 — Google Sheets 기본 그리드(26,000셀)가 통과하는 상한인가 (출력이 있어야 함)
grep -n "100_000\|100000" src/lib/upload/upload-limits.ts

# 두 문서의 숫자가 일치하는가 (둘 다 출력이 있어야 함)
grep -n "100,000\|100000" docs/PLAN.md
grep -n "100,000\|100000" docs/TICKETS.md

# 낡은 문구가 남아 있지 않은가 (출력이 비어야 함)
grep -n "세는 기준 미확정" docs/PLAN.md ; test $? -eq 1

# 계층 경계 — 업로드 계층은 엑셀 라이브러리를 모른다 (출력이 비어야 함)
grep -rn "exceljs\|@supabase" src/lib/upload/ ; test $? -eq 1

# 압축을 풀지 않는다 (출력이 비어야 함)
grep -rn "inflate\|unzip\|zlib" src/lib/upload/zip-inspector.ts ; test $? -eq 1

# 회귀 — T2~T4가 그대로 통과한다
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 실제 픽스처가 `checkUpload`를 **통과**하는가? (오탐하지 않는가 — 이 step의 존재 이유다)
   - 같은 픽스처가 `expect: 'doc'`에서 **거부**되는가?
   - `inspectZip`이 어떤 입력에도 예외를 던지지 않는가?
   - 거부 메시지에 파일명·엔트리 이름이 없는가?
   - `src/lib/upload/` 파일명 3개가 `src/lib/` 전역에서 유니크한가?
     (`CLAUDE.md` CRITICAL — basename이 겹치면 TDD 가드가 뚫린다)
   - `PLAN.md`·`TICKETS.md`의 숫자가 코드 상수와 **셋 다** 같은가?
3. `phases/t5-api-upload/index.json`의 step 0을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(확정한 셀 상한 기준과 숫자, 그 근거 한 줄,
     내보낸 함수·상수 이름, 고친 문서 2곳, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 압축을 실제로 풀지 마라. 이유: 압축 폭탄을 막으려고 만든 코드가 압축 폭탄을 터뜨리게 된다.
  중앙 디렉토리가 신고한 크기만 읽는다.
- ZIP64 extra field를 파싱하지 마라. 이유: 4MB 업무 파일에 나올 이유가 없고, 파서를 하나 더
  만드는 것보다 `untrusted`로 거부하는 쪽이 안전하다.
- `unzipper`·`jszip` 등 압축 라이브러리를 설치하지 마라. 이유: 이 step은 새 의존성 0개다.
  중앙 디렉토리 파싱은 100줄 미만이고, 의존성을 늘리면 `ADR-003`의 "교체 비용을 묶는다"가 흐려진다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL — 읽기는 `workbook-reader.ts` 한 곳뿐이다.
- 셀 수를 `worksheet.rowCount × columnCount`로 세지 마라. 이유: 그 값이 정상 파일을 26,026으로
  부풀려 T1에서 오탐을 만든 원인이다.
- 상한을 "일단 크게" 잡거나 검사를 끄지 마라. 이유: 상한이 없으면 `S2`가 미해결로 남는다.
- 거부 메시지에 파일명·셀 값·스택을 담지 마라. 이유: `X1`·`CLAUDE.md` 보안 규칙.
- 라우트 핸들러·화면을 만들지 마라. 이유: step 7~10의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
