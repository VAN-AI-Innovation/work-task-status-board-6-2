# Step 4: pending-screen

## 읽어야 할 파일

- `/docs/UI_GUIDE.md`
- `src/app/login/page.tsx` · `src/app/signup/page.tsx` (step 3) — 문구 톤과 클래스
- `src/lib/auth/viewer-session.ts` (step 1) — `pending`·`rejected`·`no_profile` 갈래
- `src/lib/auth/pending-gate.ts` (step 2) — 여기로 보내는 판정
- `src/app/api/auth/logout/route.ts` — CSRF에 대한 기존 판단이 머리말에 있다
- `supabase/migrations/0005_signup_approval.sql` (step 0) — `request_join(team)` 함수
- `src/lib/store/viewer-storage.ts` — 사용자 JWT 클라이언트를 얻는 자리

step 0이 만든 것 중 이 step이 쓰는 것: `public.request_join(team text)` — 호출자
본인의 `profiles`가 `status='rejected'`일 때만 `team_id`를 바꾸고 `status='pending'`으로
되돌린다. 그 밖의 경우 예외를 던진다.

step 1이 만든 것: `SessionOutcome`의 `pending`·`rejected`가 `teamId`·`displayName`을 싣는다.

## 작업

### 1. `/pending` 화면 — `src/app/pending/page.tsx`

서버 컴포넌트다. `resolveSession`으로 현재 상태를 읽고 세 갈래를 그린다.

| 상태 | 보여 줄 것 |
|---|---|
| `pending` | 「{팀 이름} 합류를 요청했습니다. 팀장의 승인을 기다리는 중입니다」 |
| `rejected` | 「요청이 반려되었습니다」 + **다른 팀으로 재요청 폼** |
| `no_profile` | 「프로필이 준비되지 않았습니다. 관리자에게 문의하세요」 |

세 갈래 모두 **로그아웃 버튼**을 둔다. 이유: 이 화면은 다른 곳으로 갈 수 없는 막다른
길이고, 로그아웃이 없으면 그 계정은 브라우저를 갈아타야 빠져나온다.

`status === 'ok'`인 사람이 이 주소로 오면 `/`로 되돌린다. 이유: 승인된 뒤 북마크로
돌아오는 경우가 실제로 생긴다.

팀 이름 라벨은 `src/lib/view/team-slug.ts`의 `teamLabel()`을 **그대로 쓴다.**
여기서 다시 적지 마라 — 같은 낱말이 두 곳에 있으면 한쪽만 고쳐진다.

### 2. 재요청 라우트 — `src/app/api/auth/rejoin/route.ts`

`/api/auth` 아래에 두는 이유: step 2의 `gateForSession`이 `/api/auth/**`를 `allow`한다.
다른 곳에 두면 대기·거절 사용자가 자기 요청을 보낼 수 없어 **갇힌다.**

```
export const runtime = 'nodejs'
POST — 폼 본문 { teamId }
  → 사용자 JWT 클라이언트로 rpc('request_join', { team: teamId })
  → 성공 303 /pending
  → 실패 303 /pending?error=invalid
```

**`service_role`을 쓰지 마라. 사용자 JWT로 부른다.** 이유: `request_join`은 호출자
자신(`auth.uid()`)의 행만 고치도록 만들어졌고, `service_role`로 부르면 `auth.uid()`가
없어 함수가 아무 행도 못 찾거나 — 더 나쁘게 — 앱이 대상 사용자를 인자로 넘기도록
바뀐다. 그 순간 남의 상태를 바꿀 수 있는 문이 열린다.

`teamId`는 step 3의 `signup-schema.ts`가 쓰는 것과 **같은 `z.enum`**으로 검증한다.
스키마를 복사하지 말고 `src/lib/api/signup-schema.ts`에서 팀 enum을 export해 재사용하라.

### 3. 상태 변경 POST에 Origin 검사

`src/lib/api/same-origin.ts`에 순수 함수를 만든다:

```ts
export function isSameOrigin(
  origin: string | null,
  host: string | null,
  proto: string
): boolean
```

`Origin` 헤더가 없으면(오래된 클라이언트·`curl`) **어떻게 할지 정해야 한다.** 이 프로젝트는
`curl`로 인증 흐름을 검증해 왔으므로(`login/route.ts` 머리말) **없으면 통과시킨다.**
있는데 다르면 거부한다. 브라우저는 cross-site POST에 항상 `Origin`을 붙이므로 이 규칙으로
CSRF는 막히고 `curl` 검증은 유지된다. **이 판단을 파일 주석에 근거와 함께 적어라** —
다음 사람이 「없으면 거부」로 조이면 T8이 만든 검증 절차가 통째로 죽는다.

`rejoin` 라우트에 적용한다. `login`·`logout`·`signup`은 **이 step에서 고치지 마라**
(step 9가 전 라우트를 한 번에 훑는다 — 지금 손대면 이 step의 diff가 인증 전반으로 번진다).

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/api/same-origin.test.ts src/app/api/auth/rejoin/route.test.ts

# service_role이 이 step의 라우트에 닿지 않았는지 (결과가 비어 있어야 한다)
grep -rn "SERVICE_ROLE" src/app/api/auth/rejoin/route.ts src/app/pending/

# 런타임 명시
grep -n "runtime = 'nodejs'" src/app/api/auth/rejoin/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `/pending`이 `status === 'ok'`를 `/`로 되돌리는지 테스트가 있는지 확인한다.
3. 재요청 라우트가 **대상 사용자 id를 인자로 받지 않는지** 확인한다. 받는 순간 남의 상태를
   바꿀 수 있는 문이 된다 — 대상은 언제나 `auth.uid()`다.
4. 아키텍처 체크리스트:
   - 서버 컴포넌트가 자기 API 라우트를 fetch하지 않는가?
   - 판정이 `src/lib/`에 있는가? 화면이 계산하지 않는가?
   - `src/lib/` 아래 파일명이 전역 유니크한가?
5. `phases/t11-signup-approval/index.json`의 step 4를 업데이트한다.
   `summary`에 `isSameOrigin`의 시그니처와 「Origin 없으면 통과」 판단을 적는다 —
   step 5·9가 그것을 이어받는다.

## 금지사항

- **재요청 함수에 대상 사용자를 인자로 넘기지 마라.** 이유: 2번 절에 근거가 있다.
- **`service_role`을 쓰지 마라.** 이유: 2번 절에 근거가 있다.
- **`profiles`를 앱에서 직접 `update`하지 마라.** 이유: step 0이 UPDATE GRANT를 주지 않았다.
  실패하는 것이 정상이다. RPC로만 바꾼다.
- **`login`·`logout`·`signup` 라우트를 고치지 마라.** 이유: 3번 절에 근거가 있다.
- **승인·거절 기능을 만들지 마라.** 이유: step 5·6이 한다.
- 기존 테스트를 깨뜨리지 마라
