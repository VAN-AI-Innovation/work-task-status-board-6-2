# Step 2: task-derive + display-status

## 읽어야 할 파일

- `CLAUDE.md` — 도메인 규칙(`now` 주입), TDD
- `docs/ADR.md` — **`ADR-009`**(「지연」은 상태값이 아니라 파생 판정이고 다른 색을 덮어쓴다)
- `docs/PLAN.md` — 「6. 집계·판정」의 5색 매핑표와 "판정 규칙 중 틀리기 쉬운 것들",
  「엣지 케이스 처리 방침」(마감일 없는 업무 / 담당자 미지정 / 진행률 빈칸)
- `docs/UI_GUIDE.md` — 「상태 5색 구분」(표시 상태 5개 + `hold`·`cancelled`의 취급)
- `docs/TICKETS.md` — `## T4` 완료 기준 **5**
- step 0·1 산출물: `kst-today.ts`, `task-semantic.ts`, `Task`·`TaskSemantic`·`DisplayStatus`

## 배경

요구 2번("예정·진행·검토·완료·지연 5색 구분")의 실체다. 시트의 진행 상태는 10단계인데
화면은 5색이고, **「지연」은 그 10단계에 없다.** 지연은 `dueAt`과 오늘을 비교해 나오는 파생값이며
다른 색을 덮어쓴다. 이 구분을 흐리면 완료율이 틀리고 "진행 중이면서 마감이 지난" 업무를 놓친다.

파일이 둘인 이유: `deriveTaskFlags`가 **판정**을 하고 `toDisplayStatus`가 그 결과를 **한 축으로
접는다.** 뒤의 집계(step 3)·알림(step 5)은 `flags`를 쓰고 화면(T6)만 `DisplayStatus`를 쓴다.

## 작업

### 1. `src/lib/domain/task-derive.ts` — 테스트를 **먼저** 쓴다

```ts
export interface DeriveContext {
  /** KST 기준 오늘 `YYYY-MM-DD`. `kstToday(now)`가 만든 값을 **주입받는다** */
  today: string;
  /** `buildSemanticIndex`가 만든 조회표 */
  semanticIndex: SemanticIndex;
  /** 마감 임박 기준. 기본 3 (D-3) */
  dueSoonDays?: number;
  /** 장기 미갱신 기준. 기본 7 */
  staleDays?: number;
  /** 설정 탭 구성원 목록. 없으면 `hasUnknownOwner`는 항상 false */
  knownOwners?: readonly string[];
}

export interface TaskFlags {
  semantic: TaskSemantic | null;
  /** `dueAt` 기준 남은 일수. 음수면 지났다. `dueAt`이 없으면 null */
  dday: number | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  isStale: boolean;
  hasNoOwner: boolean;
  hasUnknownOwner: boolean;
  hasNoDueDate: boolean;
}

export function deriveTaskFlags(task: Task, ctx: DeriveContext): TaskFlags;
/** 여러 건을 한 번에. `Map<taskId, TaskFlags>` */
export function deriveAllFlags(tasks: readonly Task[], ctx: DeriveContext): Map<string, TaskFlags>;
```

판정 규칙 — **각 줄이 테스트 한 개다.**

1. `dday = daysBetween(ctx.today, task.dueAt)`. `dueAt`이 null이면 `dday`도 null.
   **`Date` 객체 뺄셈을 쓰지 마라** — `kst-today.ts`의 `daysBetween`만 쓴다 (`PLAN.md` `E4`).
2. `isOverdue` = 아래 둘 중 하나. **단 `semantic`이 `done`·`cancelled`면 무조건 false.**
   - `dueAt !== null && dday < 0`
   - `task.riskStatus`가 `'지연'` (시트가 스스로 지연이라고 적은 경우, `ADR-009`의 OR 항)

   시트 리스크가 `지연`이어도 완료·취소 건은 지연이 아니다. **이건 스펙에 명시되지 않은
   판단이므로 주석에 근거를 남겨라** — 완료된 건이 빨간색이면 완료율과 화면이 어긋난다.
3. `isDueSoon` = `!isOverdue && dday !== null && 0 <= dday && dday <= dueSoonDays`
   && `semantic`이 `done`·`cancelled`가 아님. 오늘 마감(`dday === 0`)은 임박에 **포함**한다.
   단계별 SLA로 기준을 좁히는 것은 `alert-rules`(step 5)가 `TaskStage`를 보고 한다 —
   태스크 단위에는 단계 SLA를 잇는 근거가 없다(T3 결론: `slaDays`는 단계에만 붙는다).
4. `isStale` = `lastProgressAt !== null` && `daysBetween(kstDateOf(lastProgressAt), today) > staleDays`
   && `isActiveSemantic(semantic)`. **`lastProgressAt`이 null이면 false다** —
   갱신 이력이 없는 것은 "오래됐다"는 증거가 아니다.
5. `hasNoOwner` = `ownerNameRaw`를 `trim()`했을 때 빈 문자열이거나
   `미정`·`TBD`·`tbd`·`-`·`–`·`—`·`없음` 중 하나 (대소문자 무시).
   이 목록을 파일 상단 상수 `NO_OWNER_TOKENS`로 두고 코드에 흩뿌리지 마라.
6. `hasUnknownOwner` = `!hasNoOwner && knownOwners가 주어졌고 && knownOwners에 없음`.
   비교는 양쪽 `trim()` 후 정확히 일치. `knownOwners`가 없거나 빈 배열이면 **항상 false**
   (구성원 목록을 모르는데 전건을 오타로 신고하면 안 된다).
7. `hasNoDueDate` = `dueAt === null && semantic이 done·cancelled가 아님`
   (`PLAN.md` 「엣지 케이스」 — 담당자 미지정과 대칭인 별도 신호).
8. 순수 함수다. `task`를 고치지 않고 `ctx` 밖에서 시간을 읽지 않는다.

### 2. `src/lib/domain/display-status.ts` — 테스트를 **먼저** 쓴다

```ts
export function toDisplayStatus(
  semantic: TaskSemantic | null,
  flags: { isOverdue: boolean }
): DisplayStatus;

/** 배지에 쓰는 한글 라벨. UI_GUIDE.md 「상태 5색 구분」의 이름 그대로 */
export const DISPLAY_STATUS_LABELS: Readonly<Record<DisplayStatus, string>>;
```

매핑 (`PLAN.md`·`UI_GUIDE.md`와 한 글자도 다르면 안 된다):

```
flags.isOverdue === true            → 'overdue'   ← 최우선. 다른 모든 것을 덮어쓴다
planned                             → 'planned'   (예정)
in_progress · rework                → 'in_progress' (진행)
review · approval                   → 'review'    (검토)
done · pending_release              → 'done'      (완료)
hold · cancelled                    → 'muted'     (5색에 속하지 않음)
null (미등록·미입력 상태)             → 'muted'
```

- 라벨은 `예정`·`진행`·`검토`·`완료`·`지연`, `muted`는 `기타`.
- **Tailwind 클래스·색상 코드를 이 파일에 넣지 마라.** 배지 스타일은 `UI_GUIDE.md`가 정하고
  컴포넌트(T6)가 고른다. 도메인은 어느 칸인지만 말한다.
- `if/else` 사슬 대신 `Record<TaskSemantic, DisplayStatus>` 표 하나로 쓴다. semantic이 늘면
  컴파일이 먼저 막힌다.

### 3. 테스트 케이스

`task-derive.test.ts`:

1. `dueAt`이 오늘보다 하루 전 + `semantic: in_progress` → `isOverdue` true, `dday` `-1`
2. **같은 업무의 `status`를 `완료`로만 바꾸면 `isOverdue`가 false가 된다**
3. **`riskStatus: '지연'` + `dueAt: null` → `isOverdue` true** (시트 리스크 OR 항)
4. **`riskStatus: '지연'` + `status: '취소'` → `isOverdue` false** (완료·취소가 이긴다)
5. `dueAt`이 오늘 → `dday` 0, `isDueSoon` true, `isOverdue` false
6. `dueAt`이 오늘+3 → `isDueSoon` true, 오늘+4 → false (경계)
7. `dueSoonDays: 1`을 주면 오늘+3이 false가 된다
8. `lastProgressAt`이 8일 전 + `in_progress` → `isStale` true, 7일 전이면 false (경계)
9. `lastProgressAt`이 8일 전 + `완료` → `isStale` false
10. **`lastProgressAt: null` → `isStale` false** (증거 없음)
11. `ownerNameRaw`가 `''`·`'  '`·`'미정'`·`'TBD'`·`'-'` → 각각 `hasNoOwner` true
12. `knownOwners: ['담당자1']`에서 `'담당자2'` → `hasUnknownOwner` true, `'담당자1'` → false
13. **`knownOwners`를 주지 않으면 `hasUnknownOwner`가 항상 false**
14. `dueAt: null` + `in_progress` → `hasNoDueDate` true, `dueAt: null` + `완료` → false
15. **`today`를 고정한 두 번의 호출이 같은 결과를 낸다** (실행 시각에 의존하지 않는다)
16. 픽스처 통합: `parseWorkbook`으로 얻은 태스크를 `Task`로 옮겨 `today: '2026-07-25'`를 주고
    `isOverdue`·`isDueSoon` 건수를 실측해 단언한다

`display-status.test.ts`:

1. 9개 semantic이 전부 매핑된다 (`Object.keys` 순회로 누락을 잡는다)
2. **`in_progress` + `isOverdue: true` → `'overdue'`** (덮어쓴다)
3. `rework` → `'in_progress'`, `approval` → `'review'`, `pending_release` → `'done'`
4. `hold`·`cancelled`·`null` → `'muted'`
5. `DISPLAY_STATUS_LABELS`의 6개 값이 전부 한글이고 `UI_GUIDE.md`의 이름과 같다
6. **파일에 Tailwind 클래스 문자열(`bg-`·`text-`)이 없다**

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/task-derive.test.ts src/lib/domain/display-status.test.ts

# 시간을 읽지 않는다 (둘 다 출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/task-derive.ts ; test $? -eq 1
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/display-status.ts ; test $? -eq 1

# 스타일이 도메인에 새지 않았다 (출력이 비어야 함)
grep -nE "bg-|text-|border-" src/lib/domain/display-status.ts ; test $? -eq 1

# 한글 상태 문자열은 task-semantic.ts에만 있다 — 아래는 `'지연'`(riskStatus) 1건만 나와야 한다
grep -n "진행 중\|검토 요청\|승인 대기\|게시·이관 대기\|수정 중" src/lib/domain/task-derive.ts

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다. 마지막 grep의 출력이 비어 있으면 더 좋다 —
   `'지연'` 비교조차 상수로 뽑았다는 뜻이다.
2. 체크리스트:
   - `isOverdue`가 `done`·`cancelled`를 확실히 제외하는가? (테스트 2·4번)
   - `isOverdue`가 `toDisplayStatus`에서 실제로 다른 색을 덮어쓰는가?
   - 9개 semantic 중 매핑이 빠진 것이 없는가?
   - `deriveTaskFlags`가 `task`를 변형하지 않는가?
3. `phases/t4-store-domain/index.json`의 step 2를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 픽스처 실측 `isOverdue`·`isDueSoon` 건수와 기준 날짜를 포함하라.

## 금지사항

- 집계(`summarizeTeam`·`buildKpiStrip`)를 만들지 마라. 이유: step 3의 범위다.
- 알림(`collectAlerts`)을 만들지 마라. 이유: step 5의 범위다.
- `display-status.ts`에 색상·클래스·아이콘을 넣지 마라. 이유: `UI_GUIDE.md`와 T6의 일이다.
- 단계 SLA를 태스크 마감 임박에 끌어오지 마라. 이유: `slaDays`는 단계에 붙는다(T3 결론), step 5가 쓴다.
- `Date` 객체 뺄셈으로 날짜 차이를 구하지 마라. 이유: KST에서 하루가 어긋난다 (`E4`).
- 한글 상태 문자열을 `task-semantic.ts` 밖에서 늘리지 마라. 이유: `ADR-009`.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
