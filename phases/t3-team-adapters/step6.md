# Step 6: adapter-goal-metrics

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서 하드 실패 금지
- `docs/TICKETS.md` — `## T3` 완료 기준 **5·6**, `## T4` 완료 기준 **7**(`summarizeGoals`가
  달성률을 재계산한다 — **여기서 재계산하지 않는 이유**), `## T6` 완료 기준 3
- `docs/PLAN.md` — 「1. 데이터 모델」의 `goal_metrics` 블록과 **"`goal_metrics`가 과제 요구
  4번의 실체"** 문단, `E3`(퍼센트는 0.66으로 저장된다)
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `goal_metrics`, `tasks`와 별도 테이블인 이유
- T2 산출물: `src/lib/sheet/cell-normalizer.ts`(`toProgress`가 왜 여기에 맞지 않는지 확인),
  `scripts/fixtures/build-sample-workbook.mjs`의 `MARKETING_B_HEADERS`와 `executions`
- 이전 step 산출물: `src/types/goal.ts`, `src/lib/sheet/row-mapper.ts`,
  `src/lib/sheet/section-splitter.ts`

## 배경

과제 원문 요구 4번("부서별 목표와 실제 성과 비교")의 데이터는 **새로 만드는 게 아니라 시트에 이미 있다.**
`03_마케팅·관리팀` B섹션(0-based 헤더 23행, 데이터 24~26행)의 30컬럼이 그것이다.

```
기준 주차 │ 회의일 │ 마케팅 과제명 │ … │ 목표 KPI │ 목표 수치 │ 실제 성과 │ 달성률 │ 직전 주 대비 변화 │ 성과 분석 │ 잘된 점 │ 개선 필요사항 │ …
```

### 달성률은 `toProgress`로 읽으면 안 된다

`달성률` 셀은 퍼센트 서식(`0%`)이고 값이 `1.2` / `0.82` / `0.95`다.
`toProgress`를 쓰면 `1.2 → 120`은 맞지만 **`PROGRESS_OUT_OF_RANGE` 경고가 딸려 온다.**
진행률은 100을 넘으면 이상하지만 **달성률은 120%가 정상**이다. 경고가 잡음이 된다.

그래서 이 파일 안에 작은 헬퍼를 둔다: `toNumber`로 읽고, 그 셀의 `numFmt`에 `%`가 있으면
×100해서 반올림한다. **범위 경고를 내지 않는다.**

### 시트의 달성률을 고치지 않는다

픽스처 세 번째 행은 목표 40 · 실적 12인데 달성률이 `0.95`로 어긋나 있다. **의도된 함정이다.**
여기서는 시트 값을 그대로 보존한다. `actual/target` 재계산과 불일치 경고는 **T4의
`summarizeGoals`**(T4 완료 기준 7)의 일이다. 파서가 고쳐 버리면 T4가 볼 증거가 사라진다.

## 작업

### 1. `src/lib/sheet/adapter-goal-metrics.ts`

```ts
export function parseGoalMetrics(
  sheet: SheetGrid,
  section: SheetSection,
  ctx: { teamKey: TeamKey; baseYear: number },
): { goalMetrics: ParsedGoalMetric[]; warnings: ParseWarning[] };
```

섹션은 호출자(step 7의 마케팅 어댑터)가 `splitSections`에서 꺼내 넘긴다.
**이 함수가 스스로 섹션을 찾지 않는다.** `section.band`가 null이면 빈 결과를 돌려준다.

### 2. 선언적 매핑

```ts
const IDENTITY_HEADERS = ['마케팅 과제명', '실행 담당자'];

const GOAL_FIELD_MAP = [
  { header: '기준 주차',          field: 'periodLabel',      kind: 'text' },
  { header: '마케팅 과제명',       field: 'title',            kind: 'text' },
  { header: '실행 담당자',         field: 'ownerNameRaw',     kind: 'text' },
  { header: '목표',               field: 'goalText',         kind: 'text' },
  { header: '실행 채널',           field: 'channel',          kind: 'text' },
  { header: '실행 상태',           field: 'execStatus',       kind: 'text' },
  { header: '실행 시작일',         field: 'startedAt',        kind: 'date' },
  { header: '실행 기한',           field: 'dueAt',            kind: 'date' },
  { header: '목표 KPI',           field: 'kpiName',          kind: 'text' },
  { header: '목표 수치',           field: 'targetValue',      kind: 'number' },
  { header: '실제 성과',           field: 'actualValue',      kind: 'number' },
  { header: '달성률',             field: 'achievementRate',  kind: 'percent' },
  { header: '직전 주 대비 변화',    field: 'prevPeriodDelta',  kind: 'text' },
  { header: '성과 분석',           field: 'analysis',         kind: 'text' },
  { header: '잘된 점',             field: 'wentWell',         kind: 'text' },
  { header: '개선 필요사항',        field: 'needsImprovement', kind: 'text' },
] as const;
```

`목표`와 `목표 KPI`·`목표 수치`가 **마지막 조각 정확 일치**로 구분된다는 점을 확인하라.
접두 일치를 쓰면 `목표`가 셋을 다 잡아 값이 뒤섞인다.

### 3. `row-mapper`와의 관계

`ParsedGoalMetric`은 `ParsedTask`와 필드가 다르므로 `mapRows`를 그대로 쓸 수 없다.
**`mapRows`를 지표까지 처리하도록 고치지 마라** — 한 함수가 두 산출물을 만들면 양쪽이 뒤엉킨다.

대신 같은 규칙을 그대로 따른다. `row-mapper.ts`를 읽고 아래를 동일하게 지켜라:

- 행 범위는 `section.band.labelRow + 1 ~ section.endRow`
- `sheet.hiddenRows`의 행은 건너뛴다
- 신원 판정: `IDENTITY_HEADERS` 중 하나 이상에 값이 있어야 한다. 수식 셀은 판정에 쓰지 않는다
- 매핑되지 않은 컬럼은 전부 `extras`, 모든 컬럼은 `raw`
- `cell-normalizer` 경고를 1-based 좌표로 승격
- `validateParsedGoalMetric`을 돌려 경고를 합친다 (완료 기준 9)
- 경고에 셀 값·과제명·담당자를 담지 않는다

`row-mapper`의 내부 헬퍼를 재사용할 수 있으면 `export`해서 쓰되, **`row-mapper`의 공개
시그니처를 바꾸지 마라** (step 3·4가 이미 쓰고 있다).

### 4. 테스트 케이스 (`src/lib/sheet/adapter-goal-metrics.test.ts`)

픽스처를 `readWorkbook` + `splitSections`로 읽어 통합 검증한다.

1. **지표가 정확히 3건**이다 (완료 기준 6)
2. 첫 건: `title === '[샘플] 리그램 이벤트'`, `kpiName === '유입수'`,
   `targetValue === 100`, `actualValue === 120`, `achievementRate === 120`
3. 둘째 건: `achievementRate === 82` (0.82 × 100), **`PROGRESS_OUT_OF_RANGE` 경고가 없다**
4. 셋째 건: `targetValue === 40`, `actualValue === 12`, **`achievementRate === 95`**
   — 시트 값이 어긋나 있어도 **여기서 고치지 않는다**는 증거
5. `periodLabel === '2026-07 4주차'`, `prevPeriodDelta`가 `'+18%'`·`'-4%'`·`'신규'` 문자열이다
6. `goalText`·`analysis`·`wentWell`·`needsImprovement`가 채워져 있다 (완료 기준 6의 뒤쪽)
7. `startedAt`·`dueAt`이 `YYYY-MM-DD`다
8. 매핑되지 않은 컬럼(`회의일`·`제안자`·`대상`·`실행 방식`·`관련 링크` 등)이 전부 `extras`에 있다
9. `관련 링크`의 하이퍼링크 URL이 `extras`에 보존된다
10. `section.band`가 null이면 빈 결과 + 경고 0건
11. 모든 경고에 셀 값·과제명·담당자가 들어 있지 않다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/adapter-goal-metrics.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/adapter-goal-metrics.ts ; test $? -eq 1

# 달성률을 재계산하지 않았다 — 나눗셈이 없어야 한다 (눈으로 확인)
grep -nE "actualValue\s*/|/\s*targetValue" src/lib/sheet/adapter-goal-metrics.ts ; test $? -eq 1

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 달성률에 `toProgress`를 쓰지 않았는가 (범위 경고가 안 나는가)?
   - 시트의 어긋난 달성률(0.95)이 그대로 남았는가?
   - `row-mapper`의 공개 시그니처가 그대로인가?
3. `phases/t3-team-adapters/index.json`의 step 6을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(시그니처, 지표 3건의 값, 달성률 처리 방식과
     T4에 넘긴 것, `extras` 키 수, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 달성률을 `actual/target`으로 재계산하지 마라. 이유: T4 완료 기준 7의 범위이고,
  여기서 고치면 불일치 경고의 근거가 사라진다.
- 달성률에 `toProgress`를 쓰지 마라. 이유: 100 초과가 정상인데 경고가 잡음이 된다.
- `mapRows`의 시그니처를 바꾸지 마라. 이유: step 3·4가 이미 쓰고 있다.
- 섹션을 스스로 찾지 마라. 이유: step 5가 끝냈고 인자로 받는다.
- A섹션(문의)·C섹션(브리핑)을 여기서 처리하지 마라. 이유: step 7의 범위다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
