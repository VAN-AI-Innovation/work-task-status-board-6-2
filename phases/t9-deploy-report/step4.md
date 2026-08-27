# Step 4: report-api

## 읽어야 할 파일

- `CLAUDE.md` — 「라우트 핸들러는 `src/lib/`를 **호출만 하고 계산하지 않는다**」,
  「`src/app/api/**`에 `export const runtime = 'nodejs'`를 명시」,
  **「API 응답에 `tasks.raw`를 싣지 말 것 (zod 스키마로 강제)」**
- step 0의 결정 **M**(기간)·**N**(권한)·**O**(마크다운은 문자열로만)
- step 3의 `summary` — `ReportPeriod` 필드와 **`events: null` vs `[]`의 의미 차이**
- `src/app/api/report/weekly/route.ts` — **전체를 읽는다.** 특히 파일 상단의 ⚠ 주석.
  **이 step이 그 주석을 회수한다**
- `src/lib/api/read-context.ts` — `buildReadContext`(132행) · `ReadContext`(37행) ·
  `parseTaskQuery`(116행) · `taskQuerySchema`(92행). **쿼리 파싱을 zod로 하는 기존 방식**을 본다
- `src/app/api/tasks/route.ts` — 조회 라우트의 표준 모양(권한·에러·meta)
- `src/lib/auth/request-viewer.ts` — `currentViewerContext()`
- `src/lib/api/api-error.ts` — `errorResponse` · `toApiErrorCode`
- `src/proxy.ts` — 보호 라우트 목록. **결정 N에 따라 `/report`가 여기 들어간다**
- `src/app/page.tsx` — **123행의 각주 상수**와 그것을 쓰는 자리. 이 step이 지운다

## 배경

`GET /api/report/weekly`는 이미 있다. 하지만 두 가지가 비어 있다.

1. **기간을 못 고른다.** 항상 `ctx.today` 기준 이번 주다.
2. **`events: []`를 넘긴다.** 라우트 상단의 ⚠ 주석이 그 빚을 설명하고 있고, 화면
   (`src/app/page.tsx:123`)은 사용자에게 「변경 건수는 이력 조회 경로가 없어 집계되지 않습니다
   (T9에서 `listEvents`를 더한다)」라고 각주로 밝히고 있다.

step 1~3이 재료를 다 만들었다. 이 step이 **연결하고 각주를 회수한다.**

## 작업

### 1. 기간 파라미터를 받는다

쿼리 파라미터 하나(`week`, 값은 주 시작일 `YYYY-MM-DD`)를 받아 `resolveReportPeriod`에 넘긴다.

- 파싱·검증은 **zod로** 한다. `taskQuerySchema`(read-context.ts 92행)가 선례다
- **라우트가 날짜를 계산하지 마라.** `resolveReportPeriod`를 부르는 것이 전부다 (CLAUDE.md CRITICAL)
- 잘못된 값이면 **400을 내지 말고** 이번 주로 되돌린다 (결정 M). 되돌렸다는 사실은
  응답의 `meta`에 실어 화면이 알 수 있게 한다 — `ReportPeriod.fellBack`이 그 값이다

### 2. `listEvents`를 꽂는다

`view.repo.listEvents({ since, until })`로 읽어 `buildWeeklyReport`에 넘긴다.

- **사용자 JWT 경로로 나가야 한다.** `buildReadContext`가 주는 저장소를 쓴다.
  `service_role`로 직접 읽는 우회로를 만들지 마라 (`ADR-024`)
- **`taskIds`로 미리 좁히지 마라.** RLS가 이미 자른다(step 2의 정책). 여기서 또 좁히면
  범위 규칙이 두 벌이 된다
- 저장소가 이벤트를 못 읽는 경로(데모 모드 등)에서는 **`null`을 넘긴다** — `[]`가 아니다.
  step 3이 그 둘을 다르게 렌더한다

### 3. 응답 모양

기존 `{ markdown, meta }`를 유지하되 화면이 필요한 것을 더한다. 최소:

- `markdown` — 문자열 그대로 (결정 O)
- `period` — `weekStart` · `weekEnd` · `fellBack`
- `meta` — 기존 그대로 (`driver`·`mode`·`role` 등)

**`tasks.raw`가 응답에 실리지 않는 것을 확인하라.** 이 라우트는 마크다운만 내지만,
`period`·`meta`를 더하면서 실수로 원본 객체를 실을 수 있다. **zod 스키마로 응답을 강제하는
기존 패턴이 있으면 그것을 따른다.**

### 4. `/report`를 보호 라우트에 넣는다

`src/proxy.ts`의 화면 보호 목록에 `/report`를 더한다 (결정 N). **역할로 막지 마라** —
로그인만 요구한다. 데모 모드는 면제다.

`src/proxy.test.ts`에 케이스를 더한다: 미인증 `/report` → `307` + `/login?next=%2Freport`,
데모 모드 → `200`.

### 5. 빚 주석과 화면 각주를 회수한다

- `src/app/api/report/weekly/route.ts` 상단의 **⚠ 블록을 지운다.** 대신 **지금의 사실**을
  한두 줄로 남긴다 (이벤트는 사용자 JWT로 읽고, 범위는 RLS가 자른다)
- `src/app/page.tsx`의 **각주 상수(123행)와 그것을 화면에 그리는 자리를 지운다.**
  상수만 지우고 쓰는 곳을 남기면 컴파일이 깨진다 — **둘 다 지운다**
- `docs/TICKETS.md`의 T9 「리스크·미결」에 있는 `listEvents` 항목에
  **「해소됐다」는 사실과 해소한 자리**를 적는다. 항목을 통째로 지우지 마라 — 이력이다
- `src/app/page.tsx`의 브리핑 카드는 이제 **실제 건수**를 보여준다. 그 카드가 여전히
  `buildWeeklyReport`의 결과를 그대로 그리는지 확인한다

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
grep -c "events: \[\]" src/app/api/report/weekly/route.ts   # 0
grep -rc "집계되지 않습니다" src/                            # 0
grep -n "runtime = 'nodejs'" src/app/api/report/weekly/route.ts
grep -n "report" src/proxy.ts                                # 보호 목록에 있다
grep -rn "service_role\|SUPABASE_SERVICE_ROLE_KEY" src/app/api/report/   # 0줄
```

라이브 확인 (개발 서버 + 실제 세션 쿠키):

```bash
# 로그인 없이
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/report/weekly    # 401
# admin 쿠키로 — 기간 없이, 과거 주, 쓰레기 값
curl -s -b cookies.txt 'localhost:3000/api/report/weekly' | head -c 200
curl -s -b cookies.txt 'localhost:3000/api/report/weekly?week=2026-08-17' | head -c 200
curl -s -b cookies.txt 'localhost:3000/api/report/weekly?week=어제' | head -c 200   # 200 + fellBack:true
```

**세 역할의 변경 건수가 각자 다른지** 확인하라 — admin ≥ lead ≥ member여야 한다.
원격 `task_events`가 0행이면 셋 다 0이라 아무것도 증명되지 않는다. 그때는
step 2가 남긴 방식대로 검증용 이벤트를 넣고 확인한 뒤 **넣은 것만 되돌린다.**

## 검증 절차

1. 위 AC를 실행한다.
2. 아키텍처 체크리스트:
   - 라우트가 **계산하지 않는가?** 날짜·건수 계산이 라우트 본문에 있으면 `lib/`로 옮긴다
   - 서버 컴포넌트가 자기 API 라우트를 fetch하지 않는가?
   - 응답에 `raw`가 없는가?
3. `phases/t9-deploy-report/index.json`의 step 4를 갱신한다:
   - 성공 → `completed` + `summary`. **응답 필드 모양과 세 역할의 실측 건수**를 적어라 —
     step 5가 그 응답을 그리고, step 9가 그 숫자를 다시 잰다.
   - 실패 → `error` / 개입 필요 → `blocked`

## 금지사항

- **`service_role`로 이벤트를 읽지 마라.** 이유: `ADR-024`. RLS를 통째로 우회한다.
- **잘못된 `week` 값에 400을 내지 마라.** 이유: 결정 M. 되돌리고 알린다.
- **마크다운을 서버에서 HTML로 렌더하지 마라.** 이유: `S7`. sanitize가 필요해지고 셀 값이 DOM이 된다.
- **`/report` 화면을 만들지 마라.** 이유: step 5의 몫이다. 여기서는 라우트와 `proxy`까지다.
- **각주 상수만 지우고 쓰는 자리를 남기지 마라.** 이유: 컴파일이 깨진다.
- **`TICKETS.md`의 미결 항목을 통째로 삭제하지 마라.** 이유: 해소 이력이 사라진다.
- 기존 테스트를 깨뜨리지 마라. 특히 `proxy.test.ts`와 T8이 만든 인증 테스트들.
