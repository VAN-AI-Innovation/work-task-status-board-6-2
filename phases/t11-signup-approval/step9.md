# Step 9: security-audit

## 읽어야 할 파일

- `/docs/PLAN.md` — `S4` · `S5` · `S6`
- `/docs/ADR.md` — ADR-024 · ADR-025 · ADR-026 · ADR-027
- `supabase/migrations/0003_auth_rls.sql` · `supabase/migrations/0005_signup_approval.sql`
- `src/lib/auth/viewer-session.ts` · `src/lib/auth/pending-gate.ts` · `src/lib/auth/route-guard.ts`
- `src/lib/api/viewer-role.ts` · `src/lib/api/same-origin.ts`
- `src/app/api/auth/` 아래 전부 · `src/app/api/team/` · `src/app/api/members/`
- `src/lib/env-guard.ts` · `src/lib/env-guard.test.ts` — 정적 검사로 규칙을 강제하는 본보기

step 0~8이 만든 것 전부가 검증 대상이다.

## 작업

**이 step은 기능을 더하지 않는다. 앞 step들이 만든 방어를 실제로 뚫어 보고, 뚫리면 고친다.**

아래 표의 각 항목마다 **공격을 재현하는 테스트**를 쓴다. 테스트가 「막힌다」를 보여야 한다.

| # | 공격 | 어디를 재는가 |
|---|---|---|
| 1 | 가입 폼 본문에 `role=admin`·`status=active`를 끼워 넣는다 | `signup-schema` — 스키마가 그 키를 버린다. 라우트가 metadata에 싣지 않는다 |
| 2 | 대기 계정이 `/api/tasks`·`/api/stats`·`/api/alerts`·`/api/goals`를 부른다 | `pending-gate` — 전부 403 `PENDING_APPROVAL` |
| 3 | 대기 계정이 화면 주소로 직접 들어온다 | `gateForSession` — `/pending`으로 리다이렉트. `/pending` 자신은 `allow`(루프 없음) |
| 4 | 대기 계정 세션 + `?as=admin` | `resolveViewerRole` — `member`. 세션이 `ok`가 아니면 URL이 이기지 않는다 |
| 5 | `lead`가 남의 팀 요청을 승인한다 | 승인 라우트 — 403. 사유를 구분해 알리지 않는다 |
| 6 | `lead`가 `set_role`로 자기를 `admin`으로 올린다 | 승격 라우트 — zod가 `'admin'`을 거부(400), DB 함수도 거부 |
| 7 | `member`가 승인·거절·승격 라우트를 직접 POST한다 | 전부 403 |
| 8 | 남의 사이트에서 승인 라우트로 POST를 보낸다 (CSRF) | `isSameOrigin` — `Origin`이 다르면 403. **없으면 통과**(근거는 step 4 주석) |
| 9 | 이미 다른 계정에 붙은 `members` 행에 승인을 붙인다 | 승인 라우트 — 403. 남의 연결을 빼앗지 못한다 |
| 10 | 거절된 계정이 `request_join`으로 `status`를 `active`로 만든다 | 함수가 `'pending'`만 세운다 |
| 11 | 가입 시 존재하는 이메일 / 없는 이메일의 응답이 다른가 | 두 경우 모두 `?error=invalid` 하나 |
| 12 | 로그인 실패 사유가 갈리는가 | 기존 규칙 유지 — `invalid` 하나 |
| 13 | 유출 목록에 있는 비밀번호로 가입한다 | `isPwnedPassword` — `303 /signup?error=weak`. 계정이 만들어지지 않는다 |
| 14 | 유출 검사 API가 죽었을 때 가입이 막히는가 | fail-open — 타임아웃·5xx·네트워크 오류에도 가입이 진행된다 |
| 15 | 유출 검사가 비밀번호를 밖으로 보내는가 | 요청 URL에 **해시 접두사 5글자만** 실린다. 본문·헤더에 원문도 전체 해시도 없다 |

### 정적 검사도 테스트로 만든다

`env-guard.test.ts`가 그러듯, **파일 내용을 읽어 규칙 위반을 찾는 테스트**를 둔다.
사람의 주의력에 맡기지 않는다.

`src/lib/security-rules.ts`(파일명은 전역 유니크하게)에 순수 함수로 둔다:

```ts
export function findAuthRouteViolations(
  files: readonly { path: string; content: string }[]
): Violation[]
```

찾을 것:

- `src/app/api/auth/**`·`src/app/api/team/**`·`src/app/api/members/**`에
  `SERVICE_ROLE`·`getStorage(` 가 나오는가 → 위반
- 상태를 바꾸는 `POST` 라우트에 `isSameOrigin` 호출이 없는가 → 위반
- `src/app/api/auth/**`에 `console.log|error|warn` 이 있는가 → 위반 (`S6`)
- `raw_user_meta_data->>'role'` 또는 `->>'status'` 가 마이그레이션에 있는가 → 위반
- `src/lib/auth/viewer-session.ts`에 `getSession` 이 있는가 → 위반
- `pwned-password.ts`가 `range/` 뒤에 5글자 초과를 붙이는가 → 위반

**`env-guard.ts`를 고쳐 여기에 합치지 마라.** 이유: 그 파일은 `prebuild`가 부르는
별개의 게이트이고, 책임이 다르다. 규칙이 섞이면 하나가 실패했을 때 무엇이 깨졌는지
메시지가 흐려진다.

### 뚫린 것이 있으면

앞 step의 코드를 고친다. **고친 내용을 이 step의 `summary`에 반드시 적어라** — 어느
step의 결과물이 사후에 바뀌었는지가 기록에 남아야 한다.

### 라우트 전반의 Origin 검사

step 4가 `rejoin`에만 걸어 두었다. 이 step에서 **상태를 바꾸는 모든 POST 라우트**로
넓힌다: `login` · `logout` · `signup` · `rejoin` · 승인 · 거절 · 승격.

⚠ `login`·`signup`에 붙일 때 **`Origin`이 없으면 통과** 규칙을 지켜라. 조이면
`curl`로 세션 쿠키를 만드는 T8의 검증 절차가 통째로 죽는다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/security-rules.test.ts

# 위 15개 공격 테스트가 실제로 존재하는지 — 0이면 안 된다
npx vitest run --reporter=verbose 2>&1 | grep -ci "pending\|403\|forbidden\|origin"

# 정적 규칙이 현재 코드에서 위반을 0건으로 보고하는지
npx vitest run src/lib/security-rules.test.ts 2>&1 | tail -5
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 표의 15개 항목마다 **테스트가 실재하는지** 하나씩 대조한다. 이 step에서 가장 흔한
   실패는 「표를 옮겨 적기만 하고 테스트를 안 쓰는 것」이다.
3. 3번 항목(리다이렉트 루프)이 반드시 있는지 확인한다 — 이것만은 사용자가 원인을 알 수
   없는 형태로 실패한다.
4. 아키텍처 체크리스트:
   - 검사 함수가 `src/lib/`의 순수 함수인가?
   - 파일명이 전역 유니크한가?
   - `env-guard.ts`를 고치지 않았는가?
5. `phases/t11-signup-approval/index.json`의 step 9를 업데이트한다.
   `summary`에 **뚫린 항목과 고친 파일**을 적는다. 하나도 없으면 「15개 전부 방어됨」이라고
   적는다.

## 금지사항

- **테스트를 통과시키려고 방어를 느슨하게 고치지 마라.** 이유: 이 step의 목적이 뒤집힌다.
  테스트가 「막힌다」를 보여야 하고, 안 막히면 **구현을 고쳐라.**
- **`Origin`이 없을 때 거부하도록 조이지 마라.** 이유: `curl` 기반 검증 절차가 죽는다.
- **새 기능·새 화면을 만들지 마라.** 이유: 이 step은 검증과 그 결과의 수정만 다룬다.
- **`env-guard.ts`에 규칙을 합치지 마라.** 이유: 위 절에 근거가 있다.
- **원격 DB에 접속해 실계정으로 시험하지 마라.** 이유: 실업무 데이터가 있는 원격이다.
  검증은 로컬 테스트로 한다.
- 기존 테스트를 깨뜨리지 마라
