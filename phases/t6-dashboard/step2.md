# Step 2: app-shell

## 읽어야 할 파일

- `docs/UI_GUIDE.md` — step 0이 다시 쓴 **전문.** 특히 토큰 클래스·「레이아웃」의 앱 셸 규격
- `docs/TICKETS.md` — `## T6` 완료 기준 **8**(「마지막 반영」 상시 표시)·**11**(1280/1024)
- `docs/ADR.md` — `ADR-001`(마지막 반영을 드러내는 것이 이 시스템의 약점 대응)·`ADR-014`
- `src/app/layout.tsx` · `src/app/page.tsx` · `src/app/error.tsx` · `src/app/upload/page.tsx`
- `src/components/upload/` 5개 — 라이트 클래스를 쓰고 있다
- step 1 산출물: `src/lib/view/dashboard-query.ts`(`buildHref`·`parseDashboardQuery`)

## 배경

사용자가 참고 이미지에서 가져오기로 한 것은 **구조**다 — 좌측 고정 사이드바, 상단 바,
그 아래 본문. 색은 무채색 다크를 유지한다 (step 0 결정).

셸을 먼저 짓는 이유는 순서 때문이다. KPI·차트·표를 먼저 만들면 그것들을 담을 틀이 없어
페이지마다 헤더를 복사하게 되고, **「마지막 반영」이 어느 페이지엔 있고 어느 페이지엔
없는 상태**가 된다. 완료 기준 8은 *모든* 페이지를 요구한다.

이 step은 동시에 **기존 화면 3개를 다크로 옮긴다.** step 0이 배경만 뒤집어 놔서 지금
`/`와 `/upload`는 다크 배경 위에 흰 카드가 떠 있다. 다음 step들이 그 위에 쌓이기 전에
정리한다 — 뒤로 미루면 새 컴포넌트가 옆의 라이트 클래스를 보고 따라 한다.

## 확정

### 셸 규격

```
┌────────┬────────────────────────────────────────────┐
│ 로고    │ [검색                    ]  마지막 반영  역할 │  h-14 · bg-panel · border-b border-line
│ 현황판  ├────────────────────────────────────────────┤
│        │                                            │
│ 대시보드 │  {children}   max-w-[1280px] mx-auto px-6   │
│ 팀별    │                                            │
│ 업로드  │                                            │
└────────┴────────────────────────────────────────────┘
 w-[220px] (lg 미만 w-14, 라벨 숨김) · bg-panel · border-r border-line
```

- 사이드바 항목 4개: **대시보드(`/`) · 편집팀 · 촬영·기획팀 · 마케팅·관리팀** 은 step 6에서
  링크가 생긴다. **이 step에서는 「대시보드」와 「시트 업로드」 둘만** 넣는다.
  없는 라우트로 가는 링크를 미리 만들면 404가 화면에 남는다.
- 활성 항목 `bg-raise text-ink`, 비활성 `text-ink-muted hover:text-ink`.
  현재 경로 판정은 **클라이언트에서 `usePathname()`** 으로 한다.
- 상단 바의 검색 입력은 `?search=`에 묶인다. 제출 시 `buildHref(pathname, query, { search })`.
  **입력마다 라우팅하지 마라** — form submit(Enter)에서만 이동한다. 타이핑마다 서버
  컴포넌트를 다시 그리면 글자를 놓친다.
- 역할 표시는 `?as=`의 현재 값과 **세 역할 전환 링크**다. 링크는 `buildHref`로 만들어
  **다른 필터를 유지**한다. 실제 역할별 화면 차이는 step 9가 만든다.
- 아이콘은 **SVG 인라인, `strokeWidth 1.5`, 16px, 컨테이너 없이** (`UI_GUIDE.md`).
  아이콘 라이브러리를 설치하지 마라.

### 「마지막 반영」

모든 페이지 상단 바 우측에 **상시** 표시된다 (`ADR-001` — 이 시스템의 약점을 감추지 않고
드러낸다). 5일 초과면 `text-warn` + 앰버 점.

## 작업

### 1. `src/lib/view/sync-freshness.ts` — 테스트를 **먼저** 쓴다

```ts
export const STALE_DAYS = 5;

export interface SyncFreshness {
  /** 마지막 반영으로부터 지난 일수. 기록이 없으면 null */
  days: number | null;
  /** 「마지막 반영: 3일 전」 · 「마지막 반영: 오늘」 · 「마지막 반영: 기록 없음」 */
  label: string;
  /** `days > STALE_DAYS`. 기록이 없으면 **true** */
  stale: boolean;
}

/** `today`는 KST 기준 `YYYY-MM-DD`. **현재 시각을 스스로 읽지 않는다** */
export function describeSync(lastSyncedAt: string | null, today: string): SyncFreshness;
```

- `lastSyncedAt`은 ISO 타임스탬프다. `kstDateOf`로 날짜를 뽑고 `daysBetween`으로 잰다.
  **직접 `Date` 뺄셈을 하지 마라** — KST에서 하루가 어긋난다 (`E4`).
- **기록이 없으면 `stale: true`다.** 「모른다」를 「괜찮다」로 표시하면 안 된다.
  한 번도 업로드가 없었다는 사실이 바로 경고할 일이다.
- 미래 타임스탬프(음수 일수)는 `days: 0`·「오늘」로 접는다. 시계 어긋남으로 「-2일 전」이
  화면에 뜨면 사용자가 데이터를 의심한다.

테스트: 오늘/1일 전/5일 전(경계 — 아직 정상)/6일 전(경고)/기록 없음/미래/파싱 불가 문자열.

### 2. `src/components/shell/` — 셸 컴포넌트

- `app-sidebar.tsx` — `'use client'` (현재 경로 판정). props: 없음
- `app-topbar.tsx` — `'use client'` (검색 폼). props:
  `{ freshness: SyncFreshness; role: ViewerRole; query: DashboardQuery; pathname은 훅으로 }`
- `search-box.tsx` · `role-switch.tsx` · `sync-badge.tsx` — 잘게 나눈다.
  `sync-badge.tsx`는 **서버에서도 쓸 수 있게 `'use client'`를 붙이지 마라** (순수 표시).

**컴포넌트는 계산하지 않는다.** `describeSync`의 결과를 받아 그리기만 한다 (`CLAUDE.md`).

### 3. `src/app/layout.tsx` — 셸을 끼운다

```tsx
<body className="min-h-full bg-canvas text-ink">
  <div className="flex min-h-screen">
    <AppSidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      {/* 상단 바는 페이지가 데이터를 알아야 해서 각 페이지가 그린다 — 아래 참고 */}
      {children}
    </div>
  </div>
</body>
```

**상단 바를 `layout.tsx`에서 그리지 마라.** 「마지막 반영」과 역할은 저장소를 읽어야 하고,
루트 레이아웃에서 `getStorage()`를 부르면 모든 페이지가 그 비용을 지며 `/upload`처럼
필요 없는 화면도 목록을 읽는다. **각 페이지가 `<AppTopbar>`를 그린다.** 대신
**모든 페이지가 그리는지**를 step 10 감사에서 확인한다.

그 대신 layout이 지는 것 하나: `PageShell`이라는 얇은 래퍼를 `src/components/shell/`에 두고
(`<main className="flex-1"><StorageBanner/><AppTopbar .../><div className="mx-auto max-w-[1280px] px-6 py-6">{children}</div></main>`)
페이지들이 그것 하나만 부르게 한다. 배너·상단 바·본문 폭이 한 곳에서 정해진다.

### 4. 기존 화면 3개를 토큰으로 옮긴다 — **외과적으로**

`src/app/page.tsx` · `src/app/error.tsx` · `src/app/upload/page.tsx` ·
`src/components/upload/` 5개.

- **바꾸는 것은 색 클래스와 `PageShell` 도입뿐이다.** 문구·구조·로직을 손대지 마라.
  `page.tsx`의 빈 상태 분기와 「준비 중」 카드는 step 3이 대시보드로 교체한다.
- 매핑: `bg-neutral-50`→`bg-canvas`, `bg-white`→`bg-panel`, `bg-neutral-100`→`bg-raise`,
  `border-neutral-200/300`→`border-line`, `text-neutral-900`→`text-ink`,
  `text-neutral-700`→`text-ink-body`, `text-neutral-500`→`text-ink-muted`,
  `text-neutral-400`→`text-ink-faint`, `amber-*`→`warn-*`, `red-*`→`late-*`,
  `bg-neutral-900 text-white`(버튼)→`bg-ink text-canvas`.
- `src/app/page.tsx`의 「마지막 반영」 계산은 **`describeSync`로 교체**한다. 지금 그 화면이
  `STALE_DAYS`를 자기 파일에 갖고 있는데, 두 곳에 있으면 갈라진다.
- **`src/app/page.test.ts`를 깨뜨리지 마라.** 이 step에서 그 테스트는 그대로 통과해야 한다
  (문구를 바꾸지 않으므로 통과한다). 페이지가 `searchParams`를 받게 만들지도 마라 —
  step 3의 일이다.

## Acceptance Criteria

```bash
npx vitest run src/lib/view

# 라이트 팔레트 클래스가 화면에서 사라졌다 (출력이 비어야 함)
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]" src/app src/components ; test $? -eq 1

# 안티패턴 0건 (출력이 비어야 함) — 완료 기준 10
grep -rniE "backdrop-blur|backdrop-filter|bg-gradient|gradient-to|bg-clip-text|purple|violet|indigo|fuchsia|blur-3xl|drop-shadow|hover:scale" src/app src/components ; test $? -eq 1

# 셸이 있다 (넷 다 출력이 있어야 함)
ls src/components/shell/app-sidebar.tsx src/components/shell/app-topbar.tsx src/components/shell/page-shell.tsx src/lib/view/sync-freshness.ts

# 셸을 쓰는 페이지가 둘 이상 (2 이상이어야 함)
grep -rl "PageShell" src/app | wc -l

# 루트 레이아웃이 저장소를 읽지 않는다 (출력이 비어야 함)
grep -n "getStorage" src/app/layout.tsx ; test $? -eq 1

# 마지막 반영 상한이 한 곳에만 있다 (1이 나와야 함)
grep -rn "STALE_DAYS" src/ | grep -v test | wc -l

# 회귀 — 기존 화면 테스트가 그대로 통과한다
npx vitest run src/app

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `npm run dev`로 띄워 **1280px과 1024px에서** `/`와 `/upload`를 본다:
   - 사이드바가 왼쪽에 고정되고 본문이 가로 스크롤 없이 들어가는가?
   - 1024px에서 사이드바가 아이콘만 남고 레이아웃이 유지되는가?
   - 「마지막 반영」이 **두 화면 모두**에 있는가? (완료 기준 8)
   - 흰 카드·회색 라이트 텍스트가 하나도 남지 않았는가?
3. 체크리스트:
   - `describeSync`가 현재 시각을 스스로 읽지 않는가?
   - 기록이 없을 때 경고색인가?
   - 검색 입력이 **Enter에서만** 이동하는가?
   - 역할 전환 링크가 **다른 필터를 유지**하는가? (`buildHref`를 썼는가)
   - 없는 라우트로 가는 링크를 만들지 않았는가?
4. `phases/t6-dashboard/index.json`의 step 2를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 셸 컴포넌트 이름, 마이그레이션한 파일 수, `STALE_DAYS`를 한 곳으로
   모았다는 사실을 남겨라.

## 금지사항

- 루트 레이아웃에서 `getStorage()`를 부르지 마라. 이유: 저장소를 볼 필요 없는 화면까지
  전량 조회 비용을 진다.
- 아이콘 라이브러리를 설치하지 마라. 이유: 이 step은 새 의존성 0개다. 아이콘 4개는
  인라인 SVG로 충분하고, `ADR-003`의 「교체 비용을 묶는다」가 흐려진다.
- KPI·차트·표·필터 바를 만들지 마라. 이유: step 3~5의 범위다.
- 팀별 라우트 링크를 만들지 마라. 이유: 그 라우트는 step 6에서 생긴다. 404가 남는다.
- 기존 화면의 문구·로직을 바꾸지 마라. 이유: 이 step은 색과 틀만 옮긴다. 문구를 건드리면
  `page.test.ts`가 깨지고, 그 테스트가 `X3` 갈래 구분의 유일한 증거다.
- 사이드바를 열고 닫는 토글·애니메이션을 만들지 마라. 이유: `UI_GUIDE.md`가 허용한
  애니메이션은 사이드 패널 슬라이딩과 스켈레톤 페이드 둘뿐이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
