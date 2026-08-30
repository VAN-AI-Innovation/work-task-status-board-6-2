# Step 0: auth-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — 「권한 (T8)」 절
- `/docs/ADR.md` — ADR-024 · ADR-025 · ADR-026
- `/docs/PLAN.md` — 「8. 권한」의 **T8 착수 시 확정** 절 (결정 B·C·D·E·F)
- `supabase/migrations/0001_init.sql` — `teams` · `members` · `tasks` 정의
- `supabase/migrations/0003_auth_rls.sql` — **이 step이 고치는 대상.** 전문을 읽어라
- `supabase/migrations/0004_events_policy.sql`
- `src/lib/domain/viewer-scope.ts` — 범위 표. RLS는 이 표를 옮겨 적은 것이다

`0003_auth_rls.sql`의 머리말 주석과 함수 셋(`my_role` · `my_team` · `my_member_id`),
그리고 각 정책이 그 함수를 **어떻게 조합하는지**를 반드시 이해한 뒤 작업하라. 특히
`goal_metrics_select_scope` · `team_period_goals_select_scope` 두 정책은 두 번째 갈래에
`my_role()` 검사가 **없고** `my_team()`만 본다. 이 사실이 아래 작업의 핵심 근거다.

## 작업

`supabase/migrations/0005_signup_approval.sql` **한 파일만** 만든다. 기존 마이그레이션
파일은 고치지 않는다 (이유: 원격에 이미 적용돼 있어 수정해도 반영되지 않고, 파일과 DB가
어긋난 채로 남는다).

`0003_auth_rls.sql`과 같은 규율을 따른다: **재적용 가능해야 한다.**
`drop policy if exists` · `drop trigger if exists` · `create or replace` ·
`add column if not exists`로 두 번 돌려도 결과가 같아야 한다.

### 1. `profiles` 확장

```sql
alter table profiles
  add column if not exists status text not null default 'active'
    check (status in ('pending','active','rejected')),
  add column if not exists display_name text;
```

- `default 'active'`가 **기존 3개 계정(admin·lead·member)을 그대로 살린다.** 이것이
  의도다. `default 'pending'`으로 두면 마이그레이션을 적용하는 순간 운영 중인 계정이
  전부 잠긴다.
- `display_name`에 길이 상한 check를 건다 (제안: 1~40자, `null` 허용).
- **`email` 컬럼을 만들지 마라.** 이유: `auth.users`에 이미 있고, 복사본은 갱신되지 않는
  개인정보다 (`0003_auth_rls.sql` 1번 절이 같은 이유로 거부했다).
- **`member_id` 컬럼을 만들지 마라.** 이유: `members.auth_user_id`가 이미 그 연결이고
  `my_member_id()`가 그것을 본다. 두 벌이 되면 화면이 보는 「나」와 DB가 보는 「나」가 갈린다.

### 2. 권한 판정 함수 **셋 모두**에 `status='active'` 게이트

`create or replace`로 `my_role()` · `my_team()` · `my_member_id()`를 다시 만든다.
셋 다 호출자의 `profiles.status`가 `'active'`가 아니면 `null`을 돌려준다.

**셋을 다 고치는 것이 이 step에서 제일 중요하다.** `my_role()`만 고치면 구멍이 남는다 —
`goal_metrics_select_scope`의 두 번째 갈래가

```sql
or (public.my_team() is not null and team_id = public.my_team())
```

이라서 `my_role()`을 보지 않는다. 대기 상태인 사람의 `team_id`가 `'marketing'`이면
**승인 전에 마케팅팀 목표 지표가 통째로 보인다.** `team_period_goals_select_scope`도 같다.

- `my_member_id()`는 `members`를 읽으므로 `profiles`를 `exists`로 함께 확인해야 한다.
  기존의 `order by m.id limit 1` 결정 규칙은 **그대로 유지한다** (`viewer-session.ts`가
  같은 규칙으로 「나」를 고른다. 어긋나면 화면과 DB가 다른 구성원을 나로 본다).
- 세 함수 모두 `security definer` · `stable` · `set search_path = ''` · 스키마 전체 표기
  (`public.profiles`)를 유지한다. `search_path` 고정을 빠뜨리면 호출자가 같은 이름의
  테이블을 자기 스키마에 만들어 함수를 속일 수 있다 — **권한 상승 경로다.**

**기존 정책(`create policy`)은 하나도 고치지 마라.** 함수 셋이 게이트를 지므로 정책은
그대로 두면 자동으로 막힌다. 정책을 손대면 T8이 검증한 범위 규칙이 다시 검증 대상이 된다.

### 3. 가입 트리거

`auth.users`에 행이 생기면 `public.profiles` 행을 만든다.

```
public.handle_new_user()  -- security definer, search_path = '', plpgsql
  role        := 'member'    -- 하드코딩
  status      := 'pending'   -- 하드코딩
  team_id     := new.raw_user_meta_data->>'team_id' 가 public.teams에 있을 때만, 없으면 null
  display_name:= trim한 값, 빈 문자열이면 null
  on conflict (id) do nothing
```

**`role`과 `status`를 `raw_user_meta_data`에서 읽지 마라. 이유: `user_metadata`는 사용자가
고칠 수 있는 자리다.** 가입 요청 본문에 `role: "admin"`을 끼워 넣는 것만으로 권한 상승이
된다. `viewer-session.ts`의 머리말이 같은 이유로 JWT의 `user_metadata`를 거부한다.

`team_id`는 metadata에서 받되 **`teams` 테이블에 실재하는 값일 때만** 넣는다. 없는 값이
오면 `null`로 두고 트리거를 실패시키지 않는다 (실패시키면 가입 자체가 500이 되고, 사용자는
고칠 방법이 없다. `team_id`가 null인 대기 계정은 어느 리더에게도 보이지 않아 안전 측이다).

트리거는 `after insert on auth.users for each row`. `drop trigger if exists`를 먼저 둔다.

### 4. `security definer` 함수 6개 — 읽기 2 · 쓰기 4

**`profiles`·`members`에 UPDATE·INSERT GRANT를 주지 마라. 새 RLS 정책도 만들지 마라.**
이유: `with check` 조합으로 열면 「lead가 role을 admin으로 바꾸는」 같은 경우를 하나라도
빠뜨리는 순간 권한 상승이다. 함수로 좁히면 호출자 검사가 **한 곳에** 모이고 테스트가 그
한 곳을 겨눈다.

읽기 두 개가 함수인 이유는 따로 있다: 리더가 요청자를 알아보려면 **이메일**이 필요한데
`auth.users.email`은 `authenticated`가 읽을 수 없다. 정책으로는 낼 수 없고 definer 함수만
낼 수 있다.

| 함수 | 호출 자격 | 하는 일 |
|---|---|---|
| `pending_requests()` | active lead → 자기 팀 / active admin → 전부 | 대기·거절 요청 목록. `user_id·display_name·email·team_id·status·created_at` |
| `member_directory()` | active admin만 | 전 팀의 profiles + members 조인 행. 트리는 앱이 만든다 |
| `approve_join(target, member_id, new_member_name)` | active lead(같은 팀) 또는 active admin | 아래 참조 |
| `reject_join(target)` | 위와 같음 | `status='rejected'`. `members` 연결은 건드리지 않는다 |
| `request_join(team)` | 호출자 본인, `status='rejected'`일 때만 | `team_id=team`, `status='pending'` |
| `set_role(target, new_role, new_team)` | active admin만 | `new_role`은 `'lead'`·`'member'`만 |

`approve_join`의 계약:

- `member_id`와 `new_member_name` 중 **정확히 하나**가 non-null이어야 한다. 아니면 예외.
- `target`의 `status`가 `'pending'`이어야 한다. 아니면 예외 (이미 승인된 사람을 다시
  승인하면서 다른 `members` 행에 붙이는 것을 막는다).
- `member_id`를 준 경우: 그 행의 `team_id`가 `target`의 `team_id`와 같아야 하고,
  `auth_user_id`가 `null`이거나 이미 `target`이어야 한다. **다른 사람에게 붙은 행을
  빼앗지 못하게 하라.**
- `new_member_name`을 준 경우: `target`의 팀에 그 이름으로 `members` 행을 만든다.
  `members`의 `unique (team_id, name)`에 걸리면 예외로 올린다 (조용히 기존 행을 쓰면
  남의 행을 빼앗는 것과 같아진다).
- 성공 시 `profiles.status='active'` + `members.auth_user_id=target`. **한 트랜잭션이다** —
  함수 하나이므로 자동으로 그렇다. 나눠 쓰지 마라.
- **`role`을 바꾸지 마라.** 승인은 「받아들인다」이지 「승격」이 아니다.

`set_role`이 `'admin'`을 받지 않는 것은 의도다. 최초 admin은 SQL로만 심고, 화면에서
admin을 만들 수 있으면 계정 하나가 뚫렸을 때 admin이 번식한다.

전 함수 공통:
- `security definer` · `set search_path = ''` · `public.` 스키마 전체 표기
- 호출 자격 검사에 **`my_role()`·`my_team()`을 쓴다** (2번에서 이미 게이트가 걸려 있다)
- 자격 미달이면 `raise exception`. 조용히 0행을 돌려주면 화면이 「승인했다」고 답한다
- 마지막에 실행 권한을 좁힌다:
  `revoke execute on function ... from public, anon;` 뒤에
  `grant execute on function ... to authenticated;`
  **`revoke`를 빠뜨리면 안 된다** — Postgres는 새 함수의 EXECUTE를 `public`에 기본 부여한다.

## Acceptance Criteria

```bash
# 1. SQL 파일이 있고 비어 있지 않다
test -s supabase/migrations/0005_signup_approval.sql

# 2. 금지 패턴이 하나도 없다 (전부 결과가 비어 있어야 한다)
grep -nE "grant (insert|update|delete)" supabase/migrations/0005_signup_approval.sql
grep -n "raw_user_meta_data->>'role'" supabase/migrations/0005_signup_approval.sql
grep -n "raw_user_meta_data->>'status'" supabase/migrations/0005_signup_approval.sql

# 3. 필수 패턴이 전부 있다
grep -c "search_path = ''" supabase/migrations/0005_signup_approval.sql   # 9 이상
grep -c "revoke execute" supabase/migrations/0005_signup_approval.sql     # 1 이상
grep -c "status = 'active'" supabase/migrations/0005_signup_approval.sql  # 3 이상 (함수 셋)

# 4. 기존 테스트가 그대로 통과한다
npm run lint && npm run build && npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **함수 셋(`my_role`·`my_team`·`my_member_id`)이 전부 `status='active'`를 보는지**
   파일을 눈으로 확인한다. 하나라도 빠지면 대기 계정에 데이터가 샌다.
3. 아키텍처 체크리스트:
   - CLAUDE.md CRITICAL — `service_role` 키에 `NEXT_PUBLIC_` 접두사 없음 (이 step은 키를 다루지 않는다)
   - 실업무 데이터·실명이 SQL에 들어가지 않았는가? 마이그레이션에 데이터를 섞지 않는다
   - `0003_auth_rls.sql`의 정책을 고치지 않았는가?
4. 결과에 따라 `phases/t11-signup-approval/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 만든 함수 6개 이름과 시그니처를 적는다
     (다음 step들이 이 이름으로 API를 짓는다)
   - 실패 → `"status": "error"`, `"error_message"`

## 금지사항

- **원격 DB에 적용하지 마라.** 이유: 적용은 사람이 한다 (`0003_auth_rls.sql` 머리말과 같은
  절차다). 이 step의 산출물은 파일 하나다. Supabase MCP·`supabase` CLI를 부르지 마라.
- **`0001`~`0004` 마이그레이션 파일을 고치지 마라.** 이유: 원격에 이미 적용돼 있어 수정이
  반영되지 않고, 파일과 DB가 어긋난 채로 남는다.
- **`src/` 아래를 하나도 고치지 마라.** 이유: 이 step은 DB 레이어만 다룬다. 앱 쪽 반영은
  step 1~8이 한다. 지금 손대면 SQL이 적용되기 전의 코드가 커밋된다.
- **새 RLS 정책을 만들지 마라.** 이유: 4번 절에 근거가 있다. 접근 제어는 definer 함수에 모은다.
- **트리거를 집계·판정에 쓰지 마라.** 이유: `ADR-006`. 이 step의 트리거는 계정 배선 하나뿐이다.
- 기존 테스트를 깨뜨리지 마라
