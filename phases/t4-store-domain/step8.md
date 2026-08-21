# Step 8: schema-migration

## 읽어야 할 파일

- `CLAUDE.md` — 보안·데이터 규칙(`service_role`에 `NEXT_PUBLIC_` 금지)
- `docs/TICKETS.md` — `## T4` 완료 기준 **1**(테이블 12개 목록), `## T8`(RLS는 T8의 범위)
- `docs/ARCHITECTURE.md` — 「데이터 모델」 전체(컬럼 목록·UNIQUE 제약), 「권한 (T8)」
- `docs/PLAN.md` — 「1. 데이터 모델」, 「보안」
- `docs/ADR.md` — `ADR-002`(공통 컬럼 + `extras jsonb` + 자식 테이블), `ADR-004`, `ADR-008`
- step 0·7 산출물: `src/types/task.ts`·`src/types/goal.ts`,
  `src/lib/store/task-repository.ts`(어떤 조회·제약이 필요한지)

## 배경

**이 step은 SQL 파일만 만든다. 코드도 테스트도 없다.**
적용은 사람이 Supabase Studio SQL Editor에서 한다 (이 저장소에 `supabase` CLI·`psql`·Docker가 없다).
step 9가 실제 연결로 스키마 존재를 확인하고, 없으면 거기서 `blocked` 처리한다.

컬럼 이름은 `snake_case`이고 TypeScript 프로퍼티는 `camelCase`다. **`src/types/`의 필드와
1:1로 대응**시켜라 — step 9의 매퍼가 그 대응만 옮기면 되게 한다.

## 작업

### 1. `supabase/migrations/0001_init.sql`

파일 맨 위에 **적용 방법 주석**을 남겨라:

```sql
-- 적용: Supabase 대시보드 → SQL Editor에 이 파일 전체를 붙여넣고 실행한다.
-- (이 저장소에는 supabase CLI·psql이 없어 자동 적용 경로가 없다.)
-- 이 파일은 스키마의 단일 소스다. 스키마를 바꾸려면 Studio에서 직접 고치지 말고
-- 새 마이그레이션 파일을 추가한다.
```

테이블 12개를 전부 만든다 (T4 완료 기준 1):
`departments` `teams` `members` `tasks` `task_stages` `task_events` `enum_options`
`sla_rules` `uploads` `doc_extractions` `goal_metrics` `team_period_goals`

키 설계 — **이 결정을 SQL 주석에 남겨라**:

- `departments.id`·`teams.id`는 **`text` PK**다. uuid가 아니다.
  `teams.id`가 곧 `TeamKey`(`edit`·`shoot`·`marketing`)라서, 저장소가 팀 uuid를 다시 조회해
  `teamKey`로 바꾸는 왕복이 통째로 사라진다. 팀은 시트 탭에서 오는 **고정된 소수 집합**이라
  대리 키의 값어치가 없다. T8의 `my_team()`도 text로 동작한다.
- 나머지 테이블의 `id`는 `uuid primary key default gen_random_uuid()`.
- `tasks.team_id text not null references teams(id)`,
  `tasks.department_id text references departments(id)`.

제약·인덱스:

- `tasks`: `unique (team_id, source_key)` ← 업로드 upsert의 충돌 키다. 빠지면 `ADR-008`이 성립하지 않는다
- `task_stages`: `task_id uuid references tasks(id) on delete cascade`, `unique (task_id, seq)`
- `task_events`: `task_id ... on delete cascade`, `changed_fields jsonb not null`
- `enum_options`: `unique (group_key, value)`, `semantic text` (null 허용 — `ADR-009`)
- `sla_rules`: `team_id text references teams(id)` (null = 공통), `label text not null`,
  `days int not null`, `unique nulls not distinct (team_id, label)`
- `goal_metrics`: `unique (team_id, period_label, title)`
- `team_period_goals`: `unique (team_id, period_label)`
- `members`: `unique (team_id, name)`, `auth_user_id uuid` (null 허용 — T8까지 비어 있다)
- `uploads`: `kind text not null check (kind in ('sheet','doc'))`,
  `status text not null check (status in ('validating','parsing','previewing','committing','done','failed'))`,
  `parse_result jsonb`, `summary jsonb` ← 상태값은 `ARCHITECTURE.md` 「업로드 상태 전이」와 같아야 한다
- 인덱스: `tasks(team_id)`, `tasks(due_at)`, `tasks(source_key)`,
  `task_stages(task_id)`, `task_events(task_id, occurred_at desc)`,
  `goal_metrics(team_id, period_label)`

컬럼 타입:

- 날짜(`assigned_at`·`due_at`·`next_action_due`·`planned_date`·`actual_date`·`started_at`) → `date`
- 타임스탬프(`last_progress_at`·`occurred_at`·`created_at`·`updated_at`) → `timestamptz`
- `progress` → `smallint` **null 허용** (빈 셀과 0을 구분한다 — 여기서 `not null default 0`을
  걸면 T2·T3가 지켜온 성질이 DB에서 무너진다)
- `co_owner_names` → `text[]`
- `extras`·`raw`·`details`·`changed_fields`·`parse_result`·`summary` → `jsonb`
- `target_value`·`actual_value`·`achievement_rate` → `numeric`

모든 테이블에 `created_at timestamptz not null default now()`,
갱신되는 테이블(`tasks`·`goal_metrics`·`team_period_goals`)에 `updated_at timestamptz not null default now()`.
**트리거는 만들지 마라** — 저장소가 명시적으로 넣는다. 트리거를 두면 두 구현의 결과가 갈라진다.

### 2. RLS — 지금 **켜고**, 정책은 T8에서 붙인다

모든 테이블에 `alter table ... enable row level security;`를 건다. 정책은 만들지 않는다.

주석으로 근거를 남겨라: **정책 없이 RLS를 켜면 `anon`·`authenticated` 키로는 아무것도 안 되고
`service_role`만 통과한다.** T4의 저장소는 서버에서 `service_role`로만 붙으므로 정상 동작하고,
RLS를 끈 채로 두면 프로젝트 URL과 `anon` 키만 알면 전 데이터가 읽히는 상태가 된다.
T8이 `my_role()`·`my_team()` 기반 정책을 여기에 얹는다 (`ARCHITECTURE.md` 「권한 (T8)」).

### 3. `supabase/migrations/0002_seed_reference.sql`

부서 1건과 팀 3건만 넣는다. `on conflict (id) do nothing`으로 **재실행 가능**하게 쓴다.

```
departments: contents-marketing  — 컨텐츠마케팅부
teams: edit(01_편집팀) · shoot(02_촬영·기획팀) · marketing(03_마케팅·관리팀)
```

`teams`에 `name`·`sheet_tab`·`sort_order`를 넣는다. `sheet_tab`은 픽스처 탭 이름 원문이다.

**`enum_options`·`sla_rules`는 시드하지 마라.** 그 값은 업로드된 `설정` 탭에서 오고,
여기에 박아두면 시트가 바뀌었을 때 어느 쪽이 진실인지 알 수 없게 된다 (T5가 채운다).

### 4. `.gitignore` 확인만

`supabase/` 아래가 무시되지 않는지 확인한다. 무시된다면 마이그레이션이 커밋되지 않는다.
**무시되지 않으면 `.gitignore`를 건드리지 마라.**

## Acceptance Criteria

```bash
# 12개 테이블이 전부 있다 (12가 나와야 함)
grep -c "^create table" supabase/migrations/0001_init.sql

# 테이블 이름 대조 — 12줄이 나와야 하고 빠진 이름이 없어야 한다
grep -oE "^create table (if not exists )?[a-z_]+" supabase/migrations/0001_init.sql | sort

# 충돌 키가 있다 (각각 출력이 있어야 함)
grep -n "unique (team_id, source_key)" supabase/migrations/0001_init.sql
grep -n "unique (team_id, period_label, title)" supabase/migrations/0001_init.sql

# RLS가 전 테이블에 켜져 있다 (12가 나와야 함)
grep -c "enable row level security" supabase/migrations/0001_init.sql

# progress가 null을 허용한다 (not null이 붙어 있으면 실패)
grep -n "progress" supabase/migrations/0001_init.sql

# 키·비밀이 SQL에 없다 (출력이 비어야 함)
grep -niE "service_role|eyJ|password|secret" supabase/migrations/*.sql ; test $? -eq 1

# 시드가 재실행 가능하다 (출력이 있어야 함)
grep -n "on conflict" supabase/migrations/0002_seed_reference.sql

# 마이그레이션이 커밋 대상이다 (출력이 있어야 함)
git check-ignore -v supabase/migrations/0001_init.sql ; test $? -eq 1
git status --porcelain supabase/

# 게이트 — 코드 변경이 없으므로 그대로 통과해야 한다
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **SQL을 눈으로 읽어라.** 이 step은 자동 검증이 약하다(DB가 없다). 특히:
   - `ARCHITECTURE.md` 「데이터 모델」의 컬럼이 **하나도 빠지지 않았는가?** 한 줄씩 대조하라.
   - `src/types/task.ts`의 `Task` 필드와 `tasks` 컬럼이 1:1인가?
   - 외래키 방향이 맞는가? `on delete cascade`가 자식 테이블에만 걸렸는가?
   - 예약어를 컬럼 이름으로 쓰지 않았는가? (`status`·`note`는 안전하다)
3. 체크리스트:
   - 12개 테이블, RLS 12건, `progress`가 nullable인가?
   - `teams.id`가 text이고 그 근거가 주석에 있는가?
   - `enum_options`·`sla_rules`를 시드하지 **않았는가**?
4. `phases/t4-store-domain/index.json`의 step 8을 갱신한다:
   - `"summary"`에 테이블 12개 이름, 키 설계 결정(`teams.id text`), RLS 방침,
     **"적용은 사용자가 Studio SQL Editor에서 해야 한다"**를 명시하라.
   - 이 step 자체는 사용자 개입 없이 끝난다. **`blocked`로 만들지 마라** —
     적용 여부 확인은 step 9의 일이다.

## 금지사항

- RLS **정책**(`create policy`)을 만들지 마라. 이유: T8의 범위다. RLS 활성화까지가 여기다.
- `enum_options`·`sla_rules`·`tasks`를 시드하지 마라. 이유: 시트가 진실의 원천이다.
- 트리거·함수·뷰를 만들지 마라. 이유: 집계는 JS 순수 함수다 (`ADR-006`).
- 집계 뷰(`create view ... group by`)를 만들지 마라. 같은 이유다.
- SQL에 키·비밀번호·접속 문자열을 쓰지 마라. 이유: 마이그레이션은 커밋된다.
- TypeScript 코드를 만들거나 고치지 마라. 이유: 이 step은 SQL만 만든다.
- Supabase에 실제로 접속하거나 적용을 시도하지 마라. 이유: 자격증명은 step 9에서 다룬다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
