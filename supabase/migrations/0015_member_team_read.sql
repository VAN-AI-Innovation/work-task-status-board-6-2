-- ---------------------------------------------------------------------------
-- 0015 — 부원의 **열람**을 팀으로 넓힌다 (수정 범위는 그대로)
-- ---------------------------------------------------------------------------
--
-- `0013` 2절까지 부원은 **자기 담당 건만** 봤다. 그래서 막 승인된 사람이 처음 들어오면
-- 대시보드가 통째로 비고(「아직 데이터가 없습니다」), 배정을 받기 전까지 이 제품은 그
-- 사람에게 빈 상자다 — 그 화면은 가입이 잘못된 것처럼 보인다.
--
-- 팀 단위로 넓히면 첫 화면부터 자기 팀이 어디까지 왔는지가 보이고, 목표 지표가 이미 팀
-- 기준이었으므로(`goal_metrics_select_scope`) 한 화면 안에서 섹션마다 모수가 다른 상태도
-- 사라진다.
--
-- **`0012`가 팀장에게 한 것과 같은 갈래다**: 보는 범위를 넓히되 고치는 범위는 그대로 둔다.
-- `tasks_update_scope`(`0013` 3절)는 **손대지 않는다** — 부원은 여전히 주 담당이거나 공동
-- 담당인 업무만 고친다. 앱 층도 같은 표를 본다 (`viewer-scope.ts`).
--
-- 「모른다」를 「전부」로 접지 않는다: `my_team()`이 null인 계정(팀 없는 부원)은 이 갈래에
-- 걸리지 않으므로 아무 업무도 보지 못한다. 그 화면은 「소속 팀이 정해지지 않았습니다」라고
-- 말한다 (`empty-reason.ts`).
--
-- ⚠ 민감 값 마스킹은 그대로다. 부원이 팀원의 업무를 보게 됐어도 `extras`의 연락처·계정은
--   응답 계층이 `null`로 지운다 (`extras-visibility.ts` · `S6`).

drop policy if exists tasks_select_scope on public.tasks;

create policy tasks_select_scope on public.tasks
  for select to authenticated
  using (
       public.my_role() in ('admin', 'lead')
    or (public.my_role() = 'member' and public.my_team() is not null
        and team_id = public.my_team())
  );
