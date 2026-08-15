# Step 2: workbook-reader

## 읽어야 할 파일

- `CLAUDE.md` — **`exceljs` import는 `src/lib/sheet/workbook-reader.ts`와
  `src/lib/xlsx/assignment-writer.ts` 두 파일에서만** (CRITICAL). 에러·로그에 셀 값 금지
- `docs/TICKETS.md` — `## T2` 완료 기준 **8**, 리스크의 `ADR-003` 언급
- `docs/ARCHITECTURE.md` — 「엑셀 → 조회」 흐름의 `workbook-reader` 줄, 에러 코드 목록,
  실패 강도 3단계 표
- `docs/PLAN.md` — `E6~E8`(세로 병합 / 숨김 행·열 / 대시보드 탭), `E2` 표(step 1에서 갱신됨)
- `docs/ADR.md` — `ADR-003`
- `scripts/smoke/RESULT.md` — `A7` 절의 `rowCount` vs `dimensions` 표
- 이전 step 산출물: `src/types/sheet.ts`, `src/lib/sheet/cell-normalizer.ts`,
  `scripts/fixtures/build-sample-workbook.mjs`

## 배경

**이 파일이 저장소 전체에서 `exceljs`를 읽기 위해 import하는 유일한 곳이다.** 경계가
새면 `ADR-003`이 무너지고, 나중에 라이브러리를 바꿀 때 손댈 곳이 파서 전역이 된다.

리더의 일은 **해석이 아니라 채록**이다. 어떤 탭인지, 어디가 헤더인지, 무엇이 데이터 행인지는
뒤 단계(step 3·4, T3)가 판단한다. 리더는 시트를 **좌표가 붙은 격자**로 옮기고,
`exceljs`만 알 수 있는 것(`cell.master`·`numFmt`·`row.hidden`·`dimensions`)을 우리 타입에 실어 준다.

### 반드시 `dimensions`로 자른다

T1 실측: `00_통합 대시보드`는 `rowCount`가 **1001**인데 `dimensions`는 `A1:J60`이다.
Google Sheets가 기본 1000행 그리드를 서식만 채워 내보낸 탓이며, 값이 있는 셀은 144개뿐이다.
`rowCount`로 순회하면 **빈 행 940개가 격자에 들어오고** 뒤 단계가 전부 그것을 훑는다.

step 0의 픽스처가 이 현상을 재현해 두었다. **이 step의 테스트가 그것을 고정한다.**

### 병합 셀 — 추측하지 말고 실측하라

`exceljs`는 병합 영역의 슬레이브 셀에 대해서도 `cell.value`로 마스터 값을 돌려주는 것으로
보인다 (실제 파일 덤프에서 `A6`~`P6`이 모두 같은 배너 문자열을 반환했다).

그렇다면 **채우기 코드는 필요 없다.** 필요 없는 코드를 "혹시 몰라서" 넣지 마라.
할 일은 순서대로 이것이다:

1. 픽스처의 세로 병합(`01_편집팀`의 `A14:A15`)에서 두 행이 같은 값을 갖는지 **테스트로 확인**한다.
2. 이미 채워져 있으면 그 사실을 테스트로 고정하고 끝낸다 (완료 기준 8 충족).
3. 채워져 있지 않은 경우에만 `cell.master`를 따라가 채운다.

## 작업

### 1. `src/types/sheet.ts`에 격자 타입을 추가한다

**좌표 규칙을 먼저 못 박는다. 이 규칙이 흔들리면 off-by-one이 파이프라인 끝까지 간다.**

- `cells` 배열의 인덱스는 **0-based**다. `cells[0][0]`이 A1이다.
- `merges`·`hiddenRows`·`hiddenColumns`도 **0-based**다.
- `ParseWarning`의 `row`·`column`만 **1-based**다. 사람이 읽는 좌표이기 때문이다.
  이 예외를 타입 주석에 한 줄로 적어라.

```ts
export interface SheetCell {
  value: SheetCellValue;
  numFmt: string | null;
}

export interface MergeRange { top: number; left: number; bottom: number; right: number } // 0-based, 양끝 포함

export interface SheetGrid {
  name: string;
  rowCount: number;          // dimensions 기준. exceljs의 worksheet.rowCount가 아니다
  columnCount: number;
  cells: SheetCell[][];      // [row][col], 0-based. 빈 셀도 자리를 채운다 (value: null)
  merges: MergeRange[];
  hiddenRows: number[];
  hiddenColumns: number[];
}

export interface ParseWarning {
  code: string;
  sheet: string;
  row?: number;              // 1-based (사람이 읽는 좌표)
  column?: number;           // 1-based
}

export interface WorkbookGrid {
  sheets: SheetGrid[];
  warnings: ParseWarning[];
}
```

### 2. `src/lib/sheet/workbook-reader.test.ts`를 **먼저** 쓴다

픽스처를 실제로 연다. 파일은 `src/lib/fixtures/sample-workbook.xlsx`이고,
**Buffer로 읽어 넘긴다** — 제품 경로(T5의 업로드)가 파일 경로가 아니라 업로드 바이트를
받기 때문이다. 테스트가 제품과 같은 진입점을 쓰게 한다.

```ts
const buf = readFileSync(fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url)));
const wb = await readWorkbook(buf);
```

### 3. `src/lib/sheet/workbook-reader.ts` 구현

```ts
export async function readWorkbook(input: Buffer | ArrayBuffer): Promise<WorkbookGrid>
export class WorkbookReadError extends Error { readonly code = 'WORKBOOK_CORRUPT' }
```

동작:

1. `exceljs`로 로드한다. 로드 자체가 실패하면 **`WorkbookReadError`를 던진다.**
   이것이 이 모듈에서 유일하게 허용되는 하드 실패다 (`ARCHITECTURE.md` 실패 강도 표의
   「중단」). **에러 메시지에 파일 내용·셀 값·내부 경로를 담지 마라.**
2. 워크시트를 **파일에 있는 순서 그대로** 순회한다. 이름으로 거르지 않는다 —
   어떤 탭인지 판단하는 것은 step 4다.
3. 각 시트의 범위는 **`worksheet.dimensions`** 로 잡는다. `dimensions`가 없는(완전히 빈)
   시트는 `rowCount: 0, columnCount: 0, cells: []`로 둔다.
4. 격자를 채운다. 값이 없는 셀도 `{ value: null, numFmt: null }`로 자리를 만들어
   **모든 행의 길이를 `columnCount`로 맞춘다** (뒤 단계가 `cells[r][c]`를 무방비로 읽는다).
5. `numFmt`는 `cell.numFmt`를 그대로 담는다. 없으면 `null`.
   `toProgress`가 이 값으로 퍼센트를 판별하므로 절대 버리지 마라.
6. `worksheet.model.merges`(또는 동등한 API)에서 병합 범위를 읽어 `MergeRange[]`로 변환한다.
   `A1:D1` 같은 A1 표기를 0-based 숫자 범위로 바꾸는 변환은 이 파일 안에 둔다.
7. `row.hidden`인 행 인덱스를 `hiddenRows`에 모은다. **행을 여기서 지우지 마라** —
   건너뛸지 말지는 T3의 판단이다. 리더는 사실만 싣는다.
8. 숨김 열은 `hiddenColumns`에 모으고 **열마다 warning 한 건**을 남긴다
   (`code: 'HIDDEN_COLUMN'`, `PLAN.md` `E6~E8`: "숨김 열은 읽되 warning").
   숨김 행에는 경고를 남기지 않는다 (정상적인 작업 행이라 잡음이 된다).
9. 셀 값은 **해석하지 않는다.** `cell.value`를 `SheetCellValue`로 그대로 옮긴다.
   날짜 문자열화·퍼센트 변환·수식 풀기는 전부 `cell-normalizer`의 일이다.
   여기서 `cell-normalizer`를 부를 필요도 없다.

### 4. 테스트 케이스 — 픽스처의 계약을 고정한다

1. 워크시트 5개가 **파일 순서 그대로** 나온다 (`00_…` → `99_설정`)
2. `02_촬영·기획팀`의 `columnCount`가 **71**이고, 9행(0-based 8)의 헤더 셀이 71개 차 있다
3. **`00_통합 대시보드`의 `rowCount`가 `dimensions` 기준이다** — 서식만 있는 패딩 행이
   격자에 들어오지 않는다. 픽스처가 만든 패딩 마지막 행 번호보다 작아야 한다
4. **세로 병합** `01_편집팀` `A14:A15`(0-based `[13][0]`·`[14][0]`)의 값이 같다 (완료 기준 8)
5. `merges`에 그 세로 병합과 r8의 가로 병합이 들어 있다
6. `hiddenRows`에 픽스처의 숨김 행이 정확히 들어 있고, 그 행의 셀은 **격자에 그대로 남아 있다**
7. `numFmt`가 보존된다 — 퍼센트 셀의 `numFmt`에 `%`가 들어 있다
8. 셀 형태가 원형 그대로 온다 — `{formula, result}` 셀이 `unwrapCellValue`를 거쳐
   기대값이 되고, `{sharedFormula}` 셀은 `FORMULA_WITHOUT_RESULT` 경고가 된다
   (여기서 `cell-normalizer`를 **테스트에서** 조합해 확인한다. 구현이 아니라 검증이다)
9. 깨진 바이트(예: `Buffer.from('not a workbook')`)를 넣으면 `WorkbookReadError`가 나고,
   메시지에 내부 경로나 스택이 실리지 않는다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/workbook-reader.test.ts

# exceljs import가 제품 코드에서 이 파일 하나뿐이다 (출력이 정확히 1줄)
test "$(grep -rln "from 'exceljs'\|require('exceljs')\|from \"exceljs\"" src | wc -l | tr -d ' ')" = "1"
grep -rln "exceljs" src | grep -q '^src/lib/sheet/workbook-reader.ts$'

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - `src/` 안에서 `exceljs`를 아는 파일이 `workbook-reader.ts` 하나뿐인가?
   - 리더가 탭 종류·헤더 위치·데이터 행 여부를 **판단하지 않는가?** (판단이 있으면 계층 위반)
   - `cells`가 0-based이고 모든 행 길이가 `columnCount`로 맞춰졌는가?
   - 병합 채우기 코드를 넣었다면, 그것이 **실제로 필요했다는 테스트 근거**가 있는가?
     (`exceljs`가 이미 채워 준다면 코드는 없어야 한다)
   - 에러 메시지에 셀 값·경로·스택이 없는가?
3. `phases/t2-parsing-core/index.json`의 step 2를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"` (내보낸 시그니처, 좌표 규칙,
     `dimensions` 기준 채택, 병합 채우기 필요 여부의 **실측 결과**, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 다른 파일에서 `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL · `ADR-003`.
- 탭 이름으로 시트를 거르거나 `00_통합 대시보드`를 건너뛰지 마라. 이유: 판별은 step 4,
  읽지 않기로 한 결정의 집행은 T3의 파이프라인이다. 리더에 넣으면 두 곳에 규칙이 생긴다.
- 숨김 행을 격자에서 지우지 마라. 이유: 건너뛰기 판정은 T3다. 리더는 사실만 싣는다.
- 값을 정규화하지 마라(날짜 문자열화·퍼센트 ×100·수식 풀기). 이유: step 1의 역할이고,
  두 곳에서 하면 결과가 갈린다.
- `worksheet.rowCount`로 순회하지 마라. 이유: 실측에서 1001까지 팽창한다.
- 4MB·셀 수·타임아웃 같은 업로드 한도를 넣지 마라. 이유: `S2`의 세는 기준이 아직 미확정이고
  (T1 실측에서 정상 파일 오탐), 확정은 T5 완료 기준 6이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
