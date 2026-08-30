-- 적용: Supabase 대시보드 → SQL Editor에 0001~0011을 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (`drop policy if exists` + `create policy`).
--
-- 근거: 「팀장도 전사 현황판을 본다」 (이슈 #29 후속). 팀장의 대시보드에서 팀별 현황표와
--       팀별 완료율이 「우리 팀 N건, 남의 팀 0건」으로 서 있었는데, 그 표는 남의 팀에 대해
--       **틀린 사실**을 말한다. 팀을 끌고 가는 사람은 옆 팀이 어디까지 왔는지를 보고
--       자기 팀 일정을 잡는다.
--
-- ---------------------------------------------------------------------------
-- 무엇을 바꾸고 무엇을 그대로 두는가
-- ---------------------------------------------------------------------------
--
-- **읽기 범위만 넓힌다.** `lead`가 전 팀의 업무·단계·목표 지표를 **본다.**
--
-- **쓰기 범위는 그대로다.** `tasks_update_scope`·`tasks_insert_scope`·`tasks_delete_scope`는
-- 한 글자도 손대지 않는다 — 팀장이 남의 팀 업무의 담당자를 바꾸거나 지우는 것은 여전히
-- 안 된다. 이 파일이 뒤집는 것은 「본다」 하나뿐이다.
--
-- 그래서 `viewer-scope.ts`의 표가 **열람과 수정으로 갈라진다** (`taskInScope` /
-- `taskEditable`). 그 파일 머리말이 「갈릴 근거가 생기면 그때 나눈다」고 적어 둔 자리이고,
-- 지금이 그때다.
--
--   | 역할   | 업무 열람 | 업무 수정 |
--   |--------|-----------|-----------|
--   | admin  | 전부      | 전부      |
--   | lead   | **전부**  | 같은 팀   |
--   | member | 담당 건   | 담당 건   |
--
-- ⚠ **명부는 넓히지 않는다.** `member_directory()`(`0007`·`0008`)도, 팀장이 남의 팀 사람의
--   카드를 눌러 그 사람의 진행 상황을 보는 것도 그대로 막혀 있다 — 화면 쪽 문은
--   `members/page.tsx`의 `openable`이다. 「전사 현황을 본다」와 「남의 팀 개인을 들여다본다」는
--   다른 일이다.

-- ---------------------------------------------------------------------------
-- 1. tasks — 열람만 넓힌다
-- ---------------------------------------------------------------------------
--
-- `member` 갈래는 `0013`이 공동 담당까지 넓힌다. 여기서는 `lead`만 건드린다.

drop policy if exists tasks_select_scope on public.tasks;

create policy tasks_select_scope on public.tasks
  for select to authenticated
  using (
       public.my_role() in ('admin', 'lead')
    or (public.my_role() = 'member' and public.my_member_id() is not null
        and owner_member_id = public.my_member_id())
  );

-- `task_stages_select_via_task`는 손대지 않는다 — 그 정책은 `tasks`에 보이는 행을 따라가므로
-- (`exists (select 1 from public.tasks t where t.id = task_stages.task_id)`) 위 한 줄로
-- 단계도 함께 넓어진다. 규칙이 한 곳에 있다는 뜻이라 그대로 두는 것이 맞다.

-- ---------------------------------------------------------------------------
-- 2. goal_metrics · team_period_goals — 같은 이유로 넓힌다
-- ---------------------------------------------------------------------------
--
-- 대시보드의 「목표 대비 성과」와 주간 보고의 목표 섹션이 이 표를 본다. 업무만 넓히고 목표를
-- 두면 같은 화면 안에서 팀장이 보는 범위가 섹션마다 다르다.

drop policy if exists goal_metrics_select_scope on public.goal_metrics;

create policy goal_metrics_select_scope on public.goal_metrics
  for select to authenticated
  using (
       public.my_role() in ('admin', 'lead')
    or (public.my_team() is not null and team_id = public.my_team())
  );

drop policy if exists team_period_goals_select_scope on public.team_period_goals;

create policy team_period_goals_select_scope on public.team_period_goals
  for select to authenticated
  using (
       public.my_role() in ('admin', 'lead')
    or (public.my_team() is not null and team_id = public.my_team())
  );
