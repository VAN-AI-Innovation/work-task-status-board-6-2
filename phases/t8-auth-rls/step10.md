# Step 10: login-page

## 읽어야 할 파일

- `CLAUDE.md` — 컴포넌트는 `src/components/`, 로직은 `src/lib/` · 서버 컴포넌트는 자기 API를
  fetch하지 않는다 · `src/app/api/**`에 `runtime='nodejs'` · **This is NOT the Next.js you know**
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` — **전체를 읽는다.**
  `middleware`가 아니라 `proxy`다. 파일 위치는 `src/proxy.ts`, export 이름은 `proxy`,
  `config.matcher`로 대상을 좁힌다
- `node_modules/next/dist/docs/01-app/04-api-reference/02-file-conventions/proxy.md`(있으면)
- `docs/TICKETS.md` — T8 완료 기준 **7**(로그아웃 상태에서 보호된 라우트에 접근하면 로그인으로
  리다이렉트된다) · **범위 Out**(초대·가입·비밀번호 재설정·소셜 로그인 **없음**)
- `docs/UI_GUIDE.md` — 화면 규칙 전부. 특히 **안티패턴 표**(글로우·gradient-text·보라/인디고·
  backdrop-filter blur 금지)와 팔레트 토큰
- `docs/PLAN.md` — step 0의 **결정 A**(`@supabase/ssr`·`src/proxy.ts`) · **결정 E**(데모 모드는
  인증을 요구하지 않는다)
- 이전 step 산출물: `session-client.ts`·`viewer-session.ts`(6) · `request-viewer.ts`(8)
- 본뜰 기존 코드:
  - `src/components/shell/page-shell.tsx` — 화면 뼈대
  - `src/app/upload/page.tsx` — 서버 컴포넌트 + 클라이언트 패널의 분리 방식
  - `src/app/api/uploads/seed/route.ts` — 라우트 핸들러의 결

## 배경

여기서 사람이 처음으로 로그인한다. 그리고 **완료 기준 2의 `curl` 검증이 가능해지는 지점**이기도
하다 — 세션 쿠키를 만들 방법이 생기기 때문이다.

그래서 로그인을 **서버 액션이 아니라 라우트 핸들러**로 만든다.

```
POST /api/auth/login    email·password (form-encoded) → 쿠키를 굽고 리다이렉트
POST /api/auth/logout   세션을 끊고 /login으로
```

서버 액션으로 만들면 요청 본문이 Next 내부 포맷이라 `curl`로 로그인할 수 없고, 완료 기준 2를
「티켓이 정한 방법으로」 증명할 수 없다. 덤으로 **JS 없이도 로그인이 된다** — 로그인 화면은
평범한 `<form method="post">`다.

## 작업

### 1. `POST /api/auth/login` (테스트 먼저)

`src/app/api/auth/login/route.ts` · `export const runtime = 'nodejs'`

- 본문은 `application/x-www-form-urlencoded`(`request.formData()`). JSON도 받는다면 둘 다
  받되 **분기를 라우트에 쓰지 말고** 작은 `lib` 함수로 빼라. 굳이 필요 없으면 폼만 받는다.
- zod로 `email`(형식)·`password`(1자 이상)를 검증한다. 실패는 `303`으로
  `/login?error=invalid`로 돌려보낸다 — **400 JSON을 내지 마라.** 이 엔드포인트의 사용자는
  브라우저 폼이다.
- `createSessionClient`(anon 키 + `cookies()` 어댑터)로
  `auth.signInWithPassword({ email, password })`.
- 실패하면 `/login?error=invalid`로. **왜 실패했는지 구분해 알리지 마라** —
  「없는 계정」과 「비밀번호 틀림」을 나눠 답하면 계정 존재 확인 도구가 된다.
  로그에도 이메일·비밀번호를 남기지 마라.
- 성공하면 `303 See Other`로 `next` 파라미터의 경로 또는 `/`로 보낸다.
  **`next`는 `/`로 시작하고 `//`로 시작하지 않는 경로만 허용한다** (오픈 리다이렉트 방어).
  검증은 `src/lib/auth/safe-redirect.ts`(+테스트)에 둔다 — 라우트에 판정을 쓰지 않는다.
- 자격증명이 없어 클라이언트가 `null`이면 `/login?error=unavailable`.

`safe-redirect.ts` 테스트에 반드시 들어갈 것: `//evil.com`·`https://evil.com`·
`/\evil.com`·`javascript:alert(1)`·빈 문자열·`/teams/edit?x=1` (마지막만 통과).

### 2. `POST /api/auth/logout`

`auth.signOut()` 후 `303`으로 `/login`. **`GET`으로 만들지 마라** — 링크 프리페치나
이미지 태그 하나로 로그아웃되는 자리가 된다.

### 3. `/login` 화면

`src/app/login/page.tsx` (서버 컴포넌트) + `src/components/auth/login-form.tsx`
(props만 받아 JSX를 뱉는 컴포넌트. **클라이언트 컴포넌트일 필요가 없다** — 평범한 폼이다).

- 필드 둘(`email`·`password`) + 제출 버튼. `autoComplete`를 제대로 준다
  (`username`·`current-password`).
- `?error=`에 따라 한 줄 문구:
  - `invalid` → 「이메일 또는 비밀번호가 올바르지 않습니다.」
  - `unavailable` → 「인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.」
  - 그 밖의 값 → 문구를 띄우지 않는다 (URL로 임의 문자열을 화면에 그리지 마라)
- **이미 로그인한 상태로 `/login`에 오면** `/`로 `redirect()`한다.
- `no_profile`(로그인은 됐는데 `profiles` 행이 없다)이면 로그인 폼 대신
  「이 계정에는 권한이 지정되지 않았습니다. 관리자에게 문의해 주세요.」 + **로그아웃 버튼**을
  보인다. 이 갈래가 없으면 그 계정은 리다이렉트 고리에 갇힌다.
- `UI_GUIDE.md`의 팔레트 토큰만 쓴다. 안티패턴 표를 어기지 마라. 로고·일러스트를 만들지 마라.
- 사이드바(`AppSidebar`)는 로그인 화면에서 **의미가 없다.** 레이아웃을 통째로 바꾸지 말고,
  로그인 화면 안에서 자연스럽게 보이도록 최소한으로 처리한다 (`layout.tsx`를 고쳐야 한다면
  이유를 `summary`에 적어라).

### 4. `src/proxy.ts` — 완료 기준 7

```ts
export async function proxy(request: NextRequest) { … }
export const config = { matcher: [ … ] };
```

**동작은 두 가지뿐이다.**

1. **세션 갱신** — `@supabase/ssr`의 `createServerClient`를 요청/응답 쿠키에 물리고
   `auth.getUser()`를 부른다. 이것이 리프레시 토큰 회전을 굴리는 자리다.
   문서의 「`createServerClient`와 `getUser()` 사이에 코드를 넣지 마라」를 지켜라.
2. **미인증 리다이렉트** — 사용자가 없으면 `/login?next=<원래 경로>`로 보낸다.

**리다이렉트하지 않는 경우 (전부 적는다):**

- `STORAGE_DRIVER === 'memory'` 이거나 `NEXT_PUBLIC_SUPABASE_URL`·`ANON_KEY`가 없다
  → **데모 모드다** (결정 E). 아무 일도 하지 않는다. `.env` 없이 클론한 심사자의 경로를
  죽이면 안 된다
- `/login`, `/api/auth/*`
- `_next/static`·`_next/image`·`favicon.ico`·정적 이미지 (`config.matcher`로 뺀다)
- `/api/health` — 헬스체크가 로그인을 요구하면 감시 도구가 죽는다

**API 라우트는 리다이렉트하지 않는다.** `/api/**`(위 예외 제외)는 리다이렉트 대신
`401 { error: { code: 'UNAUTHENTICATED', … } }`을 낸다. 폼이 아니라 fetch가 부르는 자리라
302를 주면 클라이언트가 로그인 HTML을 JSON으로 파싱하려 든다.
**문구는 `api-error.ts`의 표와 글자까지 같아야 한다.**

- 판정 로직(어느 경로가 공개인가·데모인가)을 `proxy.ts`에 **직접 쓰지 말고**
  `src/lib/auth/route-guard.ts`(+테스트)에 순수 함수로 둔다:
  `classifyRequest(pathname, env) → 'public' | 'demo-open' | 'page' | 'api'`.
  `proxy.ts`는 그것을 부르고 응답만 만든다. 테스트가 없으면 이 규칙은 지켜지지 않는다.
- `route-guard.test.ts`에 반드시: `/`·`/login`·`/api/auth/login`·`/api/health`·`/api/tasks`·
  `/teams/edit`·`/upload`·`/extract`·`/_next/static/x.js` 각각의 분류, 그리고
  **데모 env에서는 전부 `demo-open`**.

## Acceptance Criteria

```bash
npm run test -- src/lib/auth src/app/api/auth
npm run lint && npm run build && npm run test
ls src/proxy.ts                                  # 존재한다 (src/middleware.ts는 없다)
ls src/middleware.ts 2>/dev/null && echo "FAIL: Next 16은 proxy.ts다"
grep -n 'export async function proxy\|export function proxy\|export default' src/proxy.ts
grep -rn 'GET' src/app/api/auth/logout/route.ts  # 0줄 (POST만)
grep -rn 'password' src/app/api/auth/login/route.ts | grep -i 'console\|log'   # 0줄
```

**라이브 확인 (`npm run dev`, `.env.local` = 라이브 Supabase).**
step 5가 만든 계정과 `T8_SEED_PASSWORD`를 쓴다.

```bash
# 1. 완료 기준 7 — 로그아웃 상태에서 보호 라우트
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3000/            # 307/302 → /login?next=%2F
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/login                       # 200
curl -s localhost:3000/api/tasks | head -c 200                                      # 401 UNAUTHENTICATED

# 2. 로그인 → 쿠키
curl -s -c /tmp/m.txt -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -X POST localhost:3000/api/auth/login \
  --data-urlencode "email=member@example.com" --data-urlencode "password=$T8_SEED_PASSWORD"
#   → 303 → /
curl -s -b /tmp/m.txt localhost:3000/api/tasks | head -c 300                        # 본인 건만

# 3. 완료 기준 2 — 타인 건 PATCH (티켓이 정한 검증 방법)
#    남의 태스크 id는 admin 세션으로 목록을 받아 고른다 (/tmp/a.txt)
curl -s -b /tmp/m.txt -X PATCH localhost:3000/api/tasks/<타인_id> \
  -H 'Content-Type: application/json' -d '{"progress":100}'
#   → 403 FORBIDDEN

# 4. 잘못된 비밀번호
curl -s -o /dev/null -w '%{redirect_url}\n' -X POST localhost:3000/api/auth/login \
  --data-urlencode "email=member@example.com" --data-urlencode "password=wrong"
#   → /login?error=invalid

# 5. 오픈 리다이렉트
curl -s -o /dev/null -w '%{redirect_url}\n' -X POST 'localhost:3000/api/auth/login?next=//evil.com' \
  --data-urlencode "email=member@example.com" --data-urlencode "password=$T8_SEED_PASSWORD"
#   → / (evil.com이 아니다)

# 6. 로그아웃
curl -s -b /tmp/m.txt -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/auth/logout   # 303
```

**3번의 결과(403)를 `summary`에 그대로 남겨라.** 완료 기준 2가 그 한 줄로 증명된다.

## 검증 절차

1. 위 AC와 라이브 확인 6종을 전부 실행하고 결과를 기록한다.
2. 변이 확인 셋 (통과 후 되돌린다):
   - `proxy.ts`를 `middleware.ts`로 이름만 바꾼다 → 1번 확인이 **200**을 내야 한다
     (아무 일도 안 일어난다). Next 16의 이름 규칙을 실제로 재는 유일한 방법이다
   - `route-guard`에서 `/api/health`를 공개 목록에서 뺀다 → 해당 테스트가 잡아야 한다
   - `safe-redirect`에서 `//` 검사를 뺀다 → 5번 확인이 `//evil.com`을 내야 한다
3. 체크리스트:
   - 데모 모드(`STORAGE_DRIVER=memory`)로 `npm run dev`를 띄우면 **리다이렉트 없이** 대시보드가
     그대로 뜨는가? (결정 E — 이것이 깨지면 심사자 경로가 죽는다). 실제로 띄워 확인하라
   - 로그인 실패 사유가 구분되어 노출되지 않는가?
   - `/login`이 `no_profile` 계정을 고리에 가두지 않는가?
   - 콘솔·서버 로그에 비밀번호·이메일이 찍히지 않는가?
4. `phases/t8-auth-rls/index.json`의 step 10을 갱신한다.

## 금지사항

- 회원가입·비밀번호 재설정·소셜 로그인·초대를 만들지 마라 (**범위 Out**). 계정은 step 5의
  스크립트가 만든다.
- 「기억하기」·2FA·이메일 매직링크를 만들지 마라.
- 로그인 상태를 `localStorage`·`sessionStorage`에 두지 마라. 쿠키다.
- `proxy`에서 DB를 조회하지 마라 (`profiles`도). Next 문서가 「Proxy는 느린 데이터 조회용이
  아니다」라고 못박고 있고, 역할 판정은 이미 `resolveSession`이 자기 자리에서 한다.
- 대시보드·업무 표·상단 바를 고치지 마라. step 11의 일이다.
- 안티패턴(글로우·gradient-text·보라/인디고·blur)을 쓰지 마라.
- 기존 테스트를 깨뜨리지 마라.
