# Step 5: auth-accounts

## 읽어야 할 파일

- `CLAUDE.md` — `service_role` 키에 `NEXT_PUBLIC_` 금지 · **실업무 데이터 커밋 금지** ·
  에러·로그에 셀 값을 담지 않는다 · `scripts/`는 번들에 들어가지 않으므로 예외 범위다
- `docs/TICKETS.md` — T8 완료 기준 **1**(세 역할이 각각 다른 범위를 본다) · **5**(조회가 사용자
  JWT로 나가 RLS가 실제로 걸린다)
- `docs/PLAN.md` — `S6`(개인정보) · 「9. 시연 리스크 완화」 3번(시드는 **파서로 돌려 만든**
  익명화 결과물이다)
- `.gitignore` — `.env*`가 차단되고 `.env.example`만 예외라는 것
- step 3·4 산출물: `src/lib/upload/owner-link.ts`, `supabase/migrations/0003_auth_rls.sql`
- 본뜰 기존 스크립트:
  - `scripts/fixtures/build-seed-tasks.ts` — **TypeScript 스크립트를 `vite-node`로 돌리는 방식**
    (`package.json`의 `seed:build`). 제품 코드를 import할 수 있다
  - `scripts/smoke/assignment-xlsx.mjs`·`scripts/smoke/README.md` — 검증 스크립트의 결·출력 형식
- `src/lib/upload/seed-loader.ts`·`src/app/api/uploads/seed/route.ts` — 시드를 넣는 **정식 경로**
- `src/lib/fixtures/seed-tasks.json` — 담당자 이름은 이미 익명이다
  (`담당자1~3`/`기획자1`/`마케터1~2`)

## 배경

step 4가 정책을 걸었지만 **아직 아무도 로그인하지 않았고, `members`는 0행이며,
`tasks.owner_member_id`는 전부 `null`이다.** 그 상태에서는 완료 기준 1·2·5를 잴 수 없다 —
세 역할이 「각각 다른 범위」를 보는지 확인하려면 세 계정과, 적어도 한 계정에 붙은 담당 업무가
있어야 한다.

이 step은 **두 개의 스크립트**를 남긴다.

1. `scripts/db/seed-auth.ts` — 계정·프로필·구성원을 **멱등하게** 만든다
2. `scripts/smoke/rls-check.mjs` — 세 계정으로 **실제 로그인해** `anon` 키 + JWT로 조회하고,
   보이는 건수가 역할마다 다른지 잰다. **완료 기준 5를 증명하는 것이 이 스크립트다.**

두 번째가 더 중요하다. 정책은 「걸었다」가 아니라 **「실제로 다르게 보인다」**로만 증명된다.

## 이 step은 원격 Supabase에 계정과 행을 만든다 (사용자 승인 범위)

- 만드는 것: `auth.users` 3개 + `profiles` 3행 + `members` 6행 + 시드 태스크(멱등 재확정).
- **지우는 것은 없다.** 실업무 행·계약 행을 건드리지 마라.
- 비밀번호를 **저장소에 커밋하지 마라.** `.env.local`(gitignore됨)에만 둔다.

## 작업

### 1. 비밀번호 조달 — `.env.local`에만 둔다

- 스크립트는 `T8_SEED_PASSWORD`를 `process.env`에서 읽는다.
- 없으면 **무작위 24자 이상**을 생성해 `.env.local`에 `T8_SEED_PASSWORD=...` 한 줄로
  **덧붙이고**(기존 줄을 고치지 마라), 표준출력에는 **값을 찍지 않고**
  「`.env.local`에 `T8_SEED_PASSWORD`를 새로 기록했다」만 알린다.
- `.env.example`에 아래 셋을 **빈 값으로** 추가하고 한 줄 주석을 단다.

```
# T8 데모 계정 (scripts/db/seed-auth.ts가 만든다). 실제 값은 .env.local에만 둔다.
T8_SEED_PASSWORD=
T8_SEED_EMAIL_DOMAIN=example.com
```

계정 이메일은 `admin@<도메인>`·`lead@<도메인>`·`member@<도메인>`이다. 실명·실제 주소를
쓰지 마라.

### 2. `scripts/db/seed-auth.ts`

`package.json`에 `"seed:auth": "vite-node -c vitest.config.ts scripts/db/seed-auth.ts"`를 더한다.
(`seed:build`와 같은 방식이다. `vitest.config.ts`가 `.env.local`을 읽어 주므로 키가 들어온다.)

**멱등해야 한다.** 두 번 돌려도 결과가 같고, 두 번째 실행이 에러 없이 끝난다.

순서:

1. **자격증명 확인** — `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`가 없으면
   0이 아닌 코드로 즉시 끝낸다 (사용자 개입이 필요한 상태다).
2. **`members` 6행 upsert** — `seed-tasks.json`에서 `(teamId, ownerNameRaw)` 조합을 **읽어**
   만든다. 이름을 스크립트에 하드코딩하지 마라 — 시드가 바뀌면 조용히 어긋난다.
   `on conflict (team_id, name) do nothing`에 해당하는 처리를 한다.
3. **계정 3개** — Admin API(`auth.admin.createUser`)로 만들되 `email_confirm: true`를 준다
   (확인 메일을 기다리면 스크립트가 끝나지 않는다). **이미 있으면 만들지 않는다** —
   `auth.admin.listUsers()`로 먼저 찾고, 있으면 그 id를 쓴다. 비밀번호를 매번 덮어쓰지 마라.
4. **`profiles` 3행 upsert**

   | 이메일 | `role` | `team_id` |
   |---|---|---|
   | `admin@…` | `admin` | `null` |
   | `lead@…` | `lead` | `edit` |
   | `member@…` | `member` | `edit` |

5. **`members.auth_user_id` 연결** — `member@…` 계정을 **`edit` 팀에서 태스크가 가장 많은
   이름**에 잇는다 (시드 기준 `담당자2`, 2건). 「가장 많은 이름」을 시드에서 **계산**한다 —
   그래야 완료 기준 1의 `member` 화면이 빈 화면이 아니고, 시드가 바뀌어도 따라간다.
   `lead@…`도 `edit` 팀의 다른 이름 하나에 잇는다 (팀장도 자기 담당 업무가 있다).
   `admin@…`은 잇지 않는다 — 전사 역할이라 담당자 축이 없다.
6. **시드 태스크 확정** — `tasks`에 시드 자연키가 없으면 **제품 경로 그대로** 넣는다:
   `buildSeedPayload()` → `uploads.create` → `commitUpload`. 별도 쓰기 경로를 만들지 마라
   (`/api/uploads/seed/route.ts`의 주석이 그 이유를 적고 있다). 이 시점에는 `members`가 이미
   있으므로 step 3의 `linkOwners`가 `owner_member_id`를 채운다.
7. **잔여 백필** — 그래도 `owner_member_id`가 `null`인데 이름이 붙을 수 있는 행이 있으면
   채운다. 규칙을 **다시 쓰지 마라** — `owner-link.ts`의 `buildOwnerIndex`(와 그 정규화)를
   import해서 쓴다. 두 벌이 되면 업로드로 들어온 행과 백필한 행의 기준이 갈린다.
8. **요약 출력** — 만든 것/이미 있던 것의 **건수만** 찍는다. 이메일·이름·비밀번호·키를
   찍지 마라.

### 3. `scripts/smoke/rls-check.mjs` — 완료 기준 5를 증명한다

`node scripts/smoke/rls-check.mjs`로 돈다. `.env.local`을 직접 파싱하거나
`node --env-file=.env.local`을 안내한다 (기존 스모크 스크립트의 결을 따른다).

**반드시 `anon` 키로 클라이언트를 만든다.** `service_role`로 재면 RLS가 우회되어
이 스크립트가 **아무것도 재지 않는다.** 스크립트 첫머리에서 사용 중인 키가
`SUPABASE_SERVICE_ROLE_KEY`와 같으면 즉시 실패시켜라.

재는 것:

| # | 무엇 | 기대 |
|---|---|---|
| 1 | 로그인 **없이** `select * from tasks` | 0행 (또는 권한 오류). **1행이라도 나오면 실패** |
| 2 | `admin` 로그인 후 태스크 건수 | `service_role`로 센 전체 건수와 같다 |
| 3 | `lead` 로그인 후 | `edit` 팀 건수와 같고, **전체보다 적다** |
| 4 | `member` 로그인 후 | 자기 `owner_member_id` 건수와 같고 **1건 이상**, `lead`보다 적다 |
| 5 | 셋의 건수가 **서로 다르다** | 같으면 정책이 아무것도 구분하지 못하는 것이다 |
| 6 | `member`가 **남의 태스크**에 `update({status})` | 갱신 0행 (**완료 기준 2의 DB 층**) |
| 7 | `member`가 **자기 태스크**에 `update({status})` | 1행. 끝나면 원래 값으로 되돌린다 |
| 8 | `member`가 자기 태스크의 `title`을 바꾸려 시도 | 실패(컬럼 권한 없음). step 4의 `grant update (…)`를 재는 자리 |
| 9 | `member`가 `select * from uploads` | 0행/권한 오류 (`parse_result`에 본문이 있다) |
| 10 | `admin`이 `select * from profiles` | **1행** (자기 것만). 전사 admin이어도 프로필은 자기 것뿐이다 |

- 3·4의 기대값은 **하드코딩하지 말고** `service_role` 클라이언트로 세어 비교한다.
  숫자를 적어 두면 시드가 바뀐 날 조용히 통과한다.
- 실패하면 어느 항목이 왜 실패했는지 **번호와 기대/실제 숫자**로 찍고 종료 코드 1.
  업무명·담당자 이름·셀 값을 찍지 마라 (`X1`).
- 성공하면 표 형태로 건수를 찍는다. 이 출력을 `scripts/smoke/RESULT.md`에 **「T8 RLS 실효」**
  절로 붙인다 (기존 절을 지우지 마라).

### 4. 문서

- `scripts/smoke/README.md`의 표에 `rls-check.mjs` 한 줄을 추가한다.
- `scripts/db/README.md`를 새로 만들지 마라 — 스크립트가 하나다. `README.md`(루트)의 명령어
  절에 `npm run seed:auth` 한 줄을 더한다.

## Acceptance Criteria

```bash
npm run seed:auth                 # 1회차
npm run seed:auth                 # 2회차 — 에러 없이 끝나고 "이미 있음" 건수가 늘어난다
node --env-file=.env.local scripts/smoke/rls-check.mjs   # 10개 항목 전부 통과
npm run lint && npm run build && npm run test
git status --short                # .env.local이 스테이징되지 않았다
grep -rn 'T8_SEED_PASSWORD' .env.example                 # 빈 값으로 1줄
grep -rn 'password' scripts/db/seed-auth.ts | grep -v 'process.env\|T8_SEED_PASSWORD'  # 리터럴 비밀번호 0줄
grep -rn 'SERVICE_ROLE' scripts/smoke/rls-check.mjs      # 있으면 "이 키로 재면 안 된다" 가드뿐이다
```

MCP로 확인할 것 (`execute_sql`, 프로젝트 `ebeylvqmcungiitspaib`):

```sql
select count(*) from profiles;                                  -- 3
select count(*) from members;                                   -- 6
select count(*) from members where auth_user_id is not null;    -- 2
select count(*) from tasks where owner_member_id is not null;   -- 1 이상
```

## 검증 절차

1. 위 AC를 실행한다. **`rls-check.mjs`의 10개 항목 결과를 숫자와 함께 `summary`에 남긴다.**
2. 변이 확인 둘 (통과 후 되돌린다):
   - `rls-check.mjs`가 `service_role` 키를 쓰게 바꾼다 → 스크립트 자신의 가드가 막아야 한다
   - step 4의 `tasks_select_scoped` 정책을 `using (true)`로 잠깐 바꾼다 → 항목 3·4·5가
     실패해야 한다. **확인 후 반드시 원래 정책으로 되돌리고**, 되돌린 것을 `pg_policies`
     조회로 확인한다
3. 체크리스트:
   - 비밀번호가 표준출력·커밋·문서 어디에도 없는가?
   - `seed-auth.ts`가 이름을 하드코딩하지 않고 시드에서 계산하는가?
   - 백필이 `owner-link.ts`를 import해 쓰는가? (규칙이 두 벌이 아닌가)
   - 원격의 실업무 행·계약 행 수가 그대로인가?
4. `phases/t8-auth-rls/index.json`의 step 5를 갱신한다.

## 금지사항

- 계정을 **삭제하지 마라.** 있으면 재사용한다.
- `auth.users`에 직접 `insert`하지 마라. Admin API를 쓴다 — 직접 넣으면 비밀번호 해시·
  identity 행이 빠져 로그인이 되지 않는다.
- `service_role` 키로 RLS를 재지 마라. 그러면 이 step은 아무것도 증명하지 않는다.
- `src/` 아래 제품 코드를 고치지 마라. 이 step은 스크립트·문서·`.env.example`뿐이다.
  (`owner-link.ts`는 **import만** 한다.)
- 실명·실제 이메일 주소를 쓰지 마라.
- `scripts/db/seed-auth.ts`를 `next build` 경로에서 import하지 마라.
