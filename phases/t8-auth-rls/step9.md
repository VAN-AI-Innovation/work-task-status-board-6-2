# Step 9: patch-api

## 읽어야 할 파일

- `CLAUDE.md` — 라우트는 **zod 검증 → lib 호출 → 직렬화** 3단계만 · `runtime='nodejs'` ·
  API 응답에 `tasks.raw`를 싣지 않는다 · 민감 `extras`는 admin·lead에게만
- `docs/TICKETS.md` — T8 완료 기준 **2**(「**`member`가 타인의 태스크에 `PATCH`를 보내면 서버가
  `FORBIDDEN`으로 거부한다.** UI 숨김은 방어가 아니므로 `curl`로 직접 검증한다」) ·
  `UC-16`
- `docs/PLAN.md` — `UC-16`(본인 건만 수정 가능, 타인 건은 서버가 거부) ·
  step 0의 **결정 F**(허용 필드는 `status`·`progress` 둘)
- `docs/ARCHITECTURE.md` — 「에러 처리」의 `FORBIDDEN`·`UNAUTHENTICATED`·`TASK_NOT_FOUND`
- 이전 step 산출물: `viewer-scope.ts`(1) · `TaskRepository.updateTask`(2) ·
  `viewer-storage.ts`(7) · `request-viewer.ts`·`api-error.ts`(8)
- 본뜰 기존 코드:
  - `src/app/api/tasks/[id]/route.ts` — **같은 파일에 `PATCH`를 더한다.** `GET`의 주석 결과
    구조를 그대로 따른다
  - `src/lib/api/task-response.ts` — 응답 직렬화(`raw` 제외·마스킹)는 이미 여기 있다
  - `src/lib/api/assignment-schema.ts` — `.strict()`로 모르는 키를 막는 zod 스키마의 결

## 배경

**이 step이 T8의 심장이다.** 완료 기준 2가 못박은 것은 「보이지 않는다」가 아니라
「서버가 거부한다」이고, 그것을 확인하는 방법까지 티켓이 정해 뒀다 — `curl`이다.

방어는 이미 두 층이 있다. `viewer-scope.ts`(step 1)와 RLS·컬럼 GRANT(step 4)다.
이 라우트는 **그 둘을 부르는 문**이고, 스스로 새 규칙을 만들지 않는다.

## 이 라우트가 답하는 방식 — 존재 여부를 알려주지 않는다

읽기는 `view.repo`(사용자 JWT)로 한다. RLS가 걸려 있으므로 **범위 밖의 행은 애초에
`null`로 온다** — 「없는 행」과 구별되지 않는다. 그것이 의도다: 「그 id는 존재하지만 당신 것이
아니다」라고 답하면 부원이 id를 훑어 전사 업무의 **존재와 개수**를 셀 수 있다 (`S6`).

그래서 **인증된 사용자에게 이 라우트는 `TASK_NOT_FOUND`를 내지 않는다.** 보이지 않는 행도,
없는 행도 `FORBIDDEN`(403)이다. 완료 기준 2가 요구하는 것이 정확히 그 코드다.
(`GET`은 지금대로 404를 유지한다 — 읽기에서는 404가 덜 흘린다. 두 메서드가 다른 코드를
내는 이유를 라우트 주석에 남긴다.)

## 작업

### 1. `src/lib/api/task-patch-schema.ts` (+ 테스트)를 **먼저** 쓴다

```ts
/** `PATCH /api/tasks/[id]` 본문. 결정 F — 두 필드가 전부다 */
export const taskPatchSchema: z.ZodType<TaskPatch>;
```

- `.strict()` — 모르는 키가 오면 **던진다.** 조용히 무시하면 `{"titel": "..."}` 오타가
  「저장됐다」로 보인다.
- `status`: 문자열, `trim` 후 1~100자. **enum으로 좁히지 마라** — 시트의 상태 값은
  `설정` 탭에서 오고 늘어난다 (`ADR-009`). 미등록 값은 경고이지 거부가 아니다.
- `progress`: 정수 `0~100` 또는 `null`. `null`은 「값을 지운다」이고 `undefined`(키 없음)와
  다르다. 소수·문자열·`101`·`-1`은 거부.
- **키가 하나도 없는 본문(`{}`)은 거부한다** (`VALIDATION_FAILED`). 아무것도 안 바꾸는
  요청을 200으로 답하면 클라이언트 버그가 성공으로 보인다.
- 테스트: 위 갈래 전부 + 「모르는 키」 + 「빈 객체」.

### 2. `src/app/api/tasks/[id]/route.ts` 에 `PATCH`를 더한다 (테스트 먼저)

순서는 이렇다. **각 단계에서 딱 하나만 판단한다.**

```
1. view = await currentViewerContext()
2. view.session.status !== 'ok'        → 401 UNAUTHENTICATED
3. view.base.readOnly                  → 503 STORAGE_READONLY   (저장소를 건드리기 전에)
4. body = taskPatchSchema.parse(...)   → 실패 시 400 VALIDATION_FAILED
                                          (본문이 JSON이 아닌 것도 400 — export 라우트와 같은 결)
5. task = await view.repo.getTask(id)
   task === null                       → 403 FORBIDDEN         (존재 여부를 구분해 답하지 않는다)
6. !taskInScope(task, viewer)          → 403 FORBIDDEN         (RLS가 느슨해졌을 때의 둘째 층)
7. updated = await view.repo.updateTask(id, body, now)
   updated === null                    → 403 FORBIDDEN         (DB가 막았다)
8. 200 { task: toTaskResponse(updated, deriveTaskFlags(updated, ctx), role), meta }
```

- `now`는 라우트가 만들어 넘긴다 (`new Date().toISOString()`). `lib` 안에서 시간을 읽지 않는다.
- 응답은 `GET`과 **같은 모양**이어야 한다 — 화면이 두 응답을 같은 코드로 다룬다.
  `stages`는 바뀌지 않으므로 싣지 않아도 되지만, 싣는다면 `GET`과 같은 방식으로 싣는다.
- 계산을 라우트에 쓰지 마라. 판정은 `taskInScope`, 플래그는 `deriveTaskFlags`,
  직렬화는 `toTaskResponse`다.
- 6번이 「절대 안 걸릴 코드」로 보여도 지워라 는 말이 아니다. RLS와 `viewer-scope`가 갈라지는
  날 이 줄이 유일한 방어다. **그 이유를 주석으로 남긴다.**

테스트 (`src/app/api/tasks/[id]/route.test.ts`에 이어 쓴다):

- 미인증 → **401**, 저장소 쓰기가 **불리지 않았다** (스텁으로 잰다)
- 세션 `no_profile` → 401
- `readOnly` 핸들 → 503, 쓰기 미호출
- 모르는 키·`{}`·`progress: 101`·`progress: 1.5`·`status: ''` → 400
- **`member`가 남의 건** (`getTask`가 `null`) → **403**, `updateTask` **미호출**
- **`member`가 남의 건인데 `getTask`가 돌려주긴 한 경우**(RLS가 느슨한 상황을 흉내) → **403**,
  `updateTask` 미호출. **6번 줄을 재는 유일한 케이스다**
- `member`가 본인 건 → 200이고 `updateTask`가 `(id, {status, progress}, <ISO 문자열>)`로 불렸다
- `updateTask`가 `null`을 돌려주면 → 403
- 응답에 **`raw`가 없다** (`toTaskResponse`가 이미 막지만, 이 라우트에서도 확인한다)
- `admin`이 남의 팀 건 → 200 (범위가 전사다)

### 3. 문서

- `docs/ARCHITECTURE.md`「에러 처리」 아래에 **「같은 자원, 다른 코드」** 두 줄을 남긴다:
  `GET /api/tasks/[id]`는 보이지 않으면 404, `PATCH`는 403. 이유는 위와 같다.
- `docs/PLAN.md`의 `UC-16` 줄에 「(T8 이후)」를 떼고 실제 동작을 적는다.

## Acceptance Criteria

```bash
npm run test -- src/app/api/tasks src/lib/api/task-patch-schema.test.ts
npm run lint && npm run build && npm run test
grep -n "runtime = 'nodejs'" src/app/api/tasks/\[id\]/route.ts
grep -n 'getStorage' src/app/api/tasks/\[id\]/route.ts        # 0줄
grep -rn 'ownerNameRaw\|owner_name_raw' src/app/api/tasks/\[id\]/route.ts   # 0줄 (권한이 이름으로 서지 않는다)
grep -c 'FORBIDDEN' src/app/api/tasks/\[id\]/route.ts          # 3 (5·6·7번 갈래)
```

**라이브 `curl` 검증은 step 12(감사)에서 한다** — 로그인 경로가 아직 없어 세션 쿠키를 만들
방법이 이 step에는 없다. 대신 **DB 층의 같은 방어는 step 5의 `rls-check.mjs` 항목 6·7·8이
이미 증명했다.** 그 사실을 `summary`에 적고, 「`curl` 검증은 step 12」라고 남겨라.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 변이 테스트 넷을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - 2번(401 가드)을 지운다 → 미인증 케이스가 잡아야 한다
   - 6번(`taskInScope`)을 지운다 → 「RLS가 느슨한 상황」 케이스가 잡아야 한다.
     **잡히지 않으면 그 케이스가 없는 것이다 — 반드시 만들어라**
   - 5번의 `null`을 404로 바꾼다 → 「남의 건 → 403」이 잡아야 한다
   - 스키마의 `.strict()`를 뺀다 → 「모르는 키」가 잡아야 한다
3. 체크리스트:
   - 라우트에 계산이 없는가? (판정·플래그·직렬화가 전부 `lib` 호출인가)
   - `updateTask`가 **판정 뒤에만** 불리는가? (거부 케이스에서 미호출을 잰다)
   - 응답에 `raw`가 없고 민감 `extras`가 역할에 따라 가려지는가?
4. `phases/t8-auth-rls/index.json`의 step 9를 갱신한다.

## 금지사항

- `service_role` 핸들(`view.base.repo`)로 읽거나 쓰지 마라. 이 라우트는 **전부 사용자 JWT**다
  (`ADR-024`). 「존재 확인만 service_role로」도 안 된다 — 그 순간 존재 여부가 새고,
  완료 기준 5의 문장이 거짓이 된다.
- 허용 필드를 늘리지 마라 (`note`·`dueAt`·`ownerNameRaw`·`extras`). 늘리려면 문서가 먼저다.
- `DELETE`·`POST`를 만들지 마라. 티켓에 없다.
- UI를 만들지 마라. step 11의 일이다.
- 권한 판정을 라우트 안에 **다시 쓰지 마라** — `taskInScope`를 부른다.
- 에러 메시지에 업무명·담당자·id를 담지 마라 (`X1`).
- 기존 `GET` 동작·테스트를 바꾸지 마라.
