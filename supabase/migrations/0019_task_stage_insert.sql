-- ---------------------------------------------------------------------------
-- 0019 — 업무를 만들 때 **단계도 함께** 세운다 (`task_stages` insert)
-- ---------------------------------------------------------------------------
--
-- 적용: 0001~0018을 먼저 실행한 뒤 이 파일을 붙여넣는다. **재적용 가능하다.**
--
-- `0018`이 단계를 고칠 수 있게 열었는데, 그때 열지 않은 자리가 하나 있다 — **만드는 것**이다.
-- 단계 행은 여태 시트 업로드만 만들었으므로(파서가 wide 컬럼을 펴서 넣는다), 웹에서 만든
-- 편집팀 업무에는 단계가 한 줄도 없었다. 그 팀의 실제 진행이 전부 단계에 들어 있으니
-- **웹에서 만든 업무만 타임라인이 빈 채로** 남고, `0018`이 연 [수정하기]도 고칠 줄이 없어
-- 뜨지 않는다.
--
-- 뼈대는 앱이 정한다 (`team-stage-template.ts`) — 요청이 단계 이름·순서·SLA를 고를 수 없다.
--
-- ---------------------------------------------------------------------------
-- 1. task_stages_insert_via_task — 업무를 만들 수 있는 사람이 그 단계를 만든다
-- ---------------------------------------------------------------------------
--
-- 문턱이 `tasks_insert_scope`(`0013` 4절)와 **같다**: admin은 아무 팀, lead는 자기 팀,
-- **부원은 못 한다.** 단계만 따로 만들 수 있는 사람은 없다 — 부모 업무를 만들 수 있어야
-- 그 타임라인도 세운다.
--
-- `0018`과 같은 이유로 식을 여기 적는다: 정책은 다른 정책을 호출하지 못한다. 바뀌는 날 함께
-- 고칠 자리는 `0013` 4절과 여기 둘이다.
--
-- ⚠ **`select`로 거는 `exists`가 아니다.** 부모를 `tasks_select_scope`로 확인하면 팀장이
--   남의 팀 업무에 단계를 붙일 수 있다(그쪽은 전사 열람이다 · `0012`). 그래서 `team_id`를
--   직접 본다.

drop policy if exists task_stages_insert_via_task on public.task_stages;

create policy task_stages_insert_via_task on public.task_stages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tasks t
       where t.id = task_stages.task_id
         and (
              public.my_role() = 'admin'
           or (public.my_role() = 'lead' and public.my_team() is not null
               and t.team_id = public.my_team())
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. 컬럼 GRANT — 만들 때는 구조도 넣어야 한다
-- ---------------------------------------------------------------------------
--
-- `0018`이 연 넷에 더해 `task_id`·`seq`·`stage_key`·`stage_label`·`sla_days`가 필요하다.
-- **고칠 때와 목록이 다른 것이 의도다**: 구조는 만들 때 한 번 정해지고 그 뒤로는 시트만
-- 바꾼다 (`0018` 2절의 근거 그대로 — update GRANT에는 이 다섯이 없다).
--
-- ⚠ 이 목록은 `supabase-task-store.ts`의 `createTask`가 넣는 컬럼과 **글자 그대로 같아야
--   한다.** 하나라도 목록 밖이면 Postgres가 권한 오류를 내고, 그 오류는 「업무는 만들어졌는데
--   단계가 없다」로 보여 원인을 찾기 어렵다.
grant insert (task_id, seq, stage_key, stage_label, sla_days,
              planned_date, actual_date, confirm_status, content)
  on public.task_stages to authenticated;
