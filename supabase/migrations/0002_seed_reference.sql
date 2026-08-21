-- 적용: Supabase 대시보드 → SQL Editor에 0001_init.sql을 먼저 실행한 뒤 이 파일을 실행한다.
--
-- 여기 있는 것은 **부서 1건과 팀 3건뿐**이다. 이 둘은 시트 탭 구조에서 오는 고정된 집합이고
-- tasks.team_id의 참조 대상이라 업로드보다 먼저 있어야 한다.
--
-- enum_options·sla_rules는 시드하지 않는다. 그 값은 업로드된 `설정` 탭에서 오며(T5),
-- 여기에 박아두면 시트가 바뀌었을 때 어느 쪽이 진실인지 알 수 없게 된다.
-- tasks·goal_metrics도 시드하지 않는다 — 시트가 진실의 원천이다.
--
-- on conflict do nothing이라 몇 번을 다시 실행해도 안전하다. 기존 값을 덮지도 않는다
-- (팀 이름을 Studio에서 고쳤다면 이 파일을 다시 돌려도 되돌아가지 않는다는 뜻이다).

insert into departments (id, name, sort_order) values
  ('contents-marketing', '컨텐츠마케팅부', 0)
on conflict (id) do nothing;

-- teams.id가 곧 TeamKey다 (0001_init.sql의 근거 주석 참고).
-- sheet_tab은 시트 탭 이름 원문이다.
insert into teams (id, department_id, name, sheet_tab, sort_order) values
  ('edit',      'contents-marketing', '편집팀',       '01_편집팀',        1),
  ('shoot',     'contents-marketing', '촬영·기획팀',  '02_촬영·기획팀',   2),
  ('marketing', 'contents-marketing', '마케팅·관리팀', '03_마케팅·관리팀', 3)
on conflict (id) do nothing;
