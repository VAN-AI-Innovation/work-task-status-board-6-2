# Step 4: assignment-mapper

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL: 도메인 함수는 `now`를 인자로 주입받는다.** 함수 안에서
  `new Date()`·`Date.now()`를 호출하지 않는다. TDD. 파서 하드 실패 금지
- `docs/TICKETS.md` — T7 완료 기준 **3**, 리스크·미결의 「연도 추론」 항목
- `docs/PLAN.md` — 「5. 독스 → 배정표」의 **주의점 3개**(난이도 정규식 순서 · 연도 추론 · 워크로드 조인)
  와 step 0이 추가한 「T7 착수 시 확정」의 **결정 A**(우선순위 매핑표)
- 이전 step 산출물:
  - `src/types/doc.ts` — `OutlineTask`·`WorkloadEntry`·`AssignmentRow`
  - `src/lib/doc/outline-builder.ts`·`src/lib/doc/workload-parser.ts`
- 재사용할 기존 코드: `src/lib/sheet/cell-normalizer.ts`의 `toDateString(value, {baseYear})`
  — `9/1` 같은 월/일 표기를 `baseYear`로 채워 `YYYY-MM-DD`로 만드는 로직이 **이미 있다**

## 배경

문서의 산문 표기를 배정표 한 줄로 옮기는 계층이다. 판단 셋이 전부 여기 모인다.

**1. 난이도 — 실제로 나는 버그가 명시돼 있다.**

```
❌  /上|中上|中|中下|下/     →  '中上'이 '中'에 먼저 걸린다
✅  /中上|中下|上|中|下/      →  긴 것부터
```

완료 기준 3이 이 한 줄을 잰다. 픽스처에 `中上`·`中下`가 들어 있는 이유가 이것이다.

**2. 마감 — 연도가 없다.** `9/1까지`에는 연도가 없고, 하드코딩은 금지다(`PLAN.md`).
`baseYear`를 주입받는다. 추론이 실패하면 `deadlineDate`는 null이고 `deadlineRaw`는 **남는다** —
사람이 배정표에서 그 칸을 보고 채울 수 있어야 한다. 값을 버리는 것이 가장 나쁜 실패다.

**3. 우선순위 — 문서의 `P0`을 시트 enum 값으로 옮긴다** (결정 A). 조인 실패는 조용히 빈칸이다.

## 작업

### 1. `src/lib/doc/assignment-mapper.test.ts` 를 **먼저** 쓴다

```ts
/** 긴 것부터. 이 배열의 순서가 정규식의 순서다 */
export const DIFFICULTY_LEVELS: readonly string[];      // ['中上','中下','上','中','下'] — 정렬 순서 주의
/** 시트 `공통_우선순위` 실측값 */
export const PRIORITY_LEVELS: readonly string[];        // ['긴급','높음','보통','낮음']
/** 결정 A의 표 */
export const WORKLOAD_PRIORITY_MAP: Readonly<Record<string, string>>;

export function buildAssignmentRows(
  tasks: readonly OutlineTask[],
  workload: readonly WorkloadEntry[],
  ctx: { baseYear: number }
): AssignmentRow[];
```

`DIFFICULTY_LEVELS`가 두 가지 일을 겸한다 — 정규식 순서(긴 것부터)와 드롭다운 목록(step 5).
드롭다운에 보이는 순서는 사람이 읽는 순서(`上`→`下`)여야 하므로, **정렬용 배열과 표시용 배열을
따로 export**한다: `DIFFICULTY_MATCH_ORDER`(긴 것부터)와 `DIFFICULTY_LEVELS`(`上`·`中上`·`中`·`中下`·`下`).

케이스:

| `headingRaw` | 기대 |
|---|---|
| `3-1. 시트 통합 파서 (上, 9/1까지)` | `difficulty:'上'`, `deadlineRaw:'9/1까지'`, `deadlineDate:'2026-09-01'`(baseYear 2026), `title:'시트 통합 파서'` |
| `3-2. 이상치 리포트 (中上)` | **`difficulty:'中上'`** ← 완료 기준 3. `'中'`이면 실패 |
| `3-3. 회귀 점검 (中下)` | `'中下'` |
| `3-4. 문서 정리 (下, 추후 협의)` | `deadlineRaw:'추후 협의'`, `deadlineDate:null` |
| `3-5. 이름만 있는 과제` | 난이도·마감 모두 null, `title` 그대로 |
| `3-6. 과제 (中) (2026-10-05까지)` | 괄호가 둘이어도 각각 잡는다 |
| `3-7. 과제 (9월 1일까지)` | `deadlineDate:'2026-09-01'` — `N월 M일`을 `N/M`으로 바꿔 넘긴다 |
| `baseYear: 2027` | 같은 `9/1`이 `2027-09-01`. **하드코딩 금지 확인** |
| 워크로드 `{taskNo:'3-1', priorityRaw:'P0'}` | `priority:'긴급'`, `priorityRaw:'P0'` |
| 워크로드에 없는 과제 | `priority:null`, `priorityRaw:null` (경고 없음) |
| 워크로드에만 있는 번호(`9-9`) | 아무 일도 일어나지 않는다 |
| `priorityRaw:'P7'` (표에 없음) | `priority:null`, `priorityRaw:'P7'` (원문은 남는다) |
| `details` 3줄 | `row.details`가 개행으로 이어진 문자열 |
| `details` 없음 | `''` |
| 픽스처 전체를 리더→빌더→파서→매퍼로 통과 | 난이도 5종이 **모두 정확히** 나온다 |

### 2. `src/lib/doc/assignment-mapper.ts` 를 구현한다

- **난이도**: `headingRaw`에서 `DIFFICULTY_MATCH_ORDER`를 `|`로 이은 정규식으로 찾는다.
  배열 순서를 뒤집는 코드를 넣지 마라 — 배열 자체가 이미 매칭 순서다.
- **제목**: `headingRaw`에서 번호 접두사(`N-M.`·`N-M)`)와 **난이도·마감을 담은 괄호 덩어리**를
  떼고 `trim()`. 괄호 안에 난이도도 마감도 없으면 **떼지 않는다** (`(2부)` 같은 정당한 제목의 일부).
- **마감**: 괄호 안 또는 제목 뒤에서 아래 순서로 찾는다.
  1. `YYYY-MM-DD`·`YYYY.MM.DD` 형태
  2. `M/D`·`M.D` 형태
  3. `N월 M일` → `N/M`으로 바꾼다
  `deadlineRaw`는 **문서에 적힌 표기 그대로**(`9/1까지`)이고, `deadlineDate`는 `toDateString`에
  1~3의 날짜 토큰만 넘겨 얻는다. 괄호 안에 날짜가 없으면 그 괄호 내용 전체가 `deadlineRaw`가
  되는지 아닌지는 **난이도가 아닌 괄호일 때만** 그렇다 (`(추후 협의)` → `deadlineRaw:'추후 협의'`).
- **`toDateString`을 재사용한다.** 날짜 파서를 새로 쓰지 마라 — 이 프로젝트에 월/일 추론
  로직이 두 벌 생기면 시트와 문서가 다른 날짜를 낸다.
- **`new Date()`·`Date.now()`를 부르지 마라** (`CLAUDE.md` CRITICAL). `baseYear`는 인자다.
- **우선순위**: `taskNo`로 조인 → `WORKLOAD_PRIORITY_MAP` → 없으면 null. 경고를 내지 않는다.
- 예외를 던지지 않는다. 어떤 입력에도 행 배열을 돌려준다.

## Acceptance Criteria

```bash
npm run test -- src/lib/doc/assignment-mapper.test.ts
npm run lint && npm run build && npm run test
grep -n "DIFFICULTY_MATCH_ORDER" src/lib/doc/assignment-mapper.ts   # 중上이 中보다 앞에 있는지 눈으로 확인
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `中上`이 `中`으로 떨어지는 케이스가 테스트에 **있고** 통과하는가? (완료 기준 3)
   - 연도가 코드 어디에도 리터럴로 박혀 있지 않은가? (`2026`을 grep 해서 테스트 밖에 없어야 한다)
   - 마감 추론이 실패한 행에서 `deadlineRaw`가 **살아 있는가?**
   - `exceljs`·`mammoth`를 import하지 않았는가?
3. `phases/t7-doc-extract/index.json`의 step 4를 갱신한다.

## 금지사항

- LLM 보강을 넣지 마라. `TICKETS.md` T7 범위 Out이다.
- 난이도·우선순위를 「추론」하지 마라. 문서에 없으면 빈칸이다. 사람이 채울 칸을 기계가
  그럴듯하게 메우면, 배정표를 받은 사람이 그 값을 믿는다.
- 담당자를 추론하지 마라. 문서에 이름이 나와도 `AssignmentRow`에 담지 않는다 — 개인정보이고,
  담당자 칸은 사람이 채우는 자리다 (`PLAN.md`의 배정표 컬럼 그림에 「↑빈칸」).
- 기존 테스트를 깨뜨리지 마라.
