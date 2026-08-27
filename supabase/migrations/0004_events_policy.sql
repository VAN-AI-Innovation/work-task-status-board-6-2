-- 적용: Supabase 대시보드 → SQL Editor에 0001~0003을 먼저 실행한 뒤 이 파일 전체를
-- 붙여넣고 실행한다. (원격에는 마이그레이션 이름 `t9_events_policy`로 적용돼 있다.)
-- **재적용 가능하다** — drop policy if exists와 grant가 그것을 보장하고, 두 번 돌려도
-- 정책 수가 늘지 않는다.
--
-- 근거 문서: docs/PLAN.md 「T9 착수 시 확정」의 결정 K, ADR-028,
--            ADR-024(조회는 사용자 JWT로 나간다), docs/TICKETS.md T9.
--
-- **T8은 task_events를 일부러 닫아 두었다.** 그때는 이력을 읽는 화면이 없었고 서버
-- (service_role)만 쓰는 테이블이었다 — 0003_auth_rls.sql 머리말의 「여기에 없는 것」이
-- 그것이다. T9가 `TaskRepository.listEvents`를 열면서 읽는 자리가 생겼고, 그 소비자는
-- 주간 보고의 「이번 주 변경 건수」다. 정책이 없는 채로 사용자 JWT로 읽으면 0행이 나오고,
-- 그 0이 「변경이 없어서」인지 「정책이 없어서」인지 화면에서 구분되지 않는다. 이 파일이
-- 그 문을 연다.
--
-- 여기에 없는 것과 그 이유:
--   * insert · update · delete 정책 — **이력은 append-only다.** 쓰는 것은 업로드 확정
--     경로이고 그것은 service_role로 나간다 (ADR-024). 쓰기를 열면 로그인한 사람이 자기
--     업무의 변경 이력을 지우거나 고칠 수 있다 — 이력이 고쳐지면 이력이 아니다.
--   * task_events에 직접 적은 범위 조건(my_role()·my_team()·my_member_id()) — 결정 K가
--     버린 갈래다. 이력의 범위는 업무의 범위와 **같은 사실**이고, 두 곳에 적으면 한쪽만
--     고쳐지는 날이 온다. 그 어긋남은 에러로 뜨지 않고 조용히 더 보여 주는 쪽으로 튄다.
--   * uploads 정책 — 열지 않는다. task_events.upload_id는 **값 그대로** 나가고 조인하지
--     않는다. 조인하려 드는 순간 uploads 정책을 하나 더 열어야 하고, 거기에는
--     parse_result(시트·문서 본문)가 들어 있다 (S6).
--   * security definer 함수 — 새로 만들지 않는다. 셋이면 충분하다 (ADR-025).
--   * doc_extractions 정책 — 여전히 서버 전용이다. 화면에 읽는 자리가 없다.

-- ---------------------------------------------------------------------------
-- 1. 정책 — 부모 tasks의 범위를 다시 탄다
-- ---------------------------------------------------------------------------
--
-- 아래 select가 tasks에 걸리므로 **tasks_select_scope가 다시 적용된다.** 그것이 의도다 —
-- 이력의 범위를 여기 따로 적으면 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
-- tasks 정책이 task_events를 보지 않으므로 **재귀가 아니다.**
-- 같은 판단을 T8이 task_stages에서 이미 한 번 했고(task_stages_select_via_task),
-- 같은 문제에 같은 모양을 쓰는 것이 이 스키마의 읽는 법이다.
--
-- ⚠ tasks에서 지워진 업무의 이력은 함께 보이지 않게 된다 — 부모가 없으면 exists가 거짓이다.
--   감사 목적으로 그 이력을 봐야 할 날이 오면 ADR-028을 먼저 뒤집는다.
drop policy if exists task_events_select_via_task on task_events;
create policy task_events_select_via_task on task_events
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_events.task_id));

-- ---------------------------------------------------------------------------
-- 2. 권한(GRANT) — 정책만으로는 열리지 않는다
-- ---------------------------------------------------------------------------
--
-- 0003_auth_rls.sql이 revoke all로 바닥부터 다시 쌓으면서 task_events를 **되돌려주지
-- 않았다.** 그래서 정책만 만들면 authenticated는 여전히 42501(permission denied)을 받고,
-- 라우트는 그것을 STORAGE_UNAVAILABLE(503)로 옮긴다 — 정책이 있는데도 화면은 「저장소가
-- 죽었다」고 말한다. **두 자물쇠는 따로 열어야 한다: RLS는 「어느 행」이고 GRANT는
-- 「어느 칸」이다.**
--
-- select만 준다. 쓰기 권한 셋과 **전체 삭제 권한**은 0003이 거둔 채로 둔다 — 위의
-- 「정책을 만들지 않는 이유」와 같은 자리이고, 권한이 없으면 정책이 실수로 하나 생기는 날
-- 그 부재가 두 번째 자물쇠가 된다. (전체 삭제 권한은 RLS를 통째로 우회한다.)
grant select on public.task_events to authenticated;

-- anon은 손대지 않는다. 0003이 이 스키마의 테이블에서 통째로 거뒀고 그대로 두는 것이 맞다 —
-- 로그아웃 상태에서 이력이 보이면 안 된다.
