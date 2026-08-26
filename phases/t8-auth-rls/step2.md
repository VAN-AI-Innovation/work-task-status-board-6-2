# Step 2: repo-contract-ext

## 읽어야 할 파일

- `CLAUDE.md` — 외부 연동은 `src/lib/store/`가 감싼다 · 도메인/저장소는 시간을 읽지 않고
  주입받는다 · `src/services/`를 쓰지 않는다
- `docs/TICKETS.md` — T8 완료 기준 **2**(`member`의 남의 건 `PATCH`를 서버가 거부),
  T4 완료 기준 8(두 구현이 **같은 계약 테스트**를 통과)
- `docs/ADR.md` — `ADR-006`(저장소는 판정하지 않는다) · `ADR-023`(계약은 자기 행만 센다)
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `members`
- step 0 산출물: `src/types/auth.ts`의 `TaskPatch`
- 고쳐야 할 파일 넷:
  - `src/lib/store/task-repository.ts` — 인터페이스와 `TASK_DIFF_FIELDS`
  - `src/lib/store/repository-contract.ts` — 계약 20건 + `scopeToContractRows`
  - `src/lib/store/memory-task-store.ts`
  - `src/lib/store/store-factory.ts` — `toReadOnly` 래퍼
  - `src/lib/store/supabase-task-store.ts` — 컬럼 이름은 `toTask`/`toTaskRow` **안에만** 둔다
- `supabase/migrations/0001_init.sql` — `members` 테이블 (`id`·`team_id`·`name`·`auth_user_id`)

## 배경

T8이 저장소에 요구하는 것은 둘이고, 둘 다 지금 없다.

1. **단건 수정** — `PATCH /api/tasks/[id]`(step 9)가 쓸 것. 지금 있는 쓰기는 `upsertTasks`
   하나인데 그것은 「시트 한 벌을 통째로 맞춘다」는 뜻이라, 한 사람이 자기 진행률만 고치는
   경로로 쓰면 나머지 필드를 전부 실어 보내야 하고 그 값들이 시트 원문을 덮는다.
2. **구성원 목록** — 시트의 담당자 이름을 계정에 잇는 해석(step 3)이 볼 표.

이 step은 **계약을 늘리는 step**이다. 늘린 계약은 memory·supabase 두 구현이 같이 통과해야
한다 (T4 완료 기준 8). 한쪽만 고치고 넘어가면 데모에서 되던 수정이 라이브에서 안 되거나,
그 반대가 된다.

## 게이트 주의 — 계약 테스트는 **원격 DB에 실제로 붙는다**

`vitest.config.ts`가 `.env.local`을 읽어 `supabase-task-store.test.ts`가 라이브로 돈다
(`ADR-023` 이후 기본값이 「돈다」다). 그래서:

- 계약이 만드는 행은 **`contract::` 접두사**를 달아야 한다. 새 케이스도 예외가 아니다.
- **원격의 실업무 행을 지우지 마라.** `reset`이 접두사로 좁혀 지우는 이유가 그것이다.
- `SKIP_LIVE_DB=1`을 붙여 재고서 「통과했다」고 적지 마라. 그러면 supabase 구현이 계약을
  통과하는지 아무도 확인하지 않은 채로 넘어간다.

## 작업

### 1. 타입 — `MemberRecord`를 `src/types/auth.ts`에 넣는다

```ts
/** `members` 한 행. 시트의 담당자 이름과 로그인 계정을 잇는 표다 */
export interface MemberRecord {
  id: string;
  teamId: TeamKey;
  /** 시트에 적힌 이름 원문. `(team_id, name)`이 유니크다 */
  name: string;
  /** T8에서 채워진다. 아직 계정이 없는 구성원은 null */
  authUserId: string | null;
}
```

`src/types/task.ts`에 넣지 않는다 — 업무가 아니라 **신원**이고, `Viewer.memberId`가 가리키는
대상이다.

### 2. `TaskRepository`에 메서드 둘을 추가한다

```ts
/**
 * 단건 수정. `upsertTasks`와 달리 **준 필드만** 바꾸고 나머지는 손대지 않는다.
 * 없는 id·권한 밖 행이면 `null` (RLS가 건 클라이언트에서는 후자가 실제로 일어난다).
 * `updatedAt`을 주입받는다 — 저장소는 시간을 읽지 않는다.
 */
updateTask(id: string, patch: TaskPatch, updatedAt: string): Promise<Task | null>;

/** 구성원 전량. 수백 행 규모이고 조회는 업로드 확정 때 한 번이라 필터를 두지 않는다 */
listMembers(): Promise<MemberRecord[]>;
```

- `updateTask`는 `lastProgressAt`을 **건드리지 않는다.** 그 값은 「업로드가 실제로 값을 바꿨다」는
  뜻이고(`0001_init.sql` 주석), 사람이 화면에서 고친 것을 거기 섞으면 「장기 미갱신」 판정이
  사람의 클릭으로 리셋된다.
- `updateTask`는 `task_events`를 남기지 않는다. 이벤트는 업로드 diff의 산물이다
  (`recordEvents`의 호출자는 `upsertTasks` 경로뿐이다). 늘리려면 문서가 먼저다.
- `TASK_DIFF_FIELDS`를 **고치지 마라.** 그 목록은 업로드 변경 감지용이다.

### 3. `repository-contract.ts` — 케이스 둘을 **먼저** 추가한다

기존 20건 뒤에 잇는다. 번호를 재사용하지 마라.

```
21. updateTask는 준 필드만 바꾸고 나머지를 보존한다
    - contract:: 태스크 하나를 upsert → updateTask(id, {status:'검수 중', progress: 40}, T)
    - 돌아온 Task의 status·progress가 바뀌었고 title·dueAt·extras·raw·sourceKey가 그대로다
    - 다시 getTask(id)로 읽어도 같다 (돌려준 객체만 바뀐 게 아니다)
    - progress: null 을 주면 null이 된다 (빈 셀과 0은 다르다 — 0001_init.sql 주석)
    - {} 를 주면 아무것도 바뀌지 않고 그 행이 그대로 돌아온다
22. updateTask는 없는 id에 null을 돌려주고 저장소를 바꾸지 않는다
    - updateTask('없는id', {status:'x'}, T) → null
    - 그 전후로 listTasks() 결과가 같다
```

`scopeToContractRows`에 `updateTask`를 **반드시 잇는다.** 빠뜨리면 껍데기에 그 메서드가 없어
계약 21·22가 `undefined is not a function`으로 죽는다. 잇는 방식은 `getTask`와 같다 —
계약 행이 아니면 `null`을 돌려준다.

`listMembers`는 **계약에 넣지 않는다.** 계약이 그것을 재려면 구성원을 만드는 쓰기 메서드가
있어야 하는데, 그 메서드를 제품 코드 어디도 부르지 않는다 (구성원은 step 5의 시드 스크립트가
만든다). 쓰지 않을 쓰기를 계약을 위해 만드는 것은 계약이 코드를 늘리는 것이다.
대신 **두 구현의 각자 테스트 파일**에서 잰다 (아래 5·6).
`scopeToContractRows`에는 `listMembers`도 그대로 위임해 둔다 — 껍데기가 인터페이스를 만족하지
못하면 타입이 깨진다.

### 4. `store-factory.ts`의 읽기 전용 래퍼도 막아야 한다

`toReadOnly(repo)`는 쓰기 메서드마다 `StorageReadOnlyError`를 던진다. **`updateTask`를
거기에 더하지 않으면 폴백 모드에서 단건 수정이 메모리에 조용히 저장된다** — `ADR-005`가
막으려던 바로 그 사고다(사용자는 저장됐다고 믿고 재시작 때 사라진다).
`listMembers`는 **읽기**이므로 그대로 위임한다.

`store-factory.test.ts`에 케이스 하나를 더한다: `fallback` 핸들의 `repo.updateTask`가
`STORAGE_READONLY`로 던진다.

### 5. `memory-task-store.ts`

- `seed`에 `members?: readonly MemberRecord[]`를 추가한다 (기본 `[]`).
- `updateTask`: 배열에서 찾아 **얕은 병합**하되 `patch`에 **없는 키는 건드리지 않는다**
  (`undefined`가 들어와 값을 지우면 안 된다 — `progress: null`과 `progress: undefined`는 다르다).
  돌려주는 것은 `clone`한 사본이다 (계약 19번의 규율).
- `listMembers`: `clone`한 사본.
- `memory-task-store.test.ts`에 `listMembers` 케이스를 더한다 — 시드로 준 것이 그대로 나오고,
  돌려준 배열을 호출자가 고쳐도 저장소가 오염되지 않는다.

### 6. `supabase-task-store.ts`

- `updateTask`: `from('tasks').update(row).eq('id', id).select().maybeSingle()`.
  `row`는 `patch`에 있는 키만 담고 `updated_at`을 넣는다. **`toTaskRow`를 쓰지 마라** —
  그 함수는 전체 행을 만들며, 부분 갱신에 쓰면 주지 않은 컬럼이 `null`로 덮인다.
  컬럼 이름 매핑은 이 파일 안의 **한 곳**(작은 헬퍼)에 모은다.
  `maybeSingle()`이 0행이면 `null`. 에러는 던진다(기존 다른 메서드와 같은 결).
- `listMembers`: `from('members').select('id, team_id, name, auth_user_id')` → `MemberRecord[]`.
  `team_id`는 `TeamKey`로 그대로 쓴다 (`teams.id`가 곧 `TeamKey`다 — `0001_init.sql` 주석).
- `supabase-task-store.test.ts`에 `listMembers` 케이스를 더한다. **원격을 더럽히지 않는다**:
  `contract::`로 시작하는 이름의 구성원 행을 직접 insert → `listMembers()`가 그 행을 포함하는지
  확인 → `finally`에서 그 행만 삭제. 자격증명이 없으면 기존 스위트와 같은 방식으로 `it.skip`한다.
- RPC·SQL 함수·집계를 쓰지 마라 (`ADR-006`).

## Acceptance Criteria

```bash
npm run test -- src/lib/store/memory-task-store.test.ts
npm run test -- src/lib/store/supabase-task-store.test.ts   # 라이브. skip으로 끝나면 실패로 본다
npm run lint && npm run build && npm run test
grep -n 'updateTask' src/lib/store/repository-contract.ts   # scopeToContractRows + 케이스 21·22
grep -n 'toTaskRow' src/lib/store/supabase-task-store.ts    # updateTask 안에 없어야 한다
grep -n 'new Date()\|Date.now()' src/lib/store/memory-task-store.ts src/lib/store/supabase-task-store.ts  # 0줄
```

`supabase-task-store.test.ts`가 **skip으로만 끝나면 이 step은 완료가 아니다.** 셸에
`SKIP_LIVE_DB`가 남아 있는지 먼저 확인하라 (`vitest.config.ts` 머리말의 ⚠ 문단).

## 검증 절차

1. 위 AC 커맨드를 실행한다. 계약 케이스가 **두 구현 모두에서** 돌았는지 출력으로 확인한다
   (「저장소 계약: memory」와 「저장소 계약: supabase」가 둘 다 22건이어야 한다).
2. 변이 테스트 셋을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - memory `updateTask`에서 `patch`의 `undefined` 키도 대입하게 바꾼다 → 계약 21이 잡아야 한다
   - supabase `updateTask`를 `toTaskRow`로 바꾼다 → 계약 21의 「나머지 보존」이 잡아야 한다
   - `scopeToContractRows`에서 `updateTask` 위임을 뺀다 → 계약 21·22가 죽어야 한다
3. 체크리스트:
   - 원격에 `contract::`가 아닌 새 행을 남기지 않았는가? (`select count(*) from members`가
     step 시작 때와 같아야 한다)
   - `updateTask`가 `lastProgressAt`·`task_events`를 건드리지 않는가?
4. `phases/t8-auth-rls/index.json`의 step 2를 갱신한다.

## 금지사항

- `TaskFilter`에 필드를 추가하지 마라 (step 1의 금지사항과 같은 이유).
- 권한 판정을 저장소에 넣지 마라. `updateTask`는 **누가 부르는지 모른다** — 「본인 건인가」는
  `viewer-scope.ts`가 이미 지고 있고(step 1), DB 쪽은 RLS가 진다(step 4). 세 곳이 되면
  하나만 고쳐지는 날이 온다.
- 구성원을 **만드는** 메서드를 추가하지 마라 (`upsertMembers` 등). 제품 코드가 부르지 않는다.
- `src/lib/upload/`·`src/app/api/`를 고치지 마라. step 3·9의 일이다.
- 원격 DB에 마이그레이션을 적용하지 마라. step 4의 일이다.
- 기존 계약 케이스 20건의 번호·내용을 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라.
