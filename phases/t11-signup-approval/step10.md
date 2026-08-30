# Step 10: docs-update

## 읽어야 할 파일

- `/docs/PLAN.md` — 「8. 권한」 전체. 특히 「T8 착수 시 확정」 절의 결정 목록 형식
- `/docs/ARCHITECTURE.md` — 「권한 (T8)」 전체
- `/docs/ADR.md` — **마지막 ADR 번호를 확인하라.** 새 번호는 그다음부터다
- `/docs/TICKETS.md` — 티켓 형식(완료 기준 목록)
- `/docs/UI_GUIDE.md`
- `README.md`
- `phases/t11-signup-approval/index.json` — step 0~9의 `summary`가 실제 산출물이다
- `supabase/migrations/0005_signup_approval.sql`
- `src/lib/domain/viewer-scope.ts` — 범위 표. 대기 상태가 여기 어떻게 얹히는지

**`index.json`의 각 step `summary`를 먼저 읽어라.** 그것이 실제로 만들어진 것의 목록이고,
문서는 계획이 아니라 **결과**를 적어야 한다. 계획과 결과가 다르면 결과를 적는다.

## 작업

`CLAUDE.md`가 못박은 규율: **결정이 바뀌면 코드보다 `PLAN.md`를 먼저 고친다.** 이 step은
코드를 이미 쓴 뒤에 오므로, 문서가 코드를 따라잡는 자리다.

### 1. `docs/ADR.md` — 새 ADR 4개

마지막 번호를 확인하고 이어서 붙인다. 기존 ADR의 형식(맥락·결정·근거·결과)을 그대로 따른다.

| 주제 | 핵심 |
|---|---|
| 상태 게이트를 함수 셋에 둔다 | `my_role`·`my_team`·`my_member_id` 전부가 `status='active'`를 본다. **`my_role()`만 고치면 `goal_metrics` 정책이 뚫린다** — 그 정책의 두 번째 갈래에 `my_role()` 검사가 없기 때문. 이 사실을 반드시 적어라 |
| 접근 제어를 RLS 정책이 아니라 `security definer` 함수에 모은다 | `profiles`·`members`에 UPDATE GRANT를 주지 않는다. `with check` 조합은 하나만 빠뜨려도 권한 상승. 트레이드오프(정책보다 덜 선언적이다)도 함께 적어라 |
| 계정 생성은 `signUp()`으로만 한다 | `service_role`의 admin API는 이메일 확인과 rate limit을 건너뛴다 → 이메일 선점·스팸 가입 |
| 가입 시 `role`·`status`는 트리거가 하드코딩한다 | `user_metadata`는 사용자가 고칠 수 있는 자리다 |
| 유출 비밀번호 검사를 직접 구현한다 | Supabase의 것은 Pro 전용. k-익명성으로 해시 접두사 5글자만 보낸다. **fail-open**인 이유(외부 장애가 가입 장애가 되면 안 된다)도 적어라 |

### 2. `docs/PLAN.md` — 「8. 권한」에 절 추가

새 상태 축을 표로 적는다. **`viewer-scope.ts`의 표와 나란히 놓여야 한다.**

```
status    role      볼 수 있는 것
pending   (무시)    없음. 화면은 /pending
rejected  (무시)    없음. /pending에서 재요청
active    admin     전부
active    lead      자기 팀
active    member    자기 업무 + 자기 팀 목표 지표
```

승인 흐름(가입 → 대기 → 리더 승인 + `members` 연결 → 활성)과 거절 흐름을 적는다.

**`members` 연결이 승인 시점에 일어난다는 것**을 강조해 적어라 — 이것이 안 되면 승인된
사람이 자기 업무 0건인 화면을 본다. 다음 사람이 이 자리를 「나중에 자동으로 되겠지」라고
생각하지 않도록.

### 3. `docs/ARCHITECTURE.md` — 「권한」 절 갱신

- 「세션 → 열람자」 도식에 `pending`·`rejected` 갈래를 더한다
- `proxy`는 여전히 DB를 조회하지 않고, 대기 판정은 `lib/auth/pending-gate.ts`가 진다는 것
- 새 화면 3개(`/signup`·`/pending`·`/team/requests`·`/members`)와 API 경로를 도식에 넣는다
- `security definer` 함수 6개의 이름·호출 자격 표

### 4. `docs/TICKETS.md` — T11 추가

기존 티켓 형식으로. 완료 기준은 이슈 #29의 6개를 옮기되, **실제로 검증한 방법**을 적는다.

### 5. `README.md`

- 회원가입 흐름 한 단락
- **`supabase/migrations/0005_signup_approval.sql` 적용 절차** — `0003`과 같은 방식
  (대시보드 SQL Editor). 재적용 가능하다는 것도 적는다
- 최초 admin 계정을 SQL로 심는 방법 (실제 이메일·비밀번호를 적지 마라)
- **Supabase 대시보드에서 사람이 켜야 하는 설정**: 비밀번호 최소 길이 상향, Confirm email
- **Leaked password protection은 Supabase Pro 전용이라 켤 수 없다.** 같은 방어를
  `src/lib/auth/pwned-password.ts`가 k-익명성 방식으로 직접 구현한다는 사실과, 그것이
  **가입 시점에만** 걸린다는 것(비밀번호 변경 흐름이 이 프로젝트에 없다)을 적어라

### 6. `CLAUDE.md`

새로 생긴 CRITICAL 규칙이 있으면 더한다. 후보:

- `profiles`·`members`의 상태 변경은 `security definer` 함수(RPC)로만 한다. 앱이 직접
  `update`하지 않는다
- 인증·권한 라우트(`api/auth`·`api/team`·`api/members`)에서 `service_role`을 쓰지 않는다

**규칙을 늘리기만 하지 마라.** 기존 규칙 중 이번 변경으로 사실이 틀어진 것이 있으면
고쳐라. 예: 「인증은 T8이다. 그때까지 이 값은 `?as=`에서 온다」 같은 주석이 코드에 남아
있으면 그것도 이 step에서 정리 대상이다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

# 문서에 새 산출물이 반영됐는지 — 전부 1 이상이어야 한다
grep -c "0005_signup_approval" README.md docs/ARCHITECTURE.md
grep -c "pending" docs/PLAN.md
grep -c "security definer" docs/ADR.md

# 실계정 자격증명이 문서에 새지 않았는지 (결과가 비어 있어야 한다)
grep -rniE "password *[:=] *['\"][^'\"]{4,}" README.md docs/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **`index.json`의 step 0~9 `summary`와 문서를 대조한다.** 문서에 있는데 코드에 없는
   것, 코드에 있는데 문서에 없는 것을 각각 확인한다. 계획을 적지 말고 결과를 적는다.
3. ADR 번호가 기존 마지막 번호와 이어지는지, 중복이 없는지 확인한다.
4. 아키텍처 체크리스트:
   - 실업무 데이터·실명·연락처가 문서에 들어가지 않았는가?
   - 실제 비밀번호·키가 들어가지 않았는가?
5. `phases/t11-signup-approval/index.json`의 step 10을 업데이트한다.
   `summary`에 새 ADR 번호와 고친 문서 목록을 적는다.

## 금지사항

- **`src/` 아래 코드를 고치지 마라.** 예외: 6번 절이 말한 「사실이 틀어진 주석」 정리.
  동작을 바꾸는 변경은 하지 마라 — 이 step 뒤에는 검증 단계가 없다.
- **계획을 적지 말고 결과를 적어라.** 이유: 문서가 코드보다 앞서 있으면 다음 사람이
  없는 기능을 쓰려 한다.
- **실제 이메일·비밀번호·키를 문서에 적지 마라.** 이유: CLAUDE.md CRITICAL (`S6`).
- **ADR 번호를 추측하지 마라.** `docs/ADR.md`를 열어 마지막 번호를 확인하고 이어라.
- 기존 테스트를 깨뜨리지 마라
