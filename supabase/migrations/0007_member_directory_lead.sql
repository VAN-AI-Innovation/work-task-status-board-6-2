-- 적용: Supabase 대시보드 → SQL Editor에 0001~0006을 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (create or replace 하나뿐이다).
--
-- 근거: GitHub 이슈 #29의 후속. 팀장에게도 멤버 화면을 열되, **남의 팀 사람의 이메일은
--       내려보내지 않는다.**
--
-- ---------------------------------------------------------------------------
-- member_directory() — 팀장도 부른다. 단 이메일은 자기 팀만
-- ---------------------------------------------------------------------------
--
-- 0005 4-2에서 이 함수는 `my_role() = 'admin'`일 때만 행을 냈다. 그래서 팀장에게 화면을
-- 열어 주면 **빈 조직도**를 보게 된다.
--
-- 팀장이 조직도 전체를 보는 것이 맞다: 자기 팀이 조직 어디에 서 있는지 모르면 「우리 팀」이
-- 무엇과 나란한지 알 수 없고, 팀 이름은 이미 `teams_select_authenticated`로 전원에게 열려 있다.
--
-- **다만 이메일은 다르다.** 그것은 개인정보이고(S6), 남의 팀 사람의 것을 팀장이 알아야 할
-- 이유가 없다. 그래서 행은 전부 내되 `email`만 갈래를 둔다:
--
--     admin                      → 전부
--     lead + 대상이 내 팀        → 이메일
--     lead + 대상이 남의 팀      → null
--
-- 화면은 이 null을 보고 그 카드를 **누를 수 없게** 만든다 (`members/page.tsx`).
-- 그것은 편의이고, 진짜 문은 여기다 — 주소를 직접 쳐도 내려오지 않는 값은 그릴 수 없다.
--
-- ⚠ `member`는 여전히 한 행도 받지 못한다. 부원에게 전사 명부가 필요한 자리가 없다.
--
-- ⚠ `set_role`·`remove_member`는 **손대지 않는다.** 둘 다 admin 전용 그대로다 — 보는 것과
--   바꾸는 것은 다른 질문이고, 팀장에게 승격 권한을 주는 결정은 여기 섞이면 안 된다.

create or replace function public.member_directory()
  returns table (
    user_id uuid, member_id uuid, display_name text, member_name text,
    email text, role text, status text, team_id text
  )
  language sql stable security definer set search_path = ''
as $$
  select p.id, m.id, p.display_name, m.name,
         case
           when public.my_role() = 'admin' then u.email::text
           when public.my_team() is not null
                and coalesce(p.team_id, m.team_id) = public.my_team() then u.email::text
           else null
         end,
         p.role, p.status, coalesce(p.team_id, m.team_id)
    from public.profiles p
    full outer join public.members m on m.auth_user_id = p.id
    left join auth.users u on u.id = p.id
   where public.my_role() in ('admin', 'lead')
   order by coalesce(p.team_id, m.team_id), p.role, m.name, p.id
$$;

-- 실행 권한은 0005 5절에서 이미 authenticated에 있다. create or replace는 그것을 지우지
-- 않으므로 다시 grant하지 않는다 — 적어 두면 「여기서도 준다」로 읽혀 규칙이 두 곳이 된다.
