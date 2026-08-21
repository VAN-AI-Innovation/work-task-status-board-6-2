# Step 5: task-table

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` 완료 기준 **2**(5색 구분 + Overdue 좌측 보더·배지)·
  **5**(필터 URL 유지)·**14**(빈 상태·에러 상태·**필터 0건**을 구분)
- `docs/UI_GUIDE.md` — 「상태 5색 구분」·「표」·「입력 필드 · 필터 칩」 (다크 값)
- `docs/PLAN.md` — 「빠른 조회 UX」, `UC-11`·`UC-14`
- `src/lib/domain/display-status.ts` — `DISPLAY_STATUS_LABELS`
- `src/types/api.ts` — `TaskResponse`(`displayStatus`·`statusLabel`·`flags`가 이미 붙어 있다)
- step 1 산출물: `dashboard-query.ts`(`applyDisplayFilter`·`buildHref`)·`task-sort.ts`
- step 3 산출물: `kpi-format.ts`(`formatDday`·`formatDate`·`formatCount`)

## 배경

**과제 요구 2번의 실체가 이 step이다** — 「모든 태스크가 예정·진행·검토·완료·지연
5색으로 구분되고, Overdue 행은 붉은 좌측 보더 + 배지」.

판정은 이미 끝나 있다. `TaskResponse`에 `displayStatus`와 `statusLabel`이 붙어서 온다
(`toTaskListResponse`가 `toDisplayStatus`를 부른 결과다). **화면은 다시 판정하지 않는다.**
여기서 하는 일은 그 칸을 **어떤 클래스로 그릴지** 고르는 것뿐이고, 그 매핑조차 컴포넌트가
아니라 lib에 둔다 — 표·사이드 패널·알림 패널 세 곳이 같은 배지를 써야 하기 때문이다.

그리고 **필터 바**가 여기서 생긴다. 필터 상태가 URL에 사는 것이 완료 기준 5이고
(`UC-11`), 그 변환은 step 1이 이미 확정했다. 이 step은 그 함수를 부르는 UI만 만든다.

## 확정

### 배지 클래스 (다크 · `UI_GUIDE.md`)

| `DisplayStatus` | 클래스 |
|---|---|
| `planned` | `bg-raise text-ink-muted` |
| `in_progress` | `bg-ink text-canvas` |
| `review` | `border border-line-strong text-ink` |
| `done` | `bg-panel text-ink-faint` |
| `overdue` | `bg-late-bg text-late` |
| `muted` | `text-ink-faint` (배경 없음) |

**배지에는 항상 한글 라벨이 함께 간다** — 색만으로 구분되지 않는다(색각 이상 대응).
지연 행은 추가로 `border-l-[3px] border-l-late-line`.

### 표 컬럼 — 공통 8칸

`상태 · 팀 · 업무명 · 담당자 · 마감 · D-DAY · 진행률 · 다음 조치`

**70컬럼을 표에 뿌리지 않는다** (`ADR-002`). 팀 전용 필드는 사이드 패널(step 7)이 진다.
이 결정이 촬영·기획팀 탭을 쓸 수 있게 만드는 유일한 이유다.

### 필터 바

`팀(칩 3) · 상태(칩 6) · 지연만(토글) · 담당자(입력) · 마감 범위(날짜 2) · 검색`
+ **[필터 초기화]**.

- 모든 조작은 **링크 이동**이다. `buildHref`로 URL을 만들고 `<Link>`로 간다.
  클라이언트 상태를 따로 들지 마라 — URL이 유일한 상태다. 그래야 뒤로 가기가 동작하고
  링크 복사가 화면을 재현한다.
- 담당자·검색·날짜는 입력이므로 **form submit(Enter)에서만** 이동한다.
- **`?display=`(5색 칩)와 `?status=`(원문)를 섞지 마라.** step 1의 확정이다.
- **적용 중인 필터 개수를 표시한다.** 필터가 걸린 화면인지 모르고 「데이터가 없다」고
  오해하는 것이 이 화면의 가장 흔한 사고다.

### 세 가지 빈 화면은 서로 다르다 (완료 기준 14)

| 상황 | 문구 | 행동 |
|---|---|---|
| 데이터 없음(전체 0건) | 「아직 데이터가 없습니다」 | 샘플 불러오기 / 업로드 (기존 화면 유지) |
| **필터 0건** | 「조건에 맞는 업무가 없습니다」 | **[필터 초기화]** |
| 조회 실패 | `error.tsx` | 다시 시도 |

**셋의 문구를 섞지 마라.** 필터 0건에서 「데이터가 없습니다」가 뜨면 사용자가 업로드하러 간다.

## 작업

### 1. `src/lib/view/status-badge.ts` — 테스트를 **먼저** 쓴다

```ts
export interface BadgeStyle {
  label: string;      // DISPLAY_STATUS_LABELS에서
  className: string;  // 위 표
}
export const STATUS_BADGES: Readonly<Record<DisplayStatus, BadgeStyle>>;
export function badgeOf(status: DisplayStatus): BadgeStyle;
/** 지연 행에만 좌측 보더. 그 외는 빈 문자열 */
export function rowClassOf(status: DisplayStatus): string;
```

테스트: 6칸이 빠짐없이 있다, **라벨이 `DISPLAY_STATUS_LABELS`와 정확히 같다**
(`Object.entries` 비교 — 여기서 갈라지면 화면마다 다른 한글이 뜬다), `overdue`만
`late` 토큰을 쓴다, `rowClassOf`가 `overdue`에서만 비어 있지 않다,
어떤 클래스에도 금지 팔레트(`purple`·`indigo`·`neutral-`)가 없다.

### 2. `src/components/tasks/` — 표와 필터 바

- `task-table.tsx` — props `{ tasks: TaskResponse[]; query: DashboardQuery; pathname: string }`.
  서버 컴포넌트로 둘 수 있으면 그렇게 한다(행 클릭은 `<Link>`다).
  각 행은 `buildHref(pathname, query, { task: task.id })`로 가는 링크 —
  **step 7의 사이드 패널이 그 URL을 읽는다.** 지금은 링크만 만들어 두고 패널은 없다.
  (링크가 자기 페이지를 다시 그리는 것뿐이라 404가 나지 않는다.)
- `status-badge.tsx` — props `{ status: DisplayStatus }`. `badgeOf`를 부른다
- `filter-bar.tsx` — `'use client'`(입력 제출). props `{ query; pathname; ownerOptions? }`
- `empty-state.tsx` — props `{ kind: 'no-data' | 'no-match'; resetHref?: string }`.
  **두 문구를 한 컴포넌트에 두되 분기로 확실히 가른다**

표 스타일은 `UI_GUIDE.md`: 헤더 `bg-raise text-ink-muted text-xs sticky top-0`,
행 높이 40px, `border-b border-line`, `hover:bg-raise`, 숫자·날짜는 `tabular-nums` 우측 정렬.

### 3. `src/app/page.tsx`에 끼운다

차트 **아래**에 필터 바 → 업무 표 순서. 표에 넣을 목록은:

```ts
const visible = sortTasks(applyDisplayFilter(tasks, query), query.sort);
```

`tasks`는 `toTaskListResponse(read.tasks, read.ctx.flags, read.role)`의 결과다 —
**마스킹과 원본 배제가 그 함수에 이미 들어 있다** (`S6`). 화면이 `read.tasks`(저장 모델)를
표에 직접 뿌리면 `raw`가 클라이언트로 새어 나간다. 반드시 응답 모양으로 바꿔서 넘긴다.

행이 0건일 때: `tasks.length === 0`이면 「데이터 없음」(기존 분기), 전체는 있는데
`visible.length === 0`이면 **「조건에 맞는 업무가 없습니다」 + 필터 초기화**.

목록이 아주 길 때를 대비해 **표는 자체 `overflow-x-auto` 컨테이너 안에** 둔다.
1024px에서 페이지 전체가 가로 스크롤되면 안 된다 (`ADR-014`).

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 화면이 다시 판정하지 않는다 (출력이 비어야 함)
grep -rn "toDisplayStatus\|deriveTaskFlags" src/components/ src/app/page.tsx ; test $? -eq 1

# 저장 모델이 표로 새지 않는다 (출력이 비어야 함) — raw 유출 방어
grep -rn "\.raw" src/components/tasks/ ; test $? -eq 1

# 응답 변환을 거친다 (출력이 있어야 함)
grep -n "toTaskListResponse" src/app/page.tsx

# 5색 + 기타 6칸이 다 있다 (6이 나와야 함)
grep -c "planned\|in_progress\|review\|done\|overdue\|muted" src/lib/view/status-badge.ts

# 지연 행 강조가 있다 (출력이 있어야 함)
grep -rn "border-l-\[3px\]\|border-l-late-line" src/lib/view/status-badge.ts

# 필터 0건 문구가 데이터 없음과 다르다 (둘 다 출력이 있어야 함)
grep -rn "조건에 맞는 업무가 없습니다" src/components/
grep -rn "아직 데이터가 없습니다" src/app/page.tsx

# 필터가 클라이언트 상태를 따로 들지 않는다 (출력이 비어야 함)
grep -rn "useState" src/components/tasks/task-table.tsx ; test $? -eq 1

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
2. `STORAGE_DRIVER=memory npm run dev`로 `/`를 열고 **손으로** 확인한다:
   - 다섯 색이 서로 구분되는가? **배지에 한글 라벨이 항상 있는가?**
   - 지연 행에 붉은 좌측 보더 + 배지가 있는가? (완료 기준 2)
   - 상태 칩을 눌렀을 때 **URL이 바뀌고** 표가 걸러지는가?
   - **URL을 복사해 새 탭에 붙이면 같은 화면인가?** (완료 기준 5 — 이게 핵심 검증이다)
   - 필터를 걸어 0건을 만들면 「조건에 맞는 업무가 없습니다」 + 초기화 버튼이 뜨는가?
   - 뒤로 가기가 이전 필터로 돌아가는가?
   - `?owner=<시드에 있는 이름>`으로 들어가면 그 사람 업무만 나오는가? (`UC-14`)
   - 1024px에서 페이지가 가로로 스크롤되지 않는가? (표만 스크롤되는가)
3. 체크리스트:
   - 표에 `extras`·70컬럼이 뿌려지지 않았는가? (공통 8칸인가)
   - 계산 안 된 값이 `—`인가?
   - 적용 중인 필터 개수가 보이는가?
4. `phases/t6-dashboard/index.json`의 step 5를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 배지 매핑을 lib으로 뺀 이유, 컴포넌트 이름, 세 빈 화면을 가른 문구를 남겨라.

## 금지사항

- 화면에서 상태를 다시 판정하지 마라. 이유: `displayStatus`가 이미 응답에 실려 온다.
  두 곳에서 판정하면 표와 KPI가 다른 말을 한다.
- `read.tasks`(저장 모델)를 컴포넌트에 넘기지 마라. 이유: `raw`가 클라이언트로 새어 나가고
  그 안에 연락처·계정이 있다 (`S6`).
- 필터를 클라이언트 상태로 들지 마라. 이유: URL이 유일한 상태여야 링크 공유(`UC-11`)와
  뒤로 가기가 성립한다.
- 표에 `extras`를 뿌리지 마라. 이유: `ADR-002`. 70컬럼 표는 아무도 못 쓴다.
- 필터 0건에 「데이터가 없습니다」를 쓰지 마라. 이유: 사용자가 업로드하러 간다.
- 무한 스크롤·페이지네이션·가상 스크롤을 만들지 마라. 이유: 조직 전체가 수백~수천 행이라
  전량 렌더가 문제가 아니라는 것이 `ADR-006`의 전제다. 필요해지면 그때 근거를 갖고 넣는다.
- 사이드 패널을 만들지 마라. 이유: step 7의 범위다. 여기서는 링크만 만든다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
