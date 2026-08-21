# Step 9: briefing-roles

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` 완료 기준 **7**(`?as=`로 세 역할의 진입 화면이 각각 다르다)·
  **9**(주간 브리핑 카드 + 마크다운 복사)
- `docs/PLAN.md` — `UC-08`(브리핑)·`UC-14`(`?owner=` 프리셋)·「보안」 `S4`·
  「시각화」의 리프레시 규격(`router.refresh()` + `isPending` 스켈레톤)
- `docs/ADR.md` — **`ADR-013`**(`?as=`는 정식 데모 기능이되 메모리 드라이버에서만)
- `src/lib/api/viewer-role.ts` — `resolveViewerRole`. **프로덕션+라이브에서 `?as=`를 무시한다**
- `src/lib/domain/weekly-report.ts` — `buildWeeklyReport`(마크다운 **문자열**을 돌려준다)
- `src/app/api/report/weekly/route.ts` — 같은 호출 순서. `events: []`인 이유가 주석에 있다
- step 1~8 산출물 전부

## 배경

T6의 마지막 기능 두 개다.

**주간 브리핑 카드** (`UC-08`) — `buildWeeklyReport`가 이미 마크다운을 만든다.
화면이 할 일은 카드로 보여주고 **복사**시키는 것뿐이다. 전용 화면은 T9지만 카드는 T6다.

**역할별 진입 화면** (완료 기준 7) — `H7` 헤지다. 「세 역할이 각자 다른 것을 먼저 본다」가
실제로 성립하는지 확인하는 장치이고, T8에서 진짜 인증이 붙으면 `?as=` 자리에 세션이 들어온다.
**지금 화면 차이를 만들어 두면 그때 바뀌는 것은 「누가 admin인가」뿐이다.**

그리고 **리프레시**가 여기서 붙는다. 이 시스템은 업로드해야 데이터가 갱신되므로
(`ADR-001`) 「다른 탭에서 업로드하고 이 탭을 새로고침」이 실제 사용 흐름이다.

## 확정

### 세 역할의 진입 화면

같은 데이터를 **다른 순서로** 보여준다. 숨기는 것이 아니라 **위로 올리는 것**이다 —
필요한 사람이 스크롤하면 나머지도 다 있다.

| 역할 | 맨 위에 오는 것 | 근거 |
|---|---|---|
| `admin` | KPI 10 → 목표 대비 성과 → 주간 브리핑 → 팀 요약 → 차트 → 알림 → 표 | 대표·실장은 「전사가 잘 돌고 있나」 (`UC-07`·`UC-10`) |
| `lead` | 알림 4종 → 승인 대기함 → KPI → 팀 요약 → 차트 → 표 | 팀장은 「지금 손대야 할 것」 (`UC-12`·`UC-13`) |
| `member` | **내 업무 표**(`?owner=` 안내 포함) → 축약 KPI 3칸 → 알림 → 나머지 | 부원은 「내 마감」 (`UC-14`) |

- **`member`의 축약 KPI 3칸**은 `전체 활성 · 마감 임박 · 지연`이다. 10칸을 다 보여줘도
  부원이 쓰는 것은 그 셋이고, 진입 3초 안에 자기 마감을 봐야 한다.
  **`buildKpiStrip`의 결과에서 `key`로 골라 쓴다.** 새로 세지 마라.
- `member`에게 `?owner=`가 없으면 표 위에 「담당자를 지정하면 내 업무만 볼 수 있습니다」와
  담당자 입력을 띄운다. **자동으로 아무 이름을 넣지 마라** — 우리는 그 사람이 누군지 모른다.
- **기본 역할은 `member`다** (T5의 `resolveViewerRole` 결정). 인증 전에 기본값이 넓으면
  연락처가 아무에게나 기본 노출된다.

### `?as=`는 프로덕션+Supabase에서 무시된다

`resolveViewerRole`이 이미 그렇게 만들어져 있다 (`S4`·`ADR-013`).
**화면이 그 판정을 다시 하지 마라.** `read.meta.role`을 그대로 쓴다.
역할 전환 UI(step 2의 `role-switch`)는 **`meta.mode`가 `demo`이거나 드라이버가 `memory`일 때만**
보여준다. 프로덕션에서 눌러도 안 바뀌는 버튼이 있으면 그게 고장으로 보인다.

### 브리핑 카드

- 서버 컴포넌트가 `buildWeeklyReport`를 **직접** 부른다 (`ADR-007`). `/api/report/weekly`를
  fetch하지 마라.
- 카드에는 **마크다운 원문을 `<pre>`로** 보여준다. **HTML로 렌더하지 마라** —
  그 순간 sanitize가 필요해지고 셀 값이 DOM이 된다 (`S7`. 라우트 주석이 같은 말을 한다).
- 길면 `max-h-[320px] overflow-y-auto`. 「복사」 버튼 하나.
- `events: []`라서 「이번 주 변경 건수」가 0으로 나온다. **그 사실을 카드 아래 한 줄로
  밝혀라** — 「변경 건수는 이력 조회가 없어 집계되지 않습니다(T9)」. 0을 그냥 두면
  회의에서 「이번 주 아무 일도 없었다」로 읽힌다.

### 리프레시

- 상단 바에 「새로고침」 버튼. `'use client'` + `useRouter().refresh()` + `useTransition`.
- `isPending` 동안 **불투명도 페이드 150ms 스켈레톤** (`UI_GUIDE.md`). `animate-pulse`나
  스피너 애니메이션을 만들지 마라 — 허용된 애니메이션은 패널 슬라이딩과 이 페이드뿐이다.
- 「마지막 갱신 HH:mm」은 **표시하지 마라.** 그것은 클라이언트 시계이고, 화면에는 이미
  「마지막 반영: N일 전」(서버가 준 사실)이 있다. 두 시각이 나란히 있으면 사용자가
  어느 쪽이 데이터의 신선도인지 혼동한다. (`PLAN.md`의 「마지막 갱신 HH:mm」 문구는
  이 근거로 `docs/PLAN.md`에서 함께 정정하라.)

## 작업

### 1. `src/lib/view/role-layout.ts` — 테스트를 **먼저** 쓴다

```ts
export type SectionKey =
  | 'kpi' | 'kpi_compact' | 'goals' | 'briefing' | 'teams' | 'charts'
  | 'alerts' | 'approvals' | 'tasks';

/** 위 표 그대로. **역할마다 배열이 다르다** */
export const SECTION_ORDER: Readonly<Record<ViewerRole, readonly SectionKey[]>>;

export function sectionsFor(role: ViewerRole): readonly SectionKey[];

/** `member`의 축약 KPI에 쓸 타일 키 3개 */
export const COMPACT_KPI_KEYS: readonly string[];
```

테스트: 세 배열이 **서로 다르다**(완료 기준 7의 실체 — 같으면 이 기능이 없는 것이다),
각 배열에 `tasks`가 반드시 있다(어느 역할도 업무 표를 못 보면 안 된다),
`admin`의 첫 항목이 `kpi`·`lead`가 `alerts`·`member`가 `tasks`,
`member`에만 `kpi_compact`가 있고 `kpi`가 없다,
`COMPACT_KPI_KEYS`가 `buildKpiStrip`이 실제로 내는 `key` 값의 부분집합이다
(**이 테스트가 오타를 잡는다** — 키가 틀리면 화면에 빈 칸 3개가 뜬다).

### 2. `src/components/dashboard/briefing-card.tsx`

`'use client'` (복사). props `{ markdown: string; note: string }`.

- 복사는 `navigator.clipboard.writeText`. **실패를 조용히 삼키지 마라** —
  버튼 라벨을 「복사됨」/「복사 실패」로 2초간 바꾼다. `alert()`을 쓰지 마라.
- `navigator.clipboard`가 없는 환경(비 HTTPS)을 대비해 **`try/catch`로 감싸고**
  실패 시 「직접 선택해 복사하세요」로 안내한다.

### 3. `src/components/shell/refresh-button.tsx`

`'use client'`. `useRouter().refresh()` + `useTransition`. 상단 바에 끼운다.
`isPending`을 페이지가 알아야 스켈레톤을 그릴 수 있으므로, **스켈레톤은 이 버튼 옆
콘텐츠 영역이 아니라 버튼 자체의 상태 표시**로 최소화한다 — 전체 화면 스켈레톤을 만들면
서버 컴포넌트 트리를 통째로 클라이언트로 옮겨야 한다. 버튼은 `disabled` + 라벨 「갱신 중…」,
그리고 상단 바 아래 1px 진행 표시줄(불투명도 페이드 150ms)까지가 이 step의 범위다.

### 4. `src/app/page.tsx` — 섹션 순서를 역할로 정한다

```tsx
{sectionsFor(read.meta.role).map((key) => renderSection(key))}
```

- `renderSection`은 **같은 파일 안의 switch 하나**로 둔다. 섹션마다 컴포넌트는 이미 있다.
- **어떤 역할에서도 섹션을 삭제하지 마라.** 순서만 바꾸고, `member`만 `kpi` 대신
  `kpi_compact`를 쓴다.
- 팀 라우트(`/teams/[teamSlug]`)에도 같은 순서 규칙을 적용한다. 단 `teams`·`charts` 중
  팀 화면에 없는 섹션(step 6에서 뺀 것)은 건너뛴다.

### 5. `docs/PLAN.md`의 「마지막 갱신 HH:mm」을 정정한다

「시각화」 문단의 그 문구를 지우고, **왜 두지 않는지 한 줄**을 남겨라
(서버가 준 「마지막 반영」과 클라이언트 시계가 나란히 있으면 신선도를 혼동한다).

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 세 역할의 섹션 순서가 다르다 (테스트가 이것을 검증해야 한다 — 출력이 있어야 함)
grep -n "SECTION_ORDER" src/lib/view/role-layout.ts src/lib/view/role-layout.test.ts

# 화면이 역할을 다시 판정하지 않는다 (출력이 비어야 함)
grep -rn "resolveViewerRole" src/components/ ; test $? -eq 1

# 브리핑을 HTML로 렌더하지 않는다 (출력이 비어야 함)
grep -rn "dangerouslySetInnerHTML\|marked\|remark\|markdown-it" src/ ; test $? -eq 1

# 브리핑을 직접 부른다 (출력이 있어야 함) — ADR-007
grep -n "buildWeeklyReport" src/app/page.tsx

# 변경 건수 0의 근거를 밝힌다 (출력이 있어야 함)
grep -rn "이력 조회" src/app/page.tsx src/components/dashboard/briefing-card.tsx

# 금지된 애니메이션이 없다 (출력이 비어야 함)
grep -rniE "animate-pulse|animate-spin|animate-bounce|animate-ping" src/app src/components ; test $? -eq 1

# alert()을 쓰지 않는다 (출력이 비어야 함)
grep -rn "alert(" src/components/ ; test $? -eq 1

# 낡은 문구가 문서에서 사라졌다 (출력이 비어야 함)
grep -n "마지막 갱신 HH:mm" docs/PLAN.md ; test $? -eq 1

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
2. `STORAGE_DRIVER=memory npm run dev`로 **세 URL을 나란히 열어** 비교한다:
   - `/?as=admin` · `/?as=lead` · `/?as=member`
   - **맨 위에 오는 것이 셋 다 다른가?** (완료 기준 7 — 같으면 이 step이 실패한 것이다)
   - `member`에서 KPI가 3칸인가? 연락처가 `(비공개)`인가?
   - `?as=` 없이 들어가면 `member` 화면인가? (기본값이 좁은가)
   - `/?as=member&owner=<시드에 있는 이름>`이 그 사람 업무만 보여주는가? (`UC-14`)
3. 브리핑:
   - 「복사」를 누르고 텍스트 편집기에 붙여넣어 **마크다운 표가 깨지지 않는지** 확인하라
   - 카드에 **연락처·계정·`extras` 값이 하나도 없는지** 눈으로 확인하라
     (`weekly-report.ts`가 싣지 않기로 했다. 이 문자열은 복사돼 밖으로 나간다)
   - 변경 건수 0의 근거 문구가 있는가?
4. 리프레시 버튼을 눌러 화면이 갱신되는가? 갱신 중 표시가 뜨는가? 튀지 않는가?
5. `phases/t6-dashboard/index.json`의 step 9를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 세 역할의 섹션 순서, 축약 KPI 3칸, 브리핑을 `<pre>`로 두는 이유,
   「마지막 갱신 HH:mm」을 뺀 근거를 남겨라.

## 금지사항

- 역할에 따라 섹션을 **삭제**하지 마라. 이유: 순서를 바꾸는 것이 헤지이고, 삭제는 권한이다.
  권한은 T8이다.
- 화면에서 역할을 다시 판정하지 마라. 이유: `?as=` 무시 규칙이 두 곳이 되면 프로덕션에서
  인증 우회가 생긴다 (`S4`).
- 마크다운을 HTML로 렌더하지 마라. 이유: 셀 값이 DOM이 된다 (`S7`).
  마크다운 렌더러를 설치하지 마라.
- 브리핑을 `/api/report/weekly`로 fetch하지 마라. 이유: `ADR-007`.
- 「마지막 갱신 HH:mm」을 넣지 마라. 이유: 서버가 준 「마지막 반영」과 혼동된다.
- 스피너·펄스 애니메이션을 만들지 마라. 이유: 허용된 애니메이션은 둘뿐이다.
- `alert()`을 쓰지 마라. 이유: 복사 실패는 버튼 라벨로 알린다.
- `member`에게 담당자 이름을 자동으로 채워 넣지 마라. 이유: 그 사람이 누군지 모른다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
