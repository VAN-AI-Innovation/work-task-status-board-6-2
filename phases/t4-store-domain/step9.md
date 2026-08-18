# Step 9: supabase-task-store

## 읽어야 할 파일

- `CLAUDE.md` — **`service_role` 키에 `NEXT_PUBLIC_` 금지**, 아키텍처 규칙, TDD
- `docs/TICKETS.md` — `## T4` 완료 기준 **8**(계약 테스트를 두 구현이 모두 통과), 「인터페이스 경계」
- `docs/ADR.md` — `ADR-004`, `ADR-006`
- `docs/ARCHITECTURE.md` — 「권한 (T8)」의 `service_role` 사용 방침
- `docs/PLAN.md` — 「보안」의 `S5`
- step 7·8 산출물: `task-repository.ts`·`repository-contract.ts`·`memory-task-store.ts`,
  `supabase/migrations/*.sql`
- `src/lib/env-guard.test.ts` — 이 저장소가 이미 쓰기로 한 **환경변수 이름**이 거기 있다

## 배경

T4 완료 기준 8("계약 테스트를 supabase·memory 두 구현이 모두 통과한다")의 나머지 절반이다.

**이 step은 실제 Supabase 프로젝트가 필요하다.** 사용자가 프로젝트를 만들고
`.env.local`에 키를 넣고 step 8의 SQL을 Studio SQL Editor에서 실행해 둬야 한다.
그 중 하나라도 없으면 **`blocked`로 처리하고 즉시 중단하라** (`CLAUDE.md` 하네스 실행 규칙).
추측으로 통과시키지 마라 — 통과 못 한 계약 테스트는 계약이 아니다.

환경변수 이름은 **이미 정해져 있다.** `src/lib/env-guard.test.ts`가 이 이름들로 가드를 검증한다:

```
NEXT_PUBLIC_SUPABASE_URL        # 브라우저에 나가도 되는 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # 브라우저용 키 (T8에서 쓴다)
SUPABASE_SERVICE_ROLE_KEY       # 서버 전용. NEXT_PUBLIC_ 접두사를 절대 붙이지 마라
```

## 작업

### 0. 선행 조건 확인 — **코드를 쓰기 전에 먼저 한다**

1. `.env.local`에 위 3개가 있는가? 없으면 `blocked`:
   `"blocked_reason": "Supabase 자격증명 없음 — .env.local에 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY가 필요하다"`
2. 그 키로 붙어 `tasks` 테이블이 있는가? 없으면 `blocked`:
   `"blocked_reason": "supabase/migrations/0001_init.sql·0002_seed_reference.sql이 아직 적용되지 않았다 — Supabase Studio SQL Editor에서 실행해야 한다"`
3. **`.env.local`의 내용을 출력하거나 로그·요약·커밋에 남기지 마라.** 존재 여부와
   연결 성공 여부만 확인한다.

### 1. 의존성

```bash
npm install @supabase/supabase-js
```

새 의존성은 이것 하나뿐이다. 다른 패키지를 설치하지 마라.

### 2. `vitest.config.ts` — `.env.local`을 테스트에 읽힌다

Vitest는 `.env.local`을 자동으로 읽지 않는다. Vite의 `loadEnv`로 읽어
`process.env`에 채운다. **기존 `resolve.alias` 설정을 지우지 마라.**
값이 없어도 실패시키지 말고 그냥 비워 둬라 — 메모리 전용 개발자가 테스트를 못 돌리면 안 된다.

### 3. `src/lib/store/supabase-task-store.ts` — 테스트를 **먼저** 쓴다

```ts
/** 서버 전용 클라이언트. `service_role`을 쓰므로 브라우저에서 부르면 안 된다 */
export function createServiceRoleClient(): SupabaseClient | null;

/** 클라이언트를 **주입받는다.** 테스트가 자기 클라이언트를 넣을 수 있어야 한다 */
export function createSupabaseTaskStore(client: SupabaseClient): TaskRepository;
```

- `createServiceRoleClient`는 환경변수가 하나라도 없으면 **`null`을 돌려준다.** 예외를 던지지 마라
  (`store-factory`가 폴백을 판단한다, step 10).
- `auth: { persistSession: false, autoRefreshToken: false }`로 만든다. 서버 프로세스다.
- **row ↔ 도메인 매퍼를 파일 안에 두 함수로** 둔다 (`toTask(row)` / `toTaskRow(input)`).
  컬럼 이름을 코드 여기저기에 흩뿌리지 마라.
- `snake_case` ↔ `camelCase` 대응은 step 8의 SQL과 1:1이다.
- 날짜 컬럼(`date`)은 PostgREST가 `'YYYY-MM-DD'` 문자열로 준다. 다시 `Date`로 만들지 마라.
- `numeric`은 문자열로 올 수 있다. `target_value`·`actual_value`·`achievement_rate`는
  `Number(...)`로 바꾸되 `null`은 `null`로 둔다.
- `upsertTasks`:
  1. `(team_id, source_key)`로 기존 행을 **한 번에** 조회한다 (`in` 필터). 건별 왕복을 하지 마라.
  2. `diffTaskFields`로 created/updated/unchanged를 가른다. **분류 로직을 다시 쓰지 마라 —
     `task-repository.ts`의 함수를 그대로 쓴다.** 두 구현이 갈라지는 지점이 정확히 여기다.
  3. `unchanged` 건은 **UPDATE를 보내지 마라.** 보내면 `updated_at`이 바뀌고
     `getLastSyncedAt`이 무의미해진다.
  4. `upsert(..., { onConflict: 'team_id,source_key' })`로 쓴다.
  5. 단계는 해당 `task_id`들의 행을 지우고 다시 넣는다 (통째 교체, step 7과 같은 의미).
  6. 이벤트는 `updated` 건에 대해서만 `task_events`에 넣는다.
- `listTasks` 필터는 **서버 측 쿼리로** 건다 (`eq`·`in`·`gte`·`lte`·`ilike`·`limit`).
  전건을 받아 JS로 거르지 마라 — 그러면 `limit`의 의미가 달라져 계약 10번이 깨진다.
  `search`는 `or('title.ilike.%v%,owner_name_raw.ilike.%v%')`. **`v`에 `,`·`)`·`%`가 들어가면
  필터 문자열이 깨진다** — 이스케이프 함수를 하나 두고 통과시켜라.
- `getLastSyncedAt`은 `tasks.updated_at`의 최대값을 1행만 조회한다(`order` + `limit(1)`).
  집계 SQL(`max()`)을 쓰지 마라 — `ADR-006`의 경계는 **판정·집계**이고 이것도 그 선 안이다.
  단조로운 "가장 최근 시각"이므로 정렬 1행 조회로 충분하다.
- 에러 처리: PostgREST 에러는 `Error`로 던지되 **메시지에 셀 값·행 내용을 담지 마라.**
  코드와 테이블 이름까지만 남긴다.

### 4. `src/lib/store/supabase-task-store.test.ts`

```ts
const canRun = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
describe.skipIf(!canRun)('supabase', () => {
  describeRepositoryContract('supabase', { create, reset });
});
```

- **계약 스위트를 복사하지 마라.** step 7의 `describeRepositoryContract`를 호출한다.
- 테스트 데이터 격리: `sourceKey`를 `'contract::'`로 시작하게 만들고,
  `reset`은 **`source_key like 'contract::%'`인 행만** 지운다.
  **`delete()`를 필터 없이 부르지 마라.** 실데이터가 있으면 통째로 날아간다.
- 매퍼 단위 테스트는 **연결 없이도** 돌아야 한다: `toTask(row)`·`toTaskRow(input)`가
  날짜·`numeric`·`null`·`progress: 0`을 올바로 옮기는지 확인하는 테스트를
  `describe.skipIf` **바깥에** 둔다. 키가 없어도 이 테스트는 돌아야 한다.
- 스킵될 때 **이유를 남겨라** — `console.log`가 아니라 `it.skip('...키가 없어 건너뜀')`처럼
  스위트에 흔적이 남게 한다. 조용히 0건 통과하면 완료 기준 8이 통과한 것처럼 보인다.

## Acceptance Criteria

```bash
# 매퍼 테스트는 키 없이도 통과한다
npx vitest run src/lib/store/supabase-task-store.test.ts

# 계약 테스트가 실제로 돌았는지 확인 — skip 0건이어야 한다
npx vitest run src/lib/store --reporter=verbose

# NEXT_PUBLIC_ service_role 위반이 없다
npm run guard:env

# 계약 스위트를 복사하지 않았다 (출력이 있어야 함)
grep -n "describeRepositoryContract" src/lib/store/supabase-task-store.test.ts

# 분류 로직을 다시 쓰지 않았다 (출력이 있어야 함)
grep -n "diffTaskFields" src/lib/store/supabase-task-store.ts

# 판정·집계가 새지 않았다 (출력이 비어야 함)
grep -nE "isOverdue|completionRate|toSemantic|group by|\.rpc\(" src/lib/store/supabase-task-store.ts ; test $? -eq 1

# 필터 없는 delete가 없다 (출력이 비어야 함)
grep -nE "\.delete\(\)\s*$|\.delete\(\)\.then" src/lib/store/supabase-task-store.ts ; test $? -eq 1

# 키가 커밋되지 않는다 (출력이 있어야 함 = 무시되고 있음)
git check-ignore -v .env.local

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 선행 조건 확인(작업 0)을 **먼저** 한다. 막히면 `blocked`로 기록하고 즉시 중단한다.
2. 위 AC 커맨드를 전부 실행한다.
3. **`--reporter=verbose` 출력에서 계약 항목이 memory와 supabase 두 이름으로 각각 나오는지
   눈으로 확인하라.** 이것이 T4 완료 기준 8의 증거다. 개수도 같아야 한다.
4. 체크리스트:
   - `unchanged` 건에 UPDATE를 보내지 않는가?
   - `reset`이 `contract::` 접두사 행만 지우는가?
   - `search` 필터의 특수문자가 이스케이프되는가?
   - `.env.local`의 값이 요약·로그·커밋 어디에도 남지 않았는가?
   - `package.json`에 새로 늘어난 의존성이 `@supabase/supabase-js` 하나뿐인가?
5. `phases/t4-store-domain/index.json`의 step 9를 갱신한다:
   - `"summary"`에 **계약 항목이 두 구현에서 각각 몇 개 통과했는지** 숫자로 남겨라.
   - 키·URL·프로젝트 ref를 요약에 쓰지 마라.

## 금지사항

- 계약 테스트를 복사하거나 supabase용으로 고쳐 쓰지 마라. 이유: 완료 기준 8이 무의미해진다.
- 계약 테스트가 스킵된 채로 `completed` 처리하지 마라. 이유: 통과하지 않은 계약은 계약이 아니다.
  키가 없으면 `blocked`다.
- `SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_`을 붙이지 마라. 이유: `CLAUDE.md` CRITICAL, `S5`.
- `service_role` 클라이언트를 클라이언트 컴포넌트에서 import 가능한 곳에 두지 마라.
- `.rpc()`·SQL 함수·집계 쿼리를 쓰지 마라. 이유: `ADR-006`.
- RLS 정책을 만들거나 끄지 마라. 이유: T8의 범위다.
- `.env.local`을 커밋하거나 값을 출력하지 마라.
- `store-factory`·시드를 만들지 마라. 이유: step 10의 범위다.
- 마이그레이션 SQL을 고치지 마라. 스키마가 안 맞으면 `blocked`로 보고하라. 이유: 스키마 변경은
  새 마이그레이션 파일이어야 하고, 이미 적용된 파일을 고치면 두 환경이 갈라진다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
