# Step 1: session-status

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 「권한 (T8)」의 「세션 → 열람자」
- `/docs/ADR.md` — ADR-013 · ADR-026
- `src/lib/auth/viewer-session.ts` — **이 step이 고치는 본체.** 머리말 주석을 반드시 읽어라
- `src/lib/auth/viewer-session.test.ts` — 가짜 클라이언트의 모양을 그대로 따라 쓴다
- `src/types/auth.ts`
- `src/lib/api/viewer-role.ts` — `SessionOutcome`을 소비하는 쪽
- `src/lib/api/read-context.ts`
- `supabase/migrations/0005_signup_approval.sql` — step 0의 산출물. `profiles.status`와
  `display_name`이 여기서 생겼다

step 0이 만든 것: `profiles`에 `status text not null check (status in
('pending','active','rejected'))`와 `display_name text`가 추가됐고, 권한 판정 함수
셋(`my_role`·`my_team`·`my_member_id`)이 `status='active'`가 아니면 `null`을 돌려준다.

## 작업

**TDD다. 테스트를 먼저 쓰고, 통과하는 구현을 쓴다.**

### 1. `SessionOutcome`에 두 상태를 더한다

`src/lib/auth/viewer-session.ts`의 `SessionOutcome` 유니온에 추가한다:

```
| { status: 'pending';  userId: string; email: string; teamId: TeamKey | null; displayName: string | null }
| { status: 'rejected'; userId: string; email: string; teamId: TeamKey | null; displayName: string | null }
```

`teamId`를 싣는 이유: 대기 화면이 「마케팅·관리팀 합류를 요청했습니다」라고 말해야 한다.
`displayName`을 싣는 이유: 같은 화면이 이름을 부른다. 둘 다 `profiles`에서 이미 읽는
쿼리에 컬럼만 더하면 된다 — 왕복을 늘리지 마라.

`no_profile`은 **그대로 둔다.** 「프로필 행이 없다」와 「행은 있는데 대기 중이다」는 다른
사고이고 화면이 할 말도 다르다.

### 2. `resolveSession`이 `status`를 읽고 갈래를 나눈다

`profiles` 조회의 `select`에 `status, display_name`을 더한다. 판정 순서:

```
role이 알 수 없는 값        → no_profile   (기존 규칙 그대로)
status === 'pending'       → pending
status === 'rejected'      → rejected
status === 'active'        → ok  (기존 경로. members 조회로 memberId까지 채운다)
그 밖의 알 수 없는 status   → pending
```

**알 수 없는 `status`를 `ok`로 흘려보내지 마라. 이유: 나중에 `'suspended'` 같은 값을
더했을 때 이 파일을 고치지 않으면 정지된 계정이 그대로 통과한다.** 모르는 값은 가장
좁은 쪽(`pending`)으로 접는다. 같은 이유로 `toRole`이 이미 모르는 역할을 `no_profile`로
접고 있다 — 그 판단을 그대로 따른다.

`pending`·`rejected`일 때 **`members` 조회를 하지 마라.** 이유: 승인 전에는 붙은 구성원이
없고, 왕복 한 번이 순수하게 낭비다.

**던지지 않는다**는 기존 규칙을 유지한다. 어떤 실패도 `anonymous`나 `no_profile`로 접는다.

### 3. `toAccount`가 새 갈래를 처리한다

`SessionAccount`는 상단 바가 그리는 값이다. `pending`·`rejected`도 **계정이다** —
로그인은 됐으므로 로그아웃 버튼이 필요하다. `role: null`로 돌려준다 (`no_profile`과 같은
모양). `switch`가 새 갈래를 빠뜨리면 TypeScript가 잡도록 `default` 절을 넣지 마라.

### 4. `resolveViewerRole`은 고치지 않는다 — 단 테스트를 더한다

`src/lib/api/viewer-role.ts`의 첫 줄은 `if (session.status === 'ok')`이므로 `pending`·
`rejected`는 자동으로 그다음 규칙으로 내려가고, 프로덕션+실저장소에서는 `member`가 된다.
**그 동작이 맞다** — DB의 `my_role()`이 `null`이라 실제로는 한 행도 내려오지 않는다.

`src/lib/api/viewer-role.test.ts`에 이 사실을 **못박는 테스트**를 더한다: `pending` 세션 +
프로덕션 + supabase 모드에서 결과가 `'member'`이고, `?as=admin`이 그것을 못 바꾼다.
이유: 나중에 누군가 「pending이면 세션이 있으니 세션 role을 쓰자」고 고치면 대기 계정이
`member` 화면을 얻는다. 지금은 우연히 안전한데 그 우연이 테스트로 고정돼야 한다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

# 이 step이 만든 테스트가 실제로 돌았는지 확인
npx vitest run src/lib/auth/viewer-session.test.ts src/lib/api/viewer-role.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `viewer-session.ts`에 **`getSession`이라는 이름이 여전히 한 번도 나오지 않는지** 확인한다
   (`grep -c getSession src/lib/auth/viewer-session.ts` → 0). 그 API는 JWT를 서버에서
   검증하지 않아 쿠키를 손으로 만든 사람이 `admin`이 될 수 있다. 기존 테스트가 덫을 놓고 있다.
3. 아키텍처 체크리스트:
   - 비즈니스 로직이 `src/lib/`에 있는가?
   - `src/lib/` 아래 파일명이 전역 유니크한가? (새 파일을 만들었다면)
   - CLAUDE.md CRITICAL 규칙 위반이 없는가?
4. `phases/t11-signup-approval/index.json`의 step 1을 업데이트한다.
   `summary`에 `SessionOutcome`의 최종 유니온 모양을 적는다 — step 2·4가 그것을 소비한다.

## 금지사항

- **`auth.getSession()`을 쓰지 마라. `auth.getUser()`만 쓴다.** 이유: `getSession`은 쿠키의
  JWT를 디코드만 하고 서명을 서버에서 확인하지 않는다. 이 프로젝트에서 권한 판정의
  출발점이라 여기서 틀리면 아래 전부가 무의미하다.
- **`user_metadata`에서 `role`이나 `status`를 읽지 마라.** 이유: 사용자가 고칠 수 있는
  자리다. 역할은 `profiles`에서만 온다.
- **`src/app/` 아래 화면을 만들지 마라.** 이유: 이 step은 세션 해석 레이어만 다룬다.
  화면은 step 2~4가 한다.
- **`resolveViewerRole`의 판정 순서를 바꾸지 마라.** 이유: 4번 절에 근거가 있다. 테스트만 더한다.
- 기존 테스트를 깨뜨리지 마라
