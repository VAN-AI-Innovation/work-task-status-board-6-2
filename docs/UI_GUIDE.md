# UI 디자인 가이드

> 톤은 `docs/PLAN.md`에서 확정된 **라이트 + 무채색, 시맨틱 2색**이다.
> 아래 색상 값은 그 제약 안에서 고른 구체값이며, 바꾸려면 이 문서를 먼저 고친다.

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

**위반 0건이 T6의 완료 기준이다.**

## 색상

### 배경

| 용도 | 값 |
|------|------|
| 페이지 | `#fafafa` (neutral-50) |
| 카드·패널 | `#ffffff` |
| 표 헤더·구분 영역 | `#f5f5f5` (neutral-100) |
| 테두리 | `#e5e5e5` (neutral-200) |

### 텍스트

| 용도 | 값 |
|------|------|
| 주 텍스트·수치 | `text-neutral-900` |
| 본문 | `text-neutral-700` |
| 보조·라벨 | `text-neutral-500` |
| 비활성 | `text-neutral-400` |

### 시맨틱 — 2색뿐

| 용도 | 텍스트 | 배경 | 테두리 |
|------|------|------|------|
| **지연** (overdue) | `#b91c1c` (red-700) | `#fef2f2` (red-50) | `#dc2626` (red-600) |
| **주의** (마감 임박 D-3 이내 · 데이터 5일 이상 낡음) | `#b45309` (amber-700) | `#fffbeb` (amber-50) | `#d97706` (amber-600) |

**완료를 초록으로 칠하지 않는다.** 초록이 들어오는 순간 화면의 절반이 색을 갖게 되고
지연 빨강이 눈에 안 띈다. 완료는 무채색으로 **물러난다.**

## 상태 5색 구분 (과제 요구 2번)

"5색"이지만 실제 색은 2개다. 나머지 넷은 **명도와 형태**로 구분한다.

| 표시 상태 | 배지 스타일 | 근거 |
|---|---|---|
| **예정** | `bg-neutral-100 text-neutral-600` | 아직 안 움직임 — 가장 옅다 |
| **진행** | `bg-neutral-900 text-white` | 지금 움직이는 것 — 무채색 중 가장 진하다 |
| **검토** | `bg-white text-neutral-800 border border-neutral-900` | 아웃라인. 채움과 형태로 구분 |
| **완료** | `bg-neutral-50 text-neutral-400` | 끝난 것 — 물러난다 |
| **지연** | `bg-red-50 text-red-700` + 행 좌측 3px `border-l-red-600` | **유일하게 색을 갖는다** |

- `hold`·`cancelled`는 5색에 속하지 않는다. `text-neutral-400` + 취소선 없이 라벨만.
- **지연은 다른 상태를 덮어쓴다.** 진행 중이면서 마감이 지났으면 "진행"이 아니라 "지연"이다.
- 배지는 색만으로 구분되지 않는다 — **항상 한글 라벨을 함께** 쓴다(색각 이상 대응).

## 컴포넌트

### 카드
```
rounded-md bg-white border border-neutral-200 p-5
```
KPI 타일은 `rounded` + `p-4`, 사이드 패널은 `rounded-none`. **모서리 반경을 통일하지 않는다.**

### 버튼
```
Primary:  rounded bg-neutral-900 text-white px-4 py-2 hover:bg-neutral-700
Secondary: rounded border border-neutral-300 bg-white px-4 py-2 hover:bg-neutral-50
Text:      text-neutral-500 hover:text-neutral-900 underline-offset-4 hover:underline
Danger:    rounded border border-red-300 text-red-700 hover:bg-red-50
비활성:     opacity-50 cursor-not-allowed   ← 읽기 전용 모드의 편집 버튼
```

### 입력 필드 · 필터 칩
```
입력: rounded border border-neutral-300 bg-white px-3 py-2 focus:border-neutral-900 focus:outline-none
칩(off): rounded-full border border-neutral-300 px-3 py-1 text-neutral-600
칩(on):  rounded-full bg-neutral-900 text-white px-3 py-1
```

### 표
```
헤더: bg-neutral-100 text-neutral-500 text-xs font-medium 좌측 정렬, sticky top-0
행:   border-b border-neutral-200, hover:bg-neutral-50, 높이 40px
지연 행: border-l-[3px] border-l-red-600
숫자·날짜 컬럼: tabular-nums 우측 정렬
```

### 배너 (상태 고지)
```
읽기 전용:   bg-amber-50 border-b border-amber-600 text-amber-700   "읽기 전용 — 저장소 연결 실패"
데모 모드:   bg-neutral-100 border-b border-neutral-300 text-neutral-600   "샘플 데이터 모드"
```
**둘의 문구와 색을 절대 섞지 않는다.** 하나는 사고고 하나는 의도다.

### "마지막 반영" 표시
모든 페이지 헤더 우측. `text-xs text-neutral-500`, **5일 초과 시 `text-amber-700` + 앰버 점.**

## 레이아웃

- 기준 폭 **1280px**, `max-w-[1280px] mx-auto px-6`. **1024px까지 레이아웃 유지.**
  그 아래는 깨지지 않고 읽히면 통과 — 별도 모바일 레이아웃은 만들지 않는다.
- 대시보드 그리드: KPI `grid-cols-5` 2행, 본문 `grid-cols-12` 기반.
- 정렬: **좌측 정렬 기본.** 수치만 우측 정렬. 중앙 정렬 금지(빈 상태 화면 제외).
- 간격: 카드 내부 `gap-3`, 섹션 간 `space-y-6`.
- 사이드 패널: 우측 고정 폭 `w-[480px]`, 페이지 위에 오버레이.

## 타이포그래피

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-xl font-semibold text-neutral-900` |
| 섹션 제목 | `text-sm font-semibold text-neutral-900` |
| KPI 수치 | `text-2xl font-semibold tabular-nums text-neutral-900` |
| KPI 라벨 | `text-xs text-neutral-500` |
| 표·본문 | `text-sm text-neutral-700` |
| 보조 설명 | `text-xs text-neutral-500` |

숫자는 **전부 `tabular-nums`**. 자릿수가 흔들리면 표가 읽히지 않는다.

## 차트 (Chart.js)

- 도넛 = 팀별 상태 분포, 가로 바 = 팀별 완료율. **그 외 차트 타입을 추가하지 않는다.**
- 계열 색은 상태 배지의 명도 스케일을 그대로 쓴다:
  `#e5e5e5`(예정) · `#171717`(진행) · `#737373`(검토) · `#d4d4d4`(완료) · `#dc2626`(지연).
- 그라데이션 채움·그림자·3D 금지. 격자선은 `#e5e5e5` 한 겹.
- 범례는 차트 하단 좌측 정렬. 애니메이션은 끈다(`animation: false`) — 매번 튀면 도구가 아니다.

## 애니메이션

- 사이드 패널 슬라이딩: `translate-x` **200ms** ease-out. Esc·오버레이 클릭으로 닫힌다.
- 리프레시 중 스켈레톤: 불투명도 페이드 **150ms**.
- **그 외 모든 애니메이션 금지.** 특히 hover 시 확대(scale), 그림자 증폭, 글로우.

## 아이콘

- SVG 인라인, `strokeWidth 1.5`, 크기 16px 기본.
- **아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.**
- 알림 종류는 아이콘이 아니라 **한글 라벨**로 구분한다(마감 임박 / 장기 미갱신 / 담당자 미지정 / 기한 미설정).

## 링크 렌더링 (보안)

시트의 하이퍼링크 셀을 사이드 패널에 렌더할 때 **`http`·`https` 스킴만 앵커로** 만든다.
나머지(`javascript:` 등)는 텍스트로만 표시. 외부 링크에는 `rel="noopener noreferrer"`.
