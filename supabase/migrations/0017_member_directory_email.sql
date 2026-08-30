-- ---------------------------------------------------------------------------
-- 0017 — 조직도의 이메일을 **부원에게도** 준다. `0016`의 `case`를 되돌린다
-- ---------------------------------------------------------------------------
--
-- 적용: 0016까지 실행한 뒤 이 파일을 붙여넣는다. **재적용 가능하다** (create or replace 하나).
--
-- `0016`은 부원에게 조직도를 열되 `email`은 자기 행에서만 내려보냈다. 그 판단을 뒤집는다 —
-- **`0008`이 팀장에게 한 것과 같은 판단이고 근거도 같다.**
--
-- 조직도의 이메일은 「그 사람의 업무를 들여다보는 열쇠」가 아니라 **연락처**다. 부원도 남의
-- 팀 사람에게 메일을 보낼 일이 실제로 있고, 그때 이름만 있는 조직도는 「누가 있는지」만 말하고
-- 「어떻게 닿는지」는 말하지 않는 반쪽이 된다. 감춰서 지켜지는 값도 아니다 — 같은 학회 안에서
-- 메일 주소는 이미 오간다.
--
-- **막아야 할 것은 그대로 막혀 있다.** 남의 카드를 눌러 업무 진행을 보는 것은 여전히 안 된다:
-- 화면이 부원에게 자기 카드의 패널만 열고(`canOpenMemberPanel`), 업무 자체는
-- `tasks_select_scope`가 팀에서 자르며(`0015`), 직책 변경은 `set_role`이 admin만 받는다
-- (`0005` 4-7). 이 변경으로 늘어나는 것은 **연락처 한 칸**뿐이다.
--
-- 결과적으로 이 함수는 세 역할에 **같은 것**을 준다. `0016`이 넓힌 `where`는 그대로 두고
-- `case`만 걷어내므로, 함수 본문이 `0008` 것과 `where` 한 줄만 다른 모양으로 돌아간다.

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
   where public.my_role() in ('admin', 'lead', 'member')
   order by coalesce(p.team_id, m.team_id), p.role, m.name, p.id
$$;

-- 실행 권한은 0005 5절에서 이미 authenticated에 있다.
