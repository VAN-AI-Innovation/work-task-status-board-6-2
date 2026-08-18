# Step 0: domain-model

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(도메인은 `now`를 인자로 받는다), TDD, 파일명 전역 유니크
- `docs/TICKETS.md` — `## T4` 전체(완료 기준 1~9, 인터페이스 경계)
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 컬럼 목록, 「집계·판정」, 「디렉토리 구조」
- `docs/PLAN.md` — 「1. 데이터 모델」, 「6. 집계·판정」, `E4`(KST 날짜 계산)
- `docs/ADR.md` — `ADR-006`(집계는 순수 함수), `ADR-009`(지연은 파생 판정)
- T3 산출물: `src/types/task.ts`·`src/types/goal.ts`(`ParsedTask`·`ParsedStage`·`ParsedGoalMetric`),
  `src/types/sheet.ts`(`ParseWarning` 규칙)

## 배경

T3는 **파싱 산출물**(`ParsedTask`)까지 만들었다. T4는 그 뒤 두 가지를 한다 —
저장소에 들어갔다 나온 **저장 모델**(`Task`)을 정의하고, 그 위에서 도는 판정 함수 8개를 만든다.

이 step은 **타입과 날짜 계산만** 한다. 판정 로직은 step 1~6, 저장소는 step 7~10이다.
`Task`가 흔들리면 뒤의 10개 step이 전부 흔들리므로 여기서 확정한다.

날짜를 먼저 만드는 이유: 뒤의 모든 판정(`isOverdue`·`isDueSoon`·`isStale`·D-DAY·이번 주 마감)이
**날짜 문자열 비교**에 의존한다. `Date` 객체 뺄셈은 KST에서 하루가 어긋난다 (`PLAN.md` `E4`).

## 작업

### 1. `src/types/task.ts`에 저장 모델을 **추가**한다

기존 `ParsedTask`·`ParsedStage`·`TeamKey`·`ExtraValue`는 **지우지 마라.** T3 어댑터가 쓴다.
아래를 같은 파일에 덧붙인다.

```ts
/** 시트 10단계 진행 상태를 감싼 안정 코드 (ADR-009). 판정 로직은 한글 문자열을 직접 모른다 */
export type TaskSemantic =
  | 'planned' | 'in_progress' | 'review' | 'approval' | 'rework'
  | 'pending_release' | 'done' | 'hold' | 'cancelled';

/** 화면 5색 + 무채색. 한글 라벨은 `display-status.ts`가 따로 들고 있다 (UI_GUIDE.md) */
export type DisplayStatus = 'planned' | 'in_progress' | 'review' | 'done' | 'overdue' | 'muted';

/** 저장소에 들어갔다 나온 업무. `ParsedTask` + 신원(`id`)·소속·감사 필드 */
export interface Task {
  id: string;
  /** `teams.id`. 이 프로젝트에서 팀 PK는 uuid가 아니라 `TeamKey` 문자열이다 (step 8) */
  teamId: TeamKey;
  departmentId: string | null;
  sourceKey: string;
  title: string | null;
  /** `members.id`. T4에서는 항상 null이다 — 이름→구성원 해석은 T5 커밋의 일이다 */
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
  coOwnerNames: string[];
  /** 시트 원문 그대로 보존. `semantic` 변환은 `task-semantic.ts`가 한다 */
  status: string | null;
  approvalStatus: string | null;
  priority: string | null;
  riskStatus: string | null;
  /** 0~100 정수. **빈칸은 null이고 0과 반드시 구분된다** */
  progress: number | null;
  /** 전부 `YYYY-MM-DD` 또는 null */
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  delayReason: string | null;
  note: string | null;
  extras: Record<string, ExtraValue>;
  /** **API 응답에 실으면 안 된다** (CLAUDE.md 보안 규칙) */
  raw: Record<string, ExtraValue>;
  /** ISO 8601 타임스탬프 또는 null. **실제로 값이 바뀐 업로드에서만** 갱신된다 (step 7) */
  lastProgressAt: string | null;
  sourceUploadId: string | null;
  sourceSheetTab: string;
  /** 1-based */
  sourceRowIndex: number;
}

export interface TaskStage {
  id: string;
  taskId: string;
  seq: number;
  stageKey: string;
  stageLabel: string;
  plannedDate: string | null;
  actualDate: string | null;
  content: string | null;
  confirmStatus: string | null;
  slaDays: number | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  uploadId: string | null;
  /** 바뀐 필드 **이름만**. 값을 담지 않는다 — 이력 테이블이 개인정보 사본이 되면 안 된다 */
  changedFields: string[];
  /** ISO 8601 */
  occurredAt: string;
}
```

### 2. `src/types/goal.ts`에 저장 모델을 **추가**한다

```ts
export interface GoalMetric {
  id: string;
  teamId: TeamKey;
  periodLabel: string | null;
  title: string | null;
  goalText: string | null;
  kpiName: string | null;
  targetValue: number | null;
  actualValue: number | null;
  /** **시트에 적힌 달성률.** 재계산은 `goal-stats.ts`가 따로 하고 이 값은 보존한다 */
  achievementRate: number | null;
  prevPeriodDelta: string | null;
  channel: string | null;
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
  execStatus: string | null;
  analysis: string | null;
  wentWell: string | null;
  needsImprovement: string | null;
  startedAt: string | null;
  dueAt: string | null;
  extras: Record<string, ExtraValue>;
  sourceUploadId: string | null;
  sourceSheetTab: string;
  sourceRowIndex: number;
}

export interface TeamPeriodGoal {
  id: string;
  teamId: TeamKey;
  periodLabel: string | null;
  goalText: string | null;
  riskText: string | null;
}
```

`GoalMetric`에는 `raw`를 두지 않는다 — `ParsedGoalMetric`의 `raw`는 파싱 감사용이고,
지표는 `extras`만으로 복원 가능하다. 이 결정을 타입 주석에 남겨라.

### 3. `src/lib/domain/kst-today.ts` — 테스트를 **먼저** 쓴다

`src/lib/domain/` 디렉토리를 새로 만든다.

```ts
/** `now`를 Asia/Seoul 기준 `YYYY-MM-DD`로 환산한다. 인자 없이 호출할 수 없다 */
export function kstToday(now: Date): string;
/** ISO 타임스탬프를 Asia/Seoul 기준 `YYYY-MM-DD`로 환산한다. 파싱 불가면 null */
export function kstDateOf(isoTimestamp: string | null): string | null;
/** `to - from`을 **일수**로. 둘 다 `YYYY-MM-DD`. 형식이 아니면 null */
export function daysBetween(fromYmd: string, toYmd: string): number | null;
/** `YYYY-MM-DD`에 일수를 더한 `YYYY-MM-DD` */
export function addDays(ymd: string, days: number): string | null;
/** 그 날짜가 속한 주의 월요일. 주는 **월요일에 시작**한다 */
export function startOfWeek(ymd: string): string | null;
/** 그 날짜가 속한 주의 일요일 */
export function endOfWeek(ymd: string): string | null;
```

구현 규칙 — **여기서 틀리면 전 화면의 날짜가 하루씩 밀린다.**

1. `kstToday`·`kstDateOf`는 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`로
   환산한다. `+9시간`을 손으로 더하지 마라. 오프셋 상수를 코드에 박는 순간 근거가 사라진다.
2. `daysBetween`·`addDays`·`startOfWeek`·`endOfWeek`는 **`Date.UTC`로만** 계산한다.
   `new Date('2026-08-18')`는 UTC 자정으로 파싱되고 `new Date(2026, 7, 18)`은 로컬 자정이라
   둘을 섞으면 어긋난다. 문자열을 정규식으로 쪼개 `Date.UTC(y, m - 1, d)`를 쓴다.
3. **모듈 어디에서도 `Date.now()`·인자 없는 `new Date()`를 호출하지 마라.** `kstToday`가
   `now`를 받는 이유가 그것이다 (`CLAUDE.md` CRITICAL).
4. 형식이 어긋난 입력에 예외를 던지지 마라. `null`을 돌려준다.

### 4. 테스트 케이스 (`src/lib/domain/kst-today.test.ts`)

1. `kstToday(new Date('2026-08-18T14:30:00Z'))` → `'2026-08-18'`
2. **`kstToday(new Date('2026-08-17T15:30:00Z'))` → `'2026-08-18'`** (UTC로는 17일, KST로는 18일 —
   이 케이스가 없으면 시간대 처리가 검증되지 않는다)
3. **`kstToday(new Date('2026-08-18T00:30:00Z'))` → `'2026-08-18'`** (KST 09:30, 같은 날)
4. `daysBetween('2026-08-18', '2026-08-21')` → `3`, 역방향은 `-3`, 같으면 `0`
5. **`daysBetween('2026-02-28', '2026-03-01')` → `1`** (2026년은 윤년이 아니다)
6. `daysBetween('2024-02-28', '2024-03-01')` → `2` (윤년)
7. `addDays('2026-12-31', 1)` → `'2027-01-01'`
8. `startOfWeek('2026-08-18')`(화) → `'2026-08-17'`, `endOfWeek` → `'2026-08-23'`
9. **`startOfWeek('2026-08-23')`(일) → `'2026-08-17'`** (일요일이 다음 주로 넘어가지 않는다)
10. 형식이 아닌 입력(`'2026.08.18'`·`''`·`'abc'`)은 전부 `null`이고 예외를 던지지 않는다
11. `kstDateOf(null)` → `null`

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/kst-today.test.ts

# 시간을 몰래 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/kst-today.ts ; test $? -eq 1

# 오프셋 상수를 손으로 박지 않았다 (출력이 비어야 함)
grep -nE "32400000|9 \* 60 \* 60" src/lib/domain/kst-today.ts ; test $? -eq 1

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs\|@supabase" src/lib/domain/kst-today.ts ; test $? -eq 1

# 회귀 — T3 모듈이 그대로 통과한다
npx vitest run src/lib/sheet

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - `ParsedTask`와 `Task`가 **둘 다** 남아 있는가? (T3 어댑터가 깨지지 않았는가)
   - `src/lib/`에 타입을 중복 정의하지 않았는가?
   - `Task.lastProgressAt`·`TaskEvent.changedFields`의 의미가 주석에 남아 있는가?
   - `src/lib/domain/` 아래 파일명이 `src/lib/` 전역에서 유니크한가?
     (`basename`이 겹치면 TDD 가드가 뚫린다 — `CLAUDE.md` CRITICAL)
3. `phases/t4-store-domain/index.json`의 step 0을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(추가한 타입 이름 전부, `kst-today` 내보낸 함수
     6개, 시간대 처리 방식, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 판정 함수(`toSemantic`·`deriveTaskFlags`·`summarizeTeam` 등)를 만들지 마라. 이유: step 1~6의 범위다.
- 저장소·마이그레이션 SQL을 건드리지 마라. 이유: step 7~10의 범위다.
- `ParsedTask`를 `Task`로 바꾸거나 T3 어댑터를 고치지 마라. 이유: 둘은 서로 다른 계층의 모델이다.
- `Date.now()`·인자 없는 `new Date()`를 쓰지 마라. 이유: `CLAUDE.md` CRITICAL.
- `+9시간` 오프셋을 손으로 더하지 마라. 이유: 서머타임 없는 KST에서도 근거 없는 상수는 부채다.
- `zod` 스키마를 새로 만들지 마라. 이유: 저장 모델 검증은 API 계층(T5)의 일이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
