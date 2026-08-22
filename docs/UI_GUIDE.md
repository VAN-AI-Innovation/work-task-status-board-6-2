# UI 디자인 가이드

> 톤은 `docs/PLAN.md`에서 확정된 **다크 + 무채색, 시맨틱 2색**이다.
> 아래 색상 값은 그 제약 안에서 고른 구체값이며, 바꾸려면 이 문서를 먼저 고친다.
>
> **왜 다크인가 (2026-08-22, T6 착수 시점)**: 원래 확정값은 **라이트 톤**이었고,
> 그것을 확정한 사용자가 T6 착수 시점에 **명도 방향 하나만** 뒤집었다. 바뀐 것은 배경의
> 밝기뿐이고 **무채색 원칙·시맨틱 2색·AI 슬롭 안티패턴 규율은 전부 유지**하기로 함께
> 결정했다. 참고로 제시된 이미지는 보라 액센트의 파이낸스 대시보드였으나, 참고한 것은
> **구조**(좌측 사이드바 · 상단 바 · KPI 타일 행 · 차트 카드)이지 색이 아니다.
> 이 근거가 지워지면 다음 사람이 라이트로 되돌린다.

## 디자인 원칙

1. **도구처럼 보여야 한다.** 마케팅 페이지가 아니라 매일 쓰는 대시보드다. 장식은 전부 뺀다.
2. **눈에 띄는 것은 문제뿐이다.** 화면에서 색이 있는 것은 **지연(빨강)과 주의(앰버)** 둘뿐이고,
   나머지는 전부 무채색이다. 정상 업무까지 알록달록하면 지연이 묻힌다.
3. **밀도 우선.** 한 화면에 KPI 10종과 팀별 요약이 스크롤 없이 들어가야 한다(UC-07).
   여백보다 정보를 택한다.

## AI 슬롭 안티패턴 — 하지 마라

| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

**위반 0건이 T6의 완료 기준이다.** 다크로 바뀌었다고 풀리는 규칙이 하나도 없다.

다크에서 특히 유혹이 커지는 둘을 못박는다.

- **네온·글로우** — 어두운 배경 위에서 `box-shadow`로 빛나게 만들고 싶어진다. 금지다.
  강조는 빛이 아니라 **명도 대비와 형태**로 한다.
- **보라·인디고 액센트** — 참고 이미지가 보라 액센트였다. **채택하지 않았다.**
  사용자가 「다크 + 무채색 유지」를 명시적으로 골랐고, 액센트가 하나라도 들어오면
  시맨틱 2색이 셋이 되어 지연이 묻힌다.

## 색상

색은 **토큰 한 곳에서만** 온다 (`src/app/globals.css`의 `@theme`). Tailwind v4가
`--color-*` 토큰에서 유틸리티를 만들므로, 화면 코드는 **hex가 아니라 아래 클래스 이름**을 부른다.

**`src/app/`·`src/components/`에서 `neutral-`·`red-`·`amber-`·`white` 같은 Tailwind
팔레트 클래스를 쓰지 않는다.** 다크로 한 번 뒤집힌 프로젝트라, 팔레트 클래스가 흩어져 있으면
다음에 또 뒤집을 때 같은 일을 파일 수만큼 반복하게 된다.

### 배경·테두리

| 토큰 | 값 | 유틸리티 | 용도 |
|---|---|---|---|
| `--color-canvas` | `#0b0d10` | `bg-canvas` | 페이지 배경 |
| `--color-panel` | `#14171c` | `bg-panel` | 카드·패널·사이드바·상단 바 |
| `--color-raise` | `#1a1e24` | `bg-raise` | 표 헤더·구분 영역·행 hover |
| `--color-line` | `#262b33` | `border-line` | 테두리 |
| `--color-line-strong` | `#3a424e` | `border-line-strong` | 아웃라인 배지·강조 테두리 |

### 텍스트

| 토큰 | 값 | 유틸리티 | 용도 |
|---|---|---|---|
| `--color-ink` | `#e8eaed` | `text-ink` | 주 텍스트·수치 |
| `--color-ink-body` | `#c3c8d0` | `text-ink-body` | 본문 |
| `--color-ink-muted` | `#9aa1ab` | `text-ink-muted` | 보조·라벨 |
| `--color-ink-faint` | `#6d747e` | `text-ink-faint` | 비활성·물러난 것 |

### 시맨틱 — 2색뿐

| 토큰 | 값 | 유틸리티 | 용도 |
|---|---|---|---|
| `--color-late` | `#f87171` | `text-late` | **지연** 텍스트 |
| `--color-late-bg` | `#2a1416` | `bg-late-bg` | 지연 배경 |
| `--color-late-line` | `#ef4444` | `border-late-line` · `border-l-late-line` | 지연 테두리 (행 좌측 3px) |
| `--color-warn` | `#fbbf24` | `text-warn` | **주의** (마감 임박 D-3 이내 · 데이터 5일 이상 낡음 · 목표 미달) |
| `--color-warn-bg` | `#2a2113` | `bg-warn-bg` | 주의 배경 |
| `--color-warn-line` | `#d97706` | `border-warn-line` | 주의 테두리 |

**완료를 초록으로 칠하지 않는다.** 초록이 들어오는 순간 화면의 절반이 색을 갖게 되고
지연 빨강이 눈에 안 띈다. 완료는 무채색으로 **물러난다.**

## 상태 5색 구분 (과제 요구 2번)

"5색"이지만 실제 색은 2개다. 나머지 넷은 **명도와 형태**로 구분한다.

**다크에서 명도 방향이 뒤집힌다.** 라이트에서는 「진행 = 가장 진한 무채색」이었지만,
어두운 배경 위에서 가장 진한 것은 배경에 묻힌다. **다크에서 가장 눈에 띄는 무채색은
가장 밝은 것**이므로 「진행」이 반전 배지(`bg-ink text-canvas`)가 된다.

| 표시 상태 | 배지 스타일 | 근거 |
|---|---|---|
| **예정** | `bg-raise text-ink-muted` | 아직 안 움직임 — 배경에 가장 가깝다 |
| **진행** | `bg-ink text-canvas` | 지금 움직이는 것 — 반전. 무채색 중 가장 밝다 |
| **검토** | `border border-line-strong text-ink` | 아웃라인. 채움이 아니라 형태로 구분 |
| **완료** | `bg-panel text-ink-faint` | 끝난 것 — 물러난다 |
| **지연** | `bg-late-bg text-late` + 행 좌측 3px `border-l-late-line` | **유일하게 색을 갖는다** |

- `hold`·`cancelled`(`muted`)는 5색에 속하지 않는다. `text-ink-faint` + 배지 없이 라벨만.
- **지연은 다른 상태를 덮어쓴다.** 진행 중이면서 마감이 지났으면 "진행"이 아니라 "지연"이다.
- 배지는 색만으로 구분되지 않는다 — **항상 한글 라벨을 함께** 쓴다(색각 이상 대응).

## 컴포넌트

### 카드
```
카드:       rounded-md bg-panel border border-line p-5
KPI 타일:   rounded bg-panel border border-line p-4
사이드 패널: rounded-none bg-panel border-l border-line
```
**모서리 반경을 통일하지 않는다** — 위 세 값이 서로 다른 것이 의도다.

### 버튼
```
Primary:   rounded bg-ink text-canvas px-4 py-2 hover:bg-ink-body
Secondary: rounded border border-line bg-panel px-4 py-2 text-ink hover:bg-raise
Text:      text-ink-muted hover:text-ink underline-offset-4 hover:underline
Danger:    rounded border border-late-line text-late hover:bg-late-bg
비활성:     opacity-50 cursor-not-allowed   ← 읽기 전용 모드의 편집 버튼
```

### 입력 필드 · 필터 칩
```
입력:    rounded border border-line bg-panel px-3 py-2 text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none
칩(off): rounded-full border border-line px-3 py-1 text-ink-muted hover:text-ink
칩(on):  rounded-full bg-ink text-canvas px-3 py-1
```

### 표
```
헤더: bg-raise text-ink-muted text-xs font-medium 좌측 정렬, sticky top-0
행:   border-b border-line, hover:bg-raise, 높이 40px
지연 행: border-l-[3px] border-l-late-line
숫자·날짜 컬럼: tabular-nums 우측 정렬
```

### 배너 (상태 고지)
```
읽기 전용:  bg-warn-bg border-b border-warn-line text-warn   "읽기 전용 — 저장소 연결 실패"
데모 모드:  bg-raise border-b border-line text-ink-muted     "샘플 데이터 모드"
```
**둘의 문구와 색을 절대 섞지 않는다.** 하나는 사고고 하나는 의도다.

### "마지막 반영" 표시
모든 페이지 헤더 우측. `text-xs text-ink-muted`, **5일 초과 시 `text-warn` + 앰버 점.**

## 레이아웃

### 앱 셸

```
┌────────────────────────────────────────────────────┐
│ 사이드바 │  상단 바  h-14   bg-panel border-b line  │
│ w-[220px]├────────────────────────────────────────┤
│ bg-panel │  본문  max-w-[1280px] mx-auto px-6      │
│ border-r │                                        │
└────────────────────────────────────────────────────┘
```

- 좌측 사이드바 고정 `w-[220px]`. **1024px 미만에서는 `w-14`로 줄여 아이콘만** 남긴다.
- 상단 바 `h-14`. 사이드바·상단 바 모두 `bg-panel` + `border-line`.
- 본문은 `max-w-[1280px] mx-auto px-6`.

### 폭

- 기준 폭 **1280px**, `max-w-[1280px] mx-auto px-6`. **1024px까지 레이아웃 유지** (`ADR-014`).
  그 아래는 깨지지 않고 읽히면 통과 — 별도 모바일 레이아웃은 만들지 않는다.
- 대시보드 그리드: KPI `grid-cols-5` 2행, 본문 `grid-cols-12` 기반.
- 정렬: **좌측 정렬 기본.** 수치만 우측 정렬. 중앙 정렬 금지(빈 상태 화면 제외).
- 간격: 카드 내부 `gap-3`, 섹션 간 `space-y-6`.
- 사이드 패널: 우측 고정 폭 `w-[480px]`, 페이지 위에 오버레이.

## 타이포그래피

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-xl font-semibold text-ink` |
| 섹션 제목 | `text-sm font-semibold text-ink` |
| KPI 수치 | `text-2xl font-semibold tabular-nums text-ink` |
| KPI 라벨 | `text-xs text-ink-muted` |
| 표·본문 | `text-sm text-ink-body` |
| 보조 설명 | `text-xs text-ink-muted` |

숫자는 **전부 `tabular-nums`**. 자릿수가 흔들리면 표가 읽히지 않는다.

## 차트 (Chart.js)

- 도넛 = 팀별 상태 분포, 가로 바 = 팀별 완료율. **그 외 차트 타입을 추가하지 않는다.**
- 계열 색은 상태 배지의 명도 스케일을 그대로 쓴다. 패널 배경(`#14171c`) 위에서 서로
  구분돼야 하므로 라이트 값의 단순 반전이 아니다:
  `#4b535f`(예정) · `#e8eaed`(진행) · `#9aa1ab`(검토) · `#2b313a`(완료) · `#ef4444`(지연).
- 그라데이션 채움·그림자·3D 금지. 격자선은 `#262b33` 한 겹, 축 라벨은 `#9aa1ab`.
- 범례는 차트 하단 좌측 정렬. 애니메이션은 끈다(`animation: false`) — 매번 튀면 도구가 아니다.

## 애니메이션

- 사이드 패널 슬라이딩: `translate-x` **200ms** ease-out. Esc·오버레이 클릭으로 닫힌다.
- 리프레시 중 스켈레톤: 불투명도 페이드 **150ms**.
- **그 외 모든 애니메이션 금지.** 특히 hover 시 확대(scale), 그림자 증폭, 글로우.

## 아이콘

- SVG 인라인, `strokeWidth 1.5`, 크기 16px 기본.
- **아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.**
- 알림 종류는 아이콘이 아니라 **한글 라벨**로 구분한다(마감 임박 / 장기 미갱신 / 담당자 미지정 / 기한 미설정).

## 목표 대비 성과의 톤

목표 대비 성과 섹션에서 **달성률 미달을 빨강으로 칠하지 않는다.**

- **빨강은 업무 지연 전용이다.** 목표 미달까지 빨강이면 화면에 빨강이 두 뜻으로 존재하고,
  둘을 구분하려면 사람이 매번 어느 섹션인지 확인해야 한다. 지연이 묻힌다.
- 달성률 **100 미만은 주의(`text-warn`)**, 그 외(100 이상·미측정)는 **무채색**이다.
- 달성률 막대·수치도 같은 규칙을 따른다. 초과 달성을 초록으로 칠하지 않는다.

## 링크 렌더링 (보안)

시트의 하이퍼링크 셀을 사이드 패널에 렌더할 때 **`http`·`https` 스킴만 앵커로** 만든다.
나머지(`javascript:` 등)는 텍스트로만 표시. 외부 링크에는 `rel="noopener noreferrer"`.
