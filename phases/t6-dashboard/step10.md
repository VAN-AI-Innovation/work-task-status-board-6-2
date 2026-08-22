# Step 10: t6-audit

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` **완료 기준 14개 전문.** 이 step은 그 목록을 한 줄씩 판정한다
- `docs/UI_GUIDE.md` — 안티패턴 표 (완료 기준 10)
- `docs/PLAN.md` — 「검증 방법」의 대표·실장/팀장/부원 여정 (9~15번)
- `docs/TEAM_RULES.md` 3.4 — 공통 Definition of Done
- step 0~9의 `phases/t6-dashboard/index.json` `summary` 전량

## 배경

**이 step은 새 기능을 만들지 않는다.** T6는 항목이 가장 많은 티켓이고
(`TICKETS.md`가 「이 티켓이 가장 항목이 많다」고 적어 뒀다), step 9개를 지나오는 동안
어느 완료 기준이 실제로 검증됐는지 흩어져 있다. 여기서 **14개를 한 줄씩 실행해 판정**하고,
어긋난 것은 고치고, 문서를 실제 구현에 맞춘다.

「대충 다 됐다」로 닫지 마라. **판정은 실행 결과로만 한다.**

## 작업

### 1. 완료 기준 14개를 하나씩 실행해 판정한다

각 항목마다 **어떻게 확인했는지(커맨드 또는 URL)와 결과**를 적어라.

| # | 기준 | 확인 방법 |
|---|---|---|
| 1 | 시트 KPI 10종이 모두 대응 표시 | `/`에서 타일 10개 세기 + `page.test.ts`의 10칸 테스트 |
| 2 | 5색 구분 + Overdue 좌측 보더·배지 + 알림 4종 | `/`에서 눈 + `status-badge.test.ts` + 알림 묶음 5개 |
| 3 | 목표 대비 성과: 목표→실적→달성률 + 직전 대비 | `/` 목표 섹션 |
| 4 | 사이드 패널 슬라이딩 · Esc·오버레이 닫기 · `extras` 전량 + stage | `/teams/shoot`에서 손으로 |
| 5 | 필터 URL 유지 → 링크 복사로 재현 | 필터 걸고 URL 복사 → 새 탭 |
| 6 | `?owner=` 프리셋 · `?task=` 딥링크 | 두 URL 직접 입력 |
| 7 | `?as=admin\|lead\|member` 진입 화면이 각각 다름 | 세 URL 나란히 |
| 8 | 모든 페이지에 「마지막 반영」 · 5일 초과 시 경고색 | `/`·`/teams/*`·`/upload` 셋 다 |
| 9 | 주간 브리핑 카드 + 마크다운 복사 | 복사 → 편집기 붙여넣기 |
| 10 | **안티패턴 위반 0건** | 아래 grep |
| 11 | 1280px 완전 동작 · 1024px 레이아웃 유지 | 브라우저 폭 조절 |
| 12 | `http`·`https`만 앵커 · `rel="noopener noreferrer"` | `extras-render.test.ts` + 패널 눈 확인 |
| 13 | 민감 키가 `member`에게 마스킹 | `?as=member` vs `?as=admin` 같은 업무 |
| 14 | `app/`·`app/teams/`에 `error.tsx` · 빈 상태·에러·필터 0건 구분 | 파일 존재 + 세 화면 |

**하나라도 실패하면 이 step에서 고친다.** 고칠 수 없는 것(예: 데이터가 없어 확인 불가)은
그 사실을 `summary`에 정확히 적고, 지어내지 마라.

### 2. `docs/TICKETS.md`의 T6 완료 기준에 확인 결과를 반영한다

- 구현하면서 **표현이 달라진 것**을 문서에 반영하라. 예: 슬러그가 ASCII가 된 것,
  5색 칩이 `?display=`인 것, 「마지막 갱신 HH:mm」을 두지 않기로 한 것.
  **완료 기준의 항목 자체를 삭제하거나 완화하지 마라** — 못 지킨 것은 못 지켰다고 적는다.
- T6 「리스크·미결」에 적힌 「밀리면 7·9번을 T9로 넘긴다」가 **실제로 발생했는지**
  기록하라. 넘기지 않았으면 그 문장을 「둘 다 T6에서 구현됨」으로 갱신한다.
- `weekly-report.ts`가 남긴 **「이벤트 조회 메서드가 없어 변경 건수가 0」** 메모를
  T9 항목으로 옮겨 적었는지 확인하라 (T5가 `TICKETS.md`에 같은 메모를 남겼다).

### 3. `docs/PLAN.md`「검증 방법」의 여정 9~15번을 실제로 밟는다

`STORAGE_DRIVER=memory npm run dev`로 대표·실장(9·10) → 팀장(11·12) → 부원(13·14) 순서로
직접 클릭한다. **각 단계가 몇 번 클릭에 끝나는지 세라.** `UC-14`가 「진입 3초 내」를
요구하므로 부원 여정이 세 번 넘게 걸리면 그 사실을 기록한다.

### 4. `docs/ADR.md`에 후속 항목을 덧붙인다 — **기존 항목은 지우지 않는다**

T6에서 되돌리기 비싼 결정이 셋 나왔다. ADR로 남길 값이 있는지 판단해 필요한 것만 적어라:

- **UI 톤 다크 전환** — `PLAN.md`가 「사용자 확정」으로 적어 둔 결정이 뒤집혔다.
  안티패턴 규율은 유지했다는 사실과 함께.
- **`?display=`와 `?status=`의 분리** — 저장소 필터와 화면 필터가 다른 축이라는 결정.
- **팀 슬러그 ASCII** — 링크 공유가 이 화면의 존재 이유라는 근거.

형식은 기존 ADR과 같게 (`**결정**` / `**이유**` / `**트레이드오프**`).

### 5. `README.md`를 확인한다

T9가 README를 진다. 다만 **지금 README가 「대시보드는 준비 중」류의 거짓을 말하고 있으면**
그 문장만 고쳐라. 새로 쓰지 마라 — 범위를 넘는다.

## Acceptance Criteria

```bash
# ── 완료 기준 10: 안티패턴 0건 ────────────────────────────
# **렌더되는 코드만 본다.** 테스트 파일에는 금지어가 정당하게 들어 있다 —
# `status-badge.test.ts`가 "배지 클래스에 purple·indigo가 없다"를 검사하려면 그 단어를 써야 하고,
# `dashboard-query.test.ts`는 `?display=purple`을 「모르는 값」 예시로 쓴다.
# 그 줄들을 지워 grep을 통과시키면 **검사를 지키는 테스트를 지우는 것**이 된다.
grep -rniE "backdrop-blur|backdrop-filter|bg-gradient|gradient-to|bg-clip-text|purple|violet|indigo|fuchsia|blur-3xl|drop-shadow|hover:scale|animate-pulse|animate-spin|animate-bounce|animate-ping" src/app src/components | grep -v "\.test\." ; test $? -eq 1

# 색이 토큰에서만 온다 (출력이 비어야 함)
# `globals.css`는 제외한다 — 토큰 원본이 사는 **유일한** 자리이고, hex가 거기 있는 것이 정상이다.
# 차트 계열색은 `src/lib/view/chart-series.ts`에 있어야 하며 컴포넌트에는 없어야 한다.
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]|#[0-9a-fA-F]{6}" src/app src/components --include="*.tsx" --include="*.ts" | grep -v "\.test\." ; test $? -eq 1

# ── 완료 기준 14: 에러 바운더리 둘 ────────────────────────
ls src/app/error.tsx src/app/teams/error.tsx

# 에러 화면이 예외 문자열을 렌더하지 않는다 (출력이 비어야 함)
grep -rnE "error\.(message|stack|digest)" src/app/error.tsx src/app/teams/error.tsx ; test $? -eq 1

# ── 보안: raw 유출 없음 ───────────────────────────────────
grep -rn "\.raw" src/components/ src/app/page.tsx ; test $? -eq 1

# ── 아키텍처 경계 ────────────────────────────────────────
# 화면이 자기 API를 fetch하지 않는다 (출력이 비어야 함)
grep -rn "fetch('/api\|fetch(\`/api\|fetch(\"/api" src/app/page.tsx "src/app/teams/[teamSlug]/page.tsx" ; test $? -eq 1
# 화면 계산이 lib/view에 있다 (10개 안팎이어야 함)
ls src/lib/view/*.ts | grep -v test | wc -l
# view가 시각·환경·저장소를 모른다 (출력이 비어야 함)
grep -rn "Date.now()\|new Date()\|process.env\|@/lib/store" src/lib/view/ ; test $? -eq 1
# exceljs가 두 파일에만 있다 (2가 나와야 함)
grep -rl "exceljs" src/ | wc -l

# ── 파일명 전역 유니크 (CLAUDE.md CRITICAL) ───────────────
# 아래 두 숫자가 같아야 한다
find src/lib -name "*.ts" ! -name "*.test.ts" -exec basename {} \; | sort | wc -l
find src/lib -name "*.ts" ! -name "*.test.ts" -exec basename {} \; | sort -u | wc -l

# ── 게이트 ───────────────────────────────────────────────
npm run lint && npm run build && npm run test

# 테스트 개수 (T5 종료 시점 520개보다 늘어야 한다)
npx vitest run 2>&1 | tail -5
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다. **`#[0-9a-fA-F]{6}` grep이 걸리면** 화면 코드에 hex가
   박혀 있다는 뜻이다 — 차트 계열색은 `src/lib/view/chart-series.ts`에 있어야 하고
   `src/components/`·`src/app/`에는 없어야 한다.
2. 완료 기준 14개 표를 **한 줄씩 채운다.** 각 줄에 「확인 방법 · 결과(통과/실패) · 근거」.
3. 실패한 항목을 고친다. 고친 뒤 **AC를 처음부터 다시 돌린다.**
4. `PLAN.md`「검증 방법」 여정 9~15를 직접 밟고 클릭 수를 기록한다.
5. 1280px과 1024px에서 `/`·`/teams/edit`·`/teams/shoot`·`/upload` 네 화면을 본다.
   **1024px에서 페이지가 가로 스크롤되면 실패다** (표 자체의 스크롤은 허용).
6. `phases/t6-dashboard/index.json`의 step 10을 갱신한다:
   - `"summary"`에 **14개 완료 기준의 통과/실패를 번호로** 남겨라
     (예: `1~9·11~14 통과, 10 통과(grep 0건)`). 실패가 있으면 무엇이 왜 실패했는지.
   - 고친 문서 목록과 새로 적은 ADR 번호.
   - 최종 테스트 개수.

## 금지사항

- 완료 기준을 삭제하거나 완화해 통과시키지 마라. 이유: 그것은 판정이 아니라 조작이다.
  못 지킨 것은 못 지켰다고 적는다 — T8·T9가 그 기록 위에서 움직인다.
- 새 기능을 만들지 마라. 이유: 이 step은 감사다. 기준을 채우기 위한 최소 수정만 한다.
- 안티패턴 grep을 피하려고 클래스 이름을 문자열 결합으로 숨기지 마라
  (`'bg-' + 'purple-500'`). 이유: 검사를 속이는 코드는 검사가 없는 것보다 나쁘다.
- README를 새로 쓰지 마라. 이유: T9의 범위다. 거짓 문장만 고친다.
- 기존 ADR 항목을 지우거나 고치지 마라. 이유: 결정 이력이고, 후속 항목을 덧붙이는 것이 규칙이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
