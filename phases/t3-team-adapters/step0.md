# Step 0: task-model

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서 하드 실패 금지, 보안 규칙(`raw`를 API에 싣지 않는다)
- `docs/TICKETS.md` — `## T3` 전체(완료 기준 1~10), `## T4` 완료 기준 1(테이블 목록)
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `tasks`·`task_stages`·`goal_metrics`·`team_period_goals`,
  「파일명 규칙」
- `docs/PLAN.md` — 「1. 데이터 모델」, 「4. 엑셀 파싱 파이프라인」, `E1`(유령 행), `E5`(`source_key` 충돌)
- T2 산출물: `src/types/sheet.ts`(좌표 규칙·`ParseWarning`·`SettingsRegistry`),
  `src/lib/sheet/cell-normalizer.ts`(`unwrapCellValue`가 하이퍼링크를 어떻게 돌려주는지),
  `src/lib/sheet/adapter-settings-tab.ts`(경고를 만드는 방식의 선례)

## 배경

T3는 16/70/20 컬럼을 **공통 Task 모델 하나로** 정규화한다. 어댑터 3종·언피벗·파이프라인이
전부 같은 타입 위에서 움직이므로, **타입이 흔들리면 뒤의 8개 step이 전부 흔들린다.**
이 step은 그 계약과 검증기만 만든다. 어댑터는 만들지 않는다.

DB 스키마는 T4에서 만든다. 여기서 정의하는 것은 **DB에 들어가기 전의 파싱 산출물**이고,
필드 이름은 `ARCHITECTURE.md` 데이터 모델의 컬럼과 1:1로 대응시켜 T4가 옮겨 담기만 하면 되게 한다
(`snake_case` 컬럼 → `camelCase` 프로퍼티).

## 작업

### 1. `src/types/task.ts` 신설

```ts
export type TeamKey = 'edit' | 'shoot' | 'marketing';

/**
 * `extras`·`raw`에 담기는 값. 하이퍼링크 셀은 **텍스트와 URL을 둘 다** 보존한다.
 * 문자열로 뭉개면 T6가 앵커를 그릴 근거를 잃는다 (UI 규칙은 T6, 여기서는 보존만).
 */
export type ExtraValue =
  | string
  | number
  | boolean
  | null
  | { text: string | null; hyperlink: string };

export interface ParsedStage {
  /** 그룹이 시트에 나온 순서, 0부터 */
  seq: number;
  /** `STAGE_GROUPS`가 정한 안정 키. 예: `concept` */
  stageKey: string;
  /** 시트 그룹 헤더 원문. 예: `컨셉·레퍼런스 (+2일)` */
  stageLabel: string;
  /** `YYYY-MM-DD` 또는 null */
  plannedDate: string | null;
  actualDate: string | null;
  content: string | null;
  confirmStatus: string | null;
  slaDays: number | null;
}

export interface ParsedTask {
  teamKey: TeamKey;
  /** 자연키. 업무ID가 있으면 그 값, 없으면 `slug(업무명)::slug(담당자)` */
  sourceKey: string;
  title: string | null;
  ownerNameRaw: string | null;
  coOwnerNames: string[];
  /** 시트 원문 그대로. `semantic` 변환은 T4다 */
  status: string | null;
  approvalStatus: string | null;
  priority: string | null;
  riskStatus: string | null;
  /** 0~100 정수. **빈칸은 null이고 0과 반드시 구분된다** */
  progress: number | null;
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  delayReason: string | null;
  note: string | null;
  /** 매핑되지 않은 컬럼 전량. 키는 헤더 결합 라벨 원문 */
  extras: Record<string, ExtraValue>;
  /** 원본 행 통째(감사·복원). **API 응답에 실으면 안 된다** (CLAUDE.md 보안 규칙) */
  raw: Record<string, ExtraValue>;
  sourceSheetTab: string;
  /** **1-based** — `ParseWarning`과 같은 규칙(사람이 읽는 좌표) */
  sourceRowIndex: number;
  stages: ParsedStage[];
}

export interface TabParseResult {
  sheet: string;
  teamKey: TeamKey | null;
  tasks: ParsedTask[];
  goalMetrics: ParsedGoalMetric[];
  teamPeriodGoals: ParsedTeamPeriodGoal[];
  /** 마케팅 C섹션의 회의 브리핑 줄. 저장 스키마는 T4에서 정한다 */
  briefingLines: string[];
  warnings: ParseWarning[];
}

export interface WorkbookParseResult {
  tabs: TabParseResult[];
  settings: SettingsRegistry | null;
  /** 탭 하나에 귀속되지 않는 경고(미판별 탭 등) */
  warnings: ParseWarning[];
}
```

### 2. `src/types/goal.ts` 신설

`ARCHITECTURE.md`의 타입 목록에 `goal.ts`가 이미 있다. 목표 지표를 `task.ts`에 섞지 마라.

```ts
export interface ParsedGoalMetric {
  teamKey: TeamKey;
  /** 예: `2026-07 4주차` */
  periodLabel: string | null;
  title: string | null;
  goalText: string | null;
  kpiName: string | null;
  targetValue: number | null;
  actualValue: number | null;
  /** **퍼센트 수치**(120·82·95). 시트 값을 보존만 한다 — 재계산·불일치 판정은 T4다 */
  achievementRate: number | null;
  prevPeriodDelta: string | null;
  channel: string | null;
  ownerNameRaw: string | null;
  execStatus: string | null;
  analysis: string | null;
  wentWell: string | null;
  needsImprovement: string | null;
  startedAt: string | null;
  dueAt: string | null;
  extras: Record<string, ExtraValue>;
  raw: Record<string, ExtraValue>;
  sourceSheetTab: string;
  /** 1-based */
  sourceRowIndex: number;
}

export interface ParsedTeamPeriodGoal {
  teamKey: TeamKey;
  periodLabel: string | null;
  goalText: string | null;
  riskText: string | null;
}
```

### 3. `src/lib/sheet/task-schema.ts` — 테스트를 **먼저** 쓴다

```ts
export function validateParsedTask(task: ParsedTask): ParseWarning[]
export function validateParsedGoalMetric(metric: ParsedGoalMetric): ParseWarning[]
```

`zod`로 스키마를 정의하고 `safeParse` 결과를 `ParseWarning[]`으로 옮긴다.

규칙:

1. **하드 실패시키지 않는다.** 예외를 던지지 않고, 실패해도 **입력 객체를 고치지 않는다.**
   호출자는 원래 값을 그대로 저장하고 경고만 함께 싣는다 (`CLAUDE.md` 개발 프로세스).
2. 검증 항목은 아래로 한정한다. 더 넣지 마라 — 시트는 자유 입력이라 규칙을 늘리면 경고만 늘고
   사람이 안 읽게 된다.
   - `sourceKey`가 빈 문자열이 아니다 → `SOURCE_KEY_EMPTY`
   - `title`이 null이거나 빈 문자열이 아니다 → `TASK_TITLE_MISSING`
   - `progress`가 null이거나 **0~100 정수**다 → `PROGRESS_INVALID`
   - 날짜 필드(`assignedAt`·`dueAt`·`nextActionDue`, 지표는 `startedAt`·`dueAt`)가
     null이거나 `/^\d{4}-\d{2}-\d{2}$/`다 → `DATE_FORMAT_INVALID`
   - 지표는 추가로 `title`이 있어야 한다 → `GOAL_TITLE_MISSING`
3. **경고에 셀 값·`sourceKey`·업무명을 담지 마라.** `sourceKey`는 `slug(업무명)+담당자`라
   실명이 들어간다. 담는 것은 `code`·`sheet`·`row`(1-based)뿐이다 (`CLAUDE.md` 보안 규칙).
   `column`은 필드 이름을 좌표로 환산할 수 없으므로 넣지 않는다.
4. 경고 코드는 위 5종에서 늘리지 마라. 어느 필드가 걸렸는지는 코드로 구분된다.

### 4. `docs/ARCHITECTURE.md` 디렉토리 트리 갱신

`lib/sheet/` 목록에 T3에서 새로 생기는 파일 이름 3개를 넣는다:
`task-schema` · `row-mapper` · `stage-unpivot`.
**트리의 파일 이름만 고친다.** 다른 문단·다른 문서를 건드리지 마라.

### 5. 테스트 케이스 (`src/lib/sheet/task-schema.test.ts`)

1. 정상 태스크 → 경고 0건
2. `title`이 null → `TASK_TITLE_MISSING` 1건, **입력 객체는 변경되지 않는다**
3. `progress`가 `120` → `PROGRESS_INVALID`, `progress`가 `0` → 경고 없음(0과 null 구분)
4. `progress`가 null → 경고 없음
5. `dueAt`이 `2026.07.22` → `DATE_FORMAT_INVALID`
6. `sourceKey`가 `''` → `SOURCE_KEY_EMPTY`
7. **경고 객체에 업무명·담당자·셀 값 문자열이 들어 있지 않다** (키가 `code`·`sheet`·`row`뿐)
8. 지표: `title`이 null → `GOAL_TITLE_MISSING`, `achievementRate`가 `120`이어도 경고 없음
   (달성률은 100을 넘는 것이 정상이다)

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/task-schema.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/task-schema.ts ; test $? -eq 1

# 회귀 — T2 모듈이 함께 통과한다
npx vitest run src/lib/sheet

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - `src/types/`에만 타입이 있고, `src/lib/`에 타입 중복 정의가 없는가?
   - `zod`가 `package.json` 직접 의존성인가 (T0에서 고정했다)?
   - 경고에 사람 이름이 새어 나갈 경로가 없는가?
   - `ARCHITECTURE.md` 트리에 새 파일 3개가 반영됐는가?
3. `phases/t3-team-adapters/index.json`의 step 0을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(정의한 타입 이름 전부, 경고 코드 5종,
     날짜·진행률 규칙, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 어댑터·언피벗·파이프라인을 만들지 마라. 이유: step 1~8의 범위다.
- `semantic`(`planned`·`in_progress` 등) 코드를 타입에 넣지 마라. 이유: `ADR-009`, T4의 범위다.
- DB 마이그레이션 SQL을 쓰지 마라. 이유: T4의 범위다.
- 검증 실패 시 값을 기본값으로 바꾸지 마라. 이유: 파서는 값을 보존하고 경고만 남긴다.
- 경고에 셀 값·업무명·담당자를 담지 마라. 이유: `CLAUDE.md` 보안 규칙.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
