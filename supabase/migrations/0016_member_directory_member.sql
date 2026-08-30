-- ---------------------------------------------------------------------------
-- 0016 — 조직도를 **부원에게도 연다.** 단 남의 이메일은 내리지 않는다
-- ---------------------------------------------------------------------------
--
-- 적용: Supabase 대시보드 → SQL Editor에 0001~0015를 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (create or replace 하나뿐이다).
--
-- `0008`까지 `member_directory()`는 `admin`·`lead`에게만 행을 냈고, 그 주석은 「부원에게
-- 전사 명부가 필요한 자리가 아직 없다」고 적어 뒀다. **그 자리가 생겼다** — 부원도 `/members`를
-- 연다.
--
-- 근거는 `0015`가 업무에 한 것과 같다: 방금 승인된 사람에게 이 제품은 「우리 조직이 어떻게
-- 생겼는지」조차 말해 주지 않는 상태였다. 「누가 어느 팀에 있는가」는 사내 조직도가 늘 말하는
-- 사실이고, 그것을 감추는 것이 지키는 것은 아무것도 없다.
--
-- **넓히는 것은 거기까지다.** 부원에게는 `email`을 자기 행에서만 내려보낸다 —
--
--   * `0008`이 팀장에게 이메일을 다 준 근거는 「연락처는 조직 안에서 늘 오가는 값」이었다.
--     팀장은 남의 팀 사람에게 업무로 연락할 일이 실제로 있고, 부원은 그 자리가 아니다.
--   * 부원이 볼 수 있는 개인정보를 늘리지 않고 조직도만 여는 것이 이 변경의 전부다.
--
-- 나머지 문은 **한 글자도 손대지 않는다.** 업무는 `tasks_select_scope`가 팀으로 막고(`0015`),
-- 직책 변경은 `set_role`이 admin에게만 열려 있으며(`0005` 4-7), 합류 요청 목록은
-- `pending_requests()`가 대표·팀장만 받는다(`0005` 4-1). 화면도 부원에게는 **자기 카드의
-- 패널만** 연다 (`canOpenMemberPanel`) — 그것은 헛걸음을 없애는 일이고, 진짜 문은 여기 이 셋이다.
--
-- ⚠ `my_role()`은 `status = 'active'`인 계정에만 값을 준다 (`0005` 2절). 승인 대기·거절
--   계정은 세 값 어디에도 걸리지 않아 여전히 한 행도 받지 못한다.

create or replace function public.member_directory()
  returns table (
    user_id uuid, member_id uuid, display_name text, member_name text,
    email text, role text, status text, team_id text
  )
  language sql stable security definer set search_path = ''
as $$
  select p.id, m.id, p.display_name, m.name,
         case
           when public.my_role() = 'member' and p.id is distinct from (select auth.uid())
             then null
           else u.email::text
         end,
         p.role, p.status, coalesce(p.team_id, m.team_id)
    from public.profiles p
    full outer join public.members m on m.auth_user_id = p.id
    left join auth.users u on u.id = p.id
   where public.my_role() in ('admin', 'lead', 'member')
   order by coalesce(p.team_id, m.team_id), p.role, m.name, p.id
$$;

-- 실행 권한은 0005 5절에서 이미 authenticated에 있다. create or replace는 그것을 지우지
-- 않으므로 다시 grant하지 않는다.
