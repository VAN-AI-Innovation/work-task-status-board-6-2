# Step 2: events-policy

## 읽어야 할 파일

- `CLAUDE.md` — 보안·데이터 규칙 전부. 특히 `service_role` 키를 로그·문서·에러에 남기지 않는다
- step 0이 쓴 `docs/PLAN.md` 「T9 착수 시 확정」의 **결정 K**, 그리고 `docs/ADR.md`의 **ADR-028**
- `docs/ADR.md` — **ADR-024**(조회는 사용자 JWT로 나간다) · **ADR-025**(`security definer` 함수 셋)
- `supabase/migrations/0003_auth_rls.sql` — **전체를 읽는다.** 파일 머리말의 형식, 함수 셋
  (`my_role`·`my_team`·`my_member_id`), 그리고 **`task_stages_select_via_task`(141행)** —
  이 step이 쓸 정책은 그것과 같은 모양이다
- `supabase/migrations/0001_init.sql` — `task_events` 테이블(137행)과 파일 머리말의 적용 방법
- `src/lib/store/viewer-storage.ts` — 사용자 JWT로 나가는 저장소. `ViewerContext`(35행)
- step 1이 만든 `listEvents`·`TaskEventFilter`와 두 구현
- `src/lib/auth/request-viewer.ts` — `currentViewerContext()`가 무엇을 돌려주는지

## 배경

T8은 `task_events`에 **RLS를 켜고 정책을 붙이지 않았다.** 의도한 상태였다 — 그때는 이력을 읽는
화면이 없었고, 서버(`service_role`)만 쓰는 테이블이었다. `get_advisors`의
`rls_enabled_no_policy` INFO 3건 중 하나가 이것이다.

step 1이 `listEvents`를 열었으므로 **지금 이 상태에서 사용자 JWT로 이벤트를 읽으면 0행이 나온다.**
빈 결과가 「변경이 없어서」인지 「정책이 없어서」인지 구분되지 않는다. 이 step이 그 문을 연다.

**정책을 여는 순간이 위험한 지점이다.** `task_events`는 `task_id`밖에 없어서, 여기서 범위 규칙을
새로 적으면 `tasks`의 규칙과 두 벌이 된다. 그래서 결정 K는 **`tasks` 정책을 다시 타는 것**이다.

## 이 step은 원격 Supabase를 실제로 고친다 (사용자 승인 범위)

- 프로젝트 ref: **`ebeylvqmcungiitspaib`**. `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`이 같은
  프로젝트를 가리키는지 **먼저 확인하라. 다르면 즉시 `blocked`다.**
- 적용 수단: Supabase MCP의 `apply_migration` (이름 `t9_events_policy`).
  **MCP 도구를 쓸 수 없으면 파일만 쓰고 `blocked`로 기록한 뒤 중단하라.** psql·CLI를 설치하거나
  키로 임의 HTTP를 쏘는 우회로를 만들지 마라.
- **금지**: `drop table`, 기존 컬럼 삭제·변경, 행 삭제, `truncate`.
  이 step이 만드는 것은 **정책 하나와 필요한 권한 조정뿐이다.**

## 작업

### 1. `supabase/migrations/0004_events_policy.sql` 을 쓴다

파일 머리말은 `0003_auth_rls.sql`의 결을 따른다 — 적용 방법, 근거 문서, **여기에 없는 것과 그 이유**.
주석은 한국어로, 「왜」를 남긴다.

내용의 명세:

```sql
-- task_events 조회. 아래 select가 tasks에 걸리므로 tasks_select_scope가 다시 적용된다.
-- 그것이 의도다 — 이력의 범위를 여기 따로 적으면 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
-- tasks 정책이 task_events를 보지 않으므로 재귀가 아니다.
drop policy if exists task_events_select_via_task on task_events;
create policy task_events_select_via_task on task_events
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_events.task_id));
```

**`insert`·`update`·`delete` 정책을 만들지 마라.** 이유: 이력은 업로드 확정 경로가
`service_role`로만 쓴다(`ADR-024`). 쓰기 정책을 열면 로그인한 사람이 이력을 조작할 수 있다.
**이력은 append-only이고 사람이 고치는 것이 아니다.**

`upload_id`가 `uploads`를 참조하지만 **`uploads`에는 정책이 없다.** 조인해서 업로드 정보를
끌어오려 하지 마라 — 그 순간 0행이 되거나 정책을 하나 더 열어야 한다. `listEvents`는
`upload_id`를 **값 그대로** 돌려준다.

### 2. MCP로 원격에 적용하고 실효를 확인한다

적용 뒤 **정책이 실제로 듣는지**를 SQL로 확인한다. 확인 항목:

- `pg_policies`에 `task_events_select_via_task` 1건, `roles={authenticated}`, `cmd=SELECT`
- `task_events`에 `select` 말고 다른 `cmd`의 정책이 **0건**
- 정책의 `qual`에 `profiles` 직접 select가 **없다** (재귀 방지 — T8 완료 기준 3과 같은 잣대)

### 3. `scripts/smoke/rls-check.mjs`에 이벤트 항목을 더한다

이 스크립트는 T8이 만들었고 **세 계정으로 실제 로그인해** `anon` 키 + JWT로 조회한다.
기존 10항목의 형식을 그대로 따라 항목을 더한다:

- `anon`으로 `task_events` 조회 → **0행**
- `admin` JWT로 조회 → 전체 건수
- `member` JWT로 조회 → **자기 업무의 이벤트만**. admin보다 적거나 같다
- `member`가 남의 업무 이벤트를 `task_id`로 직접 지정해도 → **0행**

**원격 `task_events`가 0행일 수 있다.** step 0의 실측이 그것을 적어 뒀다. 0행이면 세 숫자가
전부 0이라 정책이 듣는지 알 수 없다 — 그때는 **스크립트가 「검증 불가」를 명시적으로 출력하게**
하고 `PASS`로 위장하지 마라. 필요하면 `service_role`로 **테스트용 이벤트를 몇 건 넣고 확인한 뒤
넣은 것만 지운다** (`recordEvents`가 쓰는 것과 같은 모양으로). 기존 행은 건드리지 않는다.

### 4. 열람자 경로에 `listEvents`를 노출한다

`viewer-storage.ts`가 감싸는 저장소에 `listEvents`가 실려 나가는지 확인한다. step 1이 인터페이스에
더했으므로 타입은 이미 맞을 것이다 — **실제로 사용자 JWT 클라이언트로 나가는지**를 테스트로 고정한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
node scripts/smoke/rls-check.mjs        # 기존 10항목 + 새 이벤트 항목 전부 PASS
ls supabase/migrations/                 # 0004_events_policy.sql 이 있다
grep -c "drop table\|truncate\|delete from" supabase/migrations/0004_events_policy.sql   # 0
grep -c "for insert\|for update\|for delete" supabase/migrations/0004_events_policy.sql  # 0
```

원격 확인 (MCP `execute_sql`):

```sql
select policyname, cmd, roles from pg_policies
 where schemaname='public' and tablename='task_events';
```

## 검증 절차

1. 위 AC를 실행한다.
2. 아키텍처 체크리스트:
   - 정책이 `profiles`를 직접 select하지 않는가? (무한 재귀)
   - `security definer` 함수를 **새로 만들지 않았는가?** 셋이면 충분하다 (`ADR-025`)
   - `service_role` 키가 로그·문서·커밋 어디에도 없는가?
   - 원격에서 **아무 행도 지우지 않았는가?** 적용 전후로 `task_events`·`tasks` 건수가 같은가?
3. `phases/t9-deploy-report/index.json`의 step 2를 갱신한다:
   - 성공 → `completed` + `summary`. **rls-check의 이벤트 항목 실측 숫자(admin/member 건수)를
     요약에 적어라** — step 9의 감사가 그 숫자를 다시 잰다.
   - MCP를 못 쓰거나 ref가 다르면 → **`blocked`** + `blocked_reason`에 정확한 사유. 파일은 남겨 둔다.

## 금지사항

- **`insert`/`update`/`delete` 정책을 만들지 마라.** 이유: 이력이 조작 가능해진다. append-only다.
- **`task_events`에 범위 규칙을 새로 적지 마라** (`my_role()`·`my_team()`을 직접 부르는 정책).
  이유: 결정 K. `tasks`와 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
- **`uploads`에 정책을 열지 마라.** 이유: 업로드 메타는 서버만 보는 것이 T8의 결정이다.
- **원격에서 무엇도 지우지 마라.** 검증용으로 넣은 행만 되돌린다.
- **`SKIP_LIVE_DB`로 계약을 우회하지 마라.** 이유: 이 step의 요점이 라이브에서 정책이 듣는지다.
- 기존 테스트를 깨뜨리지 마라. 특히 T8이 만든 `rls-check.mjs`의 10항목.
