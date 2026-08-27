# Step 5: join-requests-api

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 「조회와 쓰기는 다른 클라이언트로 나간다 (`ADR-024`)」
- `/docs/ADR.md` — ADR-024 · ADR-027
- `src/app/api/tasks/[id]/route.ts` — **본뜰 대상.** `PATCH` 머리말의 403/404 판단을 읽어라
- `src/lib/api/api-error.ts` · `src/lib/api/task-patch-schema.ts`
- `src/lib/store/viewer-storage.ts` · `src/lib/auth/request-viewer.ts`
- `src/lib/api/same-origin.ts` (step 4) — Origin 검사
- `src/types/api.ts` — 응답 스키마를 `.strict()`로 강제하는 규율
- `src/lib/api/task-response.ts` — 응답 직렬화의 본보기
- `supabase/migrations/0005_signup_approval.sql` (step 0)

step 0이 만든 것 중 이 step이 쓰는 것:

| 함수 | 호출 자격 | 하는 일 |
|---|---|---|
| `pending_requests()` | active lead → 자기 팀 / active admin → 전부 | `user_id·display_name·email·team_id·status·created_at` |
| `approve_join(target, member_id, new_member_name)` | active lead(같은 팀) 또는 active admin | 승인 + `members` 연결 |
| `reject_join(target)` | 위와 같음 | `status='rejected'` |

`approve_join`은 `member_id`와 `new_member_name` 중 **정확히 하나**가 non-null이어야 하고,
아니면 예외를 던진다.

## 작업

**TDD다. 스키마 → 라우트 순으로 테스트를 먼저 쓴다.**

### 1. 요청 스키마 — `src/lib/api/join-request-schema.ts`

```ts
export const approveSchema = z.object({
  userId: z.uuid(),
  memberId: z.uuid().optional(),
  newMemberName: z.string().trim().min(1).max(40).optional(),
}).refine(<정확히 하나만 있을 것>);

export const rejectSchema = z.object({ userId: z.uuid() });
```

`refine`으로 「정확히 하나」를 **앱에서도** 강제하는 이유: DB 함수가 이미 막지만, 400으로
돌려주는 편이 500보다 사용자에게 정직하다. 두 곳이 같은 규칙을 지는 것은 의도이고,
**DB 쪽을 느슨하게 만들어 앱만 믿지 마라.**

### 2. 조회 라우트 — `GET /api/team/requests`

```
export const runtime = 'nodejs'
사용자 JWT 클라이언트로 rpc('pending_requests')
→ { requests: [...] }
```

**범위를 앱에서 거르지 마라.** 함수가 호출자 역할에 따라 이미 좁힌다. 앱이 한 번 더
`filter`를 걸면 규칙이 두 벌이 되고, 어긋났을 때 어느 쪽이 진짜인지 알 수 없다
(`viewer-scope.ts`와 RLS가 두 벌인 것은 데모 모드라는 근거가 있어서다 — 여기에는 없다).

**응답 스키마를 `.strict()`로 통과시켜라.** `task-response.ts`와 같은 규율이다. 이 응답에는
**이메일이 실린다** — 지정하지 않은 키가 조용히 섞이면 안 된다.

이메일이 실리는 것 자체는 의도다(리더가 요청자를 알아봐야 한다). 다만 **`admin`·`lead`만
이 라우트에 닿는다**는 것을 함수가 보증하므로, 앱은 그 위에 아무것도 더하지 않는다.

### 3. 승인·거절 라우트 — `POST /api/team/requests/approve` · `.../reject`

두 라우트로 나눈다. 하나의 라우트에 `action` 필드를 두지 마라 — 승인과 거절은 결과가
정반대인데 한 글자 오타로 갈린다.

각 라우트가 하는 일:

```
1. Origin 검사 (isSameOrigin). 다르면 403
2. zod 검증. 실패하면 400 VALIDATION_FAILED
3. 사용자 JWT로 rpc('approve_join' | 'reject_join')
4. 성공 → 갱신된 요청 목록을 다시 실어 돌려준다 (화면이 즉시 다시 그린다)
5. DB 예외 → 403 FORBIDDEN
```

**4번이 왜 목록을 다시 싣는가**: 승인 직후 화면이 자기 힘으로 목록을 계산하면 그것이
곧 계산 로직이다. 서버가 새 목록을 주면 화면은 그리기만 한다.

**5번에서 사유를 구분해 알리지 마라.** 「그 사용자는 당신 팀이 아닙니다」와 「이미 승인된
사용자입니다」가 다른 답을 주면, 리더가 uuid를 훑어 **다른 팀의 계정 존재와 상태**를 셀
수 있다. `tasks/[id]`의 `PATCH`가 같은 이유로 404 대신 403을 낸다 — 그 판단을 그대로 따른다.

**`service_role`을 쓰지 마라. 전부 사용자 JWT다.** 이유: 호출 자격 검사가 DB 함수 안에
있고 그 검사는 `auth.uid()`에 기댄다. `service_role`로 부르면 `auth.uid()`가 없어
검사가 무너지거나, 앱이 「내가 확인했으니 통과시켜라」는 인자를 넘기게 된다. 그 순간
방어가 한 겹이 되고, 그 한 겹은 앱이다.

### 4. 에러 코드

`src/lib/api/api-error.ts`에 필요한 코드를 더한다. 기존 표의 명명 규칙을 따르고,
**`FORBIDDEN` 하나로 접을 수 있으면 새 코드를 만들지 마라** (요청받지 않은 유연성 금지).

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/api/join-request-schema.test.ts src/app/api/team/requests/

# service_role이 닿지 않았는지 (결과가 비어 있어야 한다)
grep -rn "SERVICE_ROLE\|getStorage" src/app/api/team/

# 런타임 명시 (세 라우트 전부)
grep -rn "runtime = 'nodejs'" src/app/api/team/requests/

# 승인 라우트가 Origin을 검사하는지
grep -rn "isSameOrigin" src/app/api/team/requests/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 실패 갈래가 **전부 같은 403으로 접히는지** 확인한다. 사유별로 갈리면 계정 열거가 된다.
3. 앱이 요청 목록을 역할로 다시 거르지 않는지 확인한다
   (`grep -n "filter" src/app/api/team/requests/route.ts` → 범위 필터가 없어야 한다).
4. 아키텍처 체크리스트:
   - 라우트가 「zod 검증 → lib 호출 → 직렬화」 3단계인가?
   - 비즈니스 로직이 `src/lib/`에 있는가?
   - `src/app/api/**`에 `export const runtime = 'nodejs'`가 있는가?
   - 응답 스키마가 `.strict()`인가?
   - `src/lib/` 아래 파일명이 전역 유니크한가?
5. `phases/t11-signup-approval/index.json`의 step 5를 업데이트한다.
   `summary`에 라우트 3개의 경로와 응답 타입 이름을 적는다 — step 6이 그것을 소비한다.

## 금지사항

- **`service_role`(`getStorage()`)을 쓰지 마라.** 이유: 3번 절에 근거가 있다.
- **범위를 앱에서 한 번 더 거르지 마라.** 이유: 2번 절에 근거가 있다.
- **실패 사유를 구분해 알리지 마라.** 이유: 계정 열거가 된다.
- **화면을 만들지 마라.** 이유: step 6이 한다. 이 step의 산출물은 API뿐이다.
- **하나의 라우트에 `action` 필드를 두지 마라.** 이유: 3번 절에 근거가 있다.
- 기존 테스트를 깨뜨리지 마라
