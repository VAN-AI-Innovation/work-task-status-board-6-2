# Step 1: task-permission

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL 셋이 이 파일에 걸린다.** 집계·판정은 `src/lib/domain/`의 JS 순수
  함수로 한다 · 도메인 함수는 `now`를 인자로 받는다(이 함수는 시간을 아예 보지 않는다) ·
  `src/lib/` 파일명은 전역 유니크다
- `docs/TICKETS.md` — T8 완료 기준 **1**(세 역할이 각각 다른 범위를 본다)
- `docs/ADR.md` — `ADR-006`(집계·판정은 SQL이 아니라 JS). 이 step이 그 규칙의 연장이다
- step 0 산출물:
  - `docs/PLAN.md`「T8 착수 시 확정」의 **결정 D**(매칭 실패 = `unknown_owner`)
  - `src/types/auth.ts` — `Viewer`
- 본뜰 기존 코드:
  - `src/lib/domain/extras-visibility.ts` — 같은 성격의 「역할로 거르는 순수 함수」다.
    주석 밀도·`ViewerRole` 정의·「입력 객체를 고치지 않는다」 규율을 그대로 따른다
  - `src/lib/domain/task-derive.ts` — 도메인 함수의 시그니처 결
  - `src/lib/api/read-context.ts` — 「지연 거르기는 저장소가 아니라 여기서 한다」 문단.
    **이 step의 함수도 같은 자리에서 불린다** (step 8)
- `src/types/task.ts`·`src/types/goal.ts` — `Task.teamId`·`Task.ownerMemberId`,
  `GoalMetric.teamId`

## 배경

완료 기준 1이 요구하는 것은 「세 역할이 각각 다른 범위를 본다」이고, 그 **판정 자체**가
이 파일이다. RLS(step 4)가 DB에서 같은 규칙을 걸지만 **두 곳이 필요하다**:

- 데모·폴백 모드에는 RLS가 없다 (메모리 드라이버다). 그래도 역할별로 다르게 보여야 한다.
- 라이브 모드에서도 화면이 「왜 이것만 보이는가」를 설명하려면 규칙이 JS 쪽에 있어야 한다.

**그래서 규칙이 두 벌이 되는 것이 이 step의 진짜 위험이다.** 이 파일의 세 갈래와 step 4의
정책이 글자 그대로 대응하지 않으면, 데모에서 보이던 것이 라이브에서 사라지거나 그 반대가 된다.
step 4의 SQL을 쓸 때 이 파일의 주석을 그대로 옮겨 적을 수 있도록 **갈래를 세 개로 못박는다.**

## 작업

### 1. `src/lib/domain/viewer-scope.test.ts` 를 **먼저** 쓴다

파일명은 `viewer-scope.ts`다. `src/lib/api/viewer-role.ts`(역할을 **해석**한다)와 하는 일이
다르므로 이름을 나눈다 — 여기는 해석된 역할로 **범위를 정한다.**

```ts
/** 열람 범위 = 수정 범위다. 함수가 하나인 이유는 파일 주석에 남긴다 */
export function taskInScope(task: Task, viewer: Viewer): boolean;
export function scopeTasks(tasks: readonly Task[], viewer: Viewer): Task[];
export function goalMetricInScope(metric: GoalMetric, viewer: Viewer): boolean;
export function scopeGoalMetrics(metrics: readonly GoalMetric[], viewer: Viewer): GoalMetric[];
```

**갈래는 셋이고 전부다.**

| 역할 | `taskInScope` | `goalMetricInScope` |
|---|---|---|
| `admin` | 항상 `true` | 항상 `true` |
| `lead` | `viewer.teamId !== null && task.teamId === viewer.teamId` | 같은 조건 |
| `member` | `viewer.memberId !== null && task.ownerMemberId === viewer.memberId` | `viewer.teamId !== null && metric.teamId === viewer.teamId` |

`member`의 목표 지표만 태스크와 규칙이 다르다. **목표 지표에는 담당자 축이 없기 때문이다** —
`GoalMetric`은 「업무가 아니라 성과 지표」이고(`0001_init.sql` 주석) 팀 단위로 움직인다.
자기 팀 목표를 못 보는 부원은 「목표 대비 성과」 섹션이 통째로 빈 화면을 본다.

테스트 케이스 (전부 리터럴로 짓는다 — 픽스처를 읽지 마라):

**A. `admin`**
- 다른 팀·담당자 없는 태스크도 `true`
- `viewer.teamId`가 `null`이어도 `true` (전사 admin은 소속 팀이 없을 수 있다)

**B. `lead`**
- 같은 팀 `true` / 다른 팀 `false`
- **`viewer.teamId === null`이면 전부 `false`** — 팀 없는 `lead`는 아무것도 못 본다.
  이 갈래가 없으면 `null === null`로 팀 없는 태스크가 새는 날이 온다
- 태스크의 담당자가 누구든 팀만 본다

**C. `member`**
- `task.ownerMemberId === viewer.memberId` 만 `true`
- **`task.ownerMemberId === null`이면 `false`** (결정 D — `unknown_owner`).
  `viewer.memberId`도 `null`인 경우와 **함께** 잰다: `null === null`이 `true`가 되면
  담당자 미상 업무가 계정 연결 안 된 전원에게 열린다. **이 케이스는 필수다**
- 같은 팀이지만 남의 건 → `false`

**D. `scopeTasks`·`scopeGoalMetrics`**
- 원본 배열을 **고치지 않는다** (호출 후 입력 배열 길이가 그대로다)
- 순서를 바꾸지 않는다
- 빈 배열은 빈 배열
- 세 역할이 같은 입력에서 **서로 다른 길이**를 낸다 (완료 기준 1을 재는 단언)

### 2. `src/lib/domain/viewer-scope.ts` 를 구현한다

- **`Viewer | null`을 받지 마라.** `null`은 「데모 모드라 범위가 없다」와 「로그인하지 않았다」
  두 가지를 뜻하게 되고, 그 둘은 정반대의 결과를 내야 한다. 어느 쪽인지는 호출부(step 8)가
  알고 있으므로 그쪽이 판단한다.
- 시간을 읽지 않는다. `Date.now()`·`new Date()`가 이 파일에 없다.
- 저장소·`?as=`·환경변수를 보지 않는다. 인자 둘이 전부다.
- `switch (viewer.role)`로 세 갈래를 **모두 적는다.** `default`로 뭉치지 마라 — 역할이 하나
  늘면 타입 검사가 여기서 걸려야 한다.
- 파일 머리말에 남길 것: 왜 열람과 수정이 같은 규칙인지(둘이 갈릴 근거가 지금 없다),
  step 4의 RLS 정책이 이 표와 **글자 그대로 대응해야 한다**는 것, `unknown_owner`가 빠지는 이유.

## Acceptance Criteria

```bash
npm run test -- src/lib/domain/viewer-scope.test.ts
npm run lint && npm run build && npm run test
grep -n 'Date.now\|new Date' src/lib/domain/viewer-scope.ts    # 0줄
grep -n 'process.env\|getStorage\|as=' src/lib/domain/viewer-scope.ts  # 0줄
grep -rn 'ownerMemberId === null' src/lib/domain/viewer-scope.test.ts  # 1줄 이상
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **변이 테스트를 직접 넣어 보고 잡히는지 확인한다** (통과 후 되돌린다). 최소 셋:
   - `member` 갈래에서 `viewer.memberId !== null` 가드를 지운다 → C의 `null === null` 케이스가 잡아야 한다
   - `lead` 갈래에서 `viewer.teamId !== null` 가드를 지운다 → B가 잡아야 한다
   - `scopeTasks`를 `tasks.sort(...)`로 바꾼다 → D의 순서 단언이 잡아야 한다
   잡히지 않는 변이가 있으면 **테스트를 보강한다.** 무엇을 보강했는지 `summary`에 남긴다.
3. 체크리스트:
   - 세 역할이 같은 입력에서 서로 다른 길이를 내는 단언이 있는가? (없으면 이 파일은 아무것도
     구분하지 않으면서 통과할 수 있다)
   - `Viewer | null`을 받지 않는가?
4. `phases/t8-auth-rls/index.json`의 step 1을 갱신한다.

## 금지사항

- `TaskFilter`(`src/lib/store/task-repository.ts`)에 필드를 추가하지 마라. 범위 거르기는
  저장소가 아니라 조회 문맥에서 한다 — `read-context.ts`의 `overdue`가 같은 이유로 필터
  밖에 있다 (`ADR-006`). 저장소에 넣으면 memory·supabase 두 구현이 각자 판정하게 된다.
- `read-context.ts`·`store-factory.ts`·`viewer-role.ts`를 고치지 마라. step 8의 일이다.
- SQL을 쓰지 마라. step 4의 일이다.
- 역할 문자열을 새로 정의하지 마라 — `ViewerRole`을 import한다.
- 「본인 건」 판정을 `ownerNameRaw` 문자열 비교로 하지 마라. 자유 입력이라 동명이인·오타가
  그대로 권한이 된다. 판정은 `ownerMemberId` 하나로 선다.
- 기존 테스트를 깨뜨리지 마라.
