# Step 8: api-read-routes

## 읽어야 할 파일

- `CLAUDE.md` — 계층 경계, **API 응답에 `raw` 금지**, `runtime = 'nodejs'`, TDD
- `docs/TICKETS.md` — `## T5` 완료 기준 **1·9·10·12**
- `docs/PLAN.md` — 「보안」 `S6`, 「6. 집계·판정」, `UC-07`~`UC-14`
- `docs/ADR.md` — `ADR-007`(API는 클라이언트 상호작용·외부 소비 전용), `ADR-006`
- `docs/ARCHITECTURE.md` — 「집계·판정」의 리포지토리/도메인 대응표
- step 5·6 산출물: `errorResponse`·`resolveViewerRole`·`buildReadContext`·`parseTaskQuery`·
  `toTaskListResponse`
- T4 도메인 시그니처: `buildKpiStrip`·`summarizeAllTeams`·`collectAlerts`·`summarizeGoals`·
  `buildWeeklyReport`

## 배경

`ADR-007`이 정한 대로 **초기 렌더 데이터는 서버 컴포넌트가 `lib/`를 직접 부른다.** 그러면
조회 API는 왜 필요한가 — 셋이다.

1. 클라이언트의 필터·리프레시 상호작용 (T6이 쓴다)
2. 외부 소비(`curl`)와 **검증**. 완료 기준 9(`raw` 없음)를 `curl`로 확인하는 것이
   `PLAN.md`「검증 방법」 21번이다
3. 화면이 없어도 데이터 경로가 도는지 확인하는 진단면

라우트 6개가 전부 같은 모양이다: **쿼리 파싱 → `buildReadContext` → 도메인 함수 1개 →
`Response.json`.** 그 이상이 들어가면 계산이 샌 것이다 (완료 기준 1).

⚠ step 7과 같은 함정: **`route.ts`는 TDD 가드 예외가 아니다.** 각 폴더에 자기
`route.test.ts`를 둔다. `src/__tests__/route.test.ts`를 만들면 전부 뚫린다.

## 작업

여섯 폴더, 각각 `route.ts` + `route.test.ts` + `export const runtime = 'nodejs'`.

| 경로 | 부르는 도메인 함수 | 응답 |
|---|---|---|
| `GET /api/tasks` | `toTaskListResponse` | `{ tasks, meta }` |
| `GET /api/tasks/[id]` | `toTaskResponse` + `listStages` | `{ task, stages, meta }` |
| `GET /api/stats` | `buildKpiStrip` + `summarizeAllTeams` | `{ kpis, teams, meta }` |
| `GET /api/alerts` | `collectAlerts` | `{ alerts, meta }` |
| `GET /api/goals` | `summarizeGoals` | `{ items, byTeam, warnings, meta }` |
| `GET /api/report/weekly` | `buildWeeklyReport` | `{ markdown, meta }` |

공통 골격:

```ts
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const storage = await getStorage();
  try {
    const query = parseTaskQuery(url.searchParams);              // zod
    const read = await buildReadContext(storage, new Date(), {
      as: url.searchParams.get('as'),
      filter: query.filter,
    });
    return Response.json({ /* 도메인 함수 1개 호출 결과 */, meta: read.meta });
  } catch (error) {
    return errorResponse(isZodError(error) ? 'VALIDATION_FAILED' : 'STORAGE_UNAVAILABLE');
  }
}
```

**`isZodError` 판별을 라우트마다 손으로 쓰지 마라.** step 5의 `api-error.ts`에
`toApiErrorCode(error): ApiErrorCode` 하나를 **추가**하고 여섯 라우트가 그것을 쓴다
(`api-error.test.ts`에 케이스를 추가하는 것을 잊지 마라).

개별 규칙:

- **`/api/tasks`** — `toTaskListResponse(read.tasks, read.ctx.flags, read.role)`.
  `read.ctx.flags`는 `buildReadContext`가 이미 만들어 뒀다. 다시 계산하지 마라.
- **`/api/tasks/[id]`** — `params`는 **Promise다**(`const { id } = await params`).
  `repo.getTask(id)`가 `null`이면 **404**. 코드는… `X1` 목록에 태스크용 404 코드가 없다.
  **`VALIDATION_FAILED`로 뭉개지 말고 `UPLOAD_NOT_FOUND`도 쓰지 마라** —
  `errorResponse` 없이 `Response.json({ error: { code: 'NOT_FOUND', ... } }, { status: 404 })`를
  쓰는 것도 안 된다(코드 체계가 갈라진다). **`ApiErrorCode`에 `TASK_NOT_FOUND`를 추가하고
  `ARCHITECTURE.md`「에러 처리」 목록과 `PLAN.md` `X1`에도 같이 추가하라.** 코드 목록을
  늘릴 때는 문서를 함께 고친다.
- **`/api/stats`** — 두 함수를 부른다. **KPI 타일의 라벨·순서를 라우트에서 만들지 마라**
  (`buildKpiStrip`이 이미 낸다).
- **`/api/alerts`** — `collectAlerts(read.tasks, read.stages, read.ctx)`.
  `Alert`에는 `taskId`만 있고 업무명이 없다 — **친절하답시고 업무명을 붙이지 마라.**
  화면이 `?task=id`로 잇는다.
- **`/api/goals`** — `repo.listGoalMetrics()`를 부른 뒤 `summarizeGoals`.
  `GoalMetric.extras`도 **`maskExtras`를 거쳐야 한다** — 목표 지표에도 담당자·채널이 들어간다.
  `toGoalResponse(items, role)`를 `task-response.ts`에 **추가**하고 테스트를 붙여라.
- **`/api/report/weekly`** — `buildWeeklyReport({ tasks, stages, goals, events: [], ctx })`.
  **`events`는 빈 배열이다**: `TaskRepository`에 이벤트 **조회** 메서드가 없다(쓰기만 있다).
  이 사실과 이유를 라우트 주석에 남기고, `docs/TICKETS.md` T6이나 T9에서 인터페이스를 넓힐
  일이라고 적어라. 없는 데이터를 지어내지 마라.
  마크다운은 **문자열로만** 내려보낸다. 서버에서 HTML로 렌더하지 마라 (`S7`).

## 테스트

각 `route.test.ts`는 `STORAGE_DRIVER=memory` + `resetStorage()` 위에서 라우트 함수를 직접 부른다.
시드가 들어 있으므로 데이터가 있는 상태다.

`/api/tasks`:

1. 200이고 `tasks.length > 0`, `meta.today`가 `YYYY-MM-DD`
2. **`JSON.stringify(body)`에 `"raw"`가 없다** (완료 기준 9 — `PLAN.md`「검증 방법」 21번)
3. **`?as=admin`과 기본(role=member)에서 민감 키의 값이 다르다** (완료 기준 12·`S6`)
4. `?team=edit` → 편집팀만 / `?team=hr` → **400** `VALIDATION_FAILED`
5. `?overdue=1` → 전건이 `flags.isOverdue`
6. `?limit=1` → 1건

`/api/tasks/[id]`: 200에 `stages`가 함께 오고, 없는 id는 404.
`/api/stats`: `kpis.length === 10` (`UC-07`의 KPI 10종).
`/api/alerts`: `alerts[]`의 `kind`가 4종 안에 들고, 본문에 업무명이 없다.
`/api/goals`: `byTeam`이 팀별로 나오고 `items[].metric.extras`가 역할에 따라 다르다.
`/api/report/weekly`: `markdown`이 문자열이고 `#`로 시작한다.

공통: **본문에 `/src/`·`at `·`SUPABASE`·`KEY` 문자열이 없다.**

## Acceptance Criteria

```bash
npx vitest run src/app

# 라우트 6개 + step 7의 3개 = 9개 (9가 나와야 함)
find src/app/api -name "route.test.ts" | wc -l
grep -rn "runtime = 'nodejs'" src/app/api/ | wc -l

# 전역 우회 테스트가 없다 (출력이 비어야 함)
ls src/__tests__/route.test.ts 2>/dev/null ; test $? -ne 0

# 라우트가 집계를 다시 구현하지 않는다 — 도메인 함수 이름만 나오고 산술이 없어야 한다
grep -rnE "\.filter\(|\.reduce\(|Math\.round" src/app/api/tasks src/app/api/stats src/app/api/alerts src/app/api/goals src/app/api/report ; test $? -eq 1

# raw가 새지 않는다 (출력이 비어야 함)
grep -rn "\.raw" src/app/api/ ; test $? -eq 1

# 새 에러 코드가 문서에도 반영됐다 (둘 다 출력이 있어야 함)
grep -n "TASK_NOT_FOUND" docs/ARCHITECTURE.md
grep -n "TASK_NOT_FOUND" docs/PLAN.md

# 회귀
npx vitest run

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **개발 서버를 띄워 실제로 `curl`하라** — 이것이 `PLAN.md`「검증 방법」 21번이다:
   ```bash
   STORAGE_DRIVER=memory npm run dev &
   sleep 8
   curl -s localhost:3000/api/tasks | grep -c '"raw"'          # 0이어야 함
   curl -s localhost:3000/api/tasks | grep -cE '연락처|계정'    # 키는 있어도 값이 null인지 눈으로 확인
   curl -s 'localhost:3000/api/tasks?as=admin' | head -c 400
   curl -s localhost:3000/api/stats | head -c 200
   kill %1
   ```
3. 체크리스트:
   - 여섯 라우트가 각각 60줄 미만인가? (계산 0줄의 대리 지표)
   - `raw`가 응답에 없는가?
   - `member`와 `admin`의 `extras`가 실제로 다른가?
   - `events: []`인 이유가 주석에 남았는가? (없는 데이터를 지어내지 않았는가)
   - `TASK_NOT_FOUND`를 코드·`ARCHITECTURE.md`·`PLAN.md` **셋 다**에 넣었는가?
4. `phases/t5-api-upload/index.json`의 step 8을 갱신한다 (형식은 step 0과 동일).

## 금지사항

- 라우트에서 `filter`·`reduce`·산술을 하지 마라. 이유: 완료 기준 1 — 계산 로직 0줄.
  거르기는 `buildReadContext`, 집계는 `lib/domain/`이다.
- 응답에 `raw`를 싣지 마라. 이유: `CLAUDE.md` CRITICAL·`S6`.
- `Alert`에 업무명을 붙이지 마라. 이유: 알림은 외부로도 나갈 수 있고(T10 디스코드),
  실명·업무명이 실리면 `S6` 위반이다. 화면이 id로 잇는다.
- 이벤트가 없는데 있는 척하지 마라. 이유: 없는 데이터를 지어내면 주간 보고가 거짓이 된다.
  `TaskRepository`에 조회 메서드가 없다는 사실을 주석으로 남긴다.
- 주간 보고 마크다운을 서버에서 HTML로 렌더하지 마라. 이유: sanitize가 필요해진다 (`S7`).
- 에러 코드를 문서 없이 늘리지 마라. 이유: 코드 체계가 코드와 문서에서 갈라진다.
- 서버 컴포넌트가 이 라우트를 `fetch`하게 만들지 마라. 이유: `ADR-007`.
- `PATCH /api/tasks/[id]`를 만들지 마라. 이유: 수정은 권한 검증이 전제이고 T8(`UC-16`)의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
