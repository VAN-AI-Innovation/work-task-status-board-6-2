# 아키텍처

> 근거 문서는 `docs/PLAN.md`. 결정이 바뀌면 PLAN.md를 먼저 고친다.

## 계층 경계 — 이 문서에서 가장 중요한 규칙

```
서버 컴포넌트 (page.tsx)  ──직접 호출──▶  lib/store · lib/domain    ← HTTP 왕복 없음
                                              │
클라이언트 컴포넌트          ──HTTP──▶  app/api/**  ──▶  lib/…
(업로드 · PATCH · 리프레시 · 필터)
```

- **초기 렌더 데이터는 서버 컴포넌트가 `lib/`를 직접 호출**한다. 자기 API 라우트를 `fetch`하지 않는다
  (불필요한 HTTP 왕복 — Next.js 흔한 안티패턴).
- **API 라우트는 클라이언트에서 발생하는 상호작용만** 담당한다: 파일 업로드, 상태 수정, 외부 소비.
- 라우트 핸들러가 하는 일은 **zod 검증 → lib 호출 → 직렬화 3단계뿐**이다. 계산 로직 0줄.
- `src/app/api/**`는 `export const runtime = 'nodejs'`를 명시한다 (ExcelJS·mammoth가 Node 내장 모듈 사용).

## 디렉토리 구조

```
src/
├── app/
│   ├── page.tsx                      # 통합 대시보드
│   ├── teams/[teamSlug]/page.tsx     # 부서별 탭
│   ├── upload/page.tsx               # 엑셀 업로드 + 미리보기
│   ├── extract/page.tsx              # 독스 → 배정표
│   ├── error.tsx                     # 조회 실패 바운더리 (teams/ 에도 둔다)
│   └── api/  uploads/sheet · uploads/[id]/commit · uploads/seed · uploads/doc
│             export/assignment · tasks · tasks/[id] · stats · alerts
│             goals · report/weekly · health
├── components/   shell/ dashboard/ charts/ alerts/ tasks/ goals/ upload/ extract/
│                                              # props 받아 JSX만. 계산 금지
├── lib/
│   ├── sheet/   workbook-reader · header-resolver · tab-detector
│   │            section-splitter · cell-normalizer
│   │            task-schema · row-mapper · stage-unpivot
│   │            adapter-edit-team · adapter-shoot-team
│   │            adapter-marketing-team · adapter-goal-metrics
│   │            adapter-settings-tab · sheet-pipeline
│   ├── doc/     docx-reader · markdown-reader · outline-builder
│   │            assignment-mapper · workload-parser · doc-pipeline
│   ├── xlsx/    assignment-writer
│   ├── domain/  task-semantic · display-status · task-derive · kst-today
│   │            progress-stats · goal-stats · alert-rules · weekly-report
│   ├── store/   task-repository · repository-contract · memory-task-store
│   │            supabase-task-store · upload-record-store · store-factory
│   ├── upload/  upload-limits · zip-inspector · upload-guard · parse-runner
│   │            upload-mapper · upload-preview · upload-commit · seed-loader
│   ├── api/     api-error · read-context · task-response · viewer-role
│   │            assignment-schema
│   ├── auth/    쿠키 세션 → `Viewer` 해석 (T8)
│   ├── view/    화면이 쓰는 표시 규칙 (role-layout · status-badge · chart-series …)
│   └── fixtures/  sample-workbook.xlsx · sample-workload.md · sample-workload.docx
│                  seed-tasks.json
├── proxy.ts                            # Next.js 16의 middleware. 세션 갱신·보호 라우트 (T8)
├── supabase/migrations/   *.sql        # 스키마 단일 소스 (T4부터)
└── types/  task.ts · sheet.ts · doc.ts · goal.ts · api.ts · auth.ts
```

`src/services/`는 **두지 않는다.** 외부 연동(Supabase 클라이언트)은 `lib/store/`가 감싼다.

### 파일명 규칙 — TDD 가드를 역이용한다

`.claude/hooks/tdd-guard.sh`는 `src/lib/`·`src/services/`에서만 테스트를 강제하고
`src/components/`·`app/**/page.tsx`·`src/types/`는 무검사 통과한다.
이 성질을 그대로 이용한다: **판단이 들어가는 코드는 전부 `src/lib/`, 컴포넌트는 props 받아 JSX만 뱉는다.**

⚠ 가드 함정 2개 — 파일명 규칙에 반영했다.

- 가드는 **basename만 보고** `src/__tests__/{basename}.test.ts`까지 탐색한다.
  `lib/domain/status.ts`와 `lib/sheet/status.ts`가 동시에 있으면 테스트 하나로 둘 다 통과해버린다.
  → **모든 lib 파일명을 전역 유니크하게** 짓는다 (`task-semantic.ts`, `assignment-mapper.ts` 식). 미관 문제가 아니다.
- `*.config.*`는 무조건 통과다. `store-factory.config.ts` 같은 이름으로 우회하지 않는다.

## 데이터 모델

공통 컬럼 + `extras jsonb` + 자식 테이블. **매핑되지 않은 컬럼은 자동으로 `extras`로 흘러들어간다** —
이것이 70컬럼 대응의 전부다.

```
departments · teams · members(auth_user_id — T8에서 시트 담당자 이름과 계정을 잇는다)

profiles      id uuid PK → auth.users(id)   -- T8에서 생긴다
              role text  -- admin | lead | member
              team_id text → teams(id)      -- admin은 null일 수 있다

tasks         id, team_id, department_id
              source_key            -- 자연키. 업무ID 있으면 그것, 없으면 slug(업무명)+담당자
              title, owner_member_id, owner_name_raw, co_owner_names[]
              status                -- 설정 탭 원문 그대로 보존
              approval_status, priority, risk_status
              progress smallint     -- null 허용 (빈 셀과 0을 반드시 구분)
              assigned_at, due_at, next_action, next_action_owner, next_action_due
              delay_reason, note
              extras jsonb          -- 팀 전용 필드
              raw jsonb             -- 원본 행 통째 (감사·복원). API 응답에는 절대 싣지 않는다
              last_progress_at      -- 장기 미갱신 판정 기준
              source_upload_id, source_sheet_tab, source_row_index
              UNIQUE (team_id, source_key)

task_stages   task_id, seq, stage_key, stage_label,
              planned_date, actual_date, content, confirm_status, sla_days
task_events   task_id, upload_id, changed_fields jsonb, occurred_at
enum_options  group_key, value, sort_order, semantic
sla_rules     team_id(null=공통), stage_key, label, days
uploads       kind, filename, parse_result jsonb, status, summary
doc_extractions  upload_id, order_index, category, task_no, title,
                 difficulty, deadline_raw, deadline_date, priority, details jsonb
goal_metrics     team_id, period_label, title, goal_text, kpi_name,
                 target_value, actual_value, achievement_rate, prev_period_delta,
                 channel, owner_member_id, exec_status,
                 analysis, went_well, needs_improvement,
                 started_at, due_at, extras jsonb, source_upload_id
                 UNIQUE (team_id, period_label, title)
team_period_goals  team_id, period_label, goal_text, risk_text
```

- `goal_metrics`는 `tasks`와 별도다. **업무가 아니라 성과 지표**이기 때문 —
  진행 상태·마감·담당자 축이 아니라 목표값 대 실적값 축으로 움직인다.
- `enum_options.semantic`이 급소다. 판정 로직이 한글 상태 문자열을 직접 알면 시트에서 이름이 바뀔 때
  코드가 깨진다. 매핑층을 둔다:

```
업무 배정·준비 중 → planned      검토 요청 → review     게시·이관 대기 → pending_release
진행 중          → in_progress   승인 대기 → approval   완료 → done
수정 중          → rework        보류 → hold            취소 → cancelled
```

- **「지연」은 상태값이 아니라 파생 판정이다** (`due_at < today && semantic ∉ {done, cancelled}`),
  여기에 시트의 `리스크 상태 = 지연`을 OR로 합친다. 이 구분을 흐리면 완료율이 틀린다.

## 데이터 흐름

### 엑셀 → 조회

```
업로드(4MB 제한, ZIP 내부 엔트리로 타입 판별)
  ↓ workbook-reader     시트별 cells[][] + merges[]      ← ExcelJS import는 여기 한 곳뿐
  ↓ header-resolver     병합셀 forward-fill → 2단 헤더를 "컨셉·레퍼런스 / 예정일"로 결합
  ↓ tab-detector        탭 이름 정규식 + 헤더 시그니처(필수 컬럼 3개 이상) 이중 판별
  ↓ [설정 탭 먼저]       enum/SLA 레지스트리 확보
  ↓ section-splitter    마케팅 탭 A/B/C 분할
                        A → tasks(문의)  B → goal_metrics(성과)  C → 브리핑 텍스트
  ↓ 팀별 어댑터          선언적 FIELD_MAP + STAGE_GROUPS (매칭 실패 컬럼은 자동으로 extras)
  ↓ zod 검증            실패는 warnings[]에 담고 값은 보존 (하드 실패 금지)
  ↓ 미리보기 반환        { 신규 N / 변경 M / 유지 K / 경고 W }
  ↓ [사용자 확정] → upsert ON CONFLICT (team_id, source_key)  ← 단일 트랜잭션
```

**미리보기→확정 2단계**를 쓰는 이유: 즉시 반영은 단순하지만 잘못된 파일 하나로 DB가 오염되고
되돌리기 어렵다. 파싱 결과를 `uploads.parse_result`에 넣고 확정 시 그것을 소스로 upsert하면
서버 세션 상태 없이 2단계가 된다. **확정 후 `parse_result`는 비우고 `summary`만 남긴다.**

업로드 상태 전이(실패 경로 포함):

```
idle → validating → parsing → previewing → committing → done
         ↓ rejected   ↓ failed    ↓ 취소       ↓ failed
                                (무변경)     (previewing으로 복귀, 재시도)
```

### 독스 → 배정표

```
.docx → mammoth(convertToHtml, 옵션 없음) → node-html-parser → OutlineNode[]
                                                                    │
sample-workload.md → markdown-reader ────────────────────────────────┤ 같은 타입
       (테스트 픽스처 전용. 제품 경로 아님)                             ▼
                                            outline-builder → assignment-mapper
                                                       ▲ workload-parser 조인
                                          └── 여기까지 doc-pipeline 하나가 잇는다 ──┘
                                                                    ▼
                                    assignment-writer → 드롭다운 붙은 xlsx
                                                                    ▼
                                              사람이 채워서 /upload 재업로드 ★ 고리가 닫힌다
```

경계: `docx-reader`와 `markdown-reader`가 **같은 `OutlineNode[]`를 뱉고**, 그 아래 계층은
입력 형식을 모른다.

## 집계·판정 — `src/lib/domain/` 순수 함수

**집계는 SQL로 하지 않는다.** 전부 JS 순수 함수다. 리포지토리는 CRUD와 필터링된 조회만 담당한다.

```
TaskRepository  (저장/조회만)                domain/  (판정/집계만)
  listTasks(filter) → Task[]          →      toSemantic(statusRaw, registry)
  getTask(id) → Task | null           →      toDisplayStatus(semantic, flags)
  upsertTasks(tasks) → {created,…}    →      deriveTaskFlags(task, ctx)
  listStages(taskIds) → Stage[]       →      summarizeTeam(tasks, ctx)
  listGoalMetrics(filter)             →      buildKpiStrip(tasks, ctx)
  upsertGoalMetrics(metrics)          →      collectAlerts(tasks, stages, ctx)
  recordEvents(events)                →      summarizeGoals(metrics, ctx)
  getLastSyncedAt() → timestamp       →      buildWeeklyReport(tasks, metrics, events, ctx)
```

수백~수천 행 규모에서 SQL 집계의 이점은 없고, **memory·supabase 두 구현의 결과 일치**를 보장하는
값이 훨씬 크다. 행이 수만을 넘어가면 재검토한다 — 이 과제 범위 밖이다.

**`now`는 반드시 인자로 주입한다.** 도메인 함수 안에서 시간을 읽지 않는다
(`kst-today.ts`가 `Asia/Seoul` 기준 오늘을 산출하고, 나머지는 그 값을 받는다).

## 상태 관리

- **서버 상태** — 서버 컴포넌트가 `lib/store`·`lib/domain`을 직접 호출해 렌더한다. 전역 스토어 없음.
- **조회 조건**(필터·정렬·검색·`?owner=`·`?task=`·`?as=`) — **URL 쿼리가 단일 소스.**
  기술적 편의가 아니라 UC-11 때문이다: 팀장이 "이거 봐" 하고 링크를 던지는 행위가 가장 자주 일어난다.
- **로컬 UI 상태**(드롭존, 사이드 패널 열림, 미리보기 단계) — `useState`.
- **갱신** — `router.refresh()` + `isPending` 표시(불투명도 페이드 150ms). "마지막 갱신 HH:mm"은 두지 않는다 — 근거는 `PLAN.md`「시각화」.

## 저장소 · 시연 안전망

`STORAGE_DRIVER` 환경변수로 `supabase`(기본) / `memory`를 고른다. 메모리 드라이버는
마이그레이션 경로가 아니라 **시연 안전망**이다 — 무료 티어 일시중지 대비, `.env` 없이 심사자가
바로 실행, 계약 테스트로 도메인 로직 검증을 저장소와 분리.

**폴백은 읽기 전용이다.** Supabase 연결 실패 시 memory로 전환하되 모든 쓰기 경로는 `503`을 반환하고,
배너 문구를 **"읽기 전용 — 저장소 연결 실패"**로 두어 의도된 데모 모드(`STORAGE_DRIVER=memory`)와 구분한다.
폴백 중 쓰기를 메모리에 받으면 재시작 시 조용히 사라진다.

## 권한 (T8)

`profiles.role`: `admin`(대표·실장) / `lead`(팀장) / `member`(부원). 결정 근거는
`PLAN.md`「8. 권한」의 **T8 착수 시 확정** 절과 `ADR-024`~`ADR-026`.

### 세션 → 열람자

```
브라우저 쿠키 (@supabase/ssr)
   │
   ├─ src/proxy.ts          ← Next.js 16에서 middleware.ts의 새 이름. export 이름도 `proxy`
   │     · 토큰 갱신(리프레시 회전)
   │     · 세션 없으면 /login 리다이렉트  — 단 데모·폴백에서는 하지 않는다 (ADR-026)
   │
   └─ src/lib/auth/          ← 쿠키 → Viewer(`types/auth.ts`) 해석
         · profiles.role · profiles.team_id · members.auth_user_id → memberId
```

`?as=`는 **세션이 없을 때만** 산다.

```
세션이 있으면              → 세션의 role이 이긴다. ?as=는 무시된다 (개발 환경에서도)
세션이 없고 프로덕션+실저장소 → member        (S4)
세션이 없고 데모·폴백        → ?as= 해석      (ADR-013)
```

**데모 모드에서는 범위가 갈리지 않는다.** `?as=lead`에는 붙일 팀도 구성원도 없다 — 메모리
저장소에는 `profiles`도 `members`도 없어서 「우리 팀」이라고 부를 대상 자체가 없고, 흉내에
범위를 주면 **「권한이 있는 척」**이 된다. 데모에서 `?as=`가 바꾸는 것은 **섹션 배치와 민감
`extras` 마스킹** 둘뿐이고, **범위 구분(`scopeTasks`·RLS)은 로그인했을 때만 일어난다.**
이 사실을 적어 두지 않으면 다음 사람이 데모에서 `?as=lead`로 재 보고 「권한이 안 걸린다」고
결론 내린다 — 걸리지 않는 것이 맞고, 걸릴 데이터가 없는 것이다.

### 조회와 쓰기는 다른 클라이언트로 나간다 (`ADR-024`)

```
서버 컴포넌트 · 조회 라우트 · PATCH
        │  anon 키 + 사용자 JWT (요청 스코프)
        ▼
  lib/store/viewer-storage.ts  → Supabase  ← RLS가 실제로 걸린다
                                    ▲
        │  service_role (프로세스 전역 싱글턴)
  lib/store/store-factory.ts · getStorage()
        ▲
업로드 확정 · /api/uploads/seed        ← 올린 사람의 범위 밖 행도 쓴다
```

**`getStorage()`에 JWT를 밀어 넣지 않는다.** 캐시가 프로세스 전역이라 한 사용자의 토큰이
다음 요청의 다른 사용자에게 샌다. `/extract` 두 라우트는 저장소를 아예 부르지 않는다 (`ADR-022`).

⚠ **라이브에서 로그인하지 않은 조회는 「0행」이 아니라 실패한다.** `0003_auth_rls.sql`이
`anon`에게서 테이블 권한을 통째로 회수했으므로(`S5`), 세션 없는 요청은 RLS에 닿기 전에
`42501 permission denied`로 막히고 라우트는 그것을 `STORAGE_UNAVAILABLE`(503)로 옮긴다.
**정보는 새지 않지만 문구가 사실과 다르다** — 사용자는 「로그인하세요」를 봐야 한다.
이 상태를 없애는 것은 `proxy`다(세션이 없으면 저장소에 닿기 전에 `/login`으로 보낸다).

### `security definer` 함수 — **셋이다** (`ADR-025`)

```sql
public.my_role()       → text   -- profiles.role.    없으면 null (프로필 없는 계정)
public.my_team()       → text   -- profiles.team_id. admin은 null일 수 있다
public.my_member_id()  → uuid   -- members.auth_user_id = auth.uid() 인 행의 id. 없으면 null
```

- ⚠ **RLS 재귀 함정**: 정책 안에서 `profiles`·`members`를 직접 select하면 그 테이블의 정책이
  다시 걸린다. 셋 다 `security definer`로 감싼다.
- ⚠ 셋 다 `language sql` · `stable` · **`set search_path = ''`** 이고 테이블 이름에 스키마를
  명시한다(`public.profiles`). 고정하지 않으면 호출자가 같은 이름의 테이블을 자기 스키마에
  만들어 함수를 속인다 — **권한 상승 경로다** (`S5`).
- ⚠ **`null`은 셋 다 정상값이고 「모두 허용」이 아니다.** SQL의 `=`가 `null`에 참을 내지 않는
  성질이 우리 편이다. 뒤집어 쓰면(`is not distinct from`) 전원에게 열린다.

### 정책 표

**적용본은 `supabase/migrations/0003_auth_rls.sql`이다.** 아래는 그 파일에 실제로 들어간
정책 **11개**이며, 대상 롤은 전부 `authenticated`다 — `anon` 정책은 하나도 없다.

| 테이블 | select | update | insert·delete |
|---|---|---|---|
| `tasks` | admin 전체 / lead `team_id = my_team()` / member `owner_member_id = my_member_id()` | 같은 범위 (`using` = `with check`) | 없음 (`service_role`만) |
| `task_stages` | 부모 `tasks`가 보이면 보인다 | — | 없음 |
| `goal_metrics` · `team_period_goals` | admin 전체 / lead·member `team_id = my_team()` | — | 없음 |
| `teams` · `departments` · `members` · `enum_options` · `sla_rules` | 로그인한 전원 (참조 데이터) | — | 없음 |
| `profiles` | 본인 행만 | 없음 | 없음 |
| `uploads` · `task_events` · `doc_extractions` | **정책 없음 — 한 행도 안 보인다** | 없음 | 없음 |

- **마지막 줄 셋은 정책을 만들지 않은 것이 결론이다.** 착수 시점 초안은 `uploads`·
  `doc_extractions`를 admin·lead에게 열고 `task_events`를 부모 `tasks`에 딸리게 했는데,
  적용하면서 셋 다 **서버(`service_role`) 전용**으로 닫았다. `uploads.parse_result`에는
  시트·문서 본문이 통째로 들어 있고(`S6`) 화면에는 그것을 읽는 자리가 없다. 필요해지면
  그때 정책을 붙인다 — 지금 열어 두면 쓰지도 않는 경로로 원본 행이 나간다.
  (`task_events` 조회는 `T9`의 `listEvents`가 여는 자리이고, 그 경로도 서버 쪽이다.)
- **`member`에게 `owner_member_id is null`인 행은 보이지 않는다** — 시트 담당자가
  `members`에 안 붙은 경우(`unknown_owner`)다. `null`을 「내 것」으로 치면 담당자 미상 업무가
  전원에게 보이고, 그것은 범위 구분이 아니다.
- **컬럼 단위 제한은 RLS가 아니라 GRANT와 API가 함께 진다.** RLS는 「어느 행을」이고
  GRANT는 「어느 칸을」이다 — `authenticated`의 `tasks` update 권한은
  **`status`·`progress`·`updated_at` 세 컬럼뿐**이고(`updated_at`은 저장소가 갱신 시각을
  명시적으로 넣기 때문이다), 그 위에서 `PATCH /api/tasks/[id]`의 zod가 받는 필드는
  **`status`·`progress` 둘뿐**이다(`UC-16`). 정책이 통과시킨 행에서 `title`·`due_at`·`raw`를
  고칠 수 있으면 이 화면은 수정 기능이 아니라 시트 편집기가 된다.
- **`authenticated`·`anon`의 테이블 권한은 `revoke all`로 바닥부터 다시 쌓았다.** Supabase가
  기본으로 주는 `truncate`가 **RLS를 통째로 우회해 전 행을 지우기** 때문이다 — 정책을 아무리
  좁혀도 그 한 줄이면 실업무 데이터가 사라진다. 지금 `anon`은 이 스키마의 테이블에 **아무
  권한도 없고**, `authenticated`는 위 표의 10개 테이블에 `select`만 있다.
- PATCH 권한은 **서버에서도 검증**한다. UI 숨김은 방어가 아니고, RLS 하나에만 기대면
  거부가 `403`이 아니라 「0행 갱신」으로 조용히 지나간다.

## 에러 처리

에러 응답은 `{ error: { code, message } }`. `message`는 사용자에게 보여줄 한국어 문장이고
**스택·내부 경로·셀 값을 담지 않는다.**

```
FILE_TOO_LARGE · FILE_TYPE_MISMATCH · ARCHIVE_LIMIT_EXCEEDED · PARSE_TIMEOUT
WORKBOOK_CORRUPT · NO_KNOWN_TAB · SETTINGS_TAB_MISSING
DOCUMENT_CORRUPT · NO_OUTLINE_TASK
UPLOAD_NOT_FOUND · UPLOAD_ALREADY_COMMITTED · TASK_NOT_FOUND
STORAGE_READONLY · STORAGE_UNAVAILABLE · UNAUTHENTICATED · FORBIDDEN · VALIDATION_FAILED
```

셋째 줄 둘은 독스 경로(`/extract`) 전용이며 기존 코드로 대신할 수 없다.
`DOCUMENT_CORRUPT` — `WORKBOOK_CORRUPT`의 문구는 「워크북」이라, `.docx`를 올린 사람에게
무엇을 잘못했는지 알려주지 못한다.
`NO_OUTLINE_TASK` — `NO_KNOWN_TAB`과 같은 강도의 중단이다. 과제 0건짜리 배정표를 내려보내면
사람은 그게 빈 문서인지 파서 고장인지 알 수 없다.

`UNAUTHENTICATED`(401)와 `FORBIDDEN`(403)을 **뭉개지 않는다** (T8) — 「로그인하세요」와
「당신은 이걸 못 합니다」는 사용자가 할 일이 정반대다. 문구는 각각
「로그인이 필요합니다.」·「이 작업을 수행할 권한이 없습니다.」다.

실패 강도 3단계를 뭉개지 않는다.

| 강도 | 예 | 동작 |
|---|---|---|
| **경고** (진행) | 미등록 enum, 담당자 오타, 날짜 파싱 실패 1건 | 값 보존 + `warnings[]`, 미리보기 표시, 확정 가능 |
| **부분 실패** (진행) | 탭 하나 판별 실패 | 해당 탭만 건너뛰고 나머지 확정. **어떤 탭이 빠졌는지 명시** |
| **중단** (불가) | 아카이브 한도 초과, 워크북 손상, 타임아웃 | 저장소 무변경, 코드+사유 반환 |

**"알려진 탭이 하나도 없음"은 중단이다.** 빈 결과를 성공으로 처리하면 기존 데이터가 0건으로 덮인다.

빈 상태 ≠ 에러 상태 — 넷을 구분한다.

```
데이터 없음      → "아직 데이터가 없습니다"  [샘플 불러오기] [시트 업로드]
저장소 연결 실패  → "읽기 전용 — 저장소 연결 실패" 배너 + 편집 비활성
조회 실패        → error.tsx 바운더리 + [다시 시도]
필터 결과 0건    → "조건에 맞는 업무가 없습니다"  [필터 초기화]
```
