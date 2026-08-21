# Step 4: goal-stats

## 읽어야 할 파일

- `CLAUDE.md` — 도메인 규칙, 경고에 셀 값을 담지 않는다
- `docs/PLAN.md` — 「1. 데이터 모델」의 `goal_metrics` 문단(**요구 4번의 실체**),
  「6. 집계·판정」의 `summarizeGoals` 문단
- `docs/TICKETS.md` — `## T4` 완료 기준 **7**, `## T6` 완료 기준(목표 대비 성과 섹션), `UC-10`
- T3 산출물: `src/lib/sheet/adapter-goal-metrics.ts` 상단 주석
  (**달성률을 재계산하지 않고 시트 값을 보존한 이유**가 적혀 있다 — 이 step이 그 뒷면이다)
- step 0 산출물: `src/types/goal.ts`의 `GoalMetric`

## 배경

과제 요구 4번("부서별 목표와 실제 성과 비교")의 계산부다.

T3의 `adapter-goal-metrics`는 시트의 `달성률`을 **그대로 보존**했다. 나눗셈이 0줄이었고,
픽스처 셋째 행(목표 40 · 실적 12 · 시트 달성률 **95**)이 그대로 남아 있다.
`12/40 = 30%`인데 시트에는 95%라고 적혀 있다 — **시트 수식이 깨진 증거를 일부러 남긴 것이다.**

이 step이 그 증거를 읽는다. `actual/target`으로 다시 계산하고, 시트 값과 다르면 경고를 남긴다.
이 불일치 건수가 파서 정확성의 실측 지표다 (`PLAN.md` 「6. 집계·판정」).

## 작업

### 1. `src/lib/domain/goal-stats.ts` — 테스트를 **먼저** 쓴다

```ts
export interface GoalStatsContext {
  /** 시트 달성률과 재계산 값의 허용 오차(퍼센트 포인트). 기본 1 */
  tolerancePoints?: number;
}

export interface ComputedGoalMetric {
  metric: GoalMetric;
  /** `actual / target * 100`을 반올림한 정수. 계산 불가면 null */
  computedRate: number | null;
  /** 시트에 적힌 달성률 (`metric.achievementRate`) */
  sheetRate: number | null;
  /** 둘 다 있고 차이가 허용 오차를 넘으면 true */
  rateMismatch: boolean;
  /** 목표 달성 여부. `computedRate >= 100`. 계산 불가면 null */
  onTarget: boolean | null;
}

export interface TeamGoalSummary {
  teamKey: TeamKey;
  metricCount: number;
  /** `computedRate`가 있는 것들의 평균(정수). 없으면 null */
  avgAchievement: number | null;
  onTargetCount: number;
  belowTargetCount: number;
  /** 재계산이 불가능했던 건수 */
  unmeasurableCount: number;
}

export interface GoalStatsResult {
  items: ComputedGoalMetric[];
  byTeam: TeamGoalSummary[];
  warnings: ParseWarning[];
}

export function summarizeGoals(
  metrics: readonly GoalMetric[],
  ctx?: GoalStatsContext
): GoalStatsResult;
```

### 2. 계산 규칙

1. `computedRate = Math.round((actual / target) * 100)`.
   `target`이 null이거나 `actual`이 null이면 **null** — 0으로 치지 마라.
2. **`target === 0`이면 `computedRate`는 null이고 `GOAL_TARGET_ZERO` 경고를 남긴다.**
   0으로 나누면 `Infinity`가 화면까지 흘러간다.
3. `rateMismatch` = `computedRate !== null && sheetRate !== null &&
   Math.abs(computedRate - sheetRate) > tolerancePoints`.
   참이면 **`GOAL_RATE_MISMATCH` 경고 1건** (T4 완료 기준 7).
4. **시트 값을 덮어쓰지 마라.** `metric.achievementRate`는 그대로 두고 `computedRate`를 나란히
   돌려준다. 화면(T6)이 무엇을 보여줄지는 T6가 정한다. 여기서는 **둘 다 보존**한다.
5. 경고는 `{ code, sheet: metric.sourceSheetTab, row: metric.sourceRowIndex }`뿐이다.
   **목표 수치·실적·과제명·담당자를 담지 마라** (`CLAUDE.md` 보안 규칙).
6. `avgAchievement`는 `computedRate`가 있는 것들만 평균낸다. 없으면 null (0이 아니다).
   `달성률 120%`는 이상값이 아니라 정상이므로 상한을 두지 마라.
7. `byTeam`은 **지표가 있는 팀만** 돌려준다 — 팀별 요약표(step 3)와 달리 목표 지표는
   마케팅팀에만 있는 것이 정상이고, 빈 행을 만들면 화면에 "목표 없음" 팀이 늘어선다.
8. `byTeam`은 `TeamKey` 순서(`edit` → `shoot` → `marketing`)로 정렬한다. 안정적 출력이어야
   스냅샷 비교가 가능하다.
9. 순수 함수다. `metrics`를 고치지 않고 시간을 읽지 않는다.

### 3. 테스트 케이스 (`src/lib/domain/goal-stats.test.ts`)

1. `target: 100, actual: 120` → `computedRate` 120, `onTarget` true
2. `target: 50, actual: 41` → 82, `onTarget` false
3. **`target: 40, actual: 12, achievementRate: 95` → `computedRate` 30, `rateMismatch` true,
   `GOAL_RATE_MISMATCH` 경고 1건** (픽스처가 심어둔 깨진 수식)
4. `target: 100, actual: 100, achievementRate: 100` → `rateMismatch` false, 경고 0건
5. 오차 1 이내(`computedRate` 82, `sheetRate` 83)는 `rateMismatch` false, `tolerancePoints: 0`을
   주면 true (경계)
6. **`target: 0` → `computedRate` null, `GOAL_TARGET_ZERO` 1건, `Infinity`·`NaN`이 결과 어디에도
   없다** (`JSON.stringify` 결과에 `null`만 있고 예외가 나지 않음을 단언)
7. `target: null` 또는 `actual: null` → `computedRate` null, `unmeasurableCount` 증가, 경고 0건
   (미입력은 오류가 아니다)
8. `achievementRate: null`(시트에 달성률 칸이 빈 경우) → `rateMismatch` false, 경고 0건
9. **경고 객체의 키가 `code`·`sheet`·`row` 셋뿐이고, 과제명·담당자·수치가 들어 있지 않다**
10. `avgAchievement`가 계산 불가 건을 평균에서 뺀다 / 전건 불가면 null
11. 빈 배열 → `items` 0, `byTeam` 0, `warnings` 0, 예외 없음
12. `metrics` 입력 객체가 변형되지 않는다
13. **픽스처 통합**: `parseWorkbook(sample-workbook.xlsx)`의 `goalMetrics` 3건을 `GoalMetric`으로
    옮겨 `summarizeGoals`를 돌리면 `computedRate`가 `[120, 82, 30]`이고
    **`GOAL_RATE_MISMATCH`가 정확히 1건**(셋째 행)이며 `byTeam`은 `marketing` 1행이다

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/goal-stats.test.ts

# 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/goal-stats.ts ; test $? -eq 1

# SQL·저장소가 새지 않았다 (출력이 비어야 함)
grep -niE "select |group by|@supabase" src/lib/domain/goal-stats.ts ; test $? -eq 1

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 픽스처 셋째 행의 불일치가 실제로 잡혔는가? (테스트 13번)
   - 시트 달성률이 덮어써지지 않고 `sheetRate`로 남아 있는가?
   - `target: 0`에서 `Infinity`가 새지 않는가?
   - 경고에 수치·과제명이 새어 나갈 경로가 없는가?
3. `phases/t4-store-domain/index.json`의 step 4를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 픽스처 실측 `computedRate` 3개와 불일치 건수를 포함하라.

## 금지사항

- 시트 `달성률`을 재계산 값으로 덮어쓰지 마라. 이유: 불일치가 파서 정확성의 실측 지표다.
- 달성률에 100% 상한을 걸지 마라. 이유: 120%는 정상값이다 (T3 step 6의 결론).
- `PROGRESS_OUT_OF_RANGE` 계열 범위 경고를 달성률에 쓰지 마라. 이유: 같은 이유다.
- 목표 지표를 `tasks` 집계에 합치지 마라. 이유: 업무가 아니라 성과 지표다 (`ADR-002` 문단).
- 지표가 없는 팀의 빈 행을 만들지 마라. 이유: 화면에 의미 없는 0행이 늘어선다.
- 경고에 셀 값·수치를 담지 마라. 이유: `CLAUDE.md` 보안 규칙.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
