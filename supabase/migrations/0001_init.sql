-- 적용: Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여넣고 실행한다.
-- (이 저장소에는 supabase CLI·psql이 없어 자동 적용 경로가 없다.)
-- 이 파일은 스키마의 단일 소스다. 스키마를 바꾸려면 Studio에서 직접 고치지 말고
-- 새 마이그레이션 파일을 추가한다.
--
-- 근거 문서: docs/ARCHITECTURE.md 「데이터 모델」, docs/PLAN.md 「1. 데이터 모델」,
--            ADR-002(공통 컬럼 + extras jsonb + 자식 테이블) · ADR-004 · ADR-008.
-- 컬럼 이름은 snake_case이고 src/types/task.ts·goal.ts의 camelCase 프로퍼티와 1:1로 대응한다.
--
-- 여기에 없는 것과 그 이유:
--   * RLS 정책(create policy) — T8의 범위다. 여기서는 RLS를 켜는 데까지만 한다(맨 아래).
--   * 트리거·함수·뷰 — 갱신 시각은 저장소가 명시적으로 넣고, 집계는 lib/domain/의 JS
--     순수 함수가 한다 (ADR-006). DB가 값을 대신 만들면 memory·supabase 두 구현의
--     결과가 갈라지고 "같은 계약 테스트를 통과한다"(T4 완료 기준 8)가 깨진다.
--   * enum_options·sla_rules 값 — 업로드된 `설정` 탭이 진실의 원천이다 (T5가 채운다).

-- ---------------------------------------------------------------------------
-- 조직
-- ---------------------------------------------------------------------------

-- departments.id·teams.id는 uuid가 아니라 **text PK**다.
-- teams.id가 곧 TeamKey('edit'·'shoot'·'marketing')라서, 저장소가 팀 uuid를 다시 조회해
-- teamKey로 바꾸는 왕복이 통째로 사라진다 (src/types/task.ts의 Task.teamId가 TeamKey다).
-- 팀은 시트 탭에서 오는 고정된 소수 집합이라 대리 키의 값어치가 없고, T8의 my_team()도
-- text로 그대로 동작한다.
create table if not exists departments (
  id          text primary key,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists teams (
  id            text primary key,          -- TeamKey: 'edit' | 'shoot' | 'marketing'
  department_id text references departments(id),
  name          text not null,
  sheet_tab     text,                      -- 시트 탭 이름 원문. 예: '01_편집팀'
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- 신원의 단일 소스 (과제 요구 7번 — 향후 출결·평가 연계의 접점).
-- auth_user_id는 T8까지 비어 있다. 시트 담당자는 자유 입력 문자열이라 1:1로 안 붙는
-- 이름이 남고, 그런 이름은 tasks.owner_name_raw에만 남는다.
create table if not exists members (
  id           uuid primary key default gen_random_uuid(),
  team_id      text not null references teams(id),
  name         text not null,
  auth_user_id uuid,
  created_at   timestamptz not null default now(),
  unique (team_id, name)
);

-- ---------------------------------------------------------------------------
-- 업로드 (ADR-008: 미리보기 → 확정 2단계)
-- ---------------------------------------------------------------------------

-- status 값은 ARCHITECTURE.md 「업로드 상태 전이」와 같아야 한다.
-- 'rejected'·'idle'은 클라이언트 화면 상태라 DB에 행이 생기기 전이므로 여기 없다.
-- parse_result는 확정 즉시 비우고 summary만 남긴다 (A8·S6) — 원본 행에 실명·연락처가 있다.
create table if not exists uploads (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('sheet','doc')),
  filename     text,
  parse_result jsonb,
  status       text not null check (status in ('validating','parsing','previewing','committing','done','failed')),
  summary      jsonb,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 업무
-- ---------------------------------------------------------------------------

create table if not exists tasks (
  id                uuid primary key default gen_random_uuid(),
  team_id           text not null references teams(id),
  department_id     text references departments(id),
  -- 자연키. 업무ID가 있으면 그 값, 없으면 slug(업무명)::slug(담당자).
  source_key        text not null,
  title             text,
  owner_member_id   uuid references members(id),
  owner_name_raw    text,
  co_owner_names    text[] not null default '{}',
  -- 시트 원문 그대로 보존한다. semantic 변환은 lib/domain/task-semantic.ts가 한다 (ADR-009).
  status            text,
  approval_status   text,
  priority          text,
  risk_status       text,
  -- 0~100 정수. **null을 허용한다** — 빈 셀과 0은 다르다. 여기에 not null default 0을 걸면
  -- T2·T3가 지켜온 성질이 DB에서 무너지고 평균 진행률이 바닥으로 끌린다.
  progress          smallint,
  assigned_at       date,
  due_at            date,
  next_action       text,
  next_action_owner text,
  next_action_due   date,
  delay_reason      text,
  note              text,
  -- 매핑되지 않은 컬럼 전량. 70컬럼 대응의 전부다 (ADR-002).
  extras            jsonb not null default '{}'::jsonb,
  -- 원본 행 통째(감사·복원). **API 응답에 실으면 안 된다** (S6).
  raw               jsonb not null default '{}'::jsonb,
  -- 실제로 값이 바뀐 업로드에서만 갱신된다. 「장기 미갱신」 판정의 근거다.
  last_progress_at  timestamptz,
  source_upload_id  uuid references uploads(id),
  source_sheet_tab  text not null,
  source_row_index  int  not null,          -- 1-based (사람이 읽는 좌표)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- 업로드 upsert의 충돌 키. 빠지면 ADR-008(미리보기 → 확정)이 성립하지 않는다.
  unique (team_id, source_key)
);

-- 편집팀 3개 컬럼 그룹, 촬영팀 접두사 그룹이 같은 모양으로 언피벗된 결과.
-- 태스크와 같은 트랜잭션에서 통째로 교체(delete-then-insert)되므로 cascade가 필요하다.
create table if not exists task_stages (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id) on delete cascade,
  seq            int  not null,             -- 시트에 나온 순서, 0부터
  stage_key      text not null,             -- STAGE_GROUPS가 정한 안정 키. 예: 'concept'
  stage_label    text not null,             -- 시트 그룹 헤더 원문. 예: '컨셉·레퍼런스 (+2일)'
  planned_date   date,
  actual_date    date,
  content        text,
  confirm_status text,
  sla_days       int,
  created_at     timestamptz not null default now(),
  unique (task_id, seq)
);

-- changed_fields는 **필드 이름만** 담는다. 값을 담지 않는다 —
-- 이력 테이블이 개인정보 사본이 되면 안 된다 (S6).
create table if not exists task_events (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references tasks(id) on delete cascade,
  upload_id      uuid references uploads(id),
  changed_fields jsonb not null,
  occurred_at    timestamptz not null,      -- 저장소가 주입받은 시각. DB가 읽지 않는다
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 레지스트리 (`설정` 탭에서 온다 — 여기에 값을 시드하지 않는다)
-- ---------------------------------------------------------------------------

-- semantic은 null을 허용한다 (ADR-009). 시트에 새 상태가 생겨도 값은 보존되고
-- 매핑만 비어 있게 되며, 파서는 그것을 warnings로 집계한다.
create table if not exists enum_options (
  id         uuid primary key default gen_random_uuid(),
  group_key  text not null,                 -- 예: '공통_진행 상태'
  value      text not null,                 -- 예: '진행 중'
  sort_order int  not null default 0,       -- '공통_진행 상태'는 순서가 곧 진행 흐름이다
  semantic   text,
  created_at timestamptz not null default now(),
  unique (group_key, value)
);

-- team_id가 null이면 공통 규칙이다. 그래서 unique에 nulls not distinct가 필요하다 —
-- 기본 동작(nulls distinct)이면 같은 라벨의 공통 규칙이 여러 벌 쌓인다.
-- stage_key는 T3의 STAGE_GROUPS가 라벨과 단계를 이어준 뒤에야 채워진다 (시트에는 라벨뿐이다).
create table if not exists sla_rules (
  id         uuid primary key default gen_random_uuid(),
  team_id    text references teams(id),
  stage_key  text,
  label      text not null,                 -- 예: '촬영팀 섭외'
  days       int  not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (team_id, label)
);

-- ---------------------------------------------------------------------------
-- 독스 추출 (T7)
-- ---------------------------------------------------------------------------

create table if not exists doc_extractions (
  id            uuid primary key default gen_random_uuid(),
  upload_id     uuid not null references uploads(id) on delete cascade,
  order_index   int  not null,
  category      text,
  task_no       text,
  title         text,
  difficulty    text,
  deadline_raw  text,                       -- 원문 보존. 연도 추론 실패 시 이것만 남는다
  deadline_date date,
  priority      text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 목표 대비 성과 (과제 요구 4번)
-- ---------------------------------------------------------------------------

-- tasks와 별도 테이블인 이유: **업무가 아니라 성과 지표**다. 진행 상태·마감·담당자 축이
-- 아니라 목표값 대 실적값 축으로 움직인다 (ARCHITECTURE.md 데이터 모델).
-- achievement_rate는 **시트에 적힌 값**이고 재계산은 lib/domain/goal-stats.ts가 따로 한다.
-- raw를 두지 않는다 — 지표는 extras만으로 복원 가능하다 (src/types/goal.ts).
--
-- ⚠ 자연키 (team_id, period_label, title)의 뒤 두 컬럼은 null을 허용한다. Postgres 기본
--   동작에서 null은 서로 다른 값이므로 이 제약은 null이 낀 행을 접지 못한다. 저장소(step 9)는
--   메모리 구현과 같이 **upsert 전에 배열 안 중복 자연키를 접어** 넘겨야 한다
--   (goalMetricUpsertKey는 null을 같은 값으로 본다).
create table if not exists goal_metrics (
  id                uuid primary key default gen_random_uuid(),
  team_id           text not null references teams(id),
  period_label      text,                   -- 예: '2026-07 4주차'
  title             text,
  goal_text         text,
  kpi_name          text,
  target_value      numeric,
  actual_value      numeric,
  achievement_rate  numeric,
  prev_period_delta text,
  channel           text,
  owner_member_id   uuid references members(id),
  owner_name_raw    text,
  exec_status       text,
  analysis          text,
  went_well         text,
  needs_improvement text,
  started_at        date,
  due_at            date,
  extras            jsonb not null default '{}'::jsonb,
  source_upload_id  uuid references uploads(id),
  source_sheet_tab  text not null,
  source_row_index  int  not null,          -- 1-based
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (team_id, period_label, title)
);

-- 촬영·기획팀 헤더 블록의 '이번 주 핵심 목표 / 주요 리스크'.
-- period_label이 null이면 위 goal_metrics와 같은 null 주의사항이 적용된다.
create table if not exists team_period_goals (
  id           uuid primary key default gen_random_uuid(),
  team_id      text not null references teams(id),
  period_label text,
  goal_text    text,
  risk_text    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, period_label)
);

-- ---------------------------------------------------------------------------
-- 인덱스 — 화면이 실제로 거는 조회 경로만 만든다
-- ---------------------------------------------------------------------------

create index if not exists tasks_team_id_idx        on tasks (team_id);           -- 부서별 탭
create index if not exists tasks_due_at_idx         on tasks (due_at);            -- 마감 임박·이번 주 마감
create index if not exists tasks_source_key_idx     on tasks (source_key);        -- 업로드 확정 시 대조
create index if not exists task_stages_task_id_idx  on task_stages (task_id);
create index if not exists task_events_task_idx     on task_events (task_id, occurred_at desc);
create index if not exists goal_metrics_team_idx    on goal_metrics (team_id, period_label);

-- ---------------------------------------------------------------------------
-- RLS — 지금 켜고, 정책은 T8에서 붙인다
-- ---------------------------------------------------------------------------
--
-- 정책이 하나도 없는 상태로 RLS를 켜면 anon·authenticated 키로는 **아무것도 되지 않고**
-- 서버 전용 키만 통과한다. T4의 저장소는 서버에서 그 키로만 붙으므로 정상 동작한다.
-- 반대로 RLS를 끈 채로 두면 프로젝트 URL과 anon 키만 알면 전 데이터가 읽히는 상태가 된다 —
-- 시트에는 실명·출연자 연락처·문의자 계정이 있다 (S6).
-- T8이 my_role()·my_team() 기반 정책을 여기에 얹는다 (ARCHITECTURE.md 「권한 (T8)」).

alter table departments      enable row level security;
alter table teams            enable row level security;
alter table members          enable row level security;
alter table uploads          enable row level security;
alter table tasks            enable row level security;
alter table task_stages      enable row level security;
alter table task_events      enable row level security;
alter table enum_options     enable row level security;
alter table sla_rules        enable row level security;
alter table doc_extractions  enable row level security;
alter table goal_metrics     enable row level security;
alter table team_period_goals enable row level security;
