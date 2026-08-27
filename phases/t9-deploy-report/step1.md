# Step 1: list-events

## 읽어야 할 파일

- `CLAUDE.md` — 특히 「비즈니스 로직은 `src/lib/`에만」·「집계·판정은 JS 순수 함수, SQL 집계를 쓰지
  않는다」·「`src/lib/` 아래 파일명은 전역 유니크」·**TDD(테스트 먼저)**
- step 0이 쓴 `docs/PLAN.md`의 「T9 착수 시 확정」 절 — **결정 L**(필터 축)이 이 step의 명세다
- `src/lib/store/task-repository.ts` — **전체를 읽는다.** `TaskRepository` 인터페이스(70~110행),
  `TaskFilter`(17행), `matchesTaskFilter`(266행). 인터페이스에 붙은 주석의 밀도가 기준이다
- `src/lib/store/repository-contract.ts` — **전체를 읽는다.** `RepositoryContractCase` 모양,
  `REPOSITORY_CONTRACT_CASES` 배열, 계약 16번(`recordEvents`)·17번(`getLastSyncedAt`)이
  이벤트를 어떻게 다루는지. **계약 번호는 22번까지 있다 — 새 케이스는 23번부터다**
- `src/lib/store/memory-task-store.ts` — `recordEvents`(206행)가 이벤트를 어디에 쌓는지
- `src/lib/store/supabase-task-store.ts` — `recordEvents`(654행)가 어느 테이블에 쓰는지
- `src/types/task.ts` — `TaskEvent`(156행). **`changedFields`는 이름만 담고 값을 담지 않는다**
- `supabase/migrations/0001_init.sql` — `task_events` 테이블(137행)

## 배경

`TaskRepository`에는 `recordEvents`(쓰기)만 있고 **읽는 길이 없다.** 그래서
`GET /api/report/weekly`가 `buildWeeklyReport`에 `events: []`를 넘기고, 보고서의
「이번 주 변경 건수」가 항상 0으로 나간다. 화면(`src/app/page.tsx:123`)은 그 사실을 각주로
사용자에게 밝히고 있다.

이 step은 **인터페이스를 넓히고 두 구현을 맞추는 것까지만** 한다. 권한(RLS 정책)은 step 2,
보고서에 실제로 꽂는 것은 step 3~4다. **여기서 화면이나 라우트를 건드리지 마라.**

## 작업

### 1. 먼저 계약 케이스를 쓴다 (TDD)

`src/lib/store/repository-contract.ts`의 `REPOSITORY_CONTRACT_CASES`에 **23번부터** 케이스를
더한다. 최소 아래를 덮되, 케이스 이름은 기존 것들처럼 **무엇을 보장하는지가 드러나게** 짓는다.

- `listEvents()`가 **기록한 이벤트를 돌려준다.** `recordEvents` → `listEvents` 왕복이 성립한다
- **정렬이 확정돼 있다.** `occurredAt` 내림차순(최신이 먼저). 같은 시각이면 순서가 흔들려도 되지만
  **건수는 흔들리지 않는다**
- **`since`·`until`이 경계를 포함하는지 아닌지가 확정돼 있다.** 한쪽을 고르고 케이스 이름에 적어라.
  권장: `since`는 포함(`>=`), `until`은 제외(`<`). 주 경계가 이어붙을 때 이벤트가 두 번 세이지 않는다
- **`taskIds`가 빈 배열이면 빈 결과다.** `listStages([])`가 그렇다(계약 13번) — 같은 규칙을 따른다.
  「필터 없음」과 「빈 필터」는 다른 뜻이다
- **`id`가 채워져 나온다.** `recordEvents`는 `Omit<TaskEvent, 'id'>`를 받지만 `listEvents`는
  `TaskEvent`를 준다
- **돌려준 객체를 호출자가 고쳐도 저장소가 오염되지 않는다** (계약 19번과 같은 규칙)
- **`changedFields`가 값이 아니라 이름만 담고 나온다.** 저장·조회를 왕복해도 값이 새지 않는다 (`S6`)

계약 파일 머리말의 「계약 테스트 전용 파일이다」 규칙을 지킨다. **`CONTRACT_EPOCH` 등 기존
시간 상수를 재정의하지 마라** — 계약은 원격 DB를 혼자 쓰지 않는다는 전제 위에 있다(`ADR-023`).
새 케이스도 **자기가 만든 행만 세야 한다.**

### 2. `TaskRepository`에 `listEvents`를 더한다

```ts
export interface TaskEventFilter {
  /** 포함(>=). ISO 8601 */
  since?: string;
  /** 제외(<). ISO 8601 */
  until?: string;
  /** 빈 배열은 「아무것도 아님」이다 — 「필터 없음」이 아니다 */
  taskIds?: readonly string[];
}

// TaskRepository에 추가
listEvents(filter?: TaskEventFilter): Promise<TaskEvent[]>;
```

**`TaskFilter`를 재사용하지 마라** (결정 L). 이유: 이벤트에는 팀·담당자·상태 축이 없고 `task_id`
하나뿐이다. 재사용하면 동작하지 않는 필터 필드가 인터페이스에 남는다.

`matchesTaskFilter`처럼 **기준 구현**(`matchesTaskEventFilter`)을 같은 파일에 export하면
계약 케이스가 두 구현을 같은 잣대로 잴 수 있다. 기존 파일이 그 패턴을 쓰고 있다.

### 3. 두 구현을 맞춘다

- `memory-task-store.ts` — `recordEvents`가 쌓아 둔 배열을 필터·정렬해서 돌려준다.
  **복사본을 돌려준다** (계약 19번).
- `supabase-task-store.ts` — `task_events`에서 읽는다. 필터를 **PostgREST 쪽에서** 건다
  (`listTasks`의 서버 측 limit가 선례다). **SQL 집계를 쓰지 마라** — 건수 계산은 도메인 함수의 몫이다.
  컬럼 매핑(`task_id` → `taskId`, `upload_id` → `uploadId`, `changed_fields` → `changedFields`,
  `occurred_at` → `occurredAt`)은 이 파일의 기존 매핑 방식을 그대로 따른다.
- `store-factory.ts`의 105행 부근에 **비어 있는 스텁 저장소**가 있다. 거기에도 `listEvents`를
  더해야 컴파일된다 — 빈 배열을 돌려주면 된다.

### 4. 라우트의 빚 주석을 **아직 지우지 마라**

`src/app/api/report/weekly/route.ts`의 ⚠ 주석과 `src/app/page.tsx:123`의 각주는 **step 4가**
지운다. 이유: 이 step이 끝난 시점에도 화면의 변경 건수는 여전히 0이다(라우트가 아직 `[]`를
넘긴다). 각주를 먼저 지우면 화면이 거짓말을 하게 된다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test                                        # 계약이 memory·supabase 양쪽에서 돈다
grep -n "listEvents" src/lib/store/task-repository.ts
grep -c "listEvents" src/lib/store/memory-task-store.ts src/lib/store/supabase-task-store.ts
grep -n "TaskEventFilter" src/lib/store/task-repository.ts
grep -rn "listEvents" src/app/ | wc -l              # 0이어야 한다 (라우트는 step 4가 손댄다)
grep -n "집계되지 않습니다" src/app/page.tsx        # 아직 남아 있어야 한다
```

계약이 실제로 **틀린 구현을 잡는지**까지 확인한다 — `assertRepositoryContract`가 그 용도다.
정렬을 뒤집거나 `since` 경계를 반대로 바꿔 케이스가 **빨갛게 되는 것을 보고** 되돌려라.

## 검증 절차

1. 위 AC를 실행한다. `npm run test`는 **라이브 Supabase 계약을 포함해서** 돈다 —
   `SKIP_LIVE_DB`를 켜서 우회하지 마라.
2. 아키텍처 체크리스트:
   - 새 파일을 만들었다면 `src/lib/` 아래 **basename이 전역 유니크한가?** (TDD 가드가 basename만 본다)
   - SQL 집계(`count`, `group by`)를 쓰지 않았는가?
   - `src/app/` 아래를 건드리지 않았는가?
3. `phases/t9-deploy-report/index.json`의 step 1을 갱신한다:
   - 성공 → `completed` + `summary`. **계약 케이스 번호 범위와 `since`/`until` 경계 규칙을
     반드시 요약에 적어라** — step 3이 기간을 자를 때 그 규칙을 알아야 한다.
   - 실패 → `error` + `error_message` / 개입 필요 → `blocked` + `blocked_reason`

## 금지사항

- **`src/app/` 아래를 고치지 마라.** 이유: 라우트·화면은 step 4·5의 몫이다. 여기서 손대면
  이벤트가 아직 권한 없이(step 2 전) 화면에 닿는다.
- **`TaskFilter`를 확장해 이벤트 필터를 겸하게 하지 마라.** 이유: 결정 L. 동작하지 않는 축이
  인터페이스에 남는다.
- **SQL에서 건수를 세지 마라.** 이유: memory·supabase 두 구현의 결과가 갈라진다 (CLAUDE.md CRITICAL).
- **`changedFields`에 값을 담지 마라.** 이유: 이력 테이블이 개인정보 사본이 된다 (`S6`).
- **마이그레이션을 쓰지 마라.** 이유: step 2의 몫이다. 지금은 `service_role`로 읽히므로 계약이 돈다.
- 기존 테스트를 깨뜨리지 마라. 특히 계약 16번·17번.
