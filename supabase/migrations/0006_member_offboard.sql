-- 적용: Supabase 대시보드 → SQL Editor에 0001~0005를 먼저 실행한 뒤 이 파일 전체를
-- 붙여넣고 실행한다. **재적용 가능하다** (create or replace · revoke/grant 모두 멱등).
--
-- 근거: GitHub 이슈 #29의 후속. 어드민 멤버 화면의 상세 패널에서 「내보내기」를 누를 때
--       무엇이 일어나는가를 정한다.
--
-- ---------------------------------------------------------------------------
-- 내보내기 — 지우지 않고 **끊는다**
-- ---------------------------------------------------------------------------
--
-- `tasks.owner_member_id`가 `members`를 참조한다 (0001_init.sql). 명부 행을 지우면 그 사람이
-- 하던 업무의 담당자가 끊겨 「담당자 미상」이 되고, 그 업무들은 부원 범위에서 통째로 빠진다
-- (`viewer-scope.ts` 결정 D). 시트가 진실의 원천이라(ADR-001) 재업로드하면 같은 이름으로
-- 되살아나기까지 한다 — 지운 것이 지워지지 않는 셈이다.
--
-- 그래서 이 함수는 **두 가지만** 한다.
--   1. profiles.status = 'rejected'  → my_role()·my_team()·my_member_id()가 전부 null이 되어
--                                      0003의 정책이 그대로 막는다 (0005 2절)
--   2. members.auth_user_id = null   → 계정과 명부의 연결만 끊는다. 행도 이름도 남는다
--
-- 결과: 업무 이력과 담당자 표시는 그대로 남고, 그 사람은 아무것도 볼 수 없다. 다시 받아
-- 주려면 팀원 요청 탭에서 재승인하면 되고, `approve_join`이 같은 명부 행에 다시 붙인다
-- (그 함수는 `auth_user_id`가 null이거나 자기 자신일 때만 붙인다 — 남의 행을 빼앗지 않는다).
--
-- ⚠ `role`을 건드리지 않는다. 되돌릴 때 원래 역할이 남아 있어야 「팀장이었던 사람」이
--   팀장으로 돌아온다. status가 이미 전부를 막으므로 role을 낮출 이유가 없다.

create or replace function public.remove_member(target uuid) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  target_role text;
begin
  -- **어드민 전용이다.** 팀장에게 열어 주지 않는다 — 팀장이 자기 팀원을 임의로 끊을 수 있으면
  -- 승인·거절과 달리 되돌리는 사람이 정해져 있지 않다.
  if public.my_role() <> 'admin' then
    raise exception 'not permitted';
  end if;

  -- **자기 자신을 내보낼 수 없다.** 마지막 어드민이 자기를 끊으면 이 함수를 부를 수 있는
  -- 사람이 아무도 남지 않고, 되돌리는 길은 SQL Editor뿐이다.
  if target = (select auth.uid()) then
    raise exception 'cannot remove self';
  end if;

  select p.role into target_role from public.profiles p where p.id = target;
  if not found then
    raise exception 'not permitted';
  end if;

  -- **다른 어드민도 내보낼 수 없다.** set_role이 'admin'을 만들지 못하므로(0005 4-7),
  -- 여기서 내보낸 어드민은 화면으로 되돌릴 수 없다. 대칭이 맞지 않는 문은 두지 않는다.
  if target_role = 'admin' then
    raise exception 'cannot remove admin';
  end if;

  update public.members set auth_user_id = null where auth_user_id = target;
  update public.profiles set status = 'rejected' where id = target;
end $$;

-- 0005 5절과 같은 이유로 세 롤에서 걷고 authenticated에만 되돌려준다.
-- ⚠ `from public`만으로는 안 걷힌다 — Supabase가 public 스키마에 alter default privileges로
--   authenticated에 **직접** grant를 건다 (0005 5절 머리말의 실측).
revoke execute on function public.remove_member(uuid) from public, anon, authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
