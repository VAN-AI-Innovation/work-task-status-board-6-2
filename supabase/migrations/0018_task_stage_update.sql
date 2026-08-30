-- ---------------------------------------------------------------------------
-- 0018 — 단계 타임라인을 화면에서 고칠 수 있게 연다 (`task_stages`)
-- ---------------------------------------------------------------------------
--
-- 적용: 0001~0017을 먼저 실행한 뒤 이 파일을 붙여넣는다. **재적용 가능하다**
-- (`drop policy if exists` + `create policy` + `grant` 하나씩이다).
--
-- 편집팀 탭의 데이터는 팀 전용 칸(`extras`)이 아니라 **단계**에 들어 있다. `0014`가 촬영·
-- 마케팅팀의 `extras`를 열었을 때 편집팀은 열린 자리가 없었다 — 그 팀 사람이 화면에서 고칠
-- 수 있는 것은 공통 13칸뿐이고, 자기 팀의 실제 진행(컨셉·제작·최종본의 계획일·실제일·확인·
-- 내용)은 시트를 열어야만 고칠 수 있었다. `0014`가 뒤집은 근거를 그대로 편집팀에 적용한다.
--
-- ---------------------------------------------------------------------------
-- 1. task_stages_update_via_task — 범위를 **다시 적지 않는다**
-- ---------------------------------------------------------------------------
--
-- `0003` 3-5의 select 정책과 같은 모양이다: `tasks`를 한 번 거치면 `tasks_update_scope`가
-- 그대로 적용된다. 여기에 「admin은 전부, lead는 자기 팀, member는 담당 건」을 다시 적으면
-- 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
--
-- ⚠ **`update`가 아니라 `select`로 거는 것이 요점이다.** `exists (select 1 from tasks ...)`는
--   `tasks_select_scope`를 탄다 — 그쪽은 팀장에게 전사, 부원에게 자기 팀이라(`0012`·`0015`)
--   업데이트 범위보다 **넓다.** 그래서 부모를 고칠 수 없는 사람이 단계는 고치는 구멍이 생긴다.
--   그것을 막으려고 `for update` 권한을 **부모 행에 대해** 직접 되묻는다: 아래 `exists`는
--   `tasks`를 `for update of`로 잠그지 않고, 대신 `tasks_update_scope`와 **같은 식**을 부른다.
--
-- 그래서 결국 식을 적게 되는데, 적는 대신 **`my_*()` 함수 넷만** 쓴다. 정책 본문이 두 파일에
-- 흩어지는 것을 피할 방법이 Postgres에는 없다 (정책은 다른 정책을 호출하지 못한다).
-- 바뀌는 날 함께 고칠 자리는 `0013` 3절과 여기 둘이다.

drop policy if exists task_stages_update_via_task on public.task_stages;

create policy task_stages_update_via_task on public.task_stages
  for update to authenticated
  using (
    exists (
      select 1 from public.tasks t
       where t.id = task_stages.task_id
         and (
              public.my_role() = 'admin'
           or (public.my_role() = 'lead'   and public.my_team()      is not null and t.team_id = public.my_team())
           or (public.my_role() = 'member' and public.my_member_id() is not null and t.owner_member_id = public.my_member_id())
           or (public.my_role() = 'member' and public.my_member_name() is not null
               and public.my_team() is not null and t.team_id = public.my_team()
               and public.my_member_name() = any(t.co_owner_names))
         )
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
       where t.id = task_stages.task_id
         and (
              public.my_role() = 'admin'
           or (public.my_role() = 'lead'   and public.my_team()      is not null and t.team_id = public.my_team())
           or (public.my_role() = 'member' and public.my_member_id() is not null and t.owner_member_id = public.my_member_id())
           or (public.my_role() = 'member' and public.my_member_name() is not null
               and public.my_team() is not null and t.team_id = public.my_team()
               and public.my_member_name() = any(t.co_owner_names))
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. 컬럼 GRANT — 네 칸뿐이다
-- ---------------------------------------------------------------------------
--
-- `seq`·`stage_key`·`stage_label`·`sla_days`는 **시트가 정하는 구조**라 열지 않는다. 사람이
-- 단계 이름과 순서를 바꾸면 그 업무의 타임라인이 시트의 것과 다른 물건이 되고, 다음 업로드가
-- 단계를 통째로 교체하면서 그대로 사라진다.
--
-- `task_id`도 열지 않는다 — 단계를 남의 업무로 옮기는 update가 그 자리에서 막힌다.
--
-- ⚠ 이 목록은 `supabase-task-store.ts`의 `updateStages`가 넣는 컬럼과 **글자 그대로 같아야
--   한다.** 하나라도 목록 밖이면 Postgres가 권한 오류를 내는데, 그 오류는 「단계를 못 고친다」로
--   보여 원인을 찾기 어렵다.
--
-- ⚠ **여기서 고친 값은 다음 업로드가 되돌린다** (`ADR-001`). 단계는 업로드가 지우고 다시
--   넣으므로 `extras`·`status`가 이미 지고 있는 성질과 같고, 화면이 그 사실을 한 줄로 적는다.
grant update (planned_date, actual_date, confirm_status, content)
  on public.task_stages to authenticated;
