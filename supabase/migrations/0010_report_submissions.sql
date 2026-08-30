-- 적용: Supabase 대시보드 → SQL Editor에 0001~0009를 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (`create table if not exists` + `create or replace`).
--
-- 근거: 이슈 #29의 후속. 「팀장이 자기 팀 주간 보고를 어드민에게 올리고, 어드민이 팀별
--       보고를 하나로 취합한다. 어드민은 반려할 수 있고 팀장은 고쳐서 다시 올린다.」
--
-- ---------------------------------------------------------------------------
-- 1. report_submissions — 제출된 보고 한 건
-- ---------------------------------------------------------------------------
--
-- **본문을 저장한다.** 보고서 자체는 `buildWeeklyReport`가 볼 때마다 새로 계산하는 물건이라
-- 원래 저장할 자리가 없었다. 그런데 팀장이 **고쳐서** 올릴 수 있게 되는 순간 「제출한 것」과
-- 「지금 계산되는 것」이 갈린다 — 그때 저장하지 않으면 어드민이 보는 내용이 팀장이 올린
-- 내용과 달라지고, 그것은 보고 체계로서 성립하지 않는다. 그래서 제출 시점의 문자열을 얼린다.
--
-- `(team_id, week_start)`가 유니크다. 한 팀이 한 주에 갖는 보고는 하나이고, 재보고는 **새
-- 행이 아니라 같은 행의 갱신**이다 — 행을 쌓으면 「어느 것이 지금 보고인가」를 화면이 매번
-- 골라야 하고, 그 규칙이 곧 두 번째 진실이 된다.
--
-- 상태 셋:
--   submitted → 올라와 있고 어드민이 아직 안 봤다 (재보고도 여기로 돌아온다)
--   accepted  → 어드민이 받았다
--   rejected  → 어드민이 돌려보냈다. `review_note`에 사유가 있다
--
-- `note`(특이사항)를 `not null default ''`로 두는 것은 「안 적었다」와 「빈 문자열」을 가를
-- 이유가 없기 때문이다. 반대로 `review_note`는 nullable이다 — 반려가 아닌 상태에서는
-- **사유라는 것이 존재하지 않는다.**

create table if not exists public.report_submissions (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id),
  -- 주의 시작일(월요일). 앱의 `resolveReportPeriod`가 정한 값을 그대로 받는다
  week_start date not null,
  body text not null,
  note text not null default '',
  status text not null default 'submitted'
    check (status in ('submitted', 'accepted', 'rejected')),
  review_note text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (team_id, week_start)
);

-- ---------------------------------------------------------------------------
-- 2. RLS — 정책을 하나도 만들지 않는다
-- ---------------------------------------------------------------------------
--
-- `uploads`·`task_events`와 같은 자리다: RLS를 켜 두고 **정책을 두지 않으면 그 테이블은
-- 아무에게도 열리지 않는다.** 접근은 아래 `security definer` 함수 셋으로만 한다
-- (`ADR-031` — 상태를 바꾸는 일은 함수에 모은다).
--
-- 컬럼 GRANT로 열지 않는 이유가 분명하다. 이 테이블에서 바뀌는 것은 값이 아니라 **상태
-- 전이**다 — 「팀장은 자기 팀의 보고를 올린다」와 「어드민만 반려한다」와 「재보고하면 사유가
-- 지워진다」가 한 덩어리이고, 그것을 정책 + 컬럼 권한으로 쪼개면 규칙이 세 곳에 흩어진다.

alter table public.report_submissions enable row level security;

revoke all on public.report_submissions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. submit_report — 팀장이 자기 팀 보고를 올린다 (재보고도 이 함수다)
-- ---------------------------------------------------------------------------
--
-- 팀은 **인자로 받지 않는다.** `my_team()`이 정한다 — 인자로 받으면 남의 팀 이름으로 보고를
-- 올리는 요청이 성립하고, 그것을 막는 검사가 또 필요해진다.
--
-- ⚠ admin도 통과시킨다. `my_team()`이 있는 admin은 그 팀 보고를 올릴 수 있다 — 대표가
--   팀을 겸하는 조직에서 그것을 막을 근거가 없다. 팀이 없으면(대부분의 admin) 예외다.
--
-- 재보고는 `review_note`를 **지운다.** 고쳐서 다시 올린 순간 그 사유는 처리된 것이고,
-- 남겨 두면 화면이 「반려됨」과 「반려됐다가 다시 올림」을 같은 모양으로 그리게 된다.

create or replace function public.submit_report(week date, body text, note text)
  returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  team text;
begin
  -- `my_role()`은 승인된(`active`) 계정에만 값을 준다 (`0005` 2절). 대기·반려 계정과
  -- 미인증 요청은 여기서 null이 되고, `not in`이 null에 참을 내지 않으므로 아래 형태로 쓴다
  if coalesce(public.my_role(), '') not in ('admin', 'lead') then
    raise exception 'not permitted';
  end if;

  team := public.my_team();
  if team is null then
    raise exception 'no team';
  end if;
  if body is null or btrim(body) = '' then
    raise exception 'empty body';
  end if;

  insert into public.report_submissions (team_id, week_start, body, note, status, submitted_by)
  values (team, week, body, coalesce(note, ''), 'submitted', auth.uid())
  on conflict (team_id, week_start) do update
     set body = excluded.body,
         note = excluded.note,
         status = 'submitted',
         review_note = null,
         reviewed_by = null,
         reviewed_at = null,
         submitted_by = auth.uid(),
         submitted_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 4. review_report — 어드민이 받거나 돌려보낸다
-- ---------------------------------------------------------------------------
--
-- **반려에는 사유가 필수다.** 사유 없는 반려는 팀장에게 「다시 하라」는 말만 남기고, 그때
-- 팀장이 할 수 있는 것은 추측뿐이다. 받아들일 때는 사유가 없다 — 그 자리에 문자열을 두면
-- 화면이 「승인 사유」라는 없는 개념을 그리게 된다.

create or replace function public.review_report(
    target_team text,
    week date,
    decision text,
    review_note text default null
  ) returns void
  language plpgsql security definer set search_path = ''
as $$
begin
  -- ⚠ `public.my_role() <> 'admin'`이라고 쓰면 안 된다. 값이 null일 때 그 식은 null이고
  --   `if`는 null을 거짓으로 보아 **검사를 통째로 통과시킨다** (`0005` 2절과 같은 함정)
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'not permitted';
  end if;
  if decision not in ('accepted', 'rejected') then
    raise exception 'bad decision';
  end if;
  if decision = 'rejected' and (review_note is null or btrim(review_note) = '') then
    raise exception 'review note required';
  end if;

  update public.report_submissions
     set status = decision,
         -- 받아들인 보고에는 사유가 없다. 이전 반려 사유가 남아 있으면 지운다
         review_note = case when decision = 'rejected' then review_note else null end,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where team_id = target_team and week_start = week;

  -- 없는 보고를 반려할 수는 없다. 0행을 조용히 성공으로 두면 화면이 「반려했다」고 말한다
  if not found then
    raise exception 'no submission';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. list_reports — 그 주의 보고들
-- ---------------------------------------------------------------------------
--
-- 범위가 역할로 갈린다. **`where` 절 하나로 가른다** — 함수를 둘로 나누면 화면이 역할을 보고
-- 어느 것을 부를지 골라야 하고, 그 선택이 곧 두 번째 권한 판정이 된다.
--
--   admin  → 그 주의 전 팀
--   lead   → 자기 팀 하나
--   member → 0행 (부원에게 주간 보고 화면이 없다 — `staff-tools.ts`)
--
-- 승인 대기·반려 계정은 `my_role()`이 null이라 어느 갈래에도 걸리지 않는다 (`0005` 2절).
--
-- 본문(`body`)까지 내려보낸다. 어드민의 병합 문서가 그것으로 만들어지고, 팀장은 자기가
-- 올린 것을 다시 열어 고친다.

create or replace function public.list_reports(week date)
  returns table (
    team_id text, week_start date, body text, note text,
    status text, review_note text, submitted_at timestamptz, reviewed_at timestamptz
  )
  language sql stable security definer set search_path = ''
as $$
  select r.team_id, r.week_start, r.body, r.note,
         r.status, r.review_note, r.submitted_at, r.reviewed_at
    from public.report_submissions r
   where r.week_start = week
     and (
       public.my_role() = 'admin'
       or (public.my_role() = 'lead' and public.my_team() is not null and r.team_id = public.my_team())
     )
   order by r.team_id
$$;

-- ---------------------------------------------------------------------------
-- 6. 실행 권한 — 기본 부여를 걷고 authenticated에만 준다
-- ---------------------------------------------------------------------------
--
-- Postgres는 새 함수의 `execute`를 **`public` 롤에 기본으로 준다.** `revoke ... from public`
-- 만 적으면 `anon`·`authenticated`가 이미 갖고 있는 것은 그대로 남는다 — 셋을 다 적는다
-- (`supabase-default-privileges-gotcha`가 기록한 함정이다).

revoke all on function
  public.submit_report(date, text, text),
  public.review_report(text, date, text, text),
  public.list_reports(date)
from public, anon, authenticated;

grant execute on function
  public.submit_report(date, text, text),
  public.review_report(text, date, text, text),
  public.list_reports(date)
to authenticated;
