# Step 3: dashboard-kpi

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL: 서버 컴포넌트는 `src/lib/`를 호출만 하고 계산하지 않는다**
- `docs/TICKETS.md` — `## T6` 완료 기준 **1**(시트 KPI 10종이 모두 화면에 대응 표시)
- `docs/PLAN.md` — 「7. 화면」의 통합 대시보드 구성도, `UC-07`
- `docs/ADR.md` — **`ADR-007`**(서버 컴포넌트는 `lib/`를 직접 호출한다. 자기 API를 fetch하지 않는다)
- `docs/UI_GUIDE.md` — 「레이아웃」의 `KPI grid-cols-5 2행`, KPI 타일 클래스, 타이포
- `src/lib/api/read-context.ts` — **`buildReadContext`의 반환 모양 전량**
- `src/lib/domain/progress-stats.ts` — `buildKpiStrip`(10칸)·`summarizeAllTeams`·`TeamSummary`
- `src/app/page.tsx` · `src/app/page.test.ts` — 이 step이 둘 다 다시 쓴다
- step 1·2 산출물: `dashboard-query.ts`·`task-sort.ts`·`sync-freshness.ts`·`PageShell`

## 배경

여기서 대시보드가 실제로 생긴다. 그리고 **이 step이 T6 전체의 데이터 경로를 확정한다** —
뒤의 step 7개가 전부 같은 방식으로 읽는다.

경로는 하나다:

```ts
const storage = await getStorage();
const query   = parseDashboardQuery(sp);          // step 1
const read    = await buildReadContext(storage, new Date(), {
  as: sp.get('as'), ...parseTaskQuery(sp),         // T5 산출물
});
// 이후 read.tasks / read.ctx / read.role / read.meta 만 쓴다
```

`buildReadContext`를 재사용하는 이유가 핵심이다. **화면과 API가 같은 함수로 읽으면
숫자가 갈라질 수 없다.** 화면이 따로 세기 시작하면 `/api/stats`와 대시보드가 다른 값을
말하는 날이 오고, 그날 둘 다 못 믿게 된다. 마스킹(`S6`)·역할 해석(`ADR-013`)·
지연 필터도 그 함수 안에 이미 들어 있다 — 화면이 다시 만들면 그 규칙도 갈라진다.

**자기 API를 `fetch`하지 마라** (`ADR-007`). 서버 컴포넌트가 자기 서버에 HTTP를 치는 것은
왕복 비용만 늘리고, 배포 환경에서 자기 주소를 알아내는 문제까지 새로 생긴다.

## 확정

### KPI 10칸은 발명하지 않는다

`buildKpiStrip`이 시트 `00_통합 대시보드` 5행과 1:1로 대응하는 10칸을 **순서까지** 확정해
뒀다. 화면은 그 배열을 그대로 `grid-cols-5` 2행으로 뿌린다.
**라벨을 화면에서 다시 쓰지 마라. 순서를 바꾸지 마라. 칸을 더하거나 빼지 마라.**
완료 기준 1의 검증이 「10칸이 시트와 같은가」이고, 화면이 라벨을 새로 지으면 대조가 불가능해진다.

### 팀별 요약표

`summarizeAllTeams`의 `TeamSummary[]`를 그대로 표로. 컬럼은
`팀 · 전체 · 활성 · 진행 · 검토 · 승인 대기 · 완료 · 지연 · 완료율 · 평균 진행률`.
**태스크가 0건인 팀도 행으로 나온다** (그 함수가 이미 그렇게 만든다). 빈 팀을 화면에서
숨기지 마라 — 「우리 팀이 안 보인다」가 「데이터가 없다」보다 나쁜 화면이다.

### 숫자 표기

`null`은 **`0`이 아니다.** 모수가 없어 계산되지 않은 완료율과 `0%`는 다른 사실이다.
표기는 `—`(em dash). 이 규칙을 컴포넌트마다 다시 쓰지 않게 포맷터를 lib에 둔다.

## 작업

### 1. `src/lib/view/kpi-format.ts` — 테스트를 **먼저** 쓴다

```ts
/** null → '—'. 천 단위 구분자를 넣는다 */
export function formatCount(value: number | null): string;
/** null → '—'. 정수 + '%' */
export function formatPercent(value: number | null): string;
/** `KpiTile.unit`에 따라 위 둘 중 하나 */
export function formatKpi(tile: KpiTile): string;
/** `D-3` · `D+2` · `D-DAY` · null → '—' */
export function formatDday(dday: number | null): string;
/** `YYYY-MM-DD` 그대로, null → '—' */
export function formatDate(value: string | null): string;
```

- **`toLocaleString`에 로케일을 넘기지 마라.** 실행 환경에 따라 결과가 갈린다.
  천 단위 구분자는 직접 넣거나 `Intl.NumberFormat('en-US')`처럼 **고정**한다.
- `formatDday`의 부호 규칙: 남았으면 `D-3`, 오늘이면 `D-DAY`, 지났으면 `D+2`.
  `weekly-report.ts`가 같은 표기를 쓰고 있으니 **그 파일의 규칙과 어긋나지 않게** 하라
  (보고서와 화면이 다른 표기를 쓰면 회의 자리에서 같은 건인지 알 수 없다).

테스트: `null`·`0`·큰 수·음수 dday·0 dday·양수 dday·빈 문자열. **`0`이 `—`가 되지 않는다**는
테스트를 반드시 넣어라 — 이 실수가 화면에서 가장 흔하다.

### 2. `src/components/dashboard/` — KPI 스트립과 팀 요약표

- `kpi-strip.tsx` — props `{ tiles: KpiTile[] }`. `grid-cols-5` 2행. 타일 클래스는
  `UI_GUIDE.md`의 KPI 타일(`rounded bg-panel border border-line p-4`).
  수치는 `text-2xl font-semibold tabular-nums text-ink`, 라벨은 `text-xs text-ink-muted`.
  **참고 이미지의 「vs last month」 델타 배지는 만들지 마라** — 비교할 직전 값이 우리 데이터에
  없다. 없는 숫자를 그리면 대시보드가 거짓말을 한다.
- `team-summary-table.tsx` — props `{ teams: TeamSummary[] }`. 표 스타일은 `UI_GUIDE.md`.
  **숫자·비율 컬럼은 `tabular-nums` 우측 정렬**, 팀 이름만 좌측.
  지연 컬럼이 0보다 크면 그 셀만 `text-late` (행 전체를 칠하지 마라 — 행 강조는 업무 표의
  규칙이고 팀 요약에 쓰면 지연 강조가 흔해진다).

### 3. `src/app/page.tsx` — 통합 대시보드로 교체한다

```tsx
export const dynamic = 'force-dynamic';   // 유지한다. 이유는 기존 주석 그대로다

export default async function Home({ searchParams }: PageProps<'/'>) { … }
```

- Next 16에서 `searchParams`는 **Promise**다. `await`한 뒤 `toURLSearchParams`로 바꾼다.
- 빈 상태(0건) 분기는 **그대로 유지**한다. 문구·버튼도 그대로다 — `X3`의 갈래 구분이고
  이미 테스트가 있다.
- 1건 이상이면 `PageShell` 안에 **KPI 스트립 → 팀별 요약표** 순으로 그린다.
  「준비 중」 카드는 지운다.
- **차트·업무 표·알림·목표 섹션은 아직 없다.** 각각 step 4·5·8이다. 자리를 비워 둔다.
- 서버 컴포넌트에 **계산을 한 줄도 두지 마라.** `read.tasks.filter(...)`·`reduce`·
  `.length` 기반 집계 전부 금지다. 필요한 값은 `buildKpiStrip`·`summarizeAllTeams`가 준다.

### 4. `src/app/page.test.ts` — **먼저** 고친다

기존 파일을 지우지 말고 고친다. 그 테스트의 트리 순회 헬퍼(`walk`·`textOf`·`findComponent`)가
이 프로젝트에서 서버 컴포넌트를 검증하는 유일한 수단이다.

- 모든 `Home()` 호출에 `{ searchParams: Promise.resolve({}) }`를 넘기게 고친다.
- 「대시보드를 만들지 않았다 — 화면에 KPI·차트가 없다」 테스트를 **뒤집는다**:
  1건 이상이면 `KpiStrip`·`TeamSummaryTable`이 트리에 있고, 「준비 중」 문구가 없다.
- **KPI 10칸 테스트를 추가한다**: 시드를 넣고 `Home()`을 렌더한 뒤 `KpiStrip`에 넘어간
  `tiles`의 길이가 10이고 `buildKpiStrip`이 만든 라벨과 같은지. **완료 기준 1의 검증면이다.**
- 빈 상태·읽기 전용·배너 모드 테스트 4개는 **그대로 통과해야 한다.**
- `?as=admin`을 넘겼을 때와 안 넘겼을 때 `meta.role`이 다르다는 테스트를 하나 넣어라
  (step 9의 역할별 화면이 여기 위에 선다).

## Acceptance Criteria

```bash
npx vitest run src/app src/lib/view

# 서버 컴포넌트가 자기 API를 부르지 않는다 (출력이 비어야 함) — ADR-007
grep -rn "fetch('/api\|fetch(\`/api\|fetch(\"/api" src/app/page.tsx src/app/upload/page.tsx ; test $? -eq 1

# 화면이 집계하지 않는다 (출력이 비어야 함) — CLAUDE.md CRITICAL
grep -nE "\.reduce\(|\.filter\(.*\)\.length|COUNT" src/app/page.tsx ; test $? -eq 1

# KPI 라벨을 화면에서 다시 짓지 않았다 (출력이 비어야 함)
grep -n "전체 활성 업무\|승인 대기\|이번 주 마감" src/app/page.tsx src/components/dashboard/*.tsx ; test $? -eq 1

# 화면과 API가 같은 함수로 읽는다 (출력이 있어야 함)
grep -n "buildReadContext" src/app/page.tsx

# 안티패턴 0건 / 라이트 팔레트 0건 (둘 다 출력이 비어야 함)
grep -rniE "backdrop-blur|bg-gradient|bg-clip-text|purple|violet|indigo|blur-3xl|drop-shadow|hover:scale" src/app src/components ; test $? -eq 1
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]" src/app src/components ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `STORAGE_DRIVER=memory npm run dev`로 띄워 `/`를 본다:
   - **KPI 10칸이 스크롤 없이** 한 화면에 들어가는가? (`UC-07`)
   - 타일의 라벨·순서가 `docs/PLAN.md`의 시트 KPI 설명과 대응하는가?
   - 팀 3개가 모두 표에 있는가? (건수가 0인 팀도)
   - 계산 안 된 값이 `0`이 아니라 `—`로 나오는가?
   - 1280px·1024px 둘 다 깨지지 않는가?
3. `curl 'localhost:3000/api/stats' | head`의 KPI 값과 **화면 숫자가 같은지 눈으로 대조하라.**
   다르면 화면이 어딘가에서 다시 세고 있다는 뜻이다.
4. `phases/t6-dashboard/index.json`의 step 3을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 데이터 경로(`getStorage`→`buildReadContext`→도메인 함수)를 확정했다는 사실,
   컴포넌트 이름, `page.test.ts`에 추가한 테스트를 남겨라.

## 금지사항

- 서버 컴포넌트에서 자기 API를 `fetch`하지 마라. 이유: `ADR-007`. 왕복 비용과 자기 주소
  문제가 새로 생긴다.
- 화면에서 집계·판정하지 마라. 이유: `CLAUDE.md` CRITICAL. 화면과 API의 숫자가 갈라지면
  둘 다 못 믿는다.
- KPI 칸을 더하거나 빼거나 라벨을 다시 짓지 마라. 이유: 시트와의 1:1 대응이 완료 기준 1이다.
- 「vs last month」류 증감 배지를 만들지 마라. 이유: 비교할 직전 값이 데이터에 없다.
  참고 이미지에 있다는 것은 근거가 아니다.
- 빈 상태 분기와 그 문구를 지우지 마라. 이유: `X3`의 갈래 구분이고 테스트가 그것을 지킨다.
- 차트·업무 표·알림·목표 섹션을 만들지 마라. 이유: step 4·5·8의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
