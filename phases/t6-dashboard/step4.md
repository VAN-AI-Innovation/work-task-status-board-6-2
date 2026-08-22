# Step 4: dashboard-charts

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — 「차트」 절 **전문** (step 0이 다크 계열색으로 고친 값)
- `docs/TICKETS.md` — `## T6` 범위 In의 「Chart.js 도넛·바」
- `docs/PLAN.md` — 「시각화」 문단 (도넛=팀별 상태 분포, 가로 바=팀별 완료율)
- `src/lib/domain/progress-stats.ts` — `TeamSummary`(`completionRate`가 `null`일 수 있다)
- `src/lib/domain/display-status.ts` — `DISPLAY_STATUS_LABELS`
- `src/types/api.ts` — `TaskResponse.displayStatus`
- step 3 산출물: `src/app/page.tsx`의 데이터 경로, `src/components/dashboard/`

## 배경

차트는 **두 종류뿐**이다 — 도넛(팀별 상태 분포)과 가로 바(팀별 완료율).
`UI_GUIDE.md`가 「그 외 차트 타입을 추가하지 않는다」라고 못박았다. 대시보드에 차트가
늘어나면 그림이 정보보다 많아지고, 이 화면은 회의 직전 30초짜리 도구다 (`UC-07`).

Chart.js는 이미 설치돼 있다 (`chart.js@4` · `react-chartjs-2@5`). 새로 설치하지 마라.

이 step의 요점은 **계산과 그리기를 가르는 것**이다. 색·라벨·값 배열을 만드는 것은
`src/lib/view/`의 순수 함수이고, 컴포넌트는 그 결과를 Chart.js에 넘기기만 한다.
차트 컴포넌트 안에서 세기 시작하면 도넛의 숫자와 KPI의 숫자가 갈라진다.

## 확정

### 계열색 (다크)

```
예정 #4b535f · 진행 #e8eaed · 검토 #9aa1ab · 완료 #2b313a · 지연 #ef4444
격자선 #262b33 · 축 라벨 #9aa1ab
```

- **`muted`(기타)는 도넛에 넣는다.** 5색에 속하지 않지만 건수는 존재하고, 빼면 도넛 합이
  전체와 달라져 「이 그림은 무엇의 100%인가」를 아무도 모르게 된다. 색은 `#1f242b`(가장 어둡게).
- **그라데이션 채움·그림자·3D 금지.** 격자선은 한 겹. `animation: false`.
  애니메이션은 「매번 튀면 도구가 아니다」라는 이유로 꺼져 있다 — 켜지 마라.

### 도넛이 세는 것

**팀별 상태 분포**다. 팀이 3개이므로 도넛도 **팀당 하나가 아니라 하나**다 —
전사 분포를 한 개 그리고, 팀별 분포는 팀 라우트(step 6)가 같은 컴포넌트를 재사용한다.
그래서 입력은 `TaskResponse[]`(이미 걸러진 목록)이지 `TeamSummary[]`가 아니다.

### 바가 세는 것

**팀별 완료율**이다. `completionRate`가 `null`인 팀은 **막대를 그리지 않고 「—」로 표시**한다.
0%로 그리면 「완료가 하나도 없는 팀」과 「셀 것이 없는 팀」이 같은 그림이 된다.

## 작업

### 1. `src/lib/view/chart-series.ts` — 테스트를 **먼저** 쓴다

```ts
export interface ChartSeries {
  labels: string[];
  values: number[];
  colors: string[];
}

export const STATUS_COLORS: Readonly<Record<DisplayStatus, string>>;
export const CHART_GRID: string;
export const CHART_AXIS: string;

/** 5색 + 기타. **순서 고정**: overdue → in_progress → review → planned → done → muted */
export function buildStatusDonut(tasks: readonly { displayStatus: DisplayStatus }[]): ChartSeries;

/** 팀별 완료율. `completionRate`가 null인 팀은 `values`에 **넣지 않는다** */
export function buildCompletionBars(teams: readonly TeamSummary[]): ChartSeries;

/** 완료율을 잴 수 없어 막대에서 빠진 팀. 화면이 「—」로 표시한다 */
export function unmeasurableTeams(teams: readonly TeamSummary[]): TeamKey[];
```

- **라벨은 `DISPLAY_STATUS_LABELS`에서 온다.** 차트가 자기 라벨을 지으면 배지와 도넛이
  다른 말을 한다.
- **건수 0인 칸도 배열에 남긴다.** 범례에서 칸이 사라지면 도넛 색의 뜻이 매번 달라진다.
- 팀 라벨은 step 6의 `team-slug.ts`가 아직 없으므로 **이 파일이 임시로 짓지 마라.**
  `buildCompletionBars`는 `TeamKey`를 라벨로 내고, 한글 이름 매핑은 **step 6에서
  `team-slug.ts`가 생기면 그것을 쓰도록 step 6이 고친다.** 지금 두 곳에 한글 이름을
  만들면 나중에 갈라진다. (이 사실을 파일 주석에 남겨라.)

테스트: 순서 고정, 빈 입력(라벨 6칸·값 전부 0), 색 6개가 서로 다르다, `null` 완료율 팀이
`values`에서 빠지고 `unmeasurableTeams`에 잡힌다, 값 합이 입력 건수와 같다, 입력 불변.

### 2. `src/components/charts/` — Chart.js 래퍼

- `status-donut.tsx` — `'use client'`. props `{ series: ChartSeries }`
- `completion-bars.tsx` — `'use client'`. props `{ series: ChartSeries; unmeasurable: TeamKey[] }`
- `chart-registry.ts` — Chart.js의 `register`를 **한 곳에서** 한다. 두 컴포넌트가 각자
  등록하면 어느 쪽이 먼저 로드됐는지에 따라 동작이 갈린다

공통 옵션:

```ts
{
  animation: false,
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', align: 'start', labels: { color: CHART_AXIS, boxWidth: 10 } } },
}
```

- 바 차트는 `indexAxis: 'y'` (가로 바), 축 눈금 `color: CHART_AXIS`, 격자 `color: CHART_GRID`.
- 도넛은 `cutout: '62%'`. **중앙에 큰 숫자를 넣지 마라** — 참고 이미지에 있지만
  플러그인이나 절대배치 오버레이가 필요하고, 같은 숫자가 이미 KPI 타일에 있다.
- 캔버스는 고정 높이 컨테이너 안에 둔다 (`h-[240px]`). `maintainAspectRatio: false`와
  짝이며, 안 그러면 리사이즈마다 높이가 자란다.
- **툴팁은 기본값을 쓴다.** 커스텀 툴팁을 만들지 마라.

### 3. `src/app/page.tsx`에 끼운다

팀별 요약표 **아래**에 두 카드를 나란히 (`grid-cols-12` 기반, 도넛 5칸·바 7칸 정도).
카드는 `UI_GUIDE.md`의 카드 클래스. 카드 제목은 `text-sm font-semibold text-ink`,
부제는 `text-xs text-ink-muted`.

**서버 컴포넌트는 `buildStatusDonut`·`buildCompletionBars`를 부르고 결과만 넘긴다.**
`'use client'` 컴포넌트에 `TaskResponse[]` 전량을 넘기지 마라 — 직렬화 비용이 크고,
클라이언트 번들에 업무 데이터가 통째로 들어간다.

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 차트가 스스로 세지 않는다 (출력이 비어야 함)
grep -nE "\.reduce\(|\.filter\(" src/components/charts/*.tsx ; test $? -eq 1

# 애니메이션이 꺼져 있다 (출력이 있어야 함)
grep -rn "animation: false" src/components/charts/

# 차트 타입이 둘뿐이다 (doughnut·bar 외 타입이 없어야 함 — 출력이 비어야 함)
grep -rniE "type: '(line|radar|pie|polarArea|bubble|scatter)'" src/components/charts/ ; test $? -eq 1

# 그라데이션·그림자 없음 (출력이 비어야 함)
grep -rniE "createLinearGradient|shadowBlur|shadowColor|gradient" src/components/charts/ ; test $? -eq 1

# 등록이 한 곳이다 (1이 나와야 함)
grep -rln "Chart.register\|ChartJS.register" src/components/charts/ | wc -l

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
2. `STORAGE_DRIVER=memory npm run dev`로 `/`를 보고:
   - 도넛 조각 합이 표의 「전체」 합과 같은가?
   - 바의 완료율이 팀 요약표의 완료율 값과 **같은 숫자**인가? (다르면 두 곳에서 계산 중이다)
   - 새로고침할 때 차트가 **튀지 않는가**? (애니메이션이 꺼져 있는가)
   - 다크 배경에서 여섯 계열이 서로 구분되는가? 범례 글씨가 읽히는가?
   - 창을 줄였다 늘렸을 때 차트 높이가 자라지 않는가?
3. 체크리스트:
   - 도넛 라벨이 배지 라벨과 같은 한글인가?
   - 완료율이 `null`인 팀이 0%로 그려지지 않는가?
   - 클라이언트 컴포넌트에 업무 배열 전량이 넘어가지 않는가?
4. `phases/t6-dashboard/index.json`의 step 4를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 계열색 6개를 확정했다는 사실, 함수 이름, 팀 한글 라벨을 step 6으로
   미뤄 둔 사실을 남겨라.

## 금지사항

- 차트 타입을 추가하지 마라. 이유: `UI_GUIDE.md`가 도넛·가로 바 둘로 못박았다.
- 애니메이션을 켜지 마라. 이유: 매번 튀는 화면은 도구가 아니다.
- 그라데이션·그림자·3D·커스텀 툴팁·중앙 라벨 플러그인을 만들지 마라. 이유: 안티패턴이고,
  같은 숫자가 이미 KPI 타일에 있다.
- 차트 컴포넌트에서 집계하지 마라. 이유: 도넛과 KPI의 숫자가 갈라진다.
- 팀 한글 이름을 이 step에서 정의하지 마라. 이유: step 6의 `team-slug.ts`가 진다.
  두 곳에 두면 갈라진다.
- 차트 라이브러리를 새로 설치하지 마라. 이유: `chart.js`·`react-chartjs-2`가 이미 있다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
