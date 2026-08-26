# Step 11: role-gating-ui

## 읽어야 할 파일

- `CLAUDE.md` — **컴포넌트는 props를 받아 JSX만 뱉는다** · 로직은 `src/lib/` · 서버 컴포넌트는
  자기 API를 fetch하지 않는다
- `docs/UI_GUIDE.md` — **전체.** 팔레트 토큰·안티패턴 표·빈 상태 문구 규칙
- `docs/TICKETS.md` — T8 완료 기준 **1**(세 역할로 로그인해 각각 다른 범위가 보인다) ·
  `UC-16`
- `docs/ADR.md` — `ADR-013`(`?as=`는 데모 기능) · `ADR-019`(대시보드 배치) ·
  `ADR-020`(브랜드 색은 구조와 조작에만) · step 0의 `ADR-026`
- `docs/PLAN.md` — step 0의 **결정 D**(`unknown_owner`) · **결정 E**, step 8이 적은
  「데모 모드에서는 범위가 갈리지 않는다」
- 고쳐야 할 화면 코드:
  - `src/components/shell/page-shell.tsx` · `app-topbar.tsx` · `role-switch.tsx`
  - `src/components/tasks/empty-state.tsx`
  - `src/components/tasks/task-panel.tsx` (+ `task-panel-slot.tsx`)
  - 페이지 4종 (`app/page.tsx` · `teams/[teamSlug]` · `upload` · `extract`)
- 이전 step 산출물: `ReadContext.viewer`(8) · `PATCH /api/tasks/[id]`(9) ·
  `POST /api/auth/logout`(10)

## 배경

서버는 이미 막고 있다. 화면이 할 일은 **막는 것이 아니라 사실을 말하는 것**이다.

지금 상단 바는 `?as=` 역할 전환 링크 셋을 보여 준다. 로그인한 사람에게 그 링크는 **거짓말**이다 —
눌러도 역할이 바뀌지 않는다(`ADR-026`). 그리고 `member`로 로그인한 사람이 빈 표를 봤을 때,
그것이 「내 업무가 없다」인지 「계정이 담당자에 연결되지 않았다」인지 지금 화면은 답하지 못한다
(결정 D).

이 step은 그 둘을 고치고, `UC-16`의 **수정 UI**를 만든다 — 서버에 `PATCH`가 있는데 부르는
화면이 없으면 그 기능은 없는 것과 같다.

## 작업

### 1. 상단 바 — 누구로 보고 있는지 말한다

`PageShell`이 `session`(또는 `viewer`·`email`)을 받아 `AppTopbar`에 내린다.
**판정을 컴포넌트에서 하지 마라** — 페이지가 `read.viewer`/`view.session`을 그대로 넘긴다.

| 상태 | 상단 바 |
|---|---|
| 로그인함 | `이메일` + 역할 라벨(`대표·실장`/`팀장`/`부원`) + **[로그아웃]**. `RoleSwitch` **숨김** |
| 데모·폴백 (세션 없음) | 지금 그대로 `RoleSwitch` 표시 + 「데모」임을 알 수 있는 한 마디 |

- 로그아웃은 `<form method="post" action="/api/auth/logout">` 안의 버튼이다
  (링크로 만들면 프리페치 한 번에 로그아웃된다).
- 역할 라벨 문자열은 `role-switch.tsx`의 `ROLES` 표에 이미 있다. **두 벌로 적지 마라** —
  한쪽에서 export해 쓰거나 `lib/view`로 옮긴다(옮기면 `role-switch`도 그것을 쓴다).
- 이메일을 그대로 다 그리면 길다. 잘라 보일 때 **`title` 속성에 전체를 넣지 마라**
  (툴팁으로도 화면 캡처에 남는다). 폭은 CSS로 다루고 값은 자르지 않는다.

### 2. 빈 상태 — 왜 비었는지 구분한다 (`X3`의 넷을 다섯으로 늘리지 않는다)

`empty-state.tsx`는 이미 「데이터 없음」과 「필터 결과 0건」을 구분한다. 여기에 **`member`이고
`viewer.memberId === null`인 갈래** 하나를 더한다:

> 「담당자로 연결된 계정이 없어 표시할 업무가 없습니다. 시트의 담당자 이름과 계정 연결이
> 필요합니다.」

- 판정은 컴포넌트가 하지 않는다. 페이지가 `read.viewer`를 보고 어느 문구인지 **골라** 넘긴다.
  고르는 규칙이 두 줄을 넘으면 `src/lib/view/empty-reason.ts`(+테스트)로 뺀다.
- `admin`·`lead`에게는 이 문구를 보이지 마라. 그들에게 빈 표는 다른 뜻이다.

### 3. `UC-16` — 사이드 패널의 수정 컨트롤

`task-panel.tsx`에 **작은 폼 하나**를 더한다. 상태 `select` + 진행률 `number` + `[저장]`.

- **보이는 조건**: `canEdit === true`. 그 값은 **페이지/슬롯이 계산해 props로 내린다** —
  `taskInScope(task, viewer)`(step 1)를 부른 결과다. 패널이 역할을 다시 해석하지 않는다.
- **UI 숨김은 방어가 아니다.** 숨기는 이유는 「할 수 없는 조작을 보이지 않게」일 뿐이고,
  실제 거부는 서버가 한다(step 9). 이 문장을 컴포넌트 주석에 남긴다.
- 저장은 `fetch('/api/tasks/<id>', { method:'PATCH', … })`. 성공하면 `router.refresh()`.
  실패하면 서버가 준 `message`를 그대로 한 줄로 보인다 (문구를 화면이 지어내지 않는다).
- 상태 목록은 **`STATUS_SEMANTIC_MAP`의 키**를 쓴다. 문자열을 컴포넌트에 다시 적지 마라
  (`ADR-009` — 가운뎃점 하나만 달라져도 미매핑된다). 서버 컴포넌트가 목록을 props로 내린다.
- 진행률은 `0~100` 정수. `''`(빈 값)은 보내지 않는다 — 「지운다」(`null`)와 「안 바꾼다」를
  버튼 하나로 뭉개지 마라. 지우는 기능은 만들지 않는다.
- 낙관적 업데이트를 하지 마라. 서버 응답을 받고 갱신한다.

### 4. 사이드바

`app-sidebar.tsx`의 항목을 역할로 **숨기지 마라.** `role-layout.ts`의 머리말이 그 이유를 이미
적고 있다(순서만 바꾸고 삭제하지 않는다). 업로드 화면은 `member`에게도 보이고, 올리면
서버가 판단한다. 지금 업로드는 역할로 막고 있지 않으므로 **이 step에서 새로 막지도 마라** —
막으려면 티켓·문서가 먼저다.

### 5. 문서

- `docs/UI_GUIDE.md`에 「로그인 상태 표시」 규칙 한 절: 상단 바에 무엇이 나오는가,
  로그인 시 `RoleSwitch`가 사라지는 이유(`ADR-026`), 빈 상태 다섯 갈래 중 새 것 하나.
- `README.md`「화면」 절에 `/login`과 계정 3개(값 말고 **이름만**)를 한 줄 추가한다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -rn "'admin'\|'lead'\|'member'" src/components/ | grep -v 'ViewerRole\|type'
#   → 역할 문자열을 컴포넌트가 판정에 쓰고 있지 않은지 눈으로 확인 (표시 라벨 표는 예외)
grep -rn 'taskInScope\|canEditTask' src/components/    # 0줄 (판정은 서버가 해서 props로 온다)
grep -rn 'STATUS_SEMANTIC_MAP' src/components/tasks/task-panel.tsx   # 0줄 (props로 받는다)
grep -rn 'blur-\|bg-gradient\|from-purple\|from-indigo\|animate-pulse' src/components/  # 0줄
```

**세 역할로 실제 로그인해 확인한다** (`npm run dev` + step 5의 계정). 각각에 대해:

| 계정 | 확인 |
|---|---|
| `admin` | 업무 표 건수 = 전사 건수. 상단 바에 이메일·「대표·실장」·[로그아웃]. `RoleSwitch` 없음 |
| `lead` | `edit` 팀 건수만. `admin`보다 적다 |
| `member` | 본인 담당 건만. `lead`보다 적고 **1건 이상** |
| `member` | 자기 건 패널에 수정 폼이 **있고**, 상태를 바꾸면 200 + 화면에 반영된다 |
| `admin` | 남의 건 패널에도 수정 폼이 있다 (범위가 전사다) |
| `member` | `?as=admin`을 붙여도 **건수가 그대로다** (완료 기준 6의 화면 쪽) |

그리고 데모 모드(`STORAGE_DRIVER=memory npm run dev`)에서:
- 리다이렉트 없이 대시보드가 뜬다
- `RoleSwitch`가 보이고 `?as=`가 여전히 배치를 바꾼다
- 수정 폼은 **보이지 않는다** (세션이 없으므로 `canEdit`이 false다)

1280px·1024px 둘 다에서 가로 스크롤 0px, 콘솔 에러 0건.

## 검증 절차

1. 위 AC와 로그인 확인 표를 전부 실행하고 **건수를 숫자로** 기록한다.
   세 숫자가 서로 다른지가 완료 기준 1의 증명이다.
2. 변이 확인 둘 (통과 후 되돌린다):
   - `canEdit`을 항상 `true`로 만든다 → 화면엔 폼이 뜨지만 **서버가 403을 낸다**.
     그 사실을 확인해 「UI 숨김은 방어가 아니다」를 실증하고 `summary`에 남긴다
   - 로그인 상태에서 `RoleSwitch`를 다시 보이게 한다 → 눌러도 역할이 안 바뀌는 것을 확인
     (그래서 숨긴다)
3. 체크리스트:
   - 컴포넌트가 역할로 **판정**하지 않고 props를 받기만 하는가?
   - 상태 문자열·역할 라벨이 두 벌이 되지 않았는가?
   - 데모 모드가 죽지 않았는가?
   - 이메일이 툴팁·`title`·`data-*`로 새지 않는가?
4. `phases/t8-auth-rls/index.json`의 step 11을 갱신한다.

## 금지사항

- 화면에서 「막았다」고 표시하기 위해 섹션을 **삭제하지 마라.** `role-layout.ts`의 순서 표는
  그대로다 — 범위 축소는 이미 데이터에서 일어났고, 여기서 또 지우면 두 규칙이 된다.
- 새 색·새 컴포넌트 라이브러리·아이콘 세트를 들이지 마라.
- 클라이언트에서 Supabase를 직접 부르지 마라 (`createBrowserClient` 금지). 수정은
  우리 라우트를 거친다.
- `?as=`를 로그인 상태에서도 동작하게 만들지 마라.
- 수정 가능 필드를 늘리지 마라 (`status`·`progress` 둘).
- 업로드·추출 화면의 기존 동작을 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라.
