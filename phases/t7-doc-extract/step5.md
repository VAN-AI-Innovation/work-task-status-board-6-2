# Step 5: assignment-writer

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL 두 개가 이 파일에 동시에 걸린다.**
  (1) `exceljs` import는 `src/lib/sheet/workbook-reader.ts`와 **이 파일** 두 곳뿐이다.
  (2) 생성하는 xlsx의 문자열 셀은 텍스트 타입으로 강제하고 `=`·`+`·`-`·`@`·탭·개행으로 시작하면
  `'` 프리픽스를 붙인다
- `docs/ADR.md` — `ADR-012`(수식 주입은 쓰기 쪽에서 막는다) · `ADR-003`(ExcelJS 단독)
- `docs/PLAN.md` — `S1`(「우리가 만든 xlsx가 무기가 될 수 있다」), 「5. 독스 → 배정표」의
  배정표 컬럼 그림과 「왕복 테스트」, step 0이 추가한 **결정 B**(드롭다운 값의 출처)
- `docs/TICKETS.md` — T7 완료 기준 **4·5·6**
- 이전 step 산출물:
  - `src/types/doc.ts` — `AssignmentRow`
  - `src/lib/doc/assignment-mapper.ts` — `DIFFICULTY_LEVELS`·`PRIORITY_LEVELS`
  - `src/lib/doc/markdown-reader.ts`·`outline-builder.ts`·`workload-parser.ts` (왕복 테스트에 쓴다)
  - `src/lib/fixtures/sample-workload.md`
- 재사용할 기존 코드:
  - `src/lib/domain/task-semantic.ts` — `STATUS_SEMANTIC_MAP` (상태 10개의 유일한 출처)
  - `src/lib/sheet/workbook-reader.ts` — `readWorkbook`. **왕복 테스트가 이걸로 되읽는다**
  - `src/lib/sheet/header-resolver.ts` — `findHeaderBands`·`resolveHeaders`
  - `src/lib/sheet/cell-normalizer.ts` — `toText`

## 배경

이 파일이 만드는 xlsx는 **조직 사람들에게 배포되는 파일**이다(`PLAN.md` S1). 문서 본문의 값이
그대로 셀에 들어가는데, `=`로 시작하는 문자열을 엑셀은 수식으로 해석한다.
`=cmd|'/c calc'!A1`이 문서에 있으면 받는 사람 PC에서 실행된다. **T7에서 가장 위험한 파일이고,
방어는 여기 한 곳에서 강제한다.**

동시에 이 파일은 **고리를 닫는** 지점이다. 드롭다운이 붙어 있어야 사람이 채운 배정표를
`/upload`에 다시 올렸을 때 enum이 맞는다. 드롭다운이 없으면 자유 입력이 되고, 재업로드에서
미등록 값 경고가 쏟아진다.

## 작업

### 1. `src/lib/xlsx/assignment-writer.test.ts` 를 **먼저** 쓴다

```ts
export interface AssignmentDropdowns {
  status: readonly string[];
  difficulty: readonly string[];
  priority: readonly string[];
}
/** 기본 목록. 결정 B의 표 그대로 */
export const DEFAULT_DROPDOWNS: AssignmentDropdowns;
/** 헤더 · 너비 · 어느 컬럼에 드롭다운이 붙는지 */
export const ASSIGNMENT_COLUMNS: readonly { header: string; width: number }[];
/** `S1`의 방어. 이 함수 하나가 규칙의 전부다 */
export function sanitizeCellText(value: string): string;

export function buildAssignmentWorkbook(
  rows: readonly AssignmentRow[],
  opts?: { dropdowns?: AssignmentDropdowns; sheetName?: string }
): Promise<Uint8Array>;
```

컬럼은 `PLAN.md`의 그림 그대로 **11개**다:

```
카테고리 | 번호 | 과제명 | 난이도 | 마감 | 우선순위 | 세부항목 | 담당자 | 상태 | 진행률 | 비고
                          ↑드롭다운        ↑드롭다운              ↑빈칸  ↑드롭다운 ↑% 서식 ↑빈칸
```

테스트 케이스:

**A. `sanitizeCellText` (순수 함수 — 파일을 만들지 않고 잰다)**

| 입력 | 기대 |
|---|---|
| `=cmd\|'/c calc'!A1` | `'` 프리픽스가 붙는다 |
| `+1`·`-1`·`@user` | 각각 프리픽스 |
| `\t머리` · `\n머리` | 프리픽스 |
| ` =SUM(A1)` (앞 공백) | **프리픽스가 붙는다.** 엑셀은 앞 공백을 무시하고 수식으로 읽는다 |
| `정상 텍스트` · `2026-09-01` · `9/1까지` | 그대로 (프리픽스 없음) |
| `` (빈 문자열) | 그대로 |
| 이미 `'`로 시작하는 값 | 프리픽스를 **두 번 붙이지 않는다** |

**B. 파일 구조 (`buildAssignmentWorkbook` → `readWorkbook`으로 되읽어 잰다)**

- 1행이 헤더 11칸이고 순서가 위 그림과 같다
- 데이터 행 수 = `rows.length`
- 워크시트가 1개다
- 빈 `rows`도 헤더만 있는 파일을 만든다 (예외를 던지지 않는다)

**C. 드롭다운 (완료 기준 4)**

되읽은 워크북에서 `난이도`·`우선순위`·`상태` 컬럼의 **데이터 행 셀**에 데이터 검증이 붙어 있고
목록 값이 `DEFAULT_DROPDOWNS`와 같다. `readWorkbook`은 `dataValidation`을 격자에 담지 않으므로,
**이 케이스만** ExcelJS로 직접 되읽어 `cell.dataValidation`을 확인한다
(테스트 파일에서의 `exceljs` import는 제품 코드 규칙 밖이다 — `CLAUDE.md`의 대상은 `src/` 제품
경로이고 이 확인 없이는 완료 기준 4를 증명할 수 없다. 확인용 import임을 주석으로 남긴다).

**D. 수식 주입 방어 (완료 기준 5 — 필수)**

`=cmd|'/c calc'!A1`을 `details`에 담은 행으로 파일을 만들고 되읽어:
- 그 셀의 값이 **문자열**이다 (`{formula: …}` 객체가 아니다)
- `'` 프리픽스가 붙어 있다
- 셀 서식이 텍스트(`@`)다

**E. 왕복 테스트 (완료 기준 6)**

```
sample-workload.md
  → readMarkdownOutline → buildOutline → parseWorkloadPriorities → buildAssignmentRows
  → buildAssignmentWorkbook (xlsx 바이트)
  → readWorkbook + findHeaderBands + resolveHeaders + toText   ← 시트 파서로 되읽는다
  → 행 복원
```

복원한 행이 원래 `AssignmentRow[]`와 같아야 한다. **비교 기준을 정확히 정한다**:
셀에서 되읽은 문자열은 `sanitizeCellText(원본)`과 같아야 한다. 수식 주입 방어가 붙은 셀은
`'` 하나가 더 있는 것이 **정상**이며, 그것까지 포함해 일치를 재는 것이 이 테스트다.
`null` 필드는 빈 셀(되읽으면 `toText`가 null)로 간다.

### 2. `src/lib/xlsx/assignment-writer.ts` 를 구현한다

- **`sanitizeCellText`가 모든 문자열 셀을 통과한다.** 헤더도 포함한다 — 예외를 만들면 언젠가
  누군가 우회 경로를 하나 더 만든다.
- 모든 문자열 셀에 `numFmt = '@'`(텍스트)를 준다. `cell.value`에는 **문자열만** 넣는다
  (`{formula}` 객체를 만들지 마라).
- 드롭다운: `cell.dataValidation = { type: 'list', allowBlank: true, formulae: ['"값1,값2,…"'] }`
  를 **데이터 행에만** 건다. 인라인 목록 문자열은 엑셀 한도가 255자다 — 기본 목록은 훨씬 짧지만
  주석으로 한도를 남기고, 값에 `,`가 들어가면 목록이 깨진다는 것도 남긴다.
- `상태`·`담당자`·`진행률`·`비고`는 빈 칸이다. `진행률` 컬럼에는 `numFmt = '0%'`만 준다.
- 1행 틀고정(`views: [{ state:'frozen', ySplit:1 }]`), 헤더 굵게, `ASSIGNMENT_COLUMNS`의 너비 적용.
  꾸미기는 여기까지다 — 색·테두리·필터를 넣지 마라.
- `마감` 칸에는 `deadlineDate ?? deadlineRaw`를 **문자열로** 쓴다. 날짜 타입으로 쓰지 마라:
  추론 실패한 행(`추후 협의`)과 성공한 행이 같은 컬럼에 섞이는데, 타입이 갈리면 재업로드에서
  한 컬럼이 두 가지로 읽힌다.
- `DEFAULT_DROPDOWNS.status`는 `Object.keys(STATUS_SEMANTIC_MAP)`로 만든다. 상태 문자열을
  이 파일에 다시 적지 마라 (결정 B).
- 반환은 `Uint8Array`. 라우트가 그대로 응답 본문에 실을 수 있어야 한다.

## Acceptance Criteria

```bash
npm run test -- src/lib/xlsx/assignment-writer.test.ts
npm run lint && npm run build && npm run test
grep -rn "from 'exceljs'\|require('exceljs')" src/ --include=*.ts | grep -v test
# → workbook-reader.ts 와 assignment-writer.ts 두 줄만 나와야 한다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `exceljs` 제품 코드 import가 정확히 두 파일인가?
   - 완료 기준 5의 픽스처(`=cmd|'/c calc'!A1`)로 실제 파일을 만들어 되읽는 테스트가 있는가?
   - 왕복 테스트가 `readWorkbook`(시트 파서)으로 되읽는가? 자체 되읽기 함수를 만들어
     자기 자신과 비교하고 있지는 않은가?
   - 상태 10개 문자열을 이 파일에 하드코딩하지 않았는가?
3. `phases/t7-doc-extract/index.json`의 step 5를 갱신한다.

## 금지사항

- 시트에 색·조건부 서식·자동 필터·차트를 넣지 마라. 이유: 사람이 채워 되올릴 입력 파일이다.
  꾸밈이 늘수록 재업로드에서 파서가 만날 셀 형태가 는다.
- 셀 값에서 위험 문자를 **삭제**하지 마라. 프리픽스를 붙여 **보존**한다 (`ADR-012` 트레이드오프:
  「`=`로 시작하는 정당한 텍스트도 앞에 `'`가 붙는다. 사람이 지우면 그만이다」).
- `src/lib/doc/`의 파일을 **기능 추가로** 고치지 마라. 왕복 테스트가 통과하지 않아 앞 step의
  버그를 고쳐야 한다면 고치되, **무엇을 왜 고쳤는지 `summary`에 남긴다** — 어느 계층의 계약이
  틀렸는지가 기록되지 않으면 다음 사람이 같은 자리를 다시 판다. 통과시키려고 테스트의 기대값을
  느슨하게 바꾸는 것은 금지다.
- 기존 테스트를 깨뜨리지 마라.
