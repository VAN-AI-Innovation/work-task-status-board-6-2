# Step 1: cell-normalizer

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(`exceljs` import 제한, `src/lib/` 파일명 전역 유니크),
  개발 프로세스(TDD, 파서는 하드 실패 금지 — `warnings[]`에 담고 값 보존)
- `docs/TICKETS.md` — `## T2` 완료 기준 **3·4·5·6**
- `docs/PLAN.md` — `E1`(엑셀 시리얼 0/1 아티팩트) · `E2`(`cell.value` 형태 표) · `E3`(퍼센트) ·
  `E4`(KST — 왜 `now`를 주입받는지)
- `docs/ARCHITECTURE.md` — 계층 경계, `lib/sheet/` 모듈 목록
- 이전 step 산출물: `scripts/fixtures/build-sample-workbook.mjs` — **실제로 어떤 셀 형태가
  픽스처에 들어갔는지**를 여기서 확인한다

## 배경

`cell-normalizer`는 파이프라인에서 가장 아래에 있고 가장 많이 불린다. 여기서 뭉개진 값은
어느 단계에서도 복구되지 않는다.

**이 모듈은 `exceljs`를 import하지 않는다.** 규칙상 금지이기도 하지만, 더 실질적인 이유는
`cell.value`의 형태들이 전부 **평범한 JS 객체**라서 우리 타입으로 그대로 기술할 수 있기
때문이다. `workbook-reader`(step 2)가 `exceljs`를 아는 유일한 파일이고, 그 아래로는
우리가 선언한 `SheetCellValue`만 흐른다.

따라서 **이 step의 테스트는 xlsx 파일을 열지 않는다.** 값을 손으로 만들어 넣는 순수
단위 테스트다. 픽스처를 통과시키는 통합 검증은 step 2가 한다.

### 실측된 셀 형태 — `PLAN.md` E2 표가 불완전하다

실제 시트에서 아래 두 형태가 나왔는데 `E2` 표에 없다.

```
{ formula: "COUNTIFS(#REF!,…)" }     // result 키 자체가 없다
{ sharedFormula: "C10" }             // 공유 수식 슬레이브. 역시 result가 없다
```

`01_편집팀`의 KPI 행과 데이터 행 다수가 이 모양이다. `{formula, result}`만 기대하고
`value.result`를 읽으면 `undefined`가 흘러 내려가고, `String(value)`로 뭉개면
`[object Object]`가 저장된다. **둘 다 실제로 일어난다.**

## 작업

### 1. `docs/PLAN.md`의 `E2` 표를 실측에 맞춘다

`CLAUDE.md`에 따라 **결정이 바뀌면 코드보다 문서를 먼저 고친다.**

- `E2` 표에 위 두 형태를 행으로 추가한다. 처리 방침은 **`result`가 있으면 그것을 쓰고,
  없으면 null + warning** 이다.
- `docs/TICKETS.md`의 `## T2` 완료 기준 4번 문구가 "6가지"로 못 박혀 있다. 실측된 형태
  수에 맞춰 고치고, 근거를 한 줄 남긴다 (`01_편집팀` 실측에서 발견).
- 요구를 **넓히는** 수정이다. 처리해야 할 형태가 줄어드는 방향으로 고치지 마라.
- 그 외 문서는 건드리지 마라.

### 2. `src/types/sheet.ts` — 셀 값 타입 선언

`exceljs` import 없이 형태를 그대로 기술한다.

```ts
export type SheetCellPrimitive = string | number | boolean | Date;

export type SheetCellValue =
  | SheetCellPrimitive
  | null
  | { formula: string; result?: SheetCellValue }
  | { sharedFormula: string; result?: SheetCellValue }
  | { text: string; hyperlink: string }
  | { richText: { text: string }[] }
  | { error: string };
```

경고 코드도 여기 둔다. **경고에 셀 값을 담지 않는다** (`CLAUDE.md` 보안 규칙) — 코드만
반환하고, 위치(`시트명!행:열`)는 이 값을 읽은 상위 계층이 붙인다.

```ts
export type NormalizeWarning =
  | 'FORMULA_WITHOUT_RESULT'
  | 'CELL_ERROR'
  | 'UNSUPPORTED_CELL_SHAPE'
  | 'DATE_UNPARSABLE'
  | 'DATE_OUT_OF_RANGE'
  | 'PROGRESS_OUT_OF_RANGE';
```

필요한 것만 선언한다. 뒤 step에서 쓸 것 같은 타입을 미리 만들지 마라.

### 3. `src/lib/sheet/cell-normalizer.test.ts` 를 **먼저** 쓴다

TDD다. 아래 함수 시그니처를 고정하고 케이스를 먼저 깐다.

```ts
export type NormalizeResult<T> = { value: T | null; warning: NormalizeWarning | null };

unwrapCellValue(v: SheetCellValue): NormalizeResult<SheetCellPrimitive> & { hyperlink: string | null }
toText(v: SheetCellValue): NormalizeResult<string>
toNumber(v: SheetCellValue): NormalizeResult<number>
toDateString(v: SheetCellValue, opts: { baseYear: number }): NormalizeResult<string>
toProgress(v: SheetCellValue, numFmt?: string): NormalizeResult<number>
```

`toNumber`가 필요한 이유: step 5의 설정 탭 SLA 일수와 T3의 목표 수치가 숫자 컬럼이고,
그 값 역시 수식 셀로 올 수 있다. 그 외 변환 함수는 만들지 마라.

### 4. 동작 규칙 — 이대로 구현한다

#### `unwrapCellValue` — 7가지 형태를 푼다 (완료 기준 4)

| 입력 | 결과 |
|---|---|
| `null` · `undefined` | `{ value: null, warning: null }` |
| 문자열 · 숫자 · 불리언 · `Date` | 그대로 |
| `{ formula, result }` | `result`를 **재귀적으로** 다시 푼다 (`result`가 `Date`·`richText`일 수 있다) |
| `{ formula }` (result 없음) | `null` + `FORMULA_WITHOUT_RESULT` |
| `{ sharedFormula, result? }` | 위 두 줄과 동일 |
| `{ text, hyperlink }` | `value = text`, `hyperlink = hyperlink` |
| `{ richText: [...] }` | 조각의 `text`를 순서대로 이어붙인 문자열 |
| `{ error }` | `null` + `CELL_ERROR` |
| 그 밖의 객체 | `null` + `UNSUPPORTED_CELL_SHAPE` |

**어떤 경우에도 `String(value)`로 객체를 뭉개지 마라.** 미지의 형태는 null + 경고다.

`hyperlink`는 원문 그대로 돌려준다. 스킴 검사(`http`·`https`만 앵커)는 렌더 시점의
방어라 T6 범위다 — 여기서 하지 않는다.

#### `toDateString` — 전부 `YYYY-MM-DD` 또는 null (완료 기준 3·5)

- `Date` → **UTC 게터로** 포맷한다. `toISOString().slice(0,10)`은 UTC 자정 값에만 안전하고,
  로컬 게터를 쓰면 서버 타임존에 따라 하루가 밀린다.
- 숫자(엑셀 시리얼) → `Date.UTC(1899, 11, 30) + serial * 86400000`.
- **`1900-01-01` 이하는 전부 null + `DATE_OUT_OF_RANGE`.** 시리얼 0·1이 `E1`의 유령 행
  아티팩트다. 티켓 문구는 "1900-01-01 이전"이지만 죽여야 할 값이 시리얼 **0과 1** 두 개이므로
  경계를 포함해 자른다. 이 판단을 step 요약에 한 줄로 남겨라.
  (1900년 윤년 버그 구간의 시리얼 2~59는 하루 어긋날 수 있다. 실제·픽스처 데이터에 없어
  다루지 않는다. 가정을 코드 주석 한 줄로 남긴다.)
- 문자열
  - 빈 문자열 · 공백만 · `-` · `—` → `null`, **경고 없음** (정상적인 빈칸이다)
  - `2026-09-01` · `2026.09.01` · `2026. 09. 01.` · `2026/9/1` → 정규화
  - `9/1` · `9.1` (연도 없음) → `opts.baseYear`를 붙인다. **오늘 연도를 함수 안에서 읽지 마라**
    (`CLAUDE.md` — `now`·연도는 주입받는다). `baseYear`는 필수 인자다.
  - 달력상 없는 날짜(`2026-02-30`)와 그 밖의 문자열 → `null` + `DATE_UNPARSABLE`
- 불리언 → `null`, **경고 없음.** 유령 행의 날짜 서식 컬럼에 `false`가 통째로 들어 있어
  경고를 내면 25행 × 여러 컬럼만큼 잡음이 된다.
- 수식·하이퍼링크·리치텍스트 셀은 `unwrapCellValue`를 거친 뒤 위 규칙을 적용한다.
  푼 단계에서 나온 경고가 있으면 그것을 그대로 돌려준다.

#### `toProgress` — 퍼센트 서식 판별 (완료 기준 6)

- `numFmt`에 `%`가 들어 있으면 값 × 100. 없으면 값 그대로. **`0.66` → `66`**
- 문자열 `'66%'` → `66`. 문자열 `'66'` → `66`
- 소수점이 남으면 `Math.round`로 정수화한다 (`progress`는 smallint다).
  `0.33 * 100`이 `33.000000000000004`가 되는 부동소수 문제를 여기서 끝낸다.
- 빈 셀 · null → `null`. **`0`과 빈칸을 반드시 구분한다** (`PLAN.md` 데이터 모델).
- 0~100 밖의 값 → **값은 보존하고** `PROGRESS_OUT_OF_RANGE` 경고. 잘라내지 않는다
  (파서는 하드 실패·무단 보정을 하지 않는다).

#### `toText` · `toNumber`

- `toText` — 푼 값을 문자열로. 앞뒤 공백 제거. 빈 문자열은 `null`.
  `Date`가 들어오면 `DATE`가 아니라 ISO 날짜 문자열로 (`toDateString`과 같은 포맷).
- `toNumber` — 숫자면 그대로, 숫자로 읽히는 문자열이면 변환, 그 밖이면 `null`.
  쉼표가 든 `'1,200'`은 숫자로 읽는다. 경고 코드는 새로 만들지 말고 `null`만 돌린다.

### 5. 테스트 커버리지 — 완료 기준이 곧 케이스다

최소한 아래가 각각 독립 케이스로 있어야 한다.

- 셀 형태 7종 각각 (완료 기준 4)
- 시리얼 0 · 시리얼 1 · 정상 시리얼(2026년) (완료 기준 5)
- `1899-12-31` · `1900-01-01` `Date` 객체 → 둘 다 null (완료 기준 5)
- `2026-09-01` · `2026.07.22` · `9/1`+`baseYear` · `-` · 빈칸 → 완료 기준 3의 5종
- numFmt `0%` + `0.66` → `66` / numFmt 없음 + `66` → `66` (완료 기준 6)
- `{formula, result: 0.33}` + numFmt `0%` → `33` (수식과 퍼센트가 겹친 실제 케이스)
- 빈 셀 progress → `null`, `0` → `0`

## Acceptance Criteria

```bash
# 이 모듈의 테스트만 따로 통과한다
npx vitest run src/lib/sheet/cell-normalizer.test.ts

# exceljs가 이 계층에 새어 들어오지 않았다 (출력이 비어야 함)
grep -rn "exceljs" src/lib/sheet/cell-normalizer.ts src/types/sheet.ts ; test $? -eq 1

# 도메인 시간 규칙 — 모듈 안에서 현재 시각을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/sheet/cell-normalizer.ts ; test $? -eq 1

# 문서가 실측에 맞춰졌다
grep -q "sharedFormula" docs/PLAN.md

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 완료 기준 3·4·5·6에 대응하는 테스트가 **각각** 있는가?
   - `String(객체)`로 뭉개는 경로가 하나도 없는가?
   - 경고에 셀 값이 담기지 않았는가? (코드 문자열만)
   - `src/lib/sheet/`에 `cell-normalizer` 말고 다른 파일이 생기지 않았는가?
3. `phases/t2-parsing-core/index.json`의 step 1을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"` (내보낸 함수 목록, 다룬 셀 형태 수,
     1900 경계 판단, 테스트 개수를 포함할 것 — 뒤 step이 이 시그니처를 그대로 호출한다)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `exceljs`를 import하지 마라. 이유: `ADR-003`. 이 계층은 자체 타입만 안다.
- 테스트에서 `sample-workbook.xlsx`를 열지 마라. 이유: 파일을 여는 검증은 step 2다.
  여기서 열면 실패 원인이 리더와 정규화 중 어디인지 구분되지 않는다.
- 함수 안에서 `new Date()`·`Date.now()`를 부르지 마라. 이유: `CLAUDE.md` CRITICAL.
  `baseYear`는 인자로 받는다.
- `progress`를 0~100으로 잘라내지 마라. 이유: 파서는 값을 보존하고 경고만 남긴다.
- 하이퍼링크 스킴 필터를 넣지 마라. 이유: T6 완료 기준 12의 범위다.
- `src/lib/sheet/`에 `header-resolver`·`tab-detector` 등을 미리 만들지 마라. 이유: 각각 별도 step이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
