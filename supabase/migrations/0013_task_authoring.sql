-- 적용: Supabase 대시보드 → SQL Editor에 0001~0012를 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (`create or replace` · `drop policy if exists` · `grant`).
--
-- 근거: 이슈 #29의 후속 세 가지.
--   1. 업무 상세 패널에서 업무 내용을 **고친다** (지금은 상태·진행률·담당자뿐)
--   2. 리더·어드민이 업무를 **지운다**
--   3. 리더·어드민이 업무를 **만든다** (리더는 자기 팀, 어드민은 아무 팀)
--   4. 공동 담당으로 지정된 사람의 화면에도 그 업무가 **뜬다**
--
-- ---------------------------------------------------------------------------
-- 1. my_member_name() — 「나」의 시트 명부 이름
-- ---------------------------------------------------------------------------
--
-- 공동 담당(`tasks.co_owner_names`)은 **이름 배열이지 계정 id가 아니다.** `0009`가 그 성질을
-- ⚠로 적어 두고 「공동 담당자도 자기 화면에서 보게 하려면 `co_owner_member_ids uuid[]`
-- 컬럼과 정책 두 개의 member 갈래를 함께 고쳐야 한다」고 남겼다. **컬럼을 만들지 않는 쪽을
-- 고른다.**
--
-- 근거: 시트의 「공동 담당」 칸이 원래 이름 목록이고, 그 칸은 **다음 업로드가 덮어쓴다**
-- (`ADR-001`). id 컬럼을 따로 두면 업로드가 이름만 갈아 끼운 뒤 id는 옛 사람을 가리키는
-- 상태가 남고, 그때 「이름은 A인데 보이는 사람은 B」가 된다 — `0008`이 `owner_name_raw`를
-- `owner_member_id`와 **짝으로** 열면서 피하려 한 바로 그 모양이다. 이름 하나만 진실로
-- 두면 어긋날 자리가 없다.
--
-- 대가는 **동명이인**이다. `members`의 유니크가 `(team_id, name)`이라 팀이 다르면 같은
-- 이름이 설 수 있다 — 그래서 아래 정책이 이름과 **팀을 함께** 본다.
--
-- `my_member_id()`와 같은 결정 규칙(`order by id limit 1`)을 타는 것은 그 함수를 그대로
-- 부르기 때문이다. 「나」가 두 곳에서 다른 사람이 되면 안 된다.

create or replace function public.my_member_name() returns text
  language sql stable security definer set search_path = ''
as $$
  select m.name from public.members m where m.id = public.my_member_id()
$$;

revoke all on function public.my_member_name() from public, anon, authenticated;
grant execute on function public.my_member_name() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. tasks_select_scope — member 갈래에 공동 담당을 더한다
-- ---------------------------------------------------------------------------
--
-- `0012`가 세운 정책에서 **member 갈래만** 넓힌다. admin·lead 갈래는 그대로다.
--
-- 팀을 함께 보는 이유는 1절의 동명이인이다. `my_team()`이 null인 계정(팀 없는 부원)은 이
-- 갈래에 아예 걸리지 않는다 — 「모른다」를 「전부」로 접지 않는 규율 그대로다
-- (`viewer-scope.ts`).

drop policy if exists tasks_select_scope on public.tasks;

create policy tasks_select_scope on public.tasks
  for select to authenticated
  using (
       public.my_role() in ('admin', 'lead')
    or (public.my_role() = 'member' and public.my_member_id() is not null
        and owner_member_id = public.my_member_id())
    or (public.my_role() = 'member' and public.my_member_name() is not null
        and public.my_team() is not null and team_id = public.my_team()
        and public.my_member_name() = any(co_owner_names))
  );

-- ---------------------------------------------------------------------------
-- 3. tasks_update_scope — 공동 담당도 자기 업무를 고친다
-- ---------------------------------------------------------------------------
--
-- 열람에서 보이는데 진행률을 못 적으면 그 화면은 「내 업무인데 손댈 수 없는 것」이 된다.
-- `using`과 `with check`에 **같은 식**을 쓴다 — 다르면 「고칠 수는 있는데 저장하면 사라지는」
-- 행이 생긴다.
--
-- ⚠ **담당자 칸은 여전히 부원에게 닫혀 있다.** 그것을 막는 것은 이 정책이 아니라
--   `canAssignOwner`(앱)이고, DB에서는 `with check`의 member 갈래가 「주 담당이 나이거나
--   공동 담당에 내 이름이 있다」를 요구하므로 **자기를 명단에서 지우면서 저장하는 update가
--   그 자리에서 거부된다.** 남에게 넘기는 update도 같은 자리에 걸린다.
--
-- lead 갈래는 그대로 `team_id = my_team()`이다 — `0012`가 넓힌 것은 열람뿐이다.

drop policy if exists tasks_update_scope on public.tasks;

create policy tasks_update_scope on public.tasks
  for update to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id = public.my_team())
    or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
    or (public.my_role() = 'member' and public.my_member_name() is not null
        and public.my_team() is not null and team_id = public.my_team()
        and public.my_member_name() = any(co_owner_names))
  )
  with check (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead'   and public.my_team()      is not null and team_id = public.my_team())
    or (public.my_role() = 'member' and public.my_member_id() is not null and owner_member_id = public.my_member_id())
    or (public.my_role() = 'member' and public.my_member_name() is not null
        and public.my_team() is not null and team_id = public.my_team()
        and public.my_member_name() = any(co_owner_names))
  );

-- ---------------------------------------------------------------------------
-- 4. tasks_insert_scope · tasks_delete_scope — 만들고 지운다
-- ---------------------------------------------------------------------------
--
-- **부원은 어느 쪽도 못 한다.** 업무를 만드는 것은 「일을 나눠 주는」 일이고 지우는 것은
-- 되돌릴 수 없다 — 둘 다 팀을 끌고 가는 사람의 조작이다 (`staff-tools.ts`와 같은 결).
--
--   admin → 아무 팀
--   lead  → 자기 팀 (`with check`가 팀 밖으로 만드는 것을 막는다)
--
-- ⚠ **삭제는 되돌릴 수 없고 단계·이력까지 함께 사라진다.** `task_stages`·`task_events`의
--   FK가 `on delete cascade`이기 때문이다. 참조 무결성 동작은 RLS를 타지 않으므로 그
--   두 테이블에 정책이나 권한을 더할 필요가 없다 — 즉 **이 정책 하나가 유일한 문이다.**
--
-- ⚠ 시트에서 온 업무를 지우면 **다음 업로드가 그대로 되살린다** (`(team_id, source_key)`
--   upsert). 그것이 `ADR-001`이고 버그가 아니다. 웹에서 만든 업무는 시트에 없는
--   `source_key`를 갖는 덕에 되살아나지도, 덮이지도 않는다 (5절).

drop policy if exists tasks_insert_scope on public.tasks;

create policy tasks_insert_scope on public.tasks
  for insert to authenticated
  with check (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead' and public.my_team() is not null and team_id = public.my_team())
  );

drop policy if exists tasks_delete_scope on public.tasks;

create policy tasks_delete_scope on public.tasks
  for delete to authenticated
  using (
       public.my_role() = 'admin'
    or (public.my_role() = 'lead' and public.my_team() is not null and team_id = public.my_team())
  );

-- ---------------------------------------------------------------------------
-- 5. GRANT — 어느 컬럼을 여는가
-- ---------------------------------------------------------------------------
--
-- RLS는 「어느 행」이고 GRANT는 「어느 컬럼」이다 (`0003` 4절). 지금까지 update로 열린 것은
-- `status`·`progress`·`updated_at`(`0003`) + `owner_member_id`·`owner_name_raw`(`0008`) +
-- `co_owner_names`(`0009`) 여섯이었다. 「업무 내용을 웹에서 고친다」가 되면서 **사람이 회의
-- 자리에서 고쳐 적는 칸**을 연다.
--
-- 여는 기준은 `0003` 4절이 세운 것 그대로다: 「사람이 오늘 바꾸는 것」과 「다음 업로드가
-- 가져올 것」이 겹치는 자리인가. 그래서 아래 목록에 **`extras`·`raw`·`source_*`가 없다** —
-- 그쪽은 시트 원본과 감사 기록이라 사람이 손댈 자리가 아니고, 열면 이 표가 시트 편집기가
-- 된다.
--
-- ⚠ 여기 열린 칸은 전부 **다음 시트 업로드가 덮어쓴다** (`ADR-001`). 화면이 그 사실을
--   말한다 (`task-edit-form.tsx`).

grant update (
  title, status, approval_status, priority, risk_status, progress,
  assigned_at, due_at, next_action, next_action_owner, next_action_due,
  delay_reason, note, owner_member_id, owner_name_raw, co_owner_names, updated_at
) on public.tasks to authenticated;

-- insert도 컬럼을 열거한다. `grant insert on public.tasks`라고 쓰면 `extras`·`raw`·
-- `source_upload_id`까지 열려, 만드는 요청 하나가 감사 필드를 지어낼 수 있다.
grant insert (
  team_id, source_key, title, owner_member_id, owner_name_raw, co_owner_names,
  status, approval_status, priority, risk_status, progress,
  assigned_at, due_at, next_action, next_action_owner, next_action_due,
  delay_reason, note, source_sheet_tab, source_row_index, updated_at
) on public.tasks to authenticated;

-- delete에는 컬럼 개념이 없다. 행 범위는 4절의 정책이 진다.
grant delete on public.tasks to authenticated;
