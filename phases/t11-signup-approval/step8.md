# Step 8: members-tab

## 읽어야 할 파일

- `/docs/UI_GUIDE.md`
- `src/lib/domain/member-tree.ts` (step 7) — `buildMemberTree` · `MemberTree`
- `src/app/team/requests/page.tsx` (step 6) — 이 화면이 본뜰 구조. 권한 판정·404 처리
- `src/components/team/` (step 6) — 컴포넌트 규율
- `src/components/shell/app-sidebar.tsx` — 역할별 네비 (step 6이 고쳤다)
- `src/lib/api/same-origin.ts` (step 4) — Origin 검사
- `src/lib/view/role-label.ts` · `src/lib/view/team-slug.ts`
- `src/app/api/team/requests/approve/route.ts` (step 5) — 상태 변경 라우트의 본보기
- `supabase/migrations/0005_signup_approval.sql` (step 0)

step 0이 만든 것 중 이 step이 쓰는 것:

| 함수 | 호출 자격 | 하는 일 |
|---|---|---|
| `member_directory()` | active admin만 | 전 팀의 profiles + members 조인 행 |
| `set_role(target, new_role, new_team)` | active admin만 | `new_role`은 `'lead'`·`'member'`만 |

`set_role`은 **`'admin'`을 받지 않는다.** 최초 admin은 SQL로만 심는다 — 화면에서 admin을
만들 수 있으면 계정 하나가 뚫렸을 때 admin이 번식한다.

## 작업

### 1. 화면 — `src/app/members/page.tsx`

서버 컴포넌트다. **자기 API 라우트를 fetch하지 마라.** 사용자 JWT 클라이언트로
`rpc('member_directory')`를 부르고, 그 행을 **`buildMemberTree`에 넘긴다.** 화면이
직접 묶지 마라 — 트리 구성은 step 7의 순수 함수가 이미 진다.

`admin`이 아니면 `notFound()`. step 6과 같은 이유로 403이 아니라 404다.
권한 판정은 `src/lib/domain/`의 순수 함수로 두고, step 6이 만든 파일에 함수를 하나 더
얹을지 새 파일을 만들지는 코드를 읽고 판단하라 (파일명 전역 유니크 규칙을 지킬 것).

### 2. 트리 컴포넌트 — `src/components/members/`

props 받아 JSX만 뱉는다. 계산·fetch 금지.

```
편집팀
├─ 리더  김OO  (kim@…)
└─ 팀원  이OO  (lee@…)
        박OO  ⏳ 승인 대기
촬영·기획팀
└─ 리더 없음
마케팅·관리팀
├─ 리더  최OO
└─ 팀원  정OO
소속 없음
└─ 대표·실장  한OO
```

- 들여쓰기만으로 상하관계를 표현하지 말고 **중첩된 `<ul>`**로 그린다. 스크린리더가
  트리를 읽을 수 있어야 하고, 들여쓰기는 시각 효과일 뿐이다.
- `leads`가 빈 팀은 「리더 없음」을 **명시적으로 적는다.** 빈 줄로 두면 「리더가 없다」와
  「아직 안 불러왔다」가 같아 보인다.
- `pending`·`rejected`는 배지로 구분한다. 색만으로 구분하지 마라 — 글자를 함께 둔다.
- 역할 이름은 `roleLabel()`, 팀 이름은 `teamLabel()`을 쓴다. 여기서 다시 적지 마라.

### 3. 승격·해제 라우트 — `POST /api/members/role`

```
export const runtime = 'nodejs'
1. Origin 검사 (isSameOrigin). 다르면 403
2. zod 검증 — { userId: uuid, role: z.enum(['lead','member']), teamId: <TeamKey enum>.optional() }
3. 사용자 JWT로 rpc('set_role')
4. 성공 → 갱신된 디렉토리를 다시 실어 돌려준다
5. DB 예외 → 403 FORBIDDEN (사유를 구분해 알리지 마라)
```

**zod에서 `'admin'`을 받지 마라.** DB 함수가 이미 거부하지만, 앱 스키마에 그 값이 있으면
다음 사람이 「DB만 고치면 되겠네」라고 생각한다. **두 곳 모두 좁혀 둔다.**

`teamId`가 필요한 경우: `member`를 `lead`로 올릴 때 어느 팀의 리더인지 정해야 한다.
`profiles.team_id`가 이미 있으면 그대로 쓰고, 없으면(admin이었거나 팀 미배정) 인자를
요구한다. 이 규칙을 **DB 함수와 앱 중 한 곳에만** 두어라 — 두 벌이면 어긋난다.
step 0이 `set_role`에 `new_team`을 둔 것이 그 자리이므로 **DB가 진다.**

### 4. 네비게이션

`app-sidebar.tsx`에 「멤버」를 더한다. `admin`에게만 보인다. step 6이 이미 역할별 네비를
만들었으므로 **그 구조를 그대로 쓰고 다시 짓지 마라.**

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/app/api/members/ src/lib/domain/

# 서버 컴포넌트가 자기 API를 fetch하지 않는지 (결과가 비어 있어야 한다)
grep -rn "fetch(" src/app/members/page.tsx

# 컴포넌트에 계산이 없는지 (결과가 비어 있어야 한다)
grep -rn "rpc(\|getStorage\|createClient\|buildMemberTree" src/components/members/

# 'admin'을 승격 대상으로 받지 않는지 (결과가 비어 있어야 한다)
grep -n "'admin'" src/app/api/members/role/route.ts

# 런타임 명시
grep -n "runtime = 'nodejs'" src/app/api/members/role/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `lead`·`member` 역할로 `/members`에 접근하면 404인지 테스트가 있는지 확인한다.
3. 트리가 **중첩 `<ul>`**로 그려지는지, 「리더 없음」이 명시되는지 확인한다.
4. 아키텍처 체크리스트:
   - 서버 컴포넌트가 자기 API 라우트를 fetch하지 않는가?
   - 컴포넌트가 props 받아 JSX만 뱉는가?
   - 트리 구성이 `buildMemberTree`(step 7)에서 오는가? 화면이 다시 묶지 않는가?
   - `src/app/api/**`에 `export const runtime = 'nodejs'`가 있는가?
   - `src/lib/` 아래 파일명이 전역 유니크한가?
5. `phases/t11-signup-approval/index.json`의 step 8을 업데이트한다.
   `summary`에 화면·라우트 경로를 적는다.

## 금지사항

- **화면에서 `'admin'`으로 승격할 수 있게 하지 마라.** 이유: 3번 절에 근거가 있다.
- **화면이 트리를 다시 묶지 마라.** 이유: step 7의 순수 함수가 그 일을 진다. 두 벌이 되면
  테스트가 보는 것과 화면이 그리는 것이 갈린다.
- **서버 컴포넌트가 자기 API 라우트를 fetch하지 마라.** 이유: CLAUDE.md CRITICAL이다.
- **403 화면을 그리지 마라. 404를 내라.** 이유: step 6과 같다 — 기능의 존재가 정보다.
- **`service_role`을 쓰지 마라.** 이유: 호출 자격 검사가 `auth.uid()`에 기댄다.
- 기존 테스트를 깨뜨리지 마라
