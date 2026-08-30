-- 적용: Supabase 대시보드 → SQL Editor에 0001~0010을 먼저 실행한 뒤 이 파일을 붙여넣고
-- 실행한다. **재적용 가능하다** (`create or replace` 하나뿐이다).
--
-- 근거: `0010` 4절의 `review_report`가 **한 번도 성공한 적이 없다.** 어드민이 승인·반려를
--       누르면 라우트가 403(`이 작업을 수행할 권한이 없습니다`)을 냈는데, 원인은 권한이
--       아니라 plpgsql의 이름 충돌이다.
--
-- ---------------------------------------------------------------------------
-- review_report — `review_note` 이름 충돌을 없앤다
-- ---------------------------------------------------------------------------
--
-- 문제의 줄은 이것이었다.
--
--   set review_note = case when decision = 'rejected' then review_note else null end
--
-- 왼쪽 `review_note`는 갱신 대상 컬럼이라 늘 컬럼으로 읽힌다. 그런데 **오른쪽의
-- `review_note`는 파라미터 이름이면서 동시에 `report_submissions`의 컬럼 이름**이고,
-- plpgsql의 기본값(`plpgsql.variable_conflict = error`)에서 그런 참조는 실행 시점에
-- 통째로 예외가 된다.
--
--   ERROR 42702: column reference "review_note" is ambiguous
--
-- 이 예외는 `raise exception 'not permitted'`와 **모양이 같아서** 라우트가 갈라 볼 수 없다
-- (`review/route.ts`는 어떤 오류든 403으로 접는다 — 자격 미달과 없는 보고를 갈라 답하지
-- 않기 위해서다, `S6`). 그래서 「권한 없음」으로 보였다.
--
-- **파라미터 이름을 바꾸지 않는다.** 이름을 바꾸면 `create or replace`가 거부하고
-- (`cannot change name of input parameter`) `drop function`이 필요해지는데, 그 사이에
-- 실행 권한(`grant execute`)이 사라져 배포 순서에 새 함정이 생긴다. 무엇보다 **앱이 보내는
-- 인자 이름이 SQL과 글자 그대로 같다**는 이 프로젝트의 규율(`review/route.ts`)이 깨진다.
--
-- 대신 값을 **먼저 지역 변수에 담는다.** 그 대입문에는 테이블이 하나도 없어 컬럼이라는
-- 해석 자체가 성립하지 않으므로 모호할 수가 없다.
--
-- ⚠ 같은 함정이 `submit_report`에는 없다. 그쪽 파라미터(`body`·`note`)도 컬럼과 이름이
--   같지만, `insert ... values`의 값 목록에는 테이블 컬럼이 스코프에 없고 충돌 자리인
--   `do update set`은 `excluded.`로 한정돼 있다.

create or replace function public.review_report(
    target_team text,
    week date,
    decision text,
    review_note text default null
  ) returns void
  language plpgsql security definer set search_path = ''
as $$
declare
  -- 실제로 기록할 사유. 받아들인 보고에는 사유가 없다 — 이전 반려 사유가 남아 있으면 지운다
  note_to_write text;
begin
  -- ⚠ `public.my_role() <> 'admin'`이라고 쓰면 안 된다. 값이 null일 때 그 식은 null이고
  --   `if`는 null을 거짓으로 보아 **검사를 통째로 통과시킨다** (`0005` 2절과 같은 함정)
  if coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'not permitted';
  end if;
  if decision not in ('accepted', 'rejected') then
    raise exception 'bad decision';
  end if;
  if decision = 'rejected' and (review_note is null or btrim(review_note) = '') then
    raise exception 'review note required';
  end if;

  -- 여기서 푼다. 이 대입문에는 테이블이 없으므로 `review_note`는 파라미터로만 읽힌다
  note_to_write := case when decision = 'rejected' then review_note else null end;

  update public.report_submissions
     set status = decision,
         review_note = note_to_write,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where team_id = target_team and week_start = week;

  -- 없는 보고를 반려할 수는 없다. 0행을 조용히 성공으로 두면 화면이 「반려했다」고 말한다
  if not found then
    raise exception 'no submission';
  end if;
end $$;

-- 실행 권한은 `0010` 6절에서 이미 authenticated에 있다. `create or replace`는 그것을
-- 지우지 않으므로 다시 grant하지 않는다.
