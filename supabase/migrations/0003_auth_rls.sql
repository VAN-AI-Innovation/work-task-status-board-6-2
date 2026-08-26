-- 적용: Supabase 대시보드 → SQL Editor에 0001_init.sql · 0002_seed_reference.sql를 먼저
-- 실행한 뒤 이 파일 전체를 붙여넣고 실행한다. (원격에는 마이그레이션 이름 `t8_auth_rls`로
-- 적용돼 있다.) **재적용 가능하다** — drop policy if exists · create or replace ·
-- if not exists 셋이 그것을 보장하고, 두 번 돌려도 정책 수가 늘지 않는다.
--
-- 근거 문서: docs/PLAN.md 「8. 권한」의 「T8 착수 시 확정」(결정 B·C·D) · S5 · S6,
--            docs/ARCHITECTURE.md 「권한 (T8)」, ADR-024~026,
--            docs/TICKETS.md T8 완료 기준 3·4.
--
-- **이 파일의 정책 표는 src/lib/domain/viewer-scope.ts의 표를 옮겨 적은 것이다.**
-- 규칙이 두 곳에 사는 것은 의도다 — 데모·폴백 모드에는 RLS가 없고(메모리 드라이버다)
-- 그래도 역할별로 다르게 보여야 한다. 대신 두 벌이 어긋나면 데모에서 보이던 것이
-- 라이브에서 사라진다. **한쪽만 고치지 마라.**
--
-- 여기에 없는 것과 그 이유:
--   * 테스트 계정 · profiles 행 · members 행 — 마이그레이션에 데이터를 섞으면 재적용이
--     데이터를 다시 만든다. 계정 연결은 별도 단계다.
--   * 트리거 · 뷰 · 집계 함수 — 0001_init.sql과 같은 이유다 (ADR-006). 이 파일에 들어가는
--     함수는 **권한 판정 셋**뿐이다.
--   * anon 정책 — 하나도 만들지 않는다. 로그아웃 상태에서 데이터가 보이면 안 된다.
--   * uploads · task_events · doc_extractions 정책 — 서버(service_role) 전용이다.
--     uploads.parse_result에는 시트·문서 본문이 통째로 들어 있다 (S6). 정책이 없는 채로
--     RLS가 켜져 있으면 authenticated는 한 행도 읽지 못한다 — 그것이 의도한 상태다.

-- ---------------------------------------------------------------------------
-- 1. profiles — 역할의 단일 소스
-- ---------------------------------------------------------------------------

-- auth.users와 1:1. members와 합치지 않는 이유: members는 시트에서 오는 **조직 명부**이고
-- (계정 없는 구성원이 대부분이다), profiles는 **로그인 계정의 권한**이다. 축이 다르다.
-- email을 두지 않는다 — auth.users에 이미 있고, 복사본은 갱신되지 않는 개인정보다 (S6).
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','lead','member')),
  team_id    text references teams(id),   -- lead가 맡은 팀. admin은 null일 수 있다
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. security definer 함수 셋 (ADR-025)
-- ---------------------------------------------------------------------------
--
-- 정책 안에서 profiles·members를 직접 select하면 그 테이블의 정책이 다시 걸려 **무한 재귀**다
-- (완료 기준 3). security definer가 그 고리를 끊는다.
--
-- 빈 문자열로의 search_path 고정은 선택이 아니다 — 하지 않으면 호출자가 같은 이름의 테이블을
-- 자기 스키마에 만들어 함수를 속일 수 있다. **권한 상승 경로다** (S5, 완료 기준 4).
-- 그래서 테이블 이름에 스키마를 전부 적는다(public.profiles).
--
-- ⚠ null은 셋 다 정상값이고 「모두 허용」이 아니다. SQL의 =가 null에 참을 내지 않는 성질이
--   우리 편이다. 뒤집어 쓰면(is not distinct from) 전원에게 열린다.

create or replace function public.my_role() returns text
  language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = (select auth.uid()) $$;

create or replace function public.my_team() returns text
  language sql stable security definer set search_path = ''
as $$ select p.team_id from public.profiles p where p.id = (select auth.uid()) $$;

-- members.auth_user_id에는 유니크 제약이 없다. 한 계정이 두 구성원 행에 붙는 실수를 정책이
-- 임의로 고르지 않도록 order by + limit 1로 **결정적으로** 만든다.
create or replace function public.my_member_id() returns uuid
  language sql stable security definer set search_path = ''
as $$ select m.id from public.members m
      where m.auth_user_id = (select auth.uid()) order by m.id limit 1 $$;

-- ---------------------------------------------------------------------------
-- 3. 정책 — 대상 롤은 전부 authenticated다
-- ---------------------------------------------------------------------------
--
-- create policy에는 if not exists가 없다. 재적용 가능하도록 drop policy if exists를 앞세운다.

-- 3-1. profiles — 자기 행만. 남의 역할을 읽을 이유가 없다.
drop policy if exists profiles_select_self on profiles;
create policy profiles_select_self on profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- 3-2. 참조 데이터 — 로그인한 전원. 개인정보가 없고, 화면의 팀 이름·enum 라벨이 이걸 읽는다.
drop policy if exists departments_select_authenticated on departments;
create policy departments_select_authenticated on departments
  for select to authenticated using (true);

drop policy if exists teams_select_authenticated on teams;
create policy teams_select_authenticated on teams
  for select to authenticated using (true);

drop policy if exists enum_options_select_authenticated on enum_options;
create policy enum_options_select_authenticated on enum_options
  for select to authenticated using (true);

drop policy if exists sla_rules_select_authenticated on sla_rules;
create policy sla_rules_select_authenticated on sla_rules
  for select to authenticated using (true);

-- 3-3. members — 이름 표다. 담당자 필터 UI가 이걸 읽는다.
-- auth_user_id가 함께 나가지만 그건 계정 uuid이지 개인정보가 아니다(연락처·이메일이 없다).
drop policy if exists members_select_authenticated on members;
create policy members_select_authenticated on members
  for select to authenticated using (true);

-- 3-4. tasks — 범위 판정의 본체. viewer-scope.ts의 taskInScope와 글자 그대로 같다.
--   admin  전부
--   lead   my_team()이 null이 아니고 team_id가 같다
--   member my_member_id()가 null이 아니고 owner_member_id가 본인이다
-- ⚠ owner_member_id가 null인 행(unknown_owner)은 member에게 보이지 않는다 (결정 D).
--   null을 「내 것」으로 치면 담당자 미상 업무가 계정 연결 안 된 전원에게 열린다.
drop policy if exists tasks_select_scope on tasks;
create policy tasks_select_scope on tasks
  for select to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id         = public.my_team())
    or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
  );

-- update는 열람과 **같은 범위**다 (viewer-scope.ts 머리말: 보는 만큼 고친다).
-- with check가 using과 같아야 한다 — 없으면 자기 업무의 team_id를 남의 팀으로 바꿔
-- 범위 밖으로 밀어낼 수 있다. 어느 컬럼을 고칠 수 있는지는 아래 GRANT가 따로 정한다.
drop policy if exists tasks_update_scope on tasks;
create policy tasks_update_scope on tasks
  for update to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id         = public.my_team())
    or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
  )
  with check (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id         = public.my_team())
    or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
  );

-- 3-5. task_stages — 부모 tasks가 보이면 보인다.
-- 아래 select가 tasks에 걸리므로 **tasks_select_scope가 다시 적용된다.** 그것이 의도다 —
-- 단계 타임라인의 범위를 여기 따로 적으면 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
-- tasks 정책이 task_stages를 보지 않으므로 재귀가 아니다.
drop policy if exists task_stages_select_via_task on task_stages;
create policy task_stages_select_via_task on task_stages
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_stages.task_id));

-- 3-6. 목표 지표 — admin 전부 / lead·member 같은 팀.
-- **member만 tasks와 규칙이 다르다.** 목표 지표에는 담당자 축이 없어서다 — GoalMetric은
-- 업무가 아니라 성과 지표이고 팀 단위로 움직인다. 담당자로 걸러 버리면 부원은
-- 「목표 대비 성과」 섹션이 통째로 빈 화면을 본다 (viewer-scope.ts의 goalMetricInScope).
drop policy if exists goal_metrics_select_scope on goal_metrics;
create policy goal_metrics_select_scope on goal_metrics
  for select to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_team() is not null and team_id = public.my_team())
  );

drop policy if exists team_period_goals_select_scope on team_period_goals;
create policy team_period_goals_select_scope on team_period_goals
  for select to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_team() is not null and team_id = public.my_team())
  );

-- ---------------------------------------------------------------------------
-- 4. 권한(GRANT) — 정책만으로는 컬럼을 좁힐 수 없다
-- ---------------------------------------------------------------------------
--
-- RLS는 「어느 행」이고 GRANT는 「어느 컬럼」이다. 정책이 통과시킨 행에서 authenticated가
-- title·due_at·raw를 고칠 수 있으면 UC-16의 「상태·진행률 수정」이 아니라 **시트 편집기**가
-- 된다. 시트가 진실의 원천이라(ADR-001) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면
-- 사용자는 자기 수정이 사라지는 것을 본다.
--
-- API도 같은 자리를 한 번 더 막는다 — PATCH /api/tasks/[id]의 zod가 status·progress 둘만
-- 받는다(결정 F). 여기 updated_at이 하나 더 있는 것은 저장소가 갱신 시각을 명시적으로
-- 넣기 때문이다(DB 트리거를 두지 않기로 한 결과다 — 0001_init.sql).

-- **insert·update·delete만 거두지 않고 revoke all로 바닥부터 다시 쌓는다.** Supabase는 public
-- 스키마의 테이블에 기본으로 authenticated에게 **TRUNCATE·TRIGGER·REFERENCES까지** 준다.
-- TRUNCATE는 **RLS를 통째로 우회해 전 행을 지운다** — 정책을 아무리 좁혀도 그 한 줄이면
-- 실업무 데이터가 사라진다. 「select만 남긴다」를 글자 그대로 만든다.
revoke all on
  public.profiles, public.departments, public.teams, public.members,
  public.uploads, public.tasks, public.task_stages, public.task_events,
  public.enum_options, public.sla_rules, public.doc_extractions,
  public.goal_metrics, public.team_period_goals
from authenticated;

-- 정책을 붙인 테이블만 되돌려준다. **uploads·task_events·doc_extractions는 여기 없다** —
-- 서버 전용이고 정책도 없다. RLS가 이미 전부 막지만, 권한까지 거두면 정책이 실수로 하나
-- 생기는 날 이 부재가 두 번째 자물쇠가 된다 (S6).
grant select on
  public.profiles, public.departments, public.teams, public.members,
  public.tasks, public.task_stages,
  public.enum_options, public.sla_rules,
  public.goal_metrics, public.team_period_goals
to authenticated;

grant update (status, progress, updated_at) on public.tasks to authenticated;

-- anon — 이 스키마의 테이블에 하나도 닿지 않는다. 로그인 자체는 auth 스키마의
-- 엔드포인트라 영향받지 않는다.
revoke all on
  public.profiles, public.departments, public.teams, public.members,
  public.uploads, public.tasks, public.task_stages, public.task_events,
  public.enum_options, public.sla_rules, public.doc_extractions,
  public.goal_metrics, public.team_period_goals
from anon;

-- service_role은 손대지 않는다. 업로드 확정·시드가 그 키로 돌고, 올린 사람의 범위 밖 행도
-- 쓴다 (ADR-024). 함수 셋에 grant execute를 따로 적지도 않는다 — public에 기본 부여돼
-- 있고, 셋 다 호출자 자신의 행만 돌려주므로 문제가 되지 않는다.
