# Step 0: design-tokens

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — **전문.** 이 step이 이 문서를 다시 쓴다
- `docs/PLAN.md` 37행 — 「UI 톤 | **라이트 + 무채색** … | 사용자 확정」
- `docs/PRD.md` 「디자인」 절
- `CLAUDE.md` — "결정이 바뀌면 코드보다 PLAN.md를 먼저 고친다"
- `src/app/globals.css` — 현재 토큰 (Next 보일러플레이트 잔재)
- `src/app/layout.tsx` — 폰트 변수 선언

## 배경 — 무엇이 바뀌었나

사용자가 T6 착수 시점에 **UI 톤을 라이트에서 다크로 바꿨다.** `PLAN.md` 37행의
「라이트 + 무채색 · 사용자 확정」이 그 사용자에 의해 뒤집힌 것이므로 결정 자체는 유효하다.
바뀐 것은 **명도 방향 하나**이고, 나머지 규율은 전부 그대로다:

- 시맨틱 색은 여전히 **2색뿐** — 지연(빨강), 주의(앰버).
- **AI 슬롭 안티패턴은 그대로 금지된다.** 보라·인디고 액센트, gradient-text,
  backdrop-filter blur, 글로우, 배경 orb — **다크로 바뀌었다고 풀리는 규칙이 아니다.**
  사용자가 참고 이미지(보라 액센트 파이낸스 대시보드)를 주면서도 **"다크 + 무채색 유지"**를
  명시적으로 골랐다. 참고한 것은 **구조**(좌측 사이드바 · 상단 바 · KPI 타일 행 · 차트 카드)이지
  색이 아니다.
- **T6 완료 기준 10번은 살아 있다.** 위반 0건이 여전히 완료 조건이다.

이 step은 **코드를 거의 만들지 않는다.** 문서를 먼저 고치고, 그 결정을 CSS 토큰 한 곳에
못박는 것이 전부다. 뒤의 step 10개가 전부 이 토큰 이름을 부르므로, 여기서 흔들리면
열 번 고쳐야 한다.

## 확정 — 이 값을 여기서 못박는다

### 색 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| `--color-canvas` | `#0b0d10` | 페이지 배경 |
| `--color-panel` | `#14171c` | 카드·패널·사이드바·상단 바 |
| `--color-raise` | `#1a1e24` | 표 헤더·구분 영역·행 hover |
| `--color-line` | `#262b33` | 테두리 |
| `--color-line-strong` | `#3a424e` | 아웃라인 배지·강조 테두리 |
| `--color-ink` | `#e8eaed` | 주 텍스트·수치 |
| `--color-ink-body` | `#c3c8d0` | 본문 |
| `--color-ink-muted` | `#9aa1ab` | 보조·라벨 |
| `--color-ink-faint` | `#6d747e` | 비활성·물러난 것 |
| `--color-late` | `#f87171` | **지연** 텍스트 |
| `--color-late-bg` | `#2a1416` | 지연 배경 |
| `--color-late-line` | `#ef4444` | 지연 테두리 (행 좌측 3px) |
| `--color-warn` | `#fbbf24` | **주의** 텍스트 |
| `--color-warn-bg` | `#2a2113` | 주의 배경 |
| `--color-warn-line` | `#d97706` | 주의 테두리 |

Tailwind v4는 `@theme`의 `--color-*`에서 유틸리티를 만든다. 그래서 화면 코드는
`bg-canvas`·`bg-panel`·`bg-raise`·`border-line`·`border-line-strong`·`text-ink`·
`text-ink-body`·`text-ink-muted`·`text-ink-faint`·`text-late`·`bg-late-bg`·
`border-l-late-line`·`text-warn`·`bg-warn-bg`·`border-warn-line`으로만 색을 부른다.

**이 step 이후 `src/app/`·`src/components/`에서 `neutral-`·`red-`·`amber-`·`white`
같은 Tailwind 팔레트 클래스를 쓰지 않는다.** 색은 토큰 한 곳에서만 온다 — 다크로 한 번
뒤집힌 프로젝트라 팔레트 클래스가 흩어져 있으면 다음에 또 뒤집힐 때 같은 일을 반복한다.
(기존 화면 3개의 마이그레이션은 step 2가 한다. 이 step은 토큰만 깐다.)

### 다크에서 명도 방향이 뒤집힌다

라이트 가이드의 「진행 = 가장 진한 무채색(`bg-neutral-900 text-white`)」은 다크에서
그대로 쓰면 배경에 묻힌다. **다크에서 가장 눈에 띄는 무채색은 가장 밝은 것**이다.

| 표시 상태 | 배지 (다크) | 근거 |
|---|---|---|
| **예정** | `bg-raise text-ink-muted` | 아직 안 움직임 — 배경에 가장 가깝다 |
| **진행** | `bg-ink text-canvas` | 지금 움직이는 것 — 반전. 무채색 중 가장 밝다 |
| **검토** | `border border-line-strong text-ink` | 아웃라인. 채움이 아니라 형태로 구분 |
| **완료** | `bg-panel text-ink-faint` | 끝난 것 — 물러난다 |
| **지연** | `bg-late-bg text-late` + 행 좌측 3px `border-l-late-line` | **유일하게 색을 갖는다** |
| 기타(`muted`) | `text-ink-faint`, 배지 없이 라벨만 | 5색에 속하지 않는다 |

### 차트 계열색 (다크)

도넛·바의 계열색은 위 배지의 **명도 스케일을 그대로** 따른다.
패널 배경(`#14171c`) 위에서 서로 구분돼야 하므로 라이트 값의 단순 반전이 아니다.

```
예정 #4b535f · 진행 #e8eaed · 검토 #9aa1ab · 완료 #2b313a · 지연 #ef4444
격자선 #262b33 · 축 라벨 #9aa1ab
```

### 목표 미달의 톤 — 여기서 정한다

목표 대비 성과 섹션(step 8)에서 **달성률 미달을 빨강으로 칠하지 않는다.**
빨강은 **업무 지연 전용**이다. 목표 미달까지 빨강이면 화면에 빨강이 두 뜻으로 존재하고
지연이 묻힌다. 달성률 100 미만은 **주의(`text-warn`)**, 그 외는 무채색이다.

## 작업

### 1. `docs/UI_GUIDE.md`를 다시 쓴다 — **코드보다 먼저다**

문서를 통째로 갈아엎지 마라. **바꾸는 것은 색과 명도 방향뿐**이고 원칙·안티패턴·레이아웃·
타이포·애니메이션·아이콘·링크 규칙은 그대로 둔다. 구체적으로:

- 머리말의 「라이트 + 무채색」을 **「다크 + 무채색, 시맨틱 2색」**으로. 그리고
  **언제·왜 바뀌었는지 한 줄**을 남겨라 (T6 착수 시 사용자가 톤을 뒤집었고, 안티패턴 규율은
  유지하기로 했다는 사실). 근거가 사라지면 다음 사람이 라이트로 되돌린다.
- 「디자인 원칙」 3개는 **글자 그대로 유지**한다. 다크가 되어도 도구여야 하고, 눈에 띄는 것은
  문제뿐이며, 밀도가 우선이다.
- 「AI 슬롭 안티패턴」 표는 **한 줄도 지우지 마라.** 대신 표 아래에 다크에서 특히 유혹이
  커지는 것 두 개를 명시하라 — **네온/글로우와 보라 액센트**. 참고 이미지가 보라였다는
  사실과 그것을 채택하지 않았다는 결정을 한 줄로 남긴다.
- 「색상」 절을 위 토큰 표로 교체한다. **토큰 이름과 유틸리티 클래스 이름을 같이** 적어라 —
  화면 코드가 부르는 것은 클래스지 hex가 아니다.
- 「상태 5색 구분」 표를 위 다크 표로 교체하고, **명도 방향이 뒤집힌 이유 한 줄**을 남긴다.
- 「컴포넌트」의 카드·버튼·입력·칩·표·배너 예시 클래스를 토큰 클래스로 바꾼다:

  ```
  카드:       rounded-md bg-panel border border-line p-5
  KPI 타일:   rounded bg-panel border border-line p-4
  사이드 패널: rounded-none bg-panel border-l border-line
  Primary:    rounded bg-ink text-canvas px-4 py-2 hover:bg-ink-body
  Secondary:  rounded border border-line bg-panel px-4 py-2 text-ink hover:bg-raise
  Text:       text-ink-muted hover:text-ink underline-offset-4 hover:underline
  Danger:     rounded border border-late-line text-late hover:bg-late-bg
  입력:       rounded border border-line bg-panel px-3 py-2 text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none
  칩(off):    rounded-full border border-line px-3 py-1 text-ink-muted hover:text-ink
  칩(on):     rounded-full bg-ink text-canvas px-3 py-1
  표 헤더:    bg-raise text-ink-muted text-xs font-medium sticky top-0
  표 행:      border-b border-line hover:bg-raise, 높이 40px
  지연 행:    border-l-[3px] border-l-late-line
  읽기 전용 배너: bg-warn-bg border-b border-warn-line text-warn
  데모 배너:     bg-raise border-b border-line text-ink-muted
  ```
  **「모서리 반경을 통일하지 않는다」는 규칙은 유지된다** — 위 세 값이 서로 다른 것이 의도다.
- 「차트」 절의 계열색을 위 다크 값으로 교체한다. 도넛·가로 바 **두 종류만**이라는 제약과
  `animation: false`는 그대로다.
- 「레이아웃」 절에 **앱 셸**을 추가하라 (step 2가 지을 것의 규격):
  좌측 사이드바 고정 `w-[220px]`(1024px 미만에서는 `w-14` 아이콘만) + 상단 바 `h-14`,
  본문은 `max-w-[1280px] mx-auto px-6`. 사이드바·상단 바는 `bg-panel border-line`.
  **1280px 기준·1024px 유지는 그대로다** (`ADR-014`).
- 「목표 대비 성과의 톤」을 **새 소절로** 추가한다 — 위 「목표 미달의 톤」 결정을 그대로.

### 2. `docs/PLAN.md` 37행과 `docs/PRD.md`「디자인」을 같은 결정으로 고친다

- `PLAN.md` 37행: 「**다크 + 무채색**, 시맨틱 2색(빨강=지연, 앰버=주의) | 사용자 확정 (T6에서 톤 전환)」
- `PRD.md`「디자인」의 「라이트 + 무채색」도 같게. **안티패턴 문장은 그대로 둔다.**
- `PLAN.md` 603행 근처 「시각화」 문단의 안티패턴 열거도 그대로 둔다 — 여전히 유효하다.
- **세 문서의 톤 표기가 서로 달라선 안 된다.** 고친 뒤 `grep`으로 확인하라.

### 3. `src/app/globals.css` — 토큰을 깐다

```css
@import "tailwindcss";

@theme {
  --color-canvas: #0b0d10;
  /* … 위 표 전량 … */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

html { color-scheme: dark; }

body {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}
```

세 가지를 함께 처리한다.

1. **`@media (prefers-color-scheme: dark)` 블록을 지운다.** 이 앱은 다크 단일이다.
   OS 설정에 따라 톤이 갈리면 스크린샷·리뷰·완료 기준 판정이 매번 달라진다.
2. **`color-scheme: dark`를 선언한다.** 안 하면 스크롤바·기본 폼 컨트롤만 흰색으로 남는다.
3. **`font-family: Arial`을 고친다.** 현재 `body`가 `layout.tsx`가 붙인 Geist 변수를
   덮어쓰고 있다. 숫자 정렬(`tabular-nums`)이 화면 규칙인데 폰트가 의도와 다르면 표가 흔들린다.

`--background`·`--foreground`·`@theme inline` 등 Next 보일러플레이트 잔재는 제거한다.
**단, 지우기 전에 `grep`으로 그 이름을 쓰는 곳이 없는지 확인하라.**

### 4. `src/app/layout.tsx` — 최소만 손댄다

`body`에 `bg-canvas text-ink`를 명시한다. 그 외에는 건드리지 마라 —
사이드바·상단 바를 **여기서 만들지 마라.** step 2의 범위다.

## Acceptance Criteria

```bash
# 토큰 15개가 전부 있다 (15가 나와야 함)
grep -c -- "--color-" src/app/globals.css

# 보일러플레이트 잔재가 없다 (출력이 비어야 함)
grep -n "prefers-color-scheme\|@theme inline\|Arial" src/app/globals.css ; test $? -eq 1

# 세 문서의 톤 표기가 같다 (셋 다 출력이 있어야 함)
grep -n "다크 + 무채색" docs/UI_GUIDE.md docs/PLAN.md docs/PRD.md

# 낡은 표기가 남아 있지 않다 (출력이 비어야 함)
grep -rn "라이트 + 무채색" docs/ ; test $? -eq 1

# 안티패턴 규칙이 살아 있다 (넷 다 출력이 있어야 함)
grep -n "backdrop-filter\|gradient-text\|보라/인디고\|글로우" docs/UI_GUIDE.md

# 완료 기준 10번이 그대로다 (출력이 있어야 함)
grep -n "안티패턴" docs/TICKETS.md

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `npm run dev`로 띄워 `/`와 `/upload`를 눈으로 본다.
   **이 시점에 화면은 어색하다** — 배경만 다크로 바뀌고 카드·텍스트는 아직 라이트 클래스다.
   그것이 정상이며 step 2가 고친다. 여기서 확인할 것은 **배경이 다크이고 스크롤바가
   다크이며 폰트가 Geist인가** 셋뿐이다.
3. 체크리스트:
   - `UI_GUIDE.md`의 안티패턴 표에서 **한 줄도 지워지지 않았는가?**
   - 톤이 왜 바뀌었는지가 문서에 남아 있는가? (근거 없는 변경은 되돌려진다)
   - 시맨틱이 여전히 **2색**인가? 액센트 색을 하나도 추가하지 않았는가?
   - 배지 5칸이 **명도와 형태**로 구분되는가? (색을 늘려 구분하지 않았는가)
4. `phases/t6-dashboard/index.json`의 step 0을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(확정한 토큰 이름 목록, 명도 방향이
     뒤집힌 이유 한 줄, 고친 문서 3곳)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 액센트 색(보라·인디고·파랑 등)을 추가하지 마라. 이유: 사용자가 「다크 + 무채색 유지」를
  명시적으로 골랐고, 시맨틱 2색 규율이 지연을 눈에 띄게 만드는 유일한 장치다.
- 안티패턴 표의 항목을 지우거나 완화하지 마라. 이유: T6 완료 기준 10번이 그 표를 가리킨다.
- 라이트/다크 토글을 만들지 마라. 이유: 사용자가 다크 단일을 골랐다. 토글은 모든 컴포넌트를
  토큰 경유로 두 번 검증해야 하고 T6 범위가 아니다.
- 컴포넌트·화면을 만들거나 기존 화면의 클래스를 갈아치우지 마라. 이유: step 2의 범위다.
  여기서 손대면 두 step이 같은 파일을 놓고 싸운다.
- `src/lib/`에 파일을 만들지 마라. 이유: 이 step에 계산이 없다. 색은 CSS가 진다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
