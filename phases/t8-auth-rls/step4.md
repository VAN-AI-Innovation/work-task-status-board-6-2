# Step 4: auth-rls-migration

## 읽어야 할 파일

- `CLAUDE.md` — 보안·데이터 규칙 전부. 특히 `service_role` 키를 로그·문서에 남기지 않는다
- `docs/TICKETS.md` — T8 완료 기준 **3**(정책이 무한 재귀하지 않는다) · **4**
  (`set search_path = ''`가 고정되고 스키마가 명시돼 있다)
- `docs/PLAN.md` — `S5`(「`security definer` 함수는 `search_path`를 고정하지 않으면 권한 상승
  경로가 된다」) · `S6`(개인정보) · 「8. 권한」
- `docs/ARCHITECTURE.md` — step 0이 채운 「권한 (T8)」 절
- `supabase/migrations/0001_init.sql` — **전체를 읽는다.** 테이블 목록·`members` 스키마·
  맨 아래 「RLS — 지금 켜고, 정책은 T8에서 붙인다」 블록. 파일 머리말의 적용 방법도 읽는다
- `supabase/migrations/0002_seed_reference.sql` — 마이그레이션 파일의 형식·주석 밀도
- step 1 산출물: `src/lib/domain/viewer-scope.ts` — **이 SQL은 그 파일의 표를 옮겨 적는 것이다**

## 배경

지금 원격 DB는 **RLS가 켜져 있고 정책이 하나도 없다.** 그래서 `anon`·`authenticated` 키로는
아무것도 읽히지 않고, 앱은 `service_role`로만 붙어 있다. 안전하지만 **권한 구분이 없다** —
서버가 통과시키면 전부 보인다.

이 step이 그 문을 연다. 여는 순간이 T8에서 가장 위험한 지점이다:

- 정책이 틀리면 **로그인한 사람에게 화면이 통째로 빈다.** 티켓의 「리스크·미결」이 그것이다.
- 정책이 느슨하면 **부원이 전사 데이터를 읽는다.** 시트에는 실명·출연자 연락처·문의자 계정이
  있다 (`S6`).
- `security definer` 함수의 `search_path`를 빠뜨리면 **권한 상승 경로**가 된다 (`S5`).

그래서 규칙은 하나다. **step 1의 표와 글자 그대로 대응시킨다.** 새 규칙을 여기서 발명하지
마라. 다르게 하고 싶은 것이 생기면 `viewer-scope.ts`와 이 파일을 **같이** 고쳐야 하고,
그 근거는 문서에 있어야 한다.

## 이 step은 원격 Supabase를 실제로 고친다 (사용자 승인 범위)

- 프로젝트 ref: **`ebeylvqmcungiitspaib`** (`.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`과 같은
  프로젝트인지 먼저 확인하라. 다르면 즉시 `blocked`다)
- 적용 수단: Supabase MCP의 `apply_migration` (이름 `t8_auth_rls`).
  **MCP 도구를 쓸 수 없으면 파일만 쓰고 `blocked`로 기록한 뒤 중단하라.** psql·CLI를 설치하거나
  키로 임의 HTTP를 쏘는 우회로를 만들지 마라.
- **금지**: `drop table`, 기존 컬럼 삭제·변경, 실업무 행 삭제, `truncate`.
  이 step이 만드는 것은 `profiles` 한 테이블 + 함수 3개 + 정책 + 권한 조정뿐이다.

## 작업

### 1. `supabase/migrations/0003_auth_rls.sql` 을 쓴다

파일 머리말은 `0001_init.sql`의 결을 따른다 — 적용 방법, 근거 문서, **여기에 없는 것과 그 이유**.
아래가 내용의 명세다. 주석은 한국어로, 「왜」를 남긴다.

```sql
-- ── 1. profiles ────────────────────────────────────────────────────────────
-- auth.users와 1:1. 역할의 단일 소스다. members와 합치지 않는 이유: members는 시트에서 오는
-- 조직 명부이고(계정 없는 구성원이 대부분), profiles는 로그인 계정의 권한이다.
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','lead','member')),
  team_id    text references teams(id),   -- lead가 맡은 팀. admin은 null일 수 있다
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
```

`email`을 두지 않는다 — `auth.users`에 이미 있고, 복사본은 갱신되지 않는 개인정보다 (`S6`).

```sql
-- ── 2. security definer 함수 셋 ────────────────────────────────────────────
-- 정책 안에서 profiles를 직접 select하면 profiles의 정책이 다시 걸려 무한 재귀다 (완료 기준 3).
-- set search_path = '' 는 선택이 아니다 — 없으면 호출자가 같은 이름의 테이블을 자기 스키마에
-- 만들어 함수를 속일 수 있다 (S5, 완료 기준 4). 그래서 테이블 이름에 스키마를 전부 적는다.
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = (select auth.uid()) $$;

create or replace function public.my_team() returns text
  language sql stable security definer set search_path = ''
as $$ select p.team_id from public.profiles p where p.id = (select auth.uid()) $$;

-- members.auth_user_id는 유니크 제약이 없다. 한 계정이 두 구성원에 붙는 실수를 정책이
-- 임의로 고르지 않도록 order by + limit 1로 결정적으로 만든다.
create or replace function public.my_member_id() returns uuid
  language sql stable security definer set search_path = ''
as $$ select m.id from public.members m
      where m.auth_user_id = (select auth.uid()) order by m.id limit 1 $$;
```

```sql
-- ── 3. 정책 ────────────────────────────────────────────────────────────────
-- create policy에는 if not exists가 없다. 재적용 가능하도록 drop policy if exists를 앞세운다.
```

정책 표 — **`viewer-scope.ts`와 1:1이다.**

| # | 테이블 | 동작 | `using` |
|---|---|---|---|
| 1 | `profiles` | select | `id = (select auth.uid())` — 자기 행만 |
| 2 | `departments`·`teams`·`enum_options`·`sla_rules` | select | `true` (로그인 한정. 개인정보 없음) |
| 3 | `members` | select | `true` — 이름 표다. 담당자 필터 UI가 이걸 읽는다 |
| 4 | `tasks` | select | 아래 `scope_expr` |
| 5 | `tasks` | update | `using scope_expr` + `with check scope_expr` |
| 6 | `task_stages` | select | `exists (select 1 from public.tasks t where t.id = task_stages.task_id)` |
| 7 | `goal_metrics` | select | `my_role()='admin' or (my_team() is not null and team_id = public.my_team())` |
| 8 | `team_period_goals` | select | 7과 같음 |

```
scope_expr :=
     public.my_role() = 'admin'
  or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id         = public.my_team())
  or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
```

- 대상 롤은 전부 **`to authenticated`**다. `anon`에는 정책을 하나도 만들지 않는다 —
  로그아웃 상태에서 데이터가 보이면 안 된다.
- 6번은 `tasks`를 select하므로 **4번 정책이 다시 걸린다.** 그것이 의도다 — 단계 타임라인의
  범위를 따로 적으면 두 벌이 된다. `tasks` 정책이 `task_stages`를 보지 않으므로 재귀가 아니다.
- **`uploads`·`task_events`·`doc_extractions`에는 정책을 만들지 않는다.** 서버(`service_role`)
  전용이다. `uploads.parse_result`에는 문서·시트 본문이 통째로 들어 있다 (`S6`).

```sql
-- ── 4. 권한(GRANT) — 정책만으로는 컬럼을 좁힐 수 없다 ──────────────────────
-- RLS는 "어느 행"이고 GRANT는 "어느 컬럼"이다. 정책이 통과시킨 행에서 authenticated가
-- title·due_at·raw를 고칠 수 있으면 UC-16의 "상태·진행률 수정"이 아니라 시트 편집기가 된다.
revoke insert, update, delete on public.tasks from authenticated;
grant  update (status, progress, updated_at) on public.tasks to authenticated;
```

- 나머지 테이블은 `authenticated`에 **select만** 남긴다 (`revoke insert, update, delete`).
- `anon`에게는 **이 스키마의 테이블 권한을 전부 회수한다** (`revoke all on <각 테이블> from anon`).
  로그인 전에는 어떤 테이블도 닿지 않는다. 로그인 자체는 `auth` 스키마의 엔드포인트라
  영향받지 않는다.
- `service_role`은 손대지 마라. 업로드 확정·시드가 그 키로 돈다 (`ADR-024`).
- `grant execute`를 함수에 따로 적지 마라 — `public`에 기본 부여돼 있고, 함수는 자기 행만
  돌려주므로 문제가 되지 않는다.

### 2. 원격에 적용한다

1. `mcp__supabase__list_projects`로 ref를 확인한다 (`ebeylvqmcungiitspaib`).
2. `mcp__supabase__apply_migration`(`name: 't8_auth_rls'`)으로 파일 내용을 그대로 적용한다.
3. `mcp__supabase__execute_sql`로 **적용 결과를 직접 조회해 확인한다**:
   - `select proname, prosecdef, proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('my_role','my_team','my_member_id')`
     → 3행, `prosecdef` 전부 `true`, `proconfig`에 `search_path=` 가 들어 있다 (**완료 기준 4**)
   - `select tablename, policyname, cmd from pg_policies where schemaname='public' order by tablename`
     → 위 표와 일치. `uploads`·`task_events`·`doc_extractions`가 **없어야 한다**
   - `select relname, relrowsecurity from pg_class where relname='profiles'` → `true`
   - `select count(*) from tasks` → step 시작 때와 **같아야 한다** (아무것도 지우지 않았다)
4. `mcp__supabase__get_advisors`(`type: 'security'`)를 돌려 새로 생긴 경고를 확인한다.
   `function_search_path_mutable`·`rls_disabled_in_public`이 **이 step의 대상에 대해 나오면
   고친다.** 이전부터 있던 다른 경고는 건드리지 않고 `summary`에 적기만 한다.

### 3. 문서를 실제와 맞춘다

- `supabase/migrations/0001_init.sql` 맨 아래 「정책은 T8에서 붙인다」 주석에 **한 줄만** 덧붙인다:
  「→ `0003_auth_rls.sql`이 붙였다」. 기존 문장을 지우지 마라.
- `docs/ARCHITECTURE.md`「권한 (T8)」의 정책 표가 실제 적용 결과와 다르면 **문서를 고친다.**

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test     # 코드는 안 바뀌었지만 게이트는 돈다
grep -c "set search_path = ''" supabase/migrations/0003_auth_rls.sql   # 3 (함수 셋)
grep -c 'public\.' supabase/migrations/0003_auth_rls.sql               # 함수 본문이 스키마를 명시했다
grep -n 'drop table\|truncate\|delete from' supabase/migrations/0003_auth_rls.sql  # 0줄
grep -n 'from profiles' supabase/migrations/0003_auth_rls.sql          # 정책 안에 직접 select 0줄
```

그리고 **MCP 조회 결과 4종**(위 2-3)을 `summary`에 숫자로 남긴다. 「적용했다」만 적지 마라.

## 검증 절차

1. 위 AC 커맨드와 MCP 조회 4종을 실행한다.
2. **재적용 가능성**을 확인한다 — 같은 SQL을 `execute_sql`로 한 번 더 돌려 에러가 없어야 한다
   (`drop policy if exists` + `create or replace` + `if not exists`가 그것을 보장한다).
   두 번째 실행 후 `pg_policies` 건수가 첫 번째와 같아야 한다.
3. 체크리스트:
   - 함수 셋 모두 `security definer` + `search_path` 고정 + 스키마 명시인가? (완료 기준 4)
   - 정책이 `profiles`를 직접 select하지 않는가? (완료 기준 3)
   - `uploads`·`task_events`·`doc_extractions`에 정책이 없는가?
   - `tasks`의 `authenticated` update 권한이 `status`·`progress`·`updated_at` 세 컬럼뿐인가?
   - `tasks` 행 수가 step 시작 때와 같은가?
4. `phases/t8-auth-rls/index.json`의 step 4를 갱신한다.

## 금지사항

- 트리거·뷰·집계 함수를 만들지 마라 (`ADR-006`). 이 파일에 들어가는 함수는 **권한 판정** 셋뿐이다.
- 테스트 계정·`profiles` 행·`members` 행을 여기서 만들지 마라. step 5의 일이다.
  마이그레이션에 데이터를 섞으면 재적용이 데이터를 다시 만든다.
- `.env.local`의 키 값을 SQL·주석·`summary`에 옮겨 적지 마라.
- `src/` 아래 코드를 고치지 마라. 이 step은 SQL과 문서뿐이다.
- 정책을 「일단 `using (true)`로 열어 두고 나중에 좁힌다」로 만들지 마라. 그 「나중」은 오지 않고,
  그 사이에 전 데이터가 `authenticated` 전원에게 열린다.
