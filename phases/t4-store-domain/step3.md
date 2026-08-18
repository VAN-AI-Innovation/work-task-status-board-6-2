# Step 3: progress-stats

## 읽어야 할 파일

- `CLAUDE.md` — **집계는 `src/lib/domain/`의 JS 순수 함수로 한다. SQL 집계를 쓰지 않는다**
- `docs/ADR.md` — `ADR-006`(집계는 SQL이 아니라 순수 함수)
- `docs/PLAN.md` — 「6. 집계·판정」의 "판정 규칙 중 틀리기 쉬운 것들"(완료율 모수·평균 진행률),
  「A. 엑셀」의 `00_통합 대시보드` 구조
- `docs/TICKETS.md` — `## T4` 완료 기준 **3·4**, `## T6` 완료 기준 1
- step 0~2 산출물: `kst-today.ts`, `task-semantic.ts`, `task-derive.ts`

## 배경

이 step이 통합 대시보드(`UC-07`)의 숫자를 전부 만든다. **KPI 10종은 우리가 발명하는 것이 아니라
시트 `00_통합 대시보드` 탭 5행에 이미 있다.** 픽스처에서 실측한 10칸은 이렇다:

```
전체 활성 업무 | 편집팀 진행 | 촬영·기획팀 진행 | 마케팅·관리팀 진행 | 승인 대기
수정 요청 | 이번 주 마감 | 마감 임박 | 지연 | 전체 완료율
```

팀별 요약표(같은 탭 9행)의 컬럼도 그대로 옮긴다:

```
팀 | 전체 업무 | 진행 중 | 승인 대기 | 지연 | 완료 | 완료율 | 가장 가까운 마감 | 주요 리스크
```

시트 KPI는 전부 수식이고 일부는 `#REF!`로 깨져 있다. **우리는 시트 수식을 믿지 않고
태스크에서 다시 센다.** 시트와 대조하는 일은 T6가 화면에서 한다.

## 작업

### 1. `src/lib/domain/progress-stats.ts` — 테스트를 **먼저** 쓴다

```ts
export interface StatsContext extends DeriveContext {
  /** 미리 계산한 플래그. 없으면 내부에서 `deriveAllFlags`로 만든다 */
  flags?: Map<string, TaskFlags>;
}

export interface TeamSummary {
  teamKey: TeamKey;
  /** 취소 포함 전체 행 수 */
  total: number;
  /** `done`·`cancelled`가 아닌 건 */
  active: number;
  inProgress: number;      // semantic in_progress · rework
  approvalWaiting: number;  // semantic approval
  reviewWaiting: number;    // semantic review
  done: number;             // semantic done · pending_release
  cancelled: number;
  overdue: number;
  dueSoon: number;
  /** `done / (total - cancelled)`를 0~100 정수로. 모수가 0이면 **null** */
  completionRate: number | null;
  /** `overdue / (total - cancelled)`. 모수가 0이면 null */
  delayRate: number | null;
  /** `progress`가 null인 행을 **제외한** 평균. 대상이 0건이면 null */
  avgProgress: number | null;
  /** 아직 안 지난 것 중 가장 이른 `dueAt`. 없으면 null */
  nearestDueAt: string | null;
}

export interface KpiTile {
  key: string;
  /** 시트 `00_통합 대시보드` 5행의 라벨 원문 */
  label: string;
  value: number | null;
  unit: 'count' | 'percent';
}

export function summarizeTeam(tasks: readonly Task[], ctx: StatsContext): TeamSummary;
export function summarizeAllTeams(tasks: readonly Task[], ctx: StatsContext): TeamSummary[];
export function buildKpiStrip(tasks: readonly Task[], ctx: StatsContext): KpiTile[];
```

`summarizeTeam`은 **넘겨받은 배열만** 센다. 팀으로 거르는 것은 `summarizeAllTeams`의 일이고,
`summarizeTeam`은 `tasks[0].teamId`를 `teamKey`로 쓴다(빈 배열이면 호출자가 팀을 알려줘야 하므로
`summarizeTeam(tasks, ctx, teamKey)`처럼 3번째 인자로 받게 하라 — 빈 팀도 표에 0으로 나와야 한다).

### 2. 틀리기 쉬운 규칙 — 각각이 완료 기준이다

1. **완료율 모수에서 `cancelled`를 뺀다** (T4 완료 기준 3).
   `completionRate = done / (total - cancelled)`. 취소를 모수에 넣으면 완료율이 영구히 100%에
   못 미친다. `total - cancelled === 0`이면 **`0`이 아니라 `null`** — "0%"와 "셀 것이 없음"은 다르다.
2. **평균 진행률에서 `progress`가 null인 행을 제외한다** (T4 완료 기준 4).
   0으로 치면 미입력이 많은 팀의 진행률이 바닥으로 끌린다. **`progress: 0`은 포함한다** —
   0과 null의 구분이 T2·T3가 지켜온 성질이다.
3. `done`에 `pending_release`를 포함한다 (`display-status`의 5색 매핑과 같은 편이다).
   `inProgress`에 `rework`를 포함한다. **두 곳에서 편이 갈리면 화면과 숫자가 어긋난다.**
4. `overdue`는 `flags.isOverdue`를 센다. 직접 `dueAt < today`를 다시 쓰지 마라 — 판정이 두 곳이 된다.
5. `nearestDueAt`은 `dueAt !== null && dueAt >= today && semantic이 done·cancelled 아님` 중 최소값.
   문자열 비교로 충분하다(`YYYY-MM-DD`는 사전순 = 시간순).
6. 비율은 `Math.round`로 **0~100 정수**로 만든다. 소수를 화면까지 흘리지 마라.

### 3. KPI 10종 — 시트 라벨과 1:1

| # | key | label (시트 원문) | 정의 |
|---|---|---|---|
| 1 | `active_total` | `전체 활성 업무` | 전 팀 `active` 합 |
| 2 | `edit_active` | `편집팀 진행` | `edit` 팀 `active` |
| 3 | `shoot_active` | `촬영·기획팀 진행` | `shoot` 팀 `active` |
| 4 | `marketing_active` | `마케팅·관리팀 진행` | `marketing` 팀 `active` |
| 5 | `approval_waiting` | `승인 대기` | semantic `approval` |
| 6 | `rework` | `수정 요청` | semantic `rework` |
| 7 | `due_this_week` | `이번 주 마감` | `dueAt`이 `startOfWeek(today)`~`endOfWeek(today)` 안, `done`·`cancelled` 제외 |
| 8 | `due_soon` | `마감 임박` | `flags.isDueSoon` |
| 9 | `overdue` | `지연` | `flags.isOverdue` |
| 10 | `completion_rate` | `전체 완료율` | 전 팀 합산 `done / (total - cancelled)`, `unit: 'percent'` |

- 2~4번의 팀 키는 `TeamKey` 상수 배열 하나를 순회해 만든다. 팀마다 `if`를 쓰지 마라.
- 6번 라벨은 시트가 `수정 요청`이지만 시트 수식은 `COUNTIFS(...,"수정 중")`을 센다.
  **우리는 semantic `rework`를 센다** — 같은 것이다. 이 사실을 주석에 남겨라.
- 라벨의 `촬영·기획팀`은 가운뎃점 `·`(U+00B7)이다. 시트 원문을 그대로 옮겨라.
- 반환 순서는 위 표 순서로 **고정**한다. 화면이 `grid-cols-5` 2행으로 그린다(`UI_GUIDE.md`).

### 4. 테스트 케이스 (`src/lib/domain/progress-stats.test.ts`)

1. **취소 2건 + 완료 1건 + 진행 1건 → `completionRate` 50** (모수 2, 취소 제외)
2. 전건이 취소 → `completionRate` `null` (0이 아니다)
3. **`progress`가 `[80, null, 0]` → `avgProgress` 40** (null 제외, 0 포함)
4. `progress`가 전부 null → `avgProgress` `null`
5. `rework`가 `inProgress`에, `pending_release`가 `done`에 들어간다
6. `nearestDueAt`이 지난 마감을 고르지 않는다 / 완료 건의 마감을 고르지 않는다
7. 빈 배열 → 전 필드 0 또는 null, 예외 없음
8. `summarizeAllTeams`가 **태스크가 하나도 없는 팀도 행으로** 돌려준다 (표에 0으로 나와야 한다)
9. `buildKpiStrip`이 정확히 10칸을 이 순서로 돌려주고, 라벨이 시트 원문과 같다
10. `due_this_week` 경계: 이번 주 월요일·일요일 마감은 포함, 다음 주 월요일은 제외
11. `completion_rate` 타일의 `unit`이 `'percent'`, 나머지 9칸은 `'count'`
12. **`today`를 바꾸면 `overdue`·`due_soon`·`due_this_week`만 바뀌고 `completionRate`는 안 바뀐다**
13. 픽스처 통합: `parseWorkbook` 결과를 `Task[]`로 옮기고 `today: '2026-07-25'`로
    `summarizeAllTeams`·`buildKpiStrip`을 돌려 **팀별 total이 `[5, 1, 3]`**임을 확인하고
    KPI 10칸의 값을 실측해 단언한다

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/progress-stats.test.ts

# 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/progress-stats.ts ; test $? -eq 1

# SQL 집계가 없다 (출력이 비어야 함)
grep -niE "select |group by|count\(\*\)|@supabase" src/lib/domain/progress-stats.ts ; test $? -eq 1

# 지연 판정을 다시 구현하지 않았다 — task-derive를 import한다 (출력이 있어야 함)
grep -n "task-derive" src/lib/domain/progress-stats.ts

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 완료율 모수에서 취소가 빠졌는가? 모수 0에서 `null`인가?
   - 평균 진행률에서 null은 빠지고 0은 들어갔는가?
   - `done`·`inProgress`의 편 가르기가 `display-status.ts`와 같은가?
   - KPI 라벨이 시트 `00_통합 대시보드` 5행과 글자까지 같은가?
   - 팀별 `if` 사슬 없이 팀 키 배열 순회로 되어 있는가?
3. `phases/t4-store-domain/index.json`의 step 3을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 픽스처 실측 KPI 10칸의 값과 기준 날짜를 포함하라.

## 금지사항

- 목표 지표(`goal_metrics`) 집계를 만들지 마라. 이유: step 4의 범위다.
- 알림을 만들지 마라. 이유: step 5의 범위다.
- `isOverdue`·`isDueSoon`을 다시 구현하지 마라. 이유: 판정이 두 곳이 되면 갈라진다.
- SQL·`@supabase`를 쓰지 마라. 이유: `CLAUDE.md` CRITICAL, `ADR-006`.
- KPI 항목을 10개보다 늘리거나 줄이지 마라. 이유: 시트 대시보드와 1:1 대응이 근거다.
- 차트 데이터 구조(Chart.js `datasets` 등)를 만들지 마라. 이유: T6의 일이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
