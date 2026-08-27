# Step 0: t9-decisions

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처·보안·데이터 규칙 전부
- `docs/TICKETS.md` — **`## T9 · 배포 + README + 주간 보고 전용 화면`** 절 전체.
  완료 기준 6개와 「리스크·미결」의 마지막 항목(`listEvents`가 없어서 변경 건수가 0으로 나간다)
- `docs/PLAN.md` — 「8. 권한」, `S6`(개인정보), `S7`(마크다운을 서버에서 HTML로 렌더하지 않는다),
  `A7`(업로드 4MB 한도), 그리고 **T8이 남긴 「T8 구현 중 확정」 절의 결정 G~J**
- `docs/ADR.md` — **ADR-024**(조회는 사용자 JWT로 나간다) · **ADR-025**(`security definer` 함수 셋) ·
  **ADR-026**(세션이 `?as=`를 이긴다). 마지막 번호는 **ADR-027**이다
- `docs/ARCHITECTURE.md` — 디렉토리 구조 블록과 「권한 (T8)」 절
- `docs/UI_GUIDE.md` — 화면 규칙 전부
- `src/app/api/report/weekly/route.ts` — **전체를 읽는다.** 파일 상단의 ⚠ 주석이 이 step이 회수할 빚이다
- `src/lib/domain/weekly-report.ts` — `WeeklyReportInput`(49행)과 `buildWeeklyReport`(266행)
- `src/app/page.tsx` — **123행**의 각주 상수. 화면이 사용자에게 「집계되지 않습니다」라고 밝히고 있다
- `src/lib/store/task-repository.ts` — `TaskRepository` 인터페이스 전체와 `TaskFilter`(17행)
- `supabase/migrations/0003_auth_rls.sql` — 정책의 결과 특히 `task_stages_select_via_task`(141행)
- `src/types/task.ts` — `TaskEvent`(156행)

## 배경

T9는 세 가지를 동시에 끝낸다. **이 step은 코드를 쓰지 않는다.** 뒤따르는 step 1~9가 서로 어긋나지
않도록 경계를 먼저 못박고 문서에 남기는 것이 전부다.

1. **이벤트 조회 경로를 연다.** `TaskRepository`에 `recordEvents`(쓰기)만 있고 읽는 길이 없다.
   그래서 주간 보고의 「이번 주 변경 건수」가 **0으로 나간다.** 없는 숫자를 지어내지 않기로 한
   결과이고(T5 step 8), 화면은 그 사실을 각주로 밝히고 있다. T9가 그 자리를 메운다.
2. **`/report` 전용 화면**을 만든다 (`UC-08`, 과제 요구 5번).
3. **배포**한다. 심사자가 클론하지 않고도 볼 수 있는 URL을 확보한다.

## 사용자가 이미 확정한 것 (여기서 다시 묻지 마라)

아래 셋은 T9 착수 시 사용자가 답한 값이다. **이 step은 이것을 근거로 문서를 쓰는 것이지,
다시 판단하는 자리가 아니다.**

- **결정 1 — `task_events`는 RLS 정책을 추가해서 사용자 JWT로 읽는다.** 서버가 `service_role`로
  대신 읽는 우회로를 만들지 않는다. 근거는 `ADR-024`다.
- **결정 2 — `/report`는 역할로 막지 않는다.** `member`가 열면 자기 업무만 담긴 보고서가 나온다.
  범위는 이미 `viewer-scope.ts`가 자르므로 화면이 또 자르면 규칙이 두 벌이 된다.
- **결정 3 — 하네스가 원격 Supabase를 직접 고쳐도 된다.** 프로젝트 ref `ebeylvqmcungiitspaib`.
  step 2가 마이그레이션 `0004`를 MCP로 적용한다. **`drop table`·컬럼 삭제·행 삭제·`truncate`는 금지다.**

## 작업

### 1. 경계 결정을 확정해 `docs/PLAN.md`에 「T9 착수 시 확정」 절을 신설한다

T8이 남긴 「T8 구현 중 확정」 절의 결을 그대로 따른다. 결정 문자는 **`K`부터 이어 붙인다**
(T8이 `J`까지 썼다). 아래가 확정할 항목이고, **각 항목에 「왜 다른 갈래를 버렸는지」를 남긴다.**

- **결정 K — `task_events`는 `tasks` 정책을 다시 타서 읽는다.** `task_stages_select_via_task`와
  같은 모양이다(`exists (select 1 from public.tasks t where t.id = task_events.task_id)`).
  이유: 이력의 범위를 여기 따로 적으면 규칙이 두 벌이 되고 한쪽만 고쳐지는 날이 온다.
  버린 갈래: 라우트가 권한을 검증하고 `service_role`로 읽기 — `ADR-024`가 세운 경계에 구멍이 난다.
- **결정 L — `listEvents`의 필터 축을 확정한다.** 최소 `{ since?: string; until?: string; taskIds?: readonly string[] }`.
  **`TaskFilter`를 재사용하지 마라** — 이벤트에는 팀·담당자·상태 축이 없고 `task_id`밖에 없다.
  필터 이름을 `TaskEventFilter`로 새로 짓는다.
- **결정 M — 기간은 `now` 주입으로 정하고, 화면이 주는 것은 「몇 주 전」이 아니라 `weekStart` 날짜다.**
  `lib/domain`은 시계를 부르지 않는다(CLAUDE.md CRITICAL). KST 오늘은 `lib/domain/kst-today.ts`가 낸다.
  잘못된 기간 문자열이 오면 **하드 실패시키지 말고** 이번 주로 되돌리고 그 사실을 응답에 남긴다.
- **결정 N — `/report`는 역할로 막지 않는다** (위 결정 2). 다만 **로그인은 필요하다** —
  `src/proxy.ts`의 보호 목록에 `/report`가 들어간다. 데모 모드(`STORAGE_DRIVER=memory`)는 면제다.
- **결정 O — 마크다운은 서버에서 HTML로 렌더하지 않는다** (`S7`). 화면은 `<pre>`로 원문을 보여주고
  복사·다운로드까지만 한다. 다운로드는 **클라이언트에서 `Blob`으로** 만든다 — 파일을 내려주는
  라우트를 새로 만들지 않는다.
- **결정 P — 배포 대상은 Vercel이고, 배포 자체는 하네스가 하지 않는다.** 사용자 계정 인증이
  필요해서다. step 8이 `blocked`로 서고 사용자가 처리한다. **이것을 미리 문서에 적어 둔다** —
  나중에 「왜 여기서 멈췄나」를 읽는 사람이 있다.

### 2. `docs/ADR.md`에 ADR-028을 신설한다

제목은 결정 K의 내용을 담되 **한 문장으로 판단이 드러나게** 쓴다. 기존 ADR들의 제목 형식을 보고
맞춘다. 본문에는 「버린 갈래와 그 이유」가 반드시 들어간다.

ADR을 **두 개 이상 만들지 마라.** 결정 L~P는 PLAN의 절로 충분하다 — ADR은 되돌리기 비싼 구조
결정에만 쓴다.

### 3. `docs/ARCHITECTURE.md`에 「주간 보고 (T9)」 절을 더한다

- 데이터가 흐르는 길을 한 줄로: `task_events` → `listEvents` → `buildWeeklyReport` → `/api/report/weekly` → `/report`
- **어디가 순수 함수이고 어디가 I/O인지** 표시한다
- 디렉토리 구조 블록에 이 phase가 만들 파일들의 **자리만** 예고한다 (실제 파일은 아직 없다)

### 4. `docs/TICKETS.md`의 T9 절에 「착수 시 실측」을 덧붙인다

아래를 **직접 실행해 확인한 값으로** 적는다. 추측해서 쓰지 마라.

```bash
grep -n "events: \[\]" src/app/api/report/weekly/route.ts   # 빚이 남아 있는 자리
grep -rn "집계되지 않습니다" src/                            # 화면의 각주
ls src/app/report 2>/dev/null || echo "없음"                 # /report 존재 여부
```

원격 DB의 `task_events` 행 수도 Supabase MCP로 세어 적는다. **0행이면 그 사실이 중요하다** —
step 3이 「변경 건수 0」과 「읽을 길이 없어서 0」을 구분할 수 있어야 하고, step 9의 감사도
그 숫자를 근거로 판정한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -n "결정 K\|결정 L\|결정 M\|결정 N\|결정 O\|결정 P" docs/PLAN.md   # 6건 전부
grep -n "ADR-028" docs/ADR.md                                          # 1건
grep -n "주간 보고 (T9)" docs/ARCHITECTURE.md                          # 1건
grep -c "ADR-029" docs/ADR.md                                          # 0이어야 한다
git diff --name-only                                                   # docs/ 4개만
```

## 검증 절차

1. 위 AC를 실행한다.
2. 아래를 눈으로 확인한다:
   - 결정 K~P **각각에 「버린 갈래」가 적혀 있는가?** 결론만 있으면 다시 쓴다.
   - `src/` 아래 파일이 **하나도 바뀌지 않았는가?** 이 step은 문서만 고친다.
   - 실측값을 **실제로 명령을 돌려서** 얻었는가?
3. `phases/t9-deploy-report/index.json`의 step 0을 갱신한다:
   - 성공 → `"status": "completed"`, `"summary"`에 **확정한 결정 6건을 한 줄로 압축**해서 적는다.
     다음 step들이 이 요약만 보고도 경계를 알 수 있어야 한다.
   - 3회 시도 후 실패 → `"status": "error"` + `error_message`
   - 사용자 개입 필요 → `"status": "blocked"` + `blocked_reason` 후 즉시 중단

## 금지사항

- **`src/` 아래 코드를 고치지 마라.** 이유: 이 step은 경계를 정하는 자리다. 코드를 같이 고치면
  결정과 구현이 한 커밋에 섞여, 나중에 「무엇이 결정이고 무엇이 그 결과인지」를 못 가른다.
- **마이그레이션 파일을 쓰지 마라.** 이유: step 2의 몫이다. 여기서 쓰면 step 2가 같은 파일을
  두 번 만든다.
- **ADR을 두 개 이상 만들지 마라.** 이유: 결정 L~P는 구조를 되돌리는 결정이 아니다.
- **기존 ADR 번호를 재사용하거나 기존 결정 문자(A~J)를 덮어쓰지 마라.** 이유: T8이 쓴 자리다.
- 기존 테스트를 깨뜨리지 마라.
