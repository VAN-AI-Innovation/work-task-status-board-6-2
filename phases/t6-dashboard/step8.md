# Step 8: alerts-goals

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` 완료 기준 **2**(알림 패널 4종)·**3**(목표 대비 성과 섹션)
- `docs/PRD.md` — 과제 요구 **3번**(알림)·**4번**(부서별 목표 대비 성과)
- `docs/PLAN.md` — `UC-09`(승인 대기함)·`UC-10`(목표 대비)·`UC-12`·`UC-13`
- `docs/UI_GUIDE.md` — 「아이콘」(**알림 종류는 아이콘이 아니라 한글 라벨로 구분**)·
  step 0이 더한 「목표 대비 성과의 톤」
- `src/lib/domain/alert-rules.ts` — **`AlertKind` 5종·`Alert`의 필드.
  업무명·담당자가 없다는 사실이 중요하다**
- `src/lib/domain/goal-stats.ts` — `summarizeGoals`·`ComputedGoalMetric`·`TeamGoalSummary`
- `src/lib/api/task-response.ts` — `toGoalResponse`(목표 지표도 마스킹을 거친다)
- `src/app/api/goals/route.ts` · `src/app/api/alerts/route.ts` — 같은 호출 순서를 따른다
- step 1·5·6 산출물: `buildHref`·`status-badge.ts`·`team-slug.ts`

## 배경

**과제 요구 3번과 4번이 이 step에서 화면에 나타난다.** 지금까지는 계산만 있고 표시가 없었다.

두 섹션의 성격이 다르다.

- **알림 패널** — 「무엇을 해야 하는가」. 4종이 완료 기준이고, 네 번째(**기한 미설정**)가
  특히 중요하다: 마감일이 없는 업무는 지연 판정에서 조용히 빠지므로 이 알림이 없으면
  **영영 아무 화면에도 안 뜬다.**
- **목표 대비 성과** — 「잘하고 있는가」. 업무가 아니라 성과 지표라 축이 다르고
  (`ADR-002`), 그래서 업무 필터의 영향을 받지 않는다.

### ⚠ `Alert`에는 업무명이 없다 — 의도다

`alert-rules.ts`가 `taskId`만 싣는다. 이 응답이 화면 밖(T10 디스코드 웹훅)으로도 나갈 수
있어서 실명·업무명을 담지 않기로 했다 (`S6`). **화면이 자기 목록에서 이름을 붙인다.**
알림 항목을 `?task=<id>` 딥링크로 걸면 이름 붙이기와 이동이 한 번에 해결된다.

목록에 없는 `taskId`(필터에 걸려 빠진 건)는 **알림에서도 빼라.** 이름을 못 붙이는 항목을
「(알 수 없음)」으로 남기면 사용자가 클릭할 수 없는 줄을 보게 된다.

## 확정

### 알림 4종 + 보조 1종

| `AlertKind` | 한글 라벨 | 비고 |
|---|---|---|
| `due_soon` | 마감 임박 | `days`가 음수면 danger |
| `stale` | 장기 미갱신 | `days` = 미갱신 일수 |
| `no_owner` | 담당자 미지정 | |
| `no_due_date` | 기한 미설정 | **네 번째. 빼지 마라** |
| `unknown_owner` | 담당자 오타 의심 | 4종에 포함되지 않는 **보조 신호** (`UC-12`) |

- **묶음 5개를 항상 그린다.** 0건인 묶음도 「0건」으로 남긴다 — 묶음이 사라지면
  「그 문제가 없는 것」과 「그 검사를 안 한 것」이 같은 화면이 된다.
- **종류는 한글 라벨로 구분한다. 아이콘으로 구분하지 마라** (`UI_GUIDE.md`).
- `severity: 'danger'`만 `text-late`, `'warn'`은 `text-warn`. 그 외 무채색.

### 목표 대비 성과 (요구 4번)

한 행에 **`목표 수치 → 실제 성과 → 달성률`** 과 **직전 기간 대비 변화**가 나와야 한다
(완료 기준 3). 데이터는 `summarizeGoals`가 준다.

- 표시하는 달성률은 **재계산값(`computedRate`)** 이다. 시트 값(`sheetRate`)과 어긋나면
  그 행에 **작은 표식**과 함께 「시트 값 N%」를 병기한다. **둘 다 보존한다** —
  그 불일치 건수가 파서 정확성의 실측 지표다 (`goal-stats.ts` 머리말).
- **달성률에 상한을 두지 마라.** 120%는 이상값이 아니라 정상값이다.
- **미달(100 미만)은 `text-warn`, 그 외 무채색.** 빨강은 업무 지연 전용이다 (step 0 확정).
- 직전 기간 대비는 `prevPeriodDelta` **문자열 그대로** 보여준다. 파싱해서 화살표를 붙이지
  마라 — 시트에 `+3%p`·`▲2`·`유지` 같은 자유 입력이 들어 있고, 파싱하면 그 순간 틀린
  해석을 화면에 그린다.
- 팀 요약(`TeamGoalSummary`)을 표 위에 한 줄로: 팀별 평균 달성률 · 목표 달성 건수 /
  미달 건수 / 산출 불가 건수. **`avgAchievement`가 `null`이면 `—`다.**

### 승인 대기함 (`UC-09`)

「승인 대기」 KPI 타일에 숫자만 있고 목록이 없다. 알림 패널 옆에 작은 목록으로 둔다:
`semantic === 'approval'`인 건을 **대기 일수(오늘 − `lastProgressAt`) 내림차순**으로.

**세는 것을 화면에서 하지 마라.** `TaskResponse.flags.semantic`으로 거르는 것은
필터이지 집계가 아니므로 허용되지만, **대기 일수 계산은 `daysBetween`을 쓰는 lib 함수**로
뺀다 (`alert-groups.ts`에 함께 둔다).

## 작업

### 1. `src/lib/view/alert-groups.ts` — 테스트를 **먼저** 쓴다

```ts
export const ALERT_LABELS: Readonly<Record<AlertKind, string>>;

export interface AlertGroup {
  kind: AlertKind;
  label: string;
  items: Alert[];
}

/** 5묶음을 **항상** 돌려준다. 순서 고정. 목록에 없는 taskId는 걸러 낸다 */
export function groupAlerts(alerts: readonly Alert[], knownTaskIds: ReadonlySet<string>): AlertGroup[];

export interface WaitingItem { taskId: string; days: number | null }

/** 승인 대기 일수. `lastProgressAt`이 없으면 null이고 **뒤로 정렬**된다 */
export function approvalQueue(
  tasks: readonly TaskResponse[],
  today: string
): WaitingItem[];
```

- `groupAlerts`의 묶음 순서는 위 표 순서. 묶음 안은 `days` 오름차순(급한 것 먼저),
  동률은 `taskId` 비교로 **결정적**이게.
- `approvalQueue`는 **`today`를 인자로 받는다.** 시각을 스스로 읽지 마라.

테스트: 빈 입력 → 5묶음 0건, 순서 고정, 모르는 `taskId` 제외, `days` 정렬,
동률 결정성, `lastProgressAt`이 null인 건이 뒤로, 입력 불변.

### 2. `src/lib/view/goal-view.ts` — 테스트를 **먼저** 쓴다

```ts
export interface GoalRow {
  teamKey: TeamKey;
  teamLabel: string;
  title: string;
  kpiName: string;
  target: string;     // 포맷된 문자열. 없으면 '—'
  actual: string;
  rate: string;       // '82%' · '120%' · '—'
  sheetRate: string | null;  // 불일치일 때만 값. 아니면 null
  delta: string;      // prevPeriodDelta 원문. 없으면 '—'
  belowTarget: boolean;
}

/** 팀 순서(`TEAM_KEYS`) → title 코드포인트 순. **결정적이어야 한다** */
export function toGoalRows(items: readonly ComputedGoalMetric[]): GoalRow[];
```

- 숫자 포맷은 step 3의 `kpi-format.ts`를 쓴다. 여기서 다시 만들지 마라.
- `belowTarget`은 `computedRate !== null && computedRate < 100`. **`null`은 미달이 아니다** —
  잴 수 없었을 뿐이다.

테스트: 정렬 결정성, 불일치 행에서만 `sheetRate`가 채워짐, 120%가 잘리지 않음,
`target`이 0이거나 null일 때 `rate`가 `—`, `null` 달성률이 `belowTarget: false`, 입력 불변.

### 3. 컴포넌트

- `src/components/alerts/alert-panel.tsx` — props `{ groups: AlertGroup[]; titleOf: (id) => string; hrefOf: (id) => string }`
- `src/components/alerts/approval-queue.tsx` — props `{ items: WaitingItem[]; titleOf; hrefOf }`
- `src/components/goals/goal-section.tsx` — props `{ rows: GoalRow[]; byTeam: TeamGoalSummary[]; mismatchCount: number }`

`titleOf`·`hrefOf`를 **서버에서 만들어 넘긴다.** 컴포넌트가 업무 배열을 통째로 받아
`find`하게 만들지 마라 — 알림 패널에 전체 목록이 딸려 들어간다.

### 4. `src/app/page.tsx`에 끼운다

순서: KPI → 팀 요약표 → 차트 → **목표 대비 성과** → **알림 패널 + 승인 대기함** →
필터 바 → 업무 표.

목표 지표 조회:

```ts
const goalStats = summarizeGoals(await storage.repo.listGoalMetrics());
const rows = toGoalRows(toGoalResponse(goalStats.items, read.role));
```

- **`toGoalResponse`를 반드시 거친다.** 성과 행에도 담당자·채널·문의자 계정이 섞여
  들어온다 (`S6`). `/api/goals`가 같은 순서로 부르고 있다 — 그것을 따르라.
- `goalStats.warnings.length`(불일치 건수)를 섹션 아래 한 줄로 남긴다.
  **경고에 셀 값이 없다는 사실을 확인하라** — `ParseWarning`은 좌표와 코드뿐이다.
- 목표 지표가 0건이면 섹션을 **숨기지 말고** 「목표 지표가 없습니다 — 시트의 목표 탭을
  업로드하면 표시됩니다」로 남긴다. 섹션이 사라지면 요구 4번이 구현 안 된 것처럼 보인다.
- **팀 라우트(`/teams/[teamSlug]`)에는 알림 패널만 넣고 목표 섹션은 그 팀 행만** 보여준다.

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 알림 4종 + 보조 1종이 다 있다 (5가 나와야 함)
grep -c "due_soon\|stale\|no_owner\|no_due_date\|unknown_owner" src/lib/view/alert-groups.ts

# 기한 미설정이 살아 있다 (출력이 있어야 함) — 가장 빠뜨리기 쉬운 4번째
grep -rn "기한 미설정" src/lib/view/alert-groups.ts

# 알림 종류를 아이콘으로 구분하지 않는다 (출력이 비어야 함)
grep -n "svg" src/components/alerts/alert-panel.tsx ; test $? -eq 1

# 목표 지표가 마스킹을 거친다 (출력이 있어야 함)
grep -n "toGoalResponse" src/app/page.tsx

# 달성률에 상한이 없다 (출력이 비어야 함)
grep -nE "Math.min\(.*100|> 100 \?" src/lib/view/goal-view.ts ; test $? -eq 1

# 목표 미달을 빨강으로 칠하지 않는다 (출력이 비어야 함)
grep -n "late" src/components/goals/goal-section.tsx ; test $? -eq 1

# 화면이 시각을 읽지 않는다 (출력이 비어야 함)
grep -rn "Date.now()\|new Date()" src/lib/view/ ; test $? -eq 1

# 안티패턴·라이트 팔레트 0건 (둘 다 출력이 비어야 함)
grep -rniE "backdrop-blur|bg-gradient|bg-clip-text|purple|violet|indigo|blur-3xl|drop-shadow|hover:scale" src/app src/components ; test $? -eq 1
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]" src/app src/components ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `STORAGE_DRIVER=memory npm run dev`로:
   - **알림 4종 묶음이 다 보이는가?** 0건인 묶음도 남아 있는가? (완료 기준 2)
   - 알림 항목을 클릭하면 **그 업무의 사이드 패널이 열리는가?** (`?task=` 딥링크)
   - 알림에 업무명이 붙어 있는가? (화면이 붙인 것이지 API가 준 것이 아니어야 한다)
   - **목표 대비 성과에 `목표 → 실적 → 달성률`과 직전 대비 변화가 있는가?** (완료 기준 3)
   - 시트 값과 재계산 값이 어긋난 행에 병기가 뜨는가? 아래에 건수가 있는가?
   - 승인 대기함의 건수가 「승인 대기」 KPI 타일과 **같은가?**
   - 목표 미달이 앰버인가? (빨강이 아닌가)
3. `curl 'localhost:3000/api/alerts' | head`와 화면의 묶음별 건수를 대조하라.
4. `phases/t6-dashboard/index.json`의 step 8을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 알림 5묶음을 항상 그리는 결정, 이름을 화면이 붙인다는 사실,
   달성률 표시 규칙(재계산값 + 시트값 병기), 테스트 개수를 남겨라.

## 금지사항

- 알림 묶음을 0건이라고 숨기지 마라. 이유: 「문제가 없음」과 「검사를 안 함」이 같아진다.
- `no_due_date`(기한 미설정)를 빼지 마라. 이유: 마감 없는 업무는 지연 판정에서 빠져
  이 알림이 유일한 노출 경로다.
- 알림 종류를 아이콘으로만 구분하지 마라. 이유: `UI_GUIDE.md`가 한글 라벨로 못박았다.
- `Alert`에 업무명·담당자를 담도록 도메인 함수를 고치지 마라. 이유: 그 응답이 외부로
  나갈 수 있다 (`S6`, T10).
- 달성률에 100% 상한을 두지 마라. 이유: 120%는 정상값이다.
- 시트 달성률을 재계산값으로 덮어쓰지 마라. 이유: 불일치 건수가 파서 정확성의 실측 지표다.
- `prevPeriodDelta`를 파싱해 화살표·색을 붙이지 마라. 이유: 자유 입력이라 틀린 해석이 나온다.
- 목표 미달을 빨강으로 칠하지 마라. 이유: 빨강은 업무 지연 전용이다. 두 뜻이 되면 지연이 묻힌다.
- 목표 지표 0건일 때 섹션을 숨기지 마라. 이유: 요구 4번이 미구현으로 보인다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
