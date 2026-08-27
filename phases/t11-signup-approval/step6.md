# Step 6: team-requests-tab

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — 화면 규칙 전문
- `src/components/shell/app-sidebar.tsx` — `ITEMS` 배열이 좌측 네비를 만든다
- `src/lib/view/team-slug.ts` — `TEAM_LABELS` · `teamLabel()` · `toTeamSlug()`
- `src/lib/view/role-label.ts` — 역할 한글 표
- `src/app/teams/[teamSlug]/page.tsx` — 서버 컴포넌트가 데이터를 얻는 방식의 본보기
- `src/components/tasks/` 아래 목록 컴포넌트 — 표의 마크업·클래스 본보기
- `src/app/api/team/requests/` (step 5) — 이 화면이 부르는 API 3개

step 5가 만든 것: `GET /api/team/requests`(목록) ·
`POST /api/team/requests/approve` · `POST /api/team/requests/reject`.
승인·거절 응답은 **갱신된 목록을 다시 싣는다.**

## 작업

### 1. 화면 — `src/app/team/requests/page.tsx`

**서버 컴포넌트다. 자기 API 라우트를 fetch하지 마라** (CLAUDE.md CRITICAL). 목록은
`src/lib/store/viewer-storage.ts`의 사용자 JWT 클라이언트로 `rpc('pending_requests')`를
직접 부른다. step 5의 라우트는 **승인 후 다시 그리기**를 위한 것이지 최초 렌더용이 아니다.

`admin`·`lead`가 아니면 이 화면에 오지 못하게 한다. 판정을 화면에 적지 말고
`src/lib/domain/`의 순수 함수로 둔다:

```ts
export function canReviewJoinRequests(role: ViewerRole): boolean
```

`lib/domain/`인 이유: **누가 무엇을 할 수 있는가는 판정**이고, 판정은 도메인이다
(`viewer-scope.ts`가 같은 자리에 있다). 파일명은 전역 유니크해야 한다 — `src/lib/` 아래를
먼저 훑어 충돌이 없는 이름을 고르라.

권한이 없으면 404를 낸다(`notFound()`). **403 화면을 그리지 마라** — 「이 화면은 있지만
당신은 못 본다」가 곧 「팀장 전용 기능이 존재한다」는 정보다. 없는 것처럼 보이는 편이 좁다.

### 2. 목록 컴포넌트 — `src/components/team/`

`components/`는 **props 받아 JSX만 뱉는다.** 계산·fetch를 넣지 마라.

한 줄에 들어갈 것:

```
{display_name}  {email}                 {팀 이름}   {요청 시각}
시트 담당자 연결: [ <select> ]  [승인]  [거절]
```

`<select>`의 후보는 **그 요청자의 팀에 속한 `members` 행 중 `auth_user_id`가 비어 있는
것**이다. `members`는 로그인한 전원이 select할 수 있으므로(`members_select_authenticated`)
서버 컴포넌트가 읽어 props로 내려보낸다. 마지막 항목으로 「+ 새로 만들기」를 둔다 —
고르면 이름 입력칸이 열리고, 제출 시 `newMemberName`으로 간다.

**이미 다른 계정에 붙은 `members` 행을 후보에 넣지 마라.** 이유: 고를 수 있게 해 두면
리더가 눌러 보고 나서야 실패를 안다. DB 함수도 거부하지만, 애초에 보이지 않는 편이 낫다.

`거절` 버튼은 **JS `confirm()`을 쓰지 마라.** 이유: 이 프로젝트의 화면은 JS 없이도 도는
평범한 폼이고, `confirm`은 그 성질을 깬다. 되돌릴 수 있는 동작이므로(거절해도 계정은
살아 있고 재요청이 된다) 확인 단계 없이 바로 보낸다.

### 3. 네비게이션

`app-sidebar.tsx`의 `ITEMS`에 「팀원 요청」을 더한다. **역할에 따라 항목을 감춘다.**
`ITEMS`가 지금 상수 배열이므로, 역할을 받아 배열을 돌려주는 함수로 바꾸는 것이 최소
변경인지 코드를 읽고 판단하라.

⚠ **감추는 것은 권한이 아니다.** 서버가 이미 404로 막고 있고(1번), 사이드바는 편의일
뿐이다. 이 순서를 뒤집어 「사이드바에서 뺐으니 됐다」고 하지 마라 —
`role-layout.ts`의 머리말이 같은 사고를 기록하고 있다.

대기 건수를 배지로 띄우고 싶다면 **서버가 세어 내려보낸다.** 화면이 배열 길이를 세는 것은
괜찮지만, 그 배열이 화면에서 필터링된 것이면 안 된다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/domain/  # canReviewJoinRequests 테스트 포함

# 서버 컴포넌트가 자기 API를 fetch하지 않는지 (결과가 비어 있어야 한다)
grep -rn "fetch(" src/app/team/requests/page.tsx

# 컴포넌트에 계산이 들어가지 않았는지 — rpc·store 호출이 없어야 한다
grep -rn "rpc(\|getStorage\|createClient" src/components/team/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `member` 역할로 `/team/requests`에 접근하면 404인지 테스트가 있는지 확인한다.
3. `<select>` 후보에서 **이미 연결된 `members` 행이 빠지는지** 확인한다.
4. 아키텍처 체크리스트:
   - 컴포넌트가 `src/components/`에 있고 props 받아 JSX만 뱉는가?
   - 서버 컴포넌트가 자기 API 라우트를 fetch하지 않는가?
   - 판정이 `src/lib/domain/`의 순수 함수인가?
   - `src/lib/` 아래 파일명이 전역 유니크한가?
5. `phases/t11-signup-approval/index.json`의 step 6을 업데이트한다.
   `summary`에 화면 경로와 `canReviewJoinRequests`가 놓인 파일 경로를 적는다.

## 금지사항

- **서버 컴포넌트가 자기 API 라우트를 fetch하지 마라.** 이유: CLAUDE.md CRITICAL이다.
- **403 화면을 그리지 마라. 404를 내라.** 이유: 1번 절에 근거가 있다.
- **사이드바에서 감추는 것으로 권한을 대신하지 마라.** 이유: 3번 절에 근거가 있다.
- **`components/`에 fetch·rpc·계산을 넣지 마라.** 이유: 컴포넌트는 props 받아 JSX만 뱉는다.
- **어드민 멤버 탭을 만들지 마라.** 이유: step 7·8이 한다.
- 기존 테스트를 깨뜨리지 마라
