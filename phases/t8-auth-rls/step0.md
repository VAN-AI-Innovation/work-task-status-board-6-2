# Step 0: auth-decisions

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(비즈니스 로직은 `src/lib/`, 판정은 `lib/domain/`의 순수 함수,
  `src/lib/` 파일명 전역 유니크, 서버 컴포넌트는 자기 API를 fetch하지 않는다),
  보안 규칙(`service_role`에 `NEXT_PUBLIC_` 금지, `raw` 미노출, 민감 `extras`는 admin·lead만),
  **결정이 바뀌면 코드보다 `docs/PLAN.md`를 먼저 고친다**
- `docs/TICKETS.md` — `## T8 · 인증 + RLS + 권한별 UI 게이팅` 전문 (**완료 기준 7개**)
- `docs/PLAN.md` — 「8. 권한 — 초안 범위 (T8)」, `S4`(`?as=` 우회) · `S5`(키 관리와 RLS 함정) ·
  `S6`(개인정보) · `A3`(서버 컴포넌트/라우트 경계) · `UC-16`(내 업무 수정) ·
  「검증 체크리스트」 23번
- `docs/ARCHITECTURE.md` — 「권한 (T8)」, 「에러 처리」 코드 목록, 「데이터 모델」
- `docs/ADR.md` — `ADR-004`(Supabase 직행) · `ADR-005`(읽기 전용 폴백) · `ADR-006`(집계는 JS) ·
  `ADR-007`(서버 컴포넌트가 lib 직접 호출) · `ADR-013`(`?as=`는 메모리 드라이버에서만).
  **마지막 번호는 `ADR-023`이다**
- `supabase/migrations/0001_init.sql` — `members.auth_user_id`, 맨 아래 「RLS — 지금 켜고,
  정책은 T8에서 붙인다」 블록. **`profiles` 테이블은 아직 없다**
- `src/lib/api/viewer-role.ts` — 현재의 `?as=` 해석 (T8이 바꿀 자리)
- `src/lib/domain/extras-visibility.ts` — `ViewerRole` 타입이 지금 여기 산다
- `src/lib/store/store-factory.ts` — `getStorage()`가 **프로세스 전역 싱글턴**이라는 사실.
  T8의 조회 경로 전환이 부딪히는 자리다
- `src/types/task.ts` — `Task.ownerMemberId`·`teamId`. 범위 판정이 이 두 필드로만 선다

## 배경

T8은 과제 원문 요구 6번(권한별 열람·수정 범위 구분)이다. **T6까지는 방어가 하나도 없다** —
`?as=admin`을 URL에 치면 관리자 화면이 뜨고, 서버는 아무것도 거부하지 않는다. 여기서
「보이지 않는다」를 「할 수 없다」로 바꾼다.

이 step은 코드를 거의 쓰지 않는다. **뒤 step 열한 개가 딛고 설 결정 6건을 문서에 박고**
타입을 놓는다. T8은 앞의 어느 티켓보다 되돌리기가 비싸다 — 조회 경로 전환(결정 B)은
`getStorage()` 싱글턴을 건드리고, RLS 정책은 원격 DB에 적용된다. 전제가 step마다 갈라지면
절반쯤에서 앞 step을 다시 뜯게 된다.

## 이 phase는 원격 Supabase를 실제로 고친다

step 4가 마이그레이션을 원격에 적용하고 step 5가 계정 3개를 만든다. **사용자가 승인한
범위다.** 다만 아래 셋은 이 phase 전체에서 금지다.

- 기존 테이블을 `drop`하거나 컬럼을 지우지 마라. T8이 추가하는 것은 `profiles` 한 테이블과
  함수·정책뿐이다.
- 원격의 **실업무 행을 지우지 마라.** 계약 테스트가 `contract::` 접두사로 자기 행만 세는
  이유가 그 행들이 거기 있기 때문이다 (`ADR-023`).
- `.env.local`의 키 값을 로그·문서·커밋에 옮겨 적지 마라.

## 작업

### 1. 결정 6건을 문서에 반영한다

`docs/PLAN.md`「8. 권한 — 초안 범위 (T8)」 절을 **고쳐 쓰지 말고 이어 붙인다.**
기존 문단은 근거로 남는다. 소절 제목은 **「T8 착수 시 확정」**이다.

#### 결정 A — 세션은 `@supabase/ssr` 쿠키다. 게이트는 `src/proxy.ts`

`@supabase/ssr`을 의존성에 추가한다 (`npm i @supabase/ssr`). 직접 쿠키를 굽는 대신 이 패키지를
쓰는 이유는 **리프레시 토큰 회전**이다 — access token은 1시간이면 만료되고, 갱신을 우리가 짜면
「조용히 로그아웃되는 버그」가 이 프로젝트에서 가장 재현하기 어려운 종류가 된다.

Next.js 16에서 `middleware.ts`는 **`proxy.ts`로 이름이 바뀌었다**
(`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
파일은 `src/proxy.ts`이고 export 이름은 `proxy`다. `middleware`라고 쓰면 아무 일도 일어나지 않는다.

#### 결정 B — 조회는 사용자 JWT, 쓰기 중 업로드 확정·시드만 `service_role`

완료 기준 5가 못박은 것이다. **전부 `service_role`로 처리하면 RLS를 만들어도 의미가 없다.**

| 경로 | 클라이언트 | 이유 |
|---|---|---|
| 대시보드·팀 탭·조회 라우트 6종 | anon 키 + 사용자 JWT | RLS가 실제로 걸린다 |
| `PATCH /api/tasks/[id]` | anon 키 + 사용자 JWT | 서버 판정이 뚫려도 DB가 한 번 더 막는다 |
| 업로드 확정 · `/api/uploads/seed` | `service_role` | 시트 전체를 쓴다. 올린 사람의 범위 밖 행도 쓴다 |
| `/extract` 두 라우트 | 저장소를 부르지 않는다 | `ADR-022` |

`getStorage()`는 **프로세스 전역 싱글턴**이라 사용자 JWT를 담을 수 없다(요청마다 다르다).
그래서 `getStorage()`는 `service_role` 경로 전용으로 남기고, 조회용 **요청 스코프** 핸들을
`src/lib/store/viewer-storage.ts`가 따로 만든다 (step 7). 싱글턴에 JWT를 밀어 넣지 마라 —
한 사용자의 토큰이 다음 요청의 다른 사용자에게 새는 자리다.

#### 결정 C — `security definer` 함수는 **셋**이다

`PLAN.md`·`ARCHITECTURE.md`가 적은 것은 `my_role()`·`my_team()` 둘인데, **`member` 범위를
그 둘로는 표현할 수 없다.** `member`가 보는 것은 「본인이 담당인 건」이고 그 판정은
`tasks.owner_member_id = (내 members 행의 id)`다. 정책 안에서 `members`를 직접 select하면
`members`의 정책이 다시 걸려 재귀·성능 함정으로 들어간다.

확정: **`public.my_member_id()`를 셋째 함수로 둔다.**

```sql
my_role()       → text   -- profiles.role. 없으면 null (로그인했지만 프로필이 없는 계정)
my_team()       → text   -- profiles.team_id. admin은 null일 수 있다
my_member_id()  → uuid   -- members.auth_user_id = auth.uid() 인 행의 id. 없으면 null
```

셋 다 `language sql` · `stable` · `security definer` · **`set search_path = ''`** 이고
테이블 이름에 스키마를 명시(`public.profiles`)한다. `search_path`를 고정하지 않으면 호출자가
같은 이름의 테이블을 자기 스키마에 만들어 함수를 속일 수 있다 — **권한 상승 경로다** (`S5`).

#### 결정 D — 매칭 실패는 `unknown_owner`다. `member` 범위에서 빠진다

시트의 담당자는 자유 입력 문자열이라 `members` 행에 붙지 않는 이름이 남는다. 그런 태스크는
`owner_member_id`가 `null`이고, `member`에게 **보이지 않는다.** `null`을 「내 것」으로 치면
담당자 미상 업무가 전원에게 보이고, 그것은 범위 구분이 아니다.

이건 티켓의 「리스크·미결」이 이미 정한 값이다. 화면이 그것을 숨기지 않는다 — `admin`·`lead`
에게는 그대로 보이고, `member` 화면의 빈 상태 문구가 「담당자가 연결되지 않았을 수 있습니다」를
한 줄 알린다 (step 11).

#### 결정 E — 데모 모드는 인증을 요구하지 않는다

`.env` 없이 클론해 바로 도는 경로(`STORAGE_DRIVER=memory`)가 죽으면 심사자가 아무것도 못 본다.
확정: **`proxy`는 Supabase 자격증명이 없거나 `STORAGE_DRIVER=memory`면 리다이렉트하지 않는다.**
그 모드에서는 지금처럼 `?as=`가 역할을 정한다 (`ADR-013` 그대로).

그래서 `?as=` 차단 규칙이 T8에서 **한 줄 늘어난다**:

```
세션이 있으면      → 세션의 role이 이긴다. ?as=는 무시된다 (개발 환경에서도)
세션이 없고 프로덕션+실저장소 → member (기존 규칙, S4)
세션이 없고 데모·폴백  → ?as= 해석 (기존 규칙, ADR-013)
```

「프로덕션에서만 무시」로 두면 개발 서버에서 로그인한 `member`가 `?as=admin`으로 남의 팀을
읽는다. **세션이 있는데 URL이 이기는 경우는 없다.**

#### 결정 F — 에러 코드 `UNAUTHENTICATED`(401) 하나를 추가한다. PATCH 허용 필드는 둘

`ARCHITECTURE.md`「에러 처리」 목록에 `UNAUTHENTICATED`를 추가한다. `FORBIDDEN`(403)은 이미
있고 **둘을 뭉개지 않는다** — 「로그인하세요」와 「당신은 이걸 못 합니다」는 사용자가 할 일이
정반대다.

| 코드 | 상태 | 문구 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | 로그인이 필요합니다. |
| `FORBIDDEN` (기존) | 403 | 이 작업을 수행할 권한이 없습니다. |

`PATCH /api/tasks/[id]`가 받는 필드는 **`status`·`progress` 둘뿐이다** (`UC-16` "내 업무
상태·진행률 수정"). `note`·`dueAt`·`ownerNameRaw`를 열지 않는다 — 시트가 진실의 원천이고
(`ADR-008`) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 자기 수정이 사라지는 것을
본다. 코드 수정은 step 8·9가 한다. **이 step에서는 `api-error.ts`를 고치지 마라.**

#### 문서 반영 위치

- `docs/PLAN.md` — 「8. 권한 — 초안 범위 (T8)」 끝에 **「T8 착수 시 확정」** 소절로 결정
  A~F를 붙인다. 기존 문단(`profiles.role` 3종, RLS 재귀 함정, `service_role` 용도)은
  **지우지 마라.** `S4`의 확정 코드 블록 아래에 결정 E의 3줄 표를 이어 붙인다.
- `docs/ADR.md` — 기존 형식(**결정**/**이유**/**트레이드오프**)으로 셋을 추가한다:
  - `ADR-024`: 조회는 사용자 JWT로 나가고 `service_role`은 업로드 확정·시드에만 (결정 B)
  - `ADR-025`: `security definer` 함수는 셋이고 `my_member_id()`가 `member` 범위를 진다 (결정 C)
  - `ADR-026`: 세션이 있으면 `?as=`는 환경과 무관하게 진다 — `ADR-013`을 **좁힌다** (결정 E)

  `ADR-026`은 `ADR-013`을 번복하는 것이 아니라 **조건을 하나 더 얹는 것**이다. `ADR-015`↔`ADR-018`
  처럼 「번복」이라고 쓰지 마라 — 데모 모드에서 `?as=`는 그대로 살아 있다.
  결정 A·D·F는 ADR을 만들지 않는다. A는 패키지 선택이고, D는 티켓이 이미 정했고, F는 표에 남는다.
- `docs/ARCHITECTURE.md` —
  - 「권한 (T8)」 절을 확정된 내용으로 채운다: `profiles` 스키마, 함수 셋의 시그니처,
    정책 표(어느 테이블에 어느 역할이 무엇을 하는가), 조회/쓰기 클라이언트 분리 그림.
  - 「에러 처리」 코드 블록에 `UNAUTHENTICATED` 추가.
  - 「데이터 모델」에 `profiles`를 넣고 `members.auth_user_id`가 T8에서 채워진다고 고친다.
  - 디렉토리 구조에 `src/lib/auth/`와 `src/proxy.ts`를 추가한다.
- `docs/TICKETS.md` — T8 **산출물** 줄을 실제 구성으로 고친다 (마이그레이션 1개 +
  `src/lib/auth/` + `src/lib/domain/viewer-scope.ts` + `src/lib/upload/owner-link.ts` +
  `src/lib/store/viewer-storage.ts` +
  `PATCH` 라우트 + `/login` 화면 + `src/proxy.ts`).
  **완료 기준 7개는 한 글자도 약화시키지 마라.**
- 다른 문서·다른 절은 건드리지 마라.

### 2. `src/types/auth.ts` — 인증 계층이 주고받는 타입

TDD 가드는 `src/types/`를 통과시킨다. **뒤 step에서 쓸 것 같은 타입을 미리 만들지 마라.**

```ts
/**
 * 로그인한 사람 하나. `ViewerRole`(`lib/domain/extras-visibility.ts`)을 **재정의하지 않는다** —
 * 그 타입이 이미 마스킹 판정의 입력이고, 두 벌이 되면 어느 쪽이 진짜 역할인지 갈린다.
 */
export interface Viewer {
  /** `auth.users.id` */
  userId: string;
  email: string;
  role: ViewerRole;
  /** `profiles.team_id`. `admin`은 null일 수 있다 */
  teamId: TeamKey | null;
  /** `members.auth_user_id`로 이은 행의 id. 이름이 안 붙으면 null (`unknown_owner`) */
  memberId: string | null;
}

/** `PATCH /api/tasks/[id]`가 받는 전부. 결정 F — 두 필드다 */
export interface TaskPatch {
  status?: string;
  /** 0~100 정수 또는 null(값을 지운다) */
  progress?: number | null;
}
```

`ViewerRole`·`TeamKey`는 **import한다** (`@/lib/domain/extras-visibility`, `@/types/task`).
새로 선언하지 마라.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -n 'ADR-024\|ADR-025\|ADR-026' docs/ADR.md          # 각 1줄 이상
grep -n 'UNAUTHENTICATED' docs/ARCHITECTURE.md            # 1줄 이상
grep -n 'my_member_id' docs/ARCHITECTURE.md docs/PLAN.md  # 각 1줄 이상
grep -n 'T8 착수 시 확정' docs/PLAN.md                     # 1줄
grep -c 'proxy.ts' docs/ARCHITECTURE.md                   # 1 이상
grep -rn "'admin' | 'lead' | 'member'" src/types/auth.ts  # 0줄 (재정의하지 않았다)
git diff --stat docs/                                      # PLAN·ADR·ARCHITECTURE·TICKETS 넷만
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `src/types/auth.ts`가 `ViewerRole`·`TeamKey`를 **import**하는가? 다시 선언하지 않았는가?
   - `PLAN.md`의 기존 「8. 권한」 문단을 지우지 않고 **덧붙였는가?**
   - T8 완료 기준 7개가 약화되지 않았는가?
   - 문서 어디에도 `.env.local`의 키 값이 옮겨 적히지 않았는가?
   - `ADR-026`이 `ADR-013`을 「번복」이라고 쓰지 않았는가? (좁히는 것이다)
3. `phases/t8-auth-rls/index.json`의 step 0을 갱신한다
   (`completed` + `summary`, 실패면 `error` + `error_message`, 사용자 개입 필요면 `blocked`).

## 금지사항

- 구현 코드를 쓰지 마라. 이 step의 `.ts`는 `src/types/auth.ts` 하나다.
- `npm i @supabase/ssr`를 **여기서 하지 마라.** step 6이 그 패키지를 처음 쓰면서 설치한다.
  쓰지 않는 의존성이 커밋에 먼저 들어가면 어느 step이 왜 넣었는지가 사라진다.
- `supabase/migrations/`에 파일을 만들지 마라. step 4의 일이다.
- 원격 Supabase에 아무것도 적용하지 마라. 이 step은 문서와 타입뿐이다.
- `src/lib/api/api-error.ts`·`viewer-role.ts`·`store-factory.ts`를 고치지 마라. 문서가 먼저다.
- 기존 테스트를 깨뜨리지 마라.
