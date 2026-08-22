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
├── components/   dashboard/ charts/ tasks/ goals/ upload/ ui/   # props 받아 JSX만. 계산 금지
├── lib/
│   ├── sheet/   workbook-reader · header-resolver · tab-detector
│   │            section-splitter · cell-normalizer
│   │            task-schema · row-mapper · stage-unpivot
│   │            adapter-edit-team · adapter-shoot-team
│   │            adapter-marketing-team · adapter-goal-metrics
│   │            adapter-settings-tab · sheet-pipeline
│   ├── doc/     docx-reader · markdown-reader · outline-builder
│   │            assignment-mapper · workload-parser
│   ├── xlsx/    assignment-writer
│   ├── domain/  task-semantic · display-status · task-derive · kst-today
│   │            progress-stats · goal-stats · alert-rules · weekly-report
│   ├── store/   task-repository · repository-contract · memory-task-store
│   │            supabase-task-store · upload-record-store · store-factory
│   └── fixtures/  sample-workbook.xlsx · sample-workload.md · seed-tasks.json
├── supabase/migrations/   *.sql        # 스키마 단일 소스 (T4부터)
└── types/  task.ts · sheet.ts · doc.ts · goal.ts · api.ts
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
departments · teams · members(auth_user_id nullable)

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
.docx → mammoth(convertToHtml + styleMap) → node-html-parser → OutlineNode[]
                                                                    │
sample-workload.md → markdown-reader ────────────────────────────────┤ 같은 타입
       (테스트 픽스처 전용. 제품 경로 아님)                             ▼
                                            outline-builder → assignment-mapper
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

`profiles.role`: `admin`(대표·실장) / `lead`(팀장) / `member`(부원). RLS 정책 5개 남짓.

- ⚠ **RLS 재귀 함정**: 정책 안에서 `profiles`를 직접 select하면 무한루프다.
  `security definer` 함수(`my_role()`·`my_team()`)로 감싸고 **`set search_path = ''`**를 고정한다.
- `service_role` 키는 **서버의 업로드 커밋·시드에만.** 조회는 사용자 JWT를 실은 클라이언트로 해서
  RLS가 실제로 걸리게 한다. 전부 service_role로 처리하면 RLS를 만들어도 의미가 없다.
- PATCH 권한은 **서버에서 검증**한다. UI 숨김은 방어가 아니다.

## 에러 처리

에러 응답은 `{ error: { code, message } }`. `message`는 사용자에게 보여줄 한국어 문장이고
**스택·내부 경로·셀 값을 담지 않는다.**

```
FILE_TOO_LARGE · FILE_TYPE_MISMATCH · ARCHIVE_LIMIT_EXCEEDED · PARSE_TIMEOUT
WORKBOOK_CORRUPT · NO_KNOWN_TAB · SETTINGS_TAB_MISSING
UPLOAD_NOT_FOUND · UPLOAD_ALREADY_COMMITTED · TASK_NOT_FOUND
STORAGE_READONLY · STORAGE_UNAVAILABLE · FORBIDDEN · VALIDATION_FAILED
```

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
