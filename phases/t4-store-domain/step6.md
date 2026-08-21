# Step 6: weekly-report

## 읽어야 할 파일

- `CLAUDE.md` — 도메인 규칙, 보안 규칙(민감 키)
- `docs/TICKETS.md` — `## T4` 범위 In의 `weekly-report`, `## T6` 완료 기준 9, `## T9`(전용 화면),
  `UC-08`
- `docs/PLAN.md` — 「6. 집계·판정」의 `buildWeeklyReport`, 「주간 운영 루프」, 「역할별 진입 경로」
- `docs/PRD.md` — 요구 5번(대표·실장용 주간 보고)
- step 0~5 산출물 전부

## 배경

`UC-08`("주간 브리핑 생성·복사 → 회의록에 붙여넣기")의 산출물이다. 대표·실장 여정의 종착점이며,
요구 5번의 실체다. **전용 화면은 T9지만 문자열을 만드는 함수는 여기서 확정한다** —
T6가 대시보드 카드로 먼저 노출하기 때문이다.

출력은 **마크다운 문자열 하나**다. HTML도 React 엘리먼트도 아니다. 회의록에 그대로 붙여넣는 것이
용도이므로, 표는 GFM 파이프 표를 쓰고 링크·이미지는 넣지 않는다.

## 작업

### 1. `src/lib/domain/weekly-report.ts` — 테스트를 **먼저** 쓴다

```ts
export interface WeeklyReportInput {
  tasks: readonly Task[];
  stages: readonly TaskStage[];
  goals: readonly GoalMetric[];
  /** 이번 주 변경 이력. 건수만 쓴다 */
  events: readonly TaskEvent[];
  ctx: AlertContext;
}

export function buildWeeklyReport(input: WeeklyReportInput): string;
```

집계는 **하지 말고 가져다 써라.** `summarizeAllTeams`·`buildKpiStrip`·`summarizeGoals`·
`collectAlerts`·`deriveAllFlags`를 호출한다. 이 파일 안에 새 계산식을 만들면
화면 숫자와 보고서 숫자가 갈라진다.

### 2. 문서 구조 — 이 순서로 고정

```markdown
# 주간 업무 보고 — {startOfWeek(today)} ~ {endOfWeek(today)}

## 요약
- 전체 활성 업무: N건 / 완료율: N% / 지연: N건 / 마감 임박: N건
- 이번 주 변경: N건

## 팀별 현황
| 팀 | 전체 | 진행 | 승인 대기 | 지연 | 완료 | 완료율 | 가장 가까운 마감 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
...

## 지연 업무 (N건)
- [{팀}] {업무명} — 담당 {담당자} · D{dday} · 다음 조치: {nextAction}

## 이번 주 마감 (N건)
- [{팀}] {업무명} — 담당 {담당자} · {dueAt}

## 목표 대비 성과
| 팀 | 과제 | KPI | 목표 | 실적 | 달성률 |
| --- | --- | --- | ---: | ---: | ---: |
...
(시트 달성률과 재계산 값이 다른 건이 있으면 표 아래에 "달성률 불일치 N건" 한 줄)

## 확인 필요
- 담당자 미지정 N건 / 기한 미설정 N건 / 장기 미갱신 N건 / 담당자 오타 의심 N건
```

### 3. 규칙

1. **`now`를 읽지 않는다.** 주 범위는 `ctx.today`에서 `startOfWeek`·`endOfWeek`로 만든다.
2. **출력이 결정적이어야 한다.** 모든 목록은 정렬 기준을 고정하라 —
   지연 목록은 `dday` 오름차순 → 팀 → 업무명, 마감 목록은 `dueAt` → 팀 → 업무명.
   `Map`·`Set` 순회 순서에 기대지 마라.
3. **비어 있는 섹션도 제목을 남기고 "해당 없음"을 쓴다.** 섹션을 통째로 지우면 붙여넣은
   회의록에서 "빠뜨린 건지 없는 건지" 알 수 없다.
4. 담당자 **이름은 넣는다** — 회의록 용도이므로 `ownerNameRaw`를 그대로 쓴다.
   **`extras`는 한 값도 넣지 마라.** 연락처·계정·이메일이 거기 있고, 이 문자열은 복사돼
   외부로 나간다 (`CLAUDE.md` 보안 규칙).
5. `raw`도 넣지 마라. 같은 이유다.
6. 값이 null이면 `-`로 쓴다. `null`·`undefined`·`NaN`·`[object Object]`가 문자열에 나오면 안 된다.
7. 마크다운 특수문자 방어: 업무명·담당자에 `|`가 있으면 표가 깨진다. 표 셀에 넣는 값은
   `|` → `\|`로 이스케이프하고 개행은 공백으로 바꾼다. **이스케이프 함수 하나를 만들어
   모든 셀에 통과시켜라.**
8. 순수 함수다. 파일 I/O·`fetch`·`console`을 쓰지 않는다.

### 4. 테스트 케이스 (`src/lib/domain/weekly-report.test.ts`)

1. 반환값이 문자열이고 `# 주간 업무 보고`로 시작한다
2. 제목의 기간이 `ctx.today`가 속한 주의 월~일이다
3. **같은 입력을 두 번 넣으면 완전히 같은 문자열이 나온다** (결정성)
4. **입력 배열의 순서를 뒤집어도 같은 문자열이 나온다** (정렬 고정)
5. 6개 섹션 제목이 전부 있다
6. 지연이 0건이어도 `## 지연 업무 (0건)` 제목과 "해당 없음"이 있다
7. 팀별 표의 행 수가 `summarizeAllTeams` 결과와 같다
8. **업무명에 `|`가 있어도 표 행의 파이프 개수가 헤더와 같다**
9. 업무명에 개행이 있어도 표 행이 한 줄이다
10. **결과 문자열에 `extras` 값(예: `sample_account_1`·연락처 문자열)이 들어 있지 않다**
    — `extras`를 채운 태스크로 확인
11. 결과에 `undefined`·`null`·`NaN`·`[object Object]` 문자열이 없다
12. 달성률 불일치가 있으면 "달성률 불일치 1건" 줄이 있고, 없으면 그 줄이 없다
13. 빈 입력(태스크 0건) → 예외 없이 문자열이 나오고 요약이 0으로 채워진다
14. 픽스처 통합: `parseWorkbook` 결과로 보고서를 만들고 **스냅샷으로 고정**한다
    (`toMatchInlineSnapshot` 또는 파일 스냅샷). 이후 집계가 바뀌면 이 스냅샷이 먼저 깨진다

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/weekly-report.test.ts

# 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)|toLocale" src/lib/domain/weekly-report.ts ; test $? -eq 1

# 집계를 다시 구현하지 않았다 — 아래 4개를 전부 import한다 (4줄 이상 나와야 함)
grep -nE "progress-stats|goal-stats|alert-rules|task-derive" src/lib/domain/weekly-report.ts

# 계층 경계 (출력이 비어야 함)
grep -nE "exceljs|@supabase|console\.|fetch\(" src/lib/domain/weekly-report.ts ; test $? -eq 1

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 생성된 보고서를 **눈으로 한 번 읽어라.** 마크다운 표가 깨지지 않고 회의록에 붙여넣을 만한지
   확인한다. 깨져 있으면 테스트가 통과해도 실패다.
3. 체크리스트:
   - `extras`·`raw`가 한 글자도 안 들어갔는가?
   - 섹션 6개가 전부 있고 빈 섹션도 제목이 남는가?
   - 같은 입력이 항상 같은 문자열을 내는가?
   - 새 계산식을 이 파일에서 만들지 않았는가?
4. `phases/t4-store-domain/index.json`의 step 6을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 섹션 구성과 픽스처 보고서의 요약 줄 실측값을 포함하라.

## 금지사항

- HTML·JSX·React를 돌려주지 마라. 이유: 회의록에 붙여넣는 마크다운이 용도다 (`UC-08`).
- `/report` 화면·API 라우트를 만들지 마라. 이유: T9·T5의 범위다.
- 이 파일에서 새 집계식을 만들지 마라. 이유: 화면 숫자와 보고서 숫자가 갈라진다.
- `extras`·`raw`의 값을 보고서에 넣지 마라. 이유: 연락처·계정이 복사돼 밖으로 나간다.
- `toLocaleDateString`을 쓰지 마라. 이유: 실행 환경의 로캘·시간대에 따라 출력이 달라진다.
- 정렬 없이 배열을 그대로 출력하지 마라. 이유: 스냅샷이 무작위로 깨진다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
