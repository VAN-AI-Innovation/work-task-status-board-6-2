# Step 3: signup-flow

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — 화면 규칙 전문
- `/docs/ADR.md` — ADR-027
- `src/app/api/auth/login/route.ts` — **이 step이 본뜨는 대상.** 머리말 전문을 읽어라
- `src/app/login/page.tsx` — 화면의 모양·문구·클래스를 그대로 따른다
- `src/lib/api/credentials-schema.ts` — 요청 스키마를 `lib/api/`에 두는 규율
- `src/lib/auth/session-client.ts` — `createSessionClient`와 `CookieAdapter`
- `src/lib/auth/safe-redirect.ts`
- `src/lib/auth/route-guard.ts` — step 2가 `/signup`을 공개로 열었다
- `supabase/migrations/0005_signup_approval.sql` — step 0. 트리거가 `profiles` 행을 만든다

step 0이 만든 것: `auth.users`에 행이 생기면 트리거가 `profiles`를 `role='member'`,
`status='pending'`으로 만들고, `raw_user_meta_data`의 `team_id`가 `teams`에 있으면 그것을,
없으면 `null`을 넣는다. `display_name`도 metadata에서 온다.

## 작업

**TDD다. 스키마와 라우트 테스트를 먼저 쓴다.**

### 1. 요청 스키마 — `src/lib/api/signup-schema.ts`

`credentials-schema.ts`와 같은 자리·같은 규율이다. **본문은 폼이다** (JSON을 받도록
넓히지 마라 — 이 엔드포인트를 부르는 것은 브라우저 폼과 `curl --data-urlencode` 둘뿐이다).

```ts
export const signupSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  email: z.email(),                                   // zod v4다. .string().email()이 아니다
  password: z.string().min(<정책값>),
  teamId: z.enum(['edit', 'shoot', 'marketing']),
});
export async function readSignup(request: Request): Promise<Signup | null>
```

`teamId`를 `z.enum`으로 못박는 이유: `TeamKey`는 시트 탭에서 오는 **고정된 소수 집합**이고
(`0001_init.sql`), 자유 문자열을 받으면 트리거가 `null`로 접어 어느 리더에게도 안 보이는
유령 계정이 생긴다. 여기서 400으로 돌려주는 편이 낫다.

비밀번호 최소 길이는 **하드코딩하지 말고 상수로** 이 파일에 두고 화면이 같은 상수를 읽게
하라. 두 곳에 숫자를 적으면 한쪽만 고쳐지는 날 폼은 통과하는데 서버가 거절한다.

### 1-b. 유출 비밀번호 검사 — `src/lib/auth/pwned-password.ts`

Supabase의 Leaked password protection은 **Pro 플랜 전용**이라 이 프로젝트에서 켤 수 없다
(대시보드에서 시도하면 `available on Pro Plans and up`으로 거절된다). 같은 방어를 직접 만든다.

**k-익명성(k-anonymity) 방식이다. 비밀번호도, 그 전체 해시도 절대 밖으로 보내지 마라.**

```ts
export interface PwnedCheckDeps {
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** 유출 목록에 있으면 true. 조회에 실패하면 false (근거는 아래) */
export async function isPwnedPassword(
  password: string,
  deps: PwnedCheckDeps
): Promise<boolean>
```

절차:

1. 비밀번호의 **SHA-1**을 구한다 (`node:crypto`. 이 용도에는 SHA-1이 맞다 — API가 그
   형식을 쓴다. 저장용 해시가 아니다).
2. 대문자 16진수 40글자 중 **앞 5글자만** `https://api.pwnedpasswords.com/range/{prefix}`로
   보낸다. 남는 35글자는 보내지 않는다.
3. 응답은 `SUFFIX:COUNT` 줄 목록이다. 나머지 35글자와 대조한다. 대소문자 무시.
4. `Add-Padding: true` 헤더를 붙인다 — 응답 크기로 결과를 추측당하지 않는다.

**`fetch`를 인자로 받는다.** 안에서 전역을 부르면 테스트가 네트워크를 타고, 그러면 이
방어는 CI에서 검증되지 않는다. `viewer-role.ts`·`store-factory.ts`가 `env`를 인자로 받는
것과 같은 규율이다.

**조회 실패는 「통과」로 접는다 (fail-open).** 타임아웃(2초 권장)·네트워크 오류·5xx 전부
`false`다. 이유: 외부 서비스가 죽었다고 회원가입 전체가 멈추면 안 된다. 가용성과 강도를
맞바꾼 판단이므로 **파일 주석에 근거와 함께 적어라** — 다음 사람이 fail-closed로 조이면
HIBP 장애가 곧 서비스 장애가 된다.

**비밀번호를 로그·에러 메시지에 남기지 마라. 해시도 남기지 마라** (`S6`).

라우트에서의 자리: zod 검증 통과 후, `signUp` 호출 **전**. 걸리면
`303 /signup?error=weak`. 이 갈래만은 `invalid`와 구분해도 된다 — 이유: 계정의 존재를
알려주는 정보가 아니라 **입력한 비밀번호 자체의 성질**이고, 사용자가 고칠 수 있는 일이다.
문구는 「이 비밀번호는 외부 유출 목록에 있습니다. 다른 것을 쓰세요」.

### 2. 가입 라우트 — `src/app/api/auth/signup/route.ts`

`login/route.ts`를 그대로 본뜬다: `export const runtime = 'nodejs'`, 서버 액션이 아닌
**라우트 핸들러**, 응답은 항상 **303 See Other**, 쿠키는 버퍼에 모았다가 응답에 싣는다.

```
readSignup 실패                     → 303 /signup?error=invalid
createSessionClient 없음             → 303 /signup?error=unavailable
signUp 실패                         → 303 /signup?error=invalid
성공 + 세션 있음 (이메일 확인 꺼짐)   → 303 /pending  (+ 세션 쿠키)
성공 + 세션 없음 (이메일 확인 켜짐)   → 303 /signup?sent=1
```

**`signUp()`을 쓴다. `service_role`로 `auth.admin.createUser`를 부르지 마라.**
이유: admin API는 이메일 확인을 건너뛰어 **누구나 남의 이메일로 계정을 선점**할 수 있고,
Supabase 내장 rate limit도 우회한다. `signUp`은 둘 다 준다.

`options.data`에 `display_name`과 `team_id`를 실어 보낸다 — 트리거가 그것을 읽는다.
**`role`이나 `status`를 실어 보내지 마라. 이유: `user_metadata`는 사용자가 고칠 수 있는
자리이고, 트리거는 그 두 값을 하드코딩한다.** 보내 봐야 무시되지만, 코드에 있으면 다음
사람이 트리거도 그것을 읽는다고 착각한다.

**성공과 실패가 같은 모양이어야 한다.** 이미 가입된 이메일에 대해 「이미 있는 계정입니다」를
내지 마라 — 이 엔드포인트가 계정 존재 확인 도구가 된다. Supabase의 `signUp`은 기본적으로
같은 응답을 주지만, 우리 쪽에서 `error.message`를 분기해 다른 문구를 만들면 그 방어가
깨진다. **에러는 전부 `invalid` 하나로 접는다.**

**아무것도 로그에 남기지 마라** (`S6`). 검증과 본문 읽기가 `lib/api/signup-schema.ts`에
있으므로 이 파일에는 자격증명 필드 이름조차 나오지 않아야 한다 — `grep`으로 확인된다.

`?sent=1` 갈래가 있는 이유: Supabase의 Confirm email 설정이 켜져 있으면 `signUp`이 세션을
돌려주지 않는다. **그 설정을 코드가 알 필요가 없게** 응답에서 세션 유무로 분기한다.

### 3. 가입 화면 — `src/app/signup/page.tsx`

`login/page.tsx`의 구조·클래스·문구 톤을 그대로 따른다. JS 없이 도는 평범한
`<form method="post" action="/api/auth/signup">`다.

- 필드 넷: 이름 · 이메일 · 비밀번호 · 가입할 팀
- 팀은 `<select>`. 라벨은 **`src/lib/view/team-slug.ts`의 `TEAM_LABELS`·`teamLabel()`을
  그대로 쓴다.** 이 표를 화면에 다시 적지 마라 — 같은 낱말이 두 곳에 있으면 한쪽만 고쳐지고,
  사이드바는 「마케팅·관리팀」인데 가입 폼은 「마케팅팀」이라고 부르는 화면이 된다
  (`role-label.ts`의 머리말이 같은 사고를 기록하고 있다).
- `?error=`는 `invalid`·`unavailable`·`weak` 셋만 문구로 바꾸고 나머지는 무시한다
  (`login/page.tsx`와 같은 규칙).
- `?sent=1`이면 「확인 메일을 보냈습니다」 안내를 띄운다.
- 비밀번호 최소 길이를 `minLength`로 걸고, 1번의 상수를 읽는다.
- 로그인 화면에 「계정이 없으신가요? 회원가입」 링크를, 가입 화면에 「이미 계정이 있으신가요?
  로그인」 링크를 서로 건다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/api/signup-schema.test.ts src/lib/auth/pwned-password.test.ts \
  src/app/api/auth/signup/route.test.ts

# 라우트에 자격증명 필드 이름이 새지 않았는지 (전부 결과가 비어 있어야 한다)
grep -n "password" src/app/api/auth/signup/route.ts
grep -nE "console\.(log|error|warn)" src/app/api/auth/signup/route.ts src/lib/auth/pwned-password.ts

# 유출 검사가 해시 접두사만 보내는지 — range/ 뒤에 5글자만 붙어야 한다
grep -n "api.pwnedpasswords.com" src/lib/auth/pwned-password.ts

# 유출 검사 테스트가 네트워크를 타지 않는지 — 가짜 fetch를 주입해야 한다
grep -n "fetch" src/lib/auth/pwned-password.test.ts

# admin API를 부르지 않았는지 (결과가 비어 있어야 한다)
grep -rn "auth.admin" src/app/api/auth/

# 런타임 명시
grep -n "runtime = 'nodejs'" src/app/api/auth/signup/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 계정 존재와 관련된 실패 갈래가 **전부 같은 `error=invalid`로 접히는지** 라우트를 눈으로
   확인한다. 사유별로 문구가 갈리면 이메일 열거가 가능해진다.
   (`weak`는 예외다 — 계정이 아니라 입력한 비밀번호 자체의 성질이고, 근거는 1-b절에 있다.)
2-b. `pwned-password.test.ts`가 **가짜 `fetch`로** 돈다는 것을 확인한다. 실제 네트워크를
   타면 CI가 외부 서비스에 묶이고, 그 서비스가 죽는 날 이 방어는 검증되지 않은 채로 남는다.
3. 아키텍처 체크리스트:
   - 라우트가 「zod 검증 → lib 호출 → 직렬화」 3단계인가? 계산 로직이 0줄인가?
   - 컴포넌트가 props 받아 JSX만 뱉는가?
   - `src/lib/` 아래 파일명이 전역 유니크한가?
   - `service_role` 키에 `NEXT_PUBLIC_` 접두사가 없는가?
4. `phases/t11-signup-approval/index.json`의 step 3을 업데이트한다.
   `summary`에 만든 파일 경로와 비밀번호 최소 길이 상수 이름을 적는다.

## 금지사항

- **`SUPABASE_SERVICE_ROLE_KEY`를 이 step에서 쓰지 마라.** 이유: 2번 절에 근거가 있다.
  가입은 익명 사용자가 부르는 경로이고, `service_role`이 닿으면 RLS가 통째로 우회된다.
- **계정 존재와 관련된 실패 사유를 구분해 알리지 마라.** 이유: 계정 존재 확인 도구가 된다.
- **비밀번호 전체나 그 전체 해시를 외부로 보내지 마라. 앞 5글자 해시 접두사만 보낸다.**
  이유: 그것이 k-익명성의 전부다. 전체를 보내면 유출 검사가 곧 유출 경로가 된다.
- **유출 검사를 fail-closed로 만들지 마라.** 이유: 1-b절에 근거가 있다. 외부 서비스 장애가
  회원가입 장애가 된다.
- **유출 검사 테스트에서 실제 네트워크를 타지 마라.** 이유: 검증이 외부 서비스에 묶인다.
- **`profiles`에 앱이 직접 `insert`하지 마라.** 이유: 트리거가 한다. 앱이 같이 쓰면 `role`·
  `status`를 앱이 정하게 되고, 그 자리가 곧 권한 상승 경로다.
- **승인·거절 기능을 만들지 마라.** 이유: step 5·6이 한다.
- 기존 테스트를 깨뜨리지 마라
