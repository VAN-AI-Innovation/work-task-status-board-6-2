# Step 6: auth-session

## 읽어야 할 파일

- `CLAUDE.md` — 비즈니스 로직은 `src/lib/`에만 · `src/lib/` 파일명 전역 유니크 ·
  `service_role` 키에 `NEXT_PUBLIC_` 금지 · **This is NOT the Next.js you know** 블록
- `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md` — Next 16에서
  `middleware`가 `proxy`로 바뀌었다는 사실 (step 10이 쓴다. 여기서는 이름만 확인)
- `node_modules/next/dist/docs/01-app/04-api-reference/…/cookies.md`(있으면) — `cookies()`가
  Next 16에서 **Promise**라는 것
- `docs/TICKETS.md` — T8 완료 기준 **5**(조회가 사용자 JWT로 나간다)
- step 0 산출물: `src/types/auth.ts`의 `Viewer`, `docs/PLAN.md`「T8 착수 시 확정」 결정 A·B
- step 2 산출물: `MemberRecord`
- 본뜰 기존 코드:
  - `src/lib/store/store-factory.ts` — **환경을 인자로 받는다**는 규율(`createClientFrom(env)`).
    이 step도 같다: `process.env`를 함수 안에서 읽지 않는다
  - `src/lib/api/viewer-role.ts` — 「테스트로 지켜지지 않으면 지켜지지 않는다」 문단

## 배경

지금까지 T8이 만든 것은 **DB 쪽 절반**이다 (정책·계정·구성원). 앱은 아직 로그인이 무엇인지
모른다. 이 step이 그 절반을 잇는다: **쿠키 → 검증된 사용자 → `Viewer`.**

두 가지를 여기서 못박는다.

1. **`auth.getSession()`을 쓰지 마라. `auth.getUser()`를 쓴다.** `getSession()`은 쿠키에 담긴
   JWT를 **디코드만** 한다 — 서명을 서버에서 확인하지 않으므로, 쿠키를 손으로 만든 사람이
   `admin`이 될 수 있다. `getUser()`는 Auth 서버에 물어본다. 이 프로젝트에서 권한 판정의
   출발점이므로 여기서 틀리면 아래 전부가 무의미하다.
2. **역할은 JWT가 아니라 `profiles`에서 온다.** JWT의 `user_metadata`는 사용자가 고칠 수 있는
   자리다. RLS의 `my_role()`도 `profiles`를 보므로, 앱과 DB가 같은 표를 봐야 화면과 데이터가
   어긋나지 않는다.

## 작업

### 0. 패키지 설치

```bash
npm i @supabase/ssr
```

`package.json`·`package-lock.json` 변경이 이 step의 커밋에 함께 들어간다. 다른 패키지를
추가하지 마라.

### 1. `src/lib/auth/session-client.test.ts` 를 **먼저** 쓴다

```ts
/** `@supabase/ssr`의 쿠키 어댑터. Next의 `cookies()` 모양을 그대로 받는다 */
export interface CookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
}

/**
 * anon 키 + 쿠키 세션 클라이언트. **`service_role`을 쓰지 않는다** — 이 클라이언트로 나가는
 * 조회에 RLS가 걸리는 것이 완료 기준 5다.
 * 자격증명이 없으면 `null` (데모 모드다. 던지면 키 없는 클론이 죽는다).
 */
export function createSessionClient(
  cookies: CookieAdapter,
  env: { url?: string; anonKey?: string }
): SupabaseClient | null;
```

테스트:
- 키가 둘 다 있으면 `null`이 아니고 `.auth`·`.from`을 갖는다
- `url`이 없으면 `null`, `anonKey`가 없으면 `null`, 둘 다 없으면 `null`
- **URL 형식이 깨져 있으면 던지지 않고 `null`** (`store-factory`의 `createClientFrom`과 같은 결)
- `env`를 인자로 받으므로 `process.env`를 건드리지 않는다 (테스트가 환경을 오염시키지 않는다)

구현 주의:
- `createServerClient(url, anonKey, { cookies: { getAll, setAll } })`.
  `setAll`은 **서버 컴포넌트에서 호출되면 던진다** — `try/catch`로 삼킨다.
  (`proxy`가 세션을 갱신하므로 서버 컴포넌트에서 못 써도 된다. 그 이유를 주석으로 남긴다.)
- `SUPABASE_SERVICE_ROLE_KEY`라는 문자열이 이 파일에 **나오면 안 된다.**

### 2. `src/lib/auth/viewer-session.test.ts` 를 **먼저** 쓴다

```ts
export type SessionOutcome =
  | { status: 'anonymous' }
  /** 로그인은 됐는데 profiles 행이 없다. 「미인증」과 다르다 — 로그아웃 버튼이 필요하다 */
  | { status: 'no_profile'; userId: string; email: string }
  | { status: 'ok'; viewer: Viewer };

export async function resolveSession(client: SupabaseClient): Promise<SessionOutcome>;
```

`client`를 **인자로 받는다.** 그래야 손으로 만든 가짜 클라이언트로 전 갈래를 잴 수 있다.
가짜는 테스트 파일 안에 작은 객체로 짓는다 (`vi.mock`으로 `@supabase/ssr`을 통째로 갈아끼우지
마라 — 그러면 우리 코드가 아니라 mock을 재게 된다).

테스트 케이스:

- `getUser()`가 사용자 없음 → `{ status: 'anonymous' }`
- `getUser()`가 **에러** → `anonymous` (던지지 않는다. 만료된 토큰이 흔하다)
- 사용자 있음 + `profiles` 0행 → `{ status: 'no_profile' }`
- 사용자 있음 + `profiles.role='lead'`, `team_id='edit'`, `members` 1행
  → `{ status:'ok', viewer:{ role:'lead', teamId:'edit', memberId:<그 id> } }`
- **`members` 0행 → `memberId: null`** (결정 D의 `unknown_owner`. `ok`이긴 하다)
- **`profiles.role`이 알 수 없는 값(`'owner'`·`''`·`null`) → `no_profile`.**
  임의 문자열을 `ViewerRole`로 흘려보내면 `viewer-scope`의 `switch`가 어느 갈래에도 안 걸려
  「아무것도 안 보임」이 되는데, 그 원인은 화면에서 영영 드러나지 않는다
- `team_id`가 `TeamKey` 셋 중 하나가 아니면 `teamId: null` (값은 버리고 역할은 살린다)
- **`getUser()`를 부르고 `getSession()`은 부르지 않는다** — 가짜 클라이언트에 `getSession`을
  두고 「불리면 실패」로 만들어 잰다. 이 단언이 이 파일에서 가장 중요하다
- `email`이 없는 계정(전화 로그인 등)은 빈 문자열로 둔다. 던지지 않는다

구현 주의:
- 조회는 `profiles`(자기 행)와 `members`(`auth_user_id`) 둘뿐이다. `tasks`를 읽지 마라.
- `members`는 `order('id').limit(1)` — `my_member_id()`(step 4)와 **같은 결정 규칙**이어야
  한다. 다르면 화면과 DB가 서로 다른 구성원을 「나」로 본다.
- 던지지 않는다. 어떤 실패도 `anonymous`나 `no_profile`로 접는다.

### 3. 얇은 호출부는 만들지 않는다

`cookies()`를 읽어 `createSessionClient`에 넘기는 코드는 **step 7·10이 자기 자리에서** 쓴다.
여기서 `getViewer()` 같은 전역 헬퍼를 미리 만들지 마라 — 호출부가 서버 컴포넌트냐 라우트냐
`proxy`냐에 따라 쿠키 어댑터가 다르고, 하나로 묶으면 그 차이가 감춰진다.

## Acceptance Criteria

```bash
npm run test -- src/lib/auth/session-client.test.ts src/lib/auth/viewer-session.test.ts
npm run lint && npm run build && npm run test
grep -rn 'SERVICE_ROLE' src/lib/auth/                 # 0줄
grep -rn 'getSession' src/lib/auth/viewer-session.ts  # 0줄
grep -rn 'process.env' src/lib/auth/                  # 0줄 (환경은 인자다)
grep -rn 'getSession' src/lib/auth/viewer-session.test.ts   # 1줄 이상 (부르면 실패시키는 가드)
node -e "console.log(require('./package.json').dependencies['@supabase/ssr'])"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 변이 테스트 셋을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - `getUser()`를 `getSession()`으로 바꾼다 → 가드 단언이 잡아야 한다
   - 알 수 없는 `role`을 그대로 통과시킨다 → 해당 케이스가 잡아야 한다
   - `createSessionClient`가 `anonKey` 대신 `service_role`을 쓰게 바꾼다 → `grep` AC가 잡는다
     (테스트로는 안 잡힌다는 것을 `summary`에 적어라 — grep과 리뷰가 지키는 규칙이다)
3. 체크리스트:
   - `resolveSession`이 `client`를 인자로 받는가? 안에서 만들지 않는가?
   - `members` 선택 규칙이 step 4의 `my_member_id()`와 같은가? (`order by id limit 1`)
   - `@supabase/ssr` 외에 새 의존성이 늘지 않았는가?
4. `phases/t8-auth-rls/index.json`의 step 6을 갱신한다.

## 금지사항

- 로그인/로그아웃 동작을 여기서 만들지 마라. step 10의 일이다.
- `src/proxy.ts`를 만들지 마라. step 10의 일이다.
- 브라우저용 클라이언트(`createBrowserClient`)를 만들지 마라. 로그인은 서버 액션으로 하므로
  **필요 없다.** 만들면 anon 키가 클라이언트 번들에 실릴 자리가 하나 늘고, 쓰지 않는 코드가
  남는다.
- 역할을 JWT의 `user_metadata`·`app_metadata`에서 읽지 마라.
- `store-factory.ts`·`read-context.ts`·`viewer-role.ts`를 고치지 마라. step 7·8의 일이다.
- 기존 테스트를 깨뜨리지 마라.
