-- 적용: Supabase 대시보드 → SQL Editor에 0001~0007을 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (create or replace 하나와 grant 하나뿐이다).
--
-- 근거: 이슈 #29의 후속. 두 가지를 바꾼다 — 조직도의 이메일 범위와 담당자 재지정 권한.
--
-- ---------------------------------------------------------------------------
-- 1. member_directory() — 이메일을 팀으로 가르지 않는다
-- ---------------------------------------------------------------------------
--
-- 0007은 팀장에게 남의 팀 사람의 `email`을 null로 내려보냈다. 그 판단을 뒤집는다.
--
-- 근거는 **이메일이 여기서 하는 일**이다. 조직도의 이메일은 「그 사람의 업무를 들여다보는
-- 열쇠」가 아니라 **연락처**다 — 남의 팀 사람에게 메일을 보내는 것은 조직 안에서 늘 하는
-- 일이고, 그것을 막으려고 이름만 남기면 조직도가 「누가 있는지」만 말하고 「어떻게 닿는지」는
-- 말하지 않는 반쪽이 된다.
--
-- **막아야 할 것은 그대로 막혀 있다.** 남의 팀 사람의 카드를 눌러 업무 진행 상황을 보는 것은
-- 여전히 안 된다 — 그 문은 이 함수가 아니라 `tasks_select_scope`(0003)와
-- `viewer-scope.ts`이고, 둘 다 손대지 않는다. 화면도 남의 팀 카드에 패널을 열지 않는다
-- (`members/page.tsx`의 `openable`). 즉 이 변경으로 늘어나는 것은 **연락처 한 칸**뿐이다.
--
-- ⚠ `member`는 여전히 한 행도 받지 못한다 (`where` 절 그대로). 부원에게 전사 명부가
--   필요한 자리가 아직 없다.

create or replace function public.member_directory()
  returns table (
    user_id uuid, member_id uuid, display_name text, member_name text,
    email text, role text, status text, team_id text
  )
  language sql stable security definer set search_path = ''
as $$
  select p.id, m.id, p.display_name, m.name,
         u.email::text,
         p.role, p.status, coalesce(p.team_id, m.team_id)
    from public.profiles p
    full outer join public.members m on m.auth_user_id = p.id
    left join auth.users u on u.id = p.id
   where public.my_role() in ('admin', 'lead')
   order by coalesce(p.team_id, m.team_id), p.role, m.name, p.id
$$;

-- 실행 권한은 0005 5절에서 이미 authenticated에 있다. create or replace는 그것을 지우지
-- 않으므로 다시 grant하지 않는다.

-- ---------------------------------------------------------------------------
-- 2. tasks — 담당자 칸을 연다 (업무 패널의 담당자 지정·재지정)
-- ---------------------------------------------------------------------------
--
-- 0003 4절은 `grant update (status, progress, updated_at)`로 컬럼을 셋만 열었다. 거기에
-- 담당자 두 칸을 더한다. **정책은 한 글자도 손대지 않는다** — 누가 어느 행을 고칠 수 있는지는
-- `tasks_update_scope`가 이미 정해 뒀고, 그 `with check`가 이 변경의 안전장치이기 때문이다.
--
--   admin  → 아무 행이나. 담당자를 누구로든 바꾼다.
--   lead   → 자기 팀 행. `with check`가 `team_id = my_team()`이라 팀 밖으로 밀어낼 수 없다.
--   member → 자기 행. `with check`가 `owner_member_id = my_member_id()`라 **남에게 넘기는
--            update가 그 자리에서 거부된다.** 즉 부원은 담당자를 못 바꾼다.
--
-- 앱도 같은 자리를 한 번 더 막는다 (`lib/domain/task-authoring.ts`의 `canAssignOwner`) —
-- 데모·폴백 모드에는 RLS가 없어 그쪽이 유일한 층이다.
--
-- `owner_name_raw`를 함께 여는 이유: 화면과 표가 읽는 담당자 이름이 그 칸이다. 하나만 바꾸면
-- 「담당자는 A인데 이름은 B」인 행이 남고, 그것은 데이터가 틀린 것으로 보인다.
--
-- ⚠ 이 두 칸은 **다음 업로드가 덮어쓴다.** 시트가 진실의 원천이라는 규칙 그대로이며
--   (`ADR-001`), status·progress가 이미 지고 있는 성질과 같다.
grant update (owner_member_id, owner_name_raw) on public.tasks to authenticated;
