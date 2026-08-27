-- 적용: Supabase 대시보드 → SQL Editor에 0001~0004를 먼저 실행한 뒤 이 파일 전체를
-- 붙여넣고 실행한다. **재적용 가능하다** — add column if not exists · create or replace ·
-- drop … if exists가 그것을 보장하고, 두 번 돌려도 결과가 같다.
--
-- 근거 문서: docs/PLAN.md 「8. 권한」 · S5 · S6, docs/ARCHITECTURE.md 「권한」,
--            phases/t11-signup-approval/step0.md, GitHub 이슈 #29.
--
-- 이 파일이 더하는 것은 **상태 축 하나**다. T8까지 사람은 「역할」만 가졌고, 여기서
-- 「승인되었는가」가 붙는다. 그 축이 기존 정책 전부에 걸리게 만드는 방법이 2절이다.
--
-- 여기에 없는 것과 그 이유:
--   * 새 RLS 정책 — 하나도 만들지 않는다. 접근 제어는 4절의 security definer 함수에 모은다.
--     with check 조합은 경우를 하나만 빠뜨려도 권한 상승이고, 함수로 좁히면 호출자 검사가
--     한 곳에 모여 테스트가 그 한 곳을 겨눈다.
--   * insert·update·delete GRANT — 한 칸도 주지 않는다. profiles·members의 상태 변경은
--     오직 4절의 함수를 통해서만 일어난다.
--   * 계정 · profiles 행 — 마이그레이션에 데이터를 섞으면 재적용이 데이터를 다시 만든다.
--   * 0003의 정책 — 한 줄도 고치지 않는다. 2절의 함수 셋이 게이트를 지므로 정책은 그대로
--     두면 자동으로 막힌다. 손대면 T8이 검증한 범위 규칙이 다시 검증 대상이 된다.

-- ---------------------------------------------------------------------------
-- 1. profiles 확장 — 상태 축과 표시 이름
-- ---------------------------------------------------------------------------
--
-- ⚠ default가 'active'인 것이 의도다. 이 문장은 **기존 행 전부를 active로 채운다** —
--   운영 중인 계정(admin·lead·member)이 마이그레이션 순간 잠기면 안 된다.
--   'pending'을 기본값으로 두면 적용하는 순간 아무도 못 들어온다.
--
-- email 컬럼을 두지 않는다 — auth.users에 이미 있고, 복사본은 갱신되지 않는 개인정보다(S6).
-- member_id 컬럼을 두지 않는다 — members.auth_user_id가 이미 그 연결이고 my_member_id()가
-- 그것을 본다. 두 벌이 되면 화면이 보는 「나」와 DB가 보는 「나」가 갈린다.
alter table profiles
  add column if not exists status text not null default 'active'
    check (status in ('pending','active','rejected')),
  add column if not exists display_name text
    check (display_name is null or char_length(display_name) between 1 and 40);

-- ---------------------------------------------------------------------------
-- 2. 권한 판정 함수 셋에 status 게이트 — 이 파일에서 가장 중요한 절
-- ---------------------------------------------------------------------------
--
-- **셋을 다 고쳐야 한다.** my_role()만 고치면 구멍이 남는다:
-- 0003의 goal_metrics_select_scope · team_period_goals_select_scope는 두 번째 갈래가
--
--     or (public.my_team() is not null and team_id = public.my_team())
--
-- 라서 my_role()을 **보지 않는다.** 대기 상태인 사람의 team_id가 'marketing'이면
-- 승인 전에 마케팅·관리팀 목표 지표가 통째로 보인다.
--
-- 셋이 전부 null을 돌려주면 0003의 모든 정책이 그대로 막는다 — SQL의 =가 null에 참을
-- 내지 않는 성질이 우리 편이다 (0003 2절의 ⚠ 주석과 같은 근거).
--
-- search_path = '' 고정과 스키마 전체 표기(public.profiles)는 선택이 아니다. 하지 않으면
-- 호출자가 같은 이름의 테이블을 자기 스키마에 만들어 함수를 속인다 — 권한 상승 경로다.

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p
      where p.id = (select auth.uid()) and p.status = 'active' $$;

create or replace function public.my_team() returns text
  language sql stable security definer set search_path = ''
as $$ select p.team_id from public.profiles p
      where p.id = (select auth.uid()) and p.status = 'active' $$;

-- members.auth_user_id에는 유니크 제약이 없다. 한 계정이 두 구성원 행에 붙는 실수를 정책이
-- 임의로 고르지 않도록 order by + limit 1로 **결정적으로** 만든다 (0003에서 이어받은 규칙).
-- ⚠ 이 결정 규칙은 src/lib/auth/viewer-session.ts와 **글자 그대로 같아야 한다.** 다르면
--   화면과 DB가 서로 다른 구성원을 「나」로 본다.
-- 승인이 취소된(rejected) 계정은 members 행이 남아 있어도 여기서 빠진다 — exists가 막는다.
create or replace function public.my_member_id() returns uuid
  language sql stable security definer set search_path = ''
as $$ select m.id from public.members m
      where m.auth_user_id = (select auth.uid())
        and exists (select 1 from public.profiles p
                    where p.id = (select auth.uid()) and p.status = 'active')
      order by m.id limit 1 $$;

-- ---------------------------------------------------------------------------
-- 3. 가입 트리거 — auth.users → profiles
-- ---------------------------------------------------------------------------
--
-- ⚠ **role과 status를 raw_user_meta_data에서 읽지 않는다.** user_metadata는 사용자가
--   고칠 수 있는 자리다 (viewer-session.ts 머리말이 같은 이유로 JWT의 그 필드를 거부한다).
--   가입 요청 본문에 role: "admin"을 끼워 넣는 것만으로 권한 상승이 된다. 그래서 두 값은
--   여기 **박혀 있고**, 앱이 무엇을 보내든 바뀌지 않는다.
--
-- team_id는 metadata에서 받되 teams에 실재하는 값일 때만 넣는다. 없는 값이면 null이고
-- 트리거를 실패시키지 않는다 — 실패시키면 가입 자체가 500이 되고 사용자는 고칠 방법이 없다.
-- team_id가 null인 대기 계정은 어느 리더에게도 보이지 않으므로 안전 측이다(admin이 처리).
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, role, status, team_id, display_name)
  values (
    new.id,
    'member',                                   -- 하드코딩. metadata에서 읽지 않는다
    'pending',                                  -- 하드코딩. metadata에서 읽지 않는다
    (select t.id from public.teams t
      where t.id = new.raw_user_meta_data->>'team_id'),
    nullif(left(trim(new.raw_user_meta_data->>'display_name'), 40), '')
  )
  on conflict (id) do nothing;                  -- 재적용·재시도에 안전하다
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. 접근 제어 함수 — 읽기 2 · 쓰기 4
-- ---------------------------------------------------------------------------
--
-- 읽기 둘이 정책이 아니라 함수인 이유: 리더가 요청자를 알아보려면 **이메일**이 필요한데
-- auth.users.email은 authenticated가 읽을 수 없다. 정책으로는 낼 수 없고 definer 함수만 낼 수 있다.
--
-- 쓰기 넷이 함수인 이유는 머리말에 있다 — profiles·members에 UPDATE GRANT를 주지 않는다.
--
-- 공통 규율:
--   * 호출 자격은 my_role()·my_team()으로 본다. 2절에서 이미 status 게이트가 걸려 있으므로
--     대기·거절 계정은 어느 함수도 통과하지 못한다.
--   * 자격 미달은 raise exception이다. 조용히 0행을 돌려주면 화면이 「승인했다」고 답한다.
--   * 예외 메시지에 대상의 이메일·이름을 담지 않는다 (S6). 사유만 남긴다.

-- 4-1. 대기·거절 요청 목록. active lead는 자기 팀, active admin은 전부.
create or replace function public.pending_requests()
  returns table (
    user_id uuid, display_name text, email text,
    team_id text, status text, created_at timestamptz
  )
  language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, u.email::text, p.team_id, p.status, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.status in ('pending','rejected')
     and (
          public.my_role() = 'admin'
       or (public.my_role() = 'lead' and public.my_team() is not null
           and p.team_id = public.my_team())
     )
   order by p.created_at, p.id
$$;

-- 4-2. 전 팀 명부. **admin 전용.** 트리 구성은 앱이 한다 (ADR-006 — 집계는 JS 순수 함수).
-- profiles와 members 어느 한쪽에만 있는 사람도 나와야 한다(계정 없는 명부 구성원,
-- members에 안 붙은 계정) — 그래서 full outer join이다.
create or replace function public.member_directory()
  returns table (
    user_id uuid, member_id uuid, display_name text, member_name text,
    email text, role text, status text, team_id text
  )
  language sql stable security definer set search_path = ''
as $$
  select p.id, m.id, p.display_name, m.name, u.email::text, p.role, p.status,
         coalesce(p.team_id, m.team_id)
    from public.profiles p
    full outer join public.members m on m.auth_user_id = p.id
    left join auth.users u on u.id = p.id
   where public.my_role() = 'admin'
   order by coalesce(p.team_id, m.team_id), p.role, m.name, p.id
$$;

-- 4-3. 호출자가 대상 요청을 처리할 자격이 있는가. 4-4·4-5가 공유한다.
-- 규칙을 한 곳에 두는 이유: 승인과 거절의 자격이 갈리면 「거절은 되는데 승인은 안 되는」
-- 상태가 생기고, 그 차이를 설명할 수 있는 사람이 아무도 없게 된다.
create or replace function public.can_review_join(target uuid) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select public.my_role() = 'admin'
      or (public.my_role() = 'lead'
          and public.my_team() is not null
          and exists (select 1 from public.profiles p
                       where p.id = target and p.team_id = public.my_team()))
$$;

-- 4-4. 승인 — profiles.status='active' + members.auth_user_id 연결을 **한 트랜잭션에서**.
--
-- member_id와 new_member_name 중 정확히 하나가 non-null이어야 한다. 둘 다 주거나 둘 다
-- 안 주면 예외다 — 「어느 쪽 의도였는지」를 함수가 추측하면 안 된다.
--
-- ⚠ role을 바꾸지 않는다. 승인은 「받아들인다」이지 「승격」이 아니다.
create or replace function public.approve_join(
    target uuid,
    member_id uuid default null,
    new_member_name text default null
  ) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  target_team text;
  linked uuid;
begin
  if not public.can_review_join(target) then
    raise exception 'not permitted';
  end if;

  if (member_id is null) = (new_member_name is null) then
    raise exception 'exactly one of member_id or new_member_name is required';
  end if;

  -- 이미 승인된 사람을 다시 승인하면서 다른 members 행에 붙이는 것을 막는다
  select p.team_id into target_team
    from public.profiles p where p.id = target and p.status = 'pending';
  if not found then
    raise exception 'not permitted';
  end if;
  if target_team is null then
    raise exception 'target has no team';
  end if;

  if member_id is not null then
    -- 같은 팀이어야 하고, 남에게 붙은 행을 빼앗지 못한다
    select m.auth_user_id into linked
      from public.members m where m.id = member_id and m.team_id = target_team;
    if not found then
      raise exception 'member not in target team';
    end if;
    if linked is not null and linked <> target then
      raise exception 'member already linked';
    end if;

    update public.members set auth_user_id = target where id = member_id;
  else
    -- unique (team_id, name)에 걸리면 그대로 예외로 올린다. 조용히 기존 행을 쓰면
    -- 남의 행을 빼앗는 것과 같아진다.
    insert into public.members (team_id, name, auth_user_id)
    values (target_team, left(trim(new_member_name), 40), target);
  end if;

  update public.profiles set status = 'active' where id = target;
end $$;

-- 4-5. 거절 — members 연결은 건드리지 않는다. 계정은 살아 있고 재요청이 된다.
create or replace function public.reject_join(target uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_review_join(target) then
    raise exception 'not permitted';
  end if;

  update public.profiles set status = 'rejected'
   where id = target and status = 'pending';
  if not found then
    raise exception 'not permitted';
  end if;
end $$;

-- 4-6. 재요청 — **대상은 언제나 auth.uid()다.** 인자로 받지 않는다.
-- 받는 순간 남의 상태를 바꿀 수 있는 문이 된다.
--
-- status='rejected'에서만 'pending'으로 갈 수 있다. 'active'로는 절대 못 간다 —
-- 그것은 4-4만 할 수 있는 일이다.
create or replace function public.request_join(team text) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.teams t where t.id = team) then
    raise exception 'unknown team';
  end if;

  update public.profiles
     set team_id = team, status = 'pending'
   where id = (select auth.uid()) and status = 'rejected';
  if not found then
    raise exception 'not permitted';
  end if;
end $$;

-- 4-7. 역할 변경 — **admin 전용.** new_role은 'lead'·'member'만.
--
-- ⚠ 'admin'을 받지 않는 것이 의도다. 최초 admin은 SQL로만 심는다. 화면에서 admin을
--   만들 수 있으면 계정 하나가 뚫렸을 때 admin이 번식한다.
--
-- lead로 올릴 때는 어느 팀인지가 반드시 정해져야 한다. new_team이 없으면 기존 team_id를
-- 쓰고, 그것도 null이면 예외다 — 팀 없는 lead는 my_team()이 null이라 아무것도 못 보는
-- 유령 상태가 된다.
create or replace function public.set_role(
    target uuid,
    new_role text,
    new_team text default null
  ) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  resolved_team text;
begin
  if public.my_role() <> 'admin' then
    raise exception 'not permitted';
  end if;
  if new_role not in ('lead','member') then
    raise exception 'role not assignable';
  end if;

  select coalesce(new_team, p.team_id) into resolved_team
    from public.profiles p where p.id = target;
  if not found then
    raise exception 'not permitted';
  end if;
  if resolved_team is null then
    raise exception 'team required';
  end if;
  if not exists (select 1 from public.teams t where t.id = resolved_team) then
    raise exception 'unknown team';
  end if;

  update public.profiles
     set role = new_role, team_id = resolved_team
   where id = target and status = 'active';
  if not found then
    raise exception 'not permitted';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. 실행 권한 — 좁힌다
-- ---------------------------------------------------------------------------
--
-- ⚠ **revoke를 빠뜨리면 안 된다.** Postgres는 새 함수의 EXECUTE를 public 롤에 **기본
--   부여**한다. 그대로 두면 anon이 pending_requests()를 부를 수 있다 — 함수 안의
--   my_role()이 null이라 행은 안 나오지만, 로그아웃 상태에서 닿을 수 있는 표면을
--   남길 이유가 없다 (0003이 anon에게서 테이블 권한을 통째로 회수한 것과 같은 규율).
--
-- can_review_join은 4-4·4-5의 내부 헬퍼다. authenticated에게도 주지 않는다 — 부를 이유가
-- 없고, 부를 수 있으면 「내가 누구를 심사할 수 있는지」를 훑는 도구가 된다.
--
-- 2절의 my_role·my_team·my_member_id는 손대지 않는다. 정책 안에서 불리므로 public에
-- 남아 있어야 하고, 셋 다 호출자 자신의 행만 돌려준다 (0003의 판단 그대로).

revoke execute on function
  public.pending_requests(),
  public.member_directory(),
  public.can_review_join(uuid),
  public.approve_join(uuid, uuid, text),
  public.reject_join(uuid),
  public.request_join(text),
  public.set_role(uuid, text, text),
  public.handle_new_user()
from public, anon;

grant execute on function
  public.pending_requests(),
  public.member_directory(),
  public.approve_join(uuid, uuid, text),
  public.reject_join(uuid),
  public.request_join(text),
  public.set_role(uuid, text, text)
to authenticated;
