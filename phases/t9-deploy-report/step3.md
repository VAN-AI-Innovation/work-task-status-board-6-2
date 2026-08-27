# Step 3: report-period

## 읽어야 할 파일

- `CLAUDE.md` — 특히 **「도메인 함수는 `now`를 인자로 주입받는다. 함수 안에서 `Date.now()`·
  `new Date()`를 호출하지 않는다」**와 「집계·판정은 `src/lib/domain/`의 JS 순수 함수」
- step 0이 쓴 `docs/PLAN.md` 「T9 착수 시 확정」의 **결정 M**(기간 축)
- step 1의 `summary` — **`since`/`until`의 경계 규칙**(포함/제외)이 거기 적혀 있다. 그 규칙에 맞춘다
- `src/lib/domain/weekly-report.ts` — **전체를 읽는다.** `WeeklyReportInput`(49행),
  `cell`(65행)·`percent`(74행)·`row`(78행) 같은 표 헬퍼, `buildWeeklyReport`(266행)와
  그 안에서 `startOfWeek`/`endOfWeek`를 부르는 자리(274~275행)
- `src/lib/domain/kst-today.ts` — `kstToday`(52) · `kstDateOf`(57) · `daysBetween`(67) ·
  `addDays`(76) · `startOfWeek`(84) · `endOfWeek`(94). **전부 `null`을 돌려줄 수 있다** — 왜 그런지 본다
- `src/types/task.ts` — `TaskEvent`(156행)
- `src/lib/store/task-repository.ts` — step 1이 더한 `TaskEventFilter`

## 배경

지금 `buildWeeklyReport`는 **이번 주만** 만든다. `ctx.today`에서 `startOfWeek`/`endOfWeek`를
뽑아 제목에 박는 것이 전부다. T9의 `/report`는 **기간을 고를 수 있어야 한다** (티켓 범위 In).

그리고 `events`가 들어오기 시작한다. step 1·2가 읽는 길을 열었으므로, 이 step이 **그 배열을
보고서의 숫자로 바꾼다.**

주의할 함정이 하나 있다. **「변경 건수 0」과 「읽을 길이 없어서 0」은 다른 뜻이다.** 지금까지는
후자였고 화면이 각주로 밝히고 있었다. 이 step 뒤로는 전자가 되어야 하며, **보고서가 그 둘을
구분해서 말할 수 있어야 한다.**

## 작업

### 1. 먼저 테스트를 쓴다 (TDD)

새 파일 `src/lib/domain/report-period.ts`와 그 테스트를 만든다. **basename이 전역 유니크해야
한다** — `src/lib/` 아래에 `report-period`라는 이름이 이미 없는지 확인하라.

```ts
export interface ReportPeriod {
  /** 주 시작일 (KST, YYYY-MM-DD) */
  weekStart: string;
  /** 주 종료일 (KST, YYYY-MM-DD). 사람이 읽는 값이다 */
  weekEnd: string;
  /** listEvents에 그대로 넘기는 값. 경계 규칙은 step 1의 계약과 같다 */
  since: string;
  until: string;
  /** 요청이 이상해서 이번 주로 되돌렸으면 true */
  fellBack: boolean;
}

/**
 * @param todayYmd KST 오늘 (kstToday가 낸 값). 이 함수는 시계를 부르지 않는다
 * @param requested 화면이 준 주 시작일. null·빈 값·형식 오류·미래는 이번 주로 되돌린다
 */
export function resolveReportPeriod(todayYmd: string, requested: string | null): ReportPeriod;
```

테스트가 덮어야 할 것:

- `requested`가 `null`이면 **이번 주**이고 `fellBack`은 `false`다 (되돌린 것이 아니라 기본값이다)
- `requested`가 주 중간 날짜여도 **그 주의 시작일로 정규화**된다
- `requested`가 형식 오류(`'2026-13-45'`, `'어제'`, `''`)면 **이번 주 + `fellBack: true`**.
  **던지지 마라** — 파서를 하드 실패시키지 않는 이 프로젝트의 규칙과 같은 결이다
- `requested`가 **미래 주**면 이번 주 + `fellBack: true`
- 과거 주는 **얼마든지 허용한다.** 임의의 하한을 두지 마라
- `since`/`until`이 step 1의 경계 규칙과 **정확히 맞는다.** 연속한 두 주를 만들었을 때
  **같은 이벤트가 양쪽에 들어가지 않는다** — 이것을 테스트로 고정하라
- **`Date.now()`·`new Date()`를 부르지 않는다.** 테스트에서 시계를 모킹할 필요가 없어야 한다

### 2. `buildWeeklyReport`가 기간을 받게 한다

`WeeklyReportInput`에 기간을 더한다. **`ctx.today`에서 매번 다시 계산하지 마라** — 계산은
`resolveReportPeriod` 한 곳에서 끝내고 결과를 넘긴다. 그래야 API와 화면이 같은 주를 본다.

`buildWeeklyReport` 안에서 `startOfWeek`/`endOfWeek`를 직접 부르던 자리(274~275행)를 넘겨받은
값으로 바꾼다. **기존 호출자를 깨뜨리게 된다** — `src/app/page.tsx`와
`src/app/api/report/weekly/route.ts` 둘이다. 컴파일이 통과하도록 **최소한으로** 맞춰라
(page.tsx는 이번 주를 넘기면 된다). 화면 개편은 step 5의 몫이다.

### 3. 변경 건수를 실제로 센다

`events`를 세는 자리를 만든다. **건수만 쓴다** — `changedFields`의 내용을 보고서에 풀어 쓰지 마라
(`S6`: 이력은 이름만 담고 값을 담지 않는다. 필드 이름을 나열하는 것까지가 한계다).

**「이력 경로가 없음」과 「이번 주 변경 0건」을 구분한다.** 권장: `WeeklyReportInput.events`를
`readonly TaskEvent[] | null`로 두고, `null`이면 지금처럼 **「집계되지 않음」 문구**를,
빈 배열이면 **「0건」**을 낸다. 두 갈래를 테스트로 고정하라.
step 4가 실제 배열을 넘기기 시작하면 `null` 갈래는 데모·장애 경로로만 남는다.

### 4. 팀별 섹션

티켓의 범위 In에 「팀별 섹션」이 있다. `buildWeeklyReport`가 이미 팀 축으로 무엇을 내고 있는지
**먼저 읽고**, 없으면 더한다. **`summarizeGoals` 같은 기존 집계 함수를 다시 구현하지 마라** —
있으면 부른다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -rn "new Date()\|Date.now()" src/lib/domain/report-period.ts   # 0줄
grep -rn "new Date()\|Date.now()" src/lib/domain/weekly-report.ts   # 0줄
ls src/lib/domain/report-period.ts src/lib/domain/report-period.test.ts
```

연속 주 경계가 겹치지 않는 것을 **테스트 이름으로 찾을 수 있어야 한다**:

```bash
npm run test -- src/lib/domain/report-period.test.ts
```

## 검증 절차

1. 위 AC를 실행한다.
2. 아키텍처 체크리스트:
   - `src/lib/domain/` 안에서 시계를 부르지 않는가?
   - `src/lib/` 아래 basename이 전역 유니크한가?
   - 라우트·화면을 **컴파일이 깨지지 않을 만큼만** 손댔는가? 기능 추가를 여기서 하지 않았는가?
3. `phases/t9-deploy-report/index.json`의 step 3을 갱신한다:
   - 성공 → `completed` + `summary`. **`ReportPeriod`의 필드와 `events: null` vs `[]`의 의미 차이**를
     요약에 반드시 적어라 — step 4·5가 그 계약 위에서 움직인다.
   - 실패 → `error` / 개입 필요 → `blocked`

## 금지사항

- **도메인 함수 안에서 시계를 부르지 마라.** 이유: CLAUDE.md CRITICAL. 테스트가 시각에 따라 갈린다.
- **잘못된 기간 문자열에 예외를 던지지 마라.** 이유: 화면이 URL 하나로 500을 낸다. 되돌리고 알린다.
- **`changedFields`의 값을 보고서에 풀어 쓰지 마라.** 이유: `S6`.
- **`/report` 화면이나 API 라우트를 만들지 마라.** 이유: step 4·5의 몫이다. 여기는 순수 함수까지다.
- **과거 기간에 임의의 하한(예: 8주)을 두지 마라.** 이유: 요청받지 않은 제약이다.
- 기존 테스트를 깨뜨리지 마라. `weekly-report` 기존 테스트가 전부 통과해야 한다.
