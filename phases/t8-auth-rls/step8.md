# Step 8: viewer-role-gate

## 읽어야 할 파일

- `CLAUDE.md` — 라우트 핸들러와 서버 컴포넌트는 `src/lib/`를 **호출만 하고 계산하지 않는다** ·
  서버 컴포넌트는 자기 API 라우트를 fetch하지 않는다 · `src/app/api/**`에 `runtime='nodejs'`
- `docs/TICKETS.md` — T8 완료 기준 **1**·**5**·**6**(프로덕션+Supabase에서 `?as=admin`이 무시된다)
- `docs/PLAN.md` — `S4`, step 0이 붙인 **결정 E**의 3줄 표
- `docs/ADR.md` — `ADR-013`, step 0이 쓴 `ADR-024`·`ADR-026`
- `docs/ARCHITECTURE.md` — 「에러 처리」 코드 목록
- 이전 step 산출물: `viewer-scope.ts`(1) · `viewer-storage.ts`(7) ·
  `session-client.ts`·`viewer-session.ts`(6)
- 고쳐야 할 파일:
  - `src/lib/api/viewer-role.ts` — **머리말 전체를 읽는다.** 이 step이 그 문서를 갱신한다
  - `src/lib/api/read-context.ts` — 「지연 거르기는 저장소가 아니라 여기서 한다」 문단
  - `src/lib/api/api-error.ts` — 코드 표 (`UNAUTHENTICATED` 추가)
  - 조회 라우트 6종: `api/tasks` · `api/tasks/[id]` · `api/stats` · `api/alerts` ·
    `api/goals` · `api/report/weekly`
  - 서버 컴포넌트 4종: `app/page.tsx` · `app/teams/[teamSlug]/page.tsx` ·
    `app/upload/page.tsx` · `app/extract/page.tsx`

## 배경

부품은 다 있다. 이 step이 **조회 경로 전체를 그 부품 위로 옮긴다.** 여기서 완료 기준 5와 6이
동시에 선다.

한 가지를 먼저 정직하게 적어 두자. **데모 모드에서는 범위가 갈리지 않는다.** `?as=lead`에는
붙일 팀도 구성원도 없다 — 그건 흉내이고, 흉내에 범위를 주면 「권한이 있는 척」이 된다.
데모에서 `?as=`가 바꾸는 것은 지금처럼 **섹션 배치와 민감 `extras` 마스킹**뿐이고,
**범위 구분은 로그인했을 때만 일어난다.** 이 사실을 `viewer-role.ts` 머리말과
`ARCHITECTURE.md`에 적는다 — 적어 두지 않으면 다음 사람이 데모에서 재 보고 「권한이 안 걸린다」고
결론 내린다.

## 작업

### 1. `src/lib/auth/request-viewer.ts` — Next의 `cookies()`를 만지는 **유일한 자리**

step 6이 미뤄 둔 얇은 호출부다. 서버 컴포넌트와 라우트 핸들러가 같은 모양이라 이제 하나로 묶는다.
(`proxy`는 요청 객체의 쿠키를 쓰므로 이것을 쓰지 않는다 — step 10.)

```ts
/** 이 요청의 조회 문맥. 쿠키 → 세션 클라이언트 → ViewerContext */
export async function currentViewerContext(): Promise<ViewerContext>;
```

- `cookies()`는 Next 16에서 **Promise**다. `await`한다.
- `createSessionClient(어댑터, { url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY })`.
  `process.env`를 읽는 것은 **여기까지**다 (`getStorage()`가 같은 이유로 여기서만 읽는다).
- `resolveViewerContext(await getStorage(), client)`를 돌려준다.
- 테스트: `next/headers`를 `vi.mock`으로 갈아 끼워 쿠키를 주고, 자격증명이 없으면
  `session.status === 'anonymous'`이고 `repo === base.repo`인지 잰다. 파일이 얇으므로
  케이스도 둘·셋이면 된다.

### 2. `viewer-role.ts` — 세션이 `?as=`를 이긴다

```ts
export function resolveViewerRole(
  asParam: string | null,
  env: { nodeEnv: string | undefined; mode: StorageMode },
  session: SessionOutcome
): ViewerRole;
```

**판정 순서 (결정 E).** 위에서부터 먼저 걸리는 것이 이긴다.

1. `session.status === 'ok'` → `session.viewer.role`. **환경과 무관하다.**
2. `nodeEnv === 'production' && mode !== 'demo'` → `'member'` (기존 `S4`)
3. 그 밖 → `?as=` 해석, 모르면 `'member'` (기존 `ADR-013`)

테스트에 **반드시** 들어갈 것:
- 개발 환경 + 라이브 + 세션 `member` + `?as=admin` → `'member'`.
  **이 케이스가 이 step의 존재 이유다** (기존 규칙이면 `admin`이 나온다)
- 프로덕션 + 라이브 + 세션 `admin` → `'admin'` (세션은 프로덕션에서도 진다)
- 세션 `no_profile` → 2·3번 규칙으로 내려간다 (프로필 없는 계정이 `?as=`로 승격되지
  않도록 프로덕션+라이브에서는 `member`)
- 기존 케이스 전부 그대로 통과 (세션 `anonymous`를 넘긴다)

머리말의 「인증은 T8이다」 문단을 **현재형으로 고친다.** 「그때까지」로 시작하는 문장이
남아 있으면 문서가 거짓말이 된다.

### 3. `read-context.ts` — 문맥을 받고, 범위를 거른다

```ts
export async function buildReadContext(
  view: ViewerContext,      // ← StorageHandle에서 바뀐다
  now: Date,
  params: ReadContextParams
): Promise<ReadContext>;
```

- 조회는 `view.repo`로 한다 (JWT). `view.base.repo`를 조회에 쓰지 마라.
- `meta`의 `driver`·`mode`·`readOnly`는 `view.base`에서 온다 (저장소의 성질이지 사용자의
  성질이 아니다).
- `role`은 `resolveViewerRole(params.as, {nodeEnv, mode: view.base.mode}, view.session)`.
- **범위 거르기**: `view.session.status === 'ok'`이면 `scopeTasks(listed, view.session.viewer)`를
  통과시킨다. 그 뒤에 기존 `overdueOnly` 거르기와 `flags` 좁히기가 온다 — **순서를 지켜라.**
  범위를 나중에 거르면 플래그 표와 목록의 모수가 어긋난다.
- `ReadContext`에 `viewer: Viewer | null`을 추가한다. 화면(step 11)과 `PATCH`(step 9)가
  같은 판정을 다시 하지 않도록.
- 라이브에서는 RLS가 이미 걸러 이 거르기가 대개 no-op이다. **그래도 둔다** — 두 층이 같은
  규칙일 때만 안전하고, 한 층이 사라지면(예: 정책 실수) 다른 층이 남는다. 그 이유를 주석에.
- 기존 테스트가 `StorageHandle`을 넘기고 있을 것이다. 가짜 `ViewerContext`를 만드는 작은
  헬퍼를 테스트 파일 안에 두고 전부 고친다. **기대값을 느슨하게 바꾸지 마라.**

### 4. `api-error.ts` — `UNAUTHENTICATED` 하나

```
UNAUTHENTICATED | 401 | 로그인이 필요합니다.
```

파일 주석의 「여기서 늘리지 않는다 — 필요하면 문서를 먼저 고친다」를 지켜, step 0이 이미
`ARCHITECTURE.md`에 넣은 것을 확인하고 옮겨 적는다. 문구는 **글자까지 같아야 한다.**
`toApiErrorCode`가 새 예외 타입을 잡게 만들지 마라 — 이 코드는 라우트가 명시적으로 낸다.

### 5. 호출부 10곳을 옮긴다

조회 라우트 6종·서버 컴포넌트 4종에서 `await getStorage()` → `await currentViewerContext()`,
`buildReadContext(storage, …)` → `buildReadContext(view, …)`.

- **업로드·시드·확정 라우트와 `/api/health`는 손대지 마라.** 그쪽은 `getStorage()`
  (`service_role`) 그대로다 (`ADR-024`).
- `upload/page.tsx`·`extract/page.tsx`가 `storage.readOnly`·`storage.uploads`를 쓰고 있으면
  `view.base`에서 읽는다.
- `app/page.tsx`·`teams/[teamSlug]/page.tsx`가 `storage.repo.listGoalMetrics(...)`를 직접
  부르고 있으면 `view.repo`로 바꾼다 — 라이브에서 목표 지표에도 RLS가 걸려야 한다.
- **계산을 라우트로 옮기지 마라.** 바뀌는 것은 「무엇을 부르는가」뿐이고 줄 수는 늘지 않아야 한다.
- 각 라우트/페이지의 기존 테스트를 통과시킨다. `getStorage`를 mock하던 테스트는
  `currentViewerContext`(또는 그 아래 `getStorage`)를 mock하도록 최소로 고친다.

### 6. 문서

- `docs/ARCHITECTURE.md`「권한 (T8)」에 **「데모 모드에서는 범위가 갈리지 않는다」** 한 문단을
  추가한다 (위 배경의 내용).
- `docs/PLAN.md`「T8 착수 시 확정」의 결정 E 표 아래에 같은 사실을 한 줄로 남긴다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -rn 'getStorage' src/app/api/tasks src/app/api/stats src/app/api/alerts src/app/api/goals src/app/api/report src/app/page.tsx src/app/teams
#   → 0줄 (조회 경로는 전부 currentViewerContext)
grep -rn 'getStorage' src/app/api/uploads src/app/api/health
#   → 그대로 남아 있어야 한다 (service_role 경로)
grep -rn 'cookies()' src/lib src/app | grep -v test
#   → src/lib/auth/request-viewer.ts 한 줄만
grep -n 'UNAUTHENTICATED' src/lib/api/api-error.ts docs/ARCHITECTURE.md
grep -n '인증은 T8이다\|그때까지' src/lib/api/viewer-role.ts   # 0줄 (문서를 현재형으로 고쳤다)
```

라이브 확인 (`npm run dev` + 로그인 없이):
```bash
curl -s 'localhost:3000/api/tasks' | head -c 400     # 라이브면 tasks 0건 (RLS). 500이 아니다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 변이 테스트 넷을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - `resolveViewerRole`에서 1번 규칙(세션 우선)을 맨 **아래**로 내린다 → 「개발+라이브+세션
     member+`?as=admin`」 케이스가 잡아야 한다
   - `buildReadContext`가 `view.base.repo`로 조회하게 바꾼다 → 조회 테스트가 잡아야 한다.
     **잡히지 않으면 테스트를 보강하라** (라이브 RLS 없이는 이 변이가 조용할 수 있다)
   - `scopeTasks` 호출을 `overdue` 거르기 **뒤로** 옮긴다 → 플래그 모수 단언이 잡아야 한다
   - `UNAUTHENTICATED`의 문구를 한 글자 바꾼다 → 문서 대조 테스트가 있으면 잡힌다.
     없으면 만들지 말고 `summary`에 「grep으로만 지켜진다」고 적어라
3. 체크리스트:
   - 업로드·시드·확정 라우트가 여전히 `service_role`인가? (완료 기준 5의 뒷절)
   - `cookies()`가 한 곳에만 있는가?
   - 라우트·페이지에 계산 로직이 늘지 않았는가? (`git diff`로 줄 수를 본다)
4. `phases/t8-auth-rls/index.json`의 step 8을 갱신한다.

## 금지사항

- `PATCH` 라우트를 만들지 마라. step 9의 일이다.
- `/login`·`proxy.ts`를 만들지 마라. step 10의 일이다.
- 화면의 문구·레이아웃을 바꾸지 마라. step 11의 일이다. 이 step은 **데이터 경로**만 옮긴다.
- 미인증 요청을 라우트에서 401로 막지 마라. 지금 단계에서 막으면 데모 모드가 통째로 죽는다 —
  「보호」는 `proxy`가 지고(step 10), 조회는 RLS가 0행으로 답하는 것으로 충분하다.
- `store-factory.ts`의 캐시를 건드리지 마라.
- 기존 테스트의 기대값을 느슨하게 바꿔서 통과시키지 마라.
