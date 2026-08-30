# Step 7: member-tree

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 「권한 (T8)」
- `/docs/ADR.md` — ADR-006 (집계·판정은 `lib/domain/`의 JS 순수 함수)
- `src/lib/domain/viewer-scope.ts` — 순수 판정 함수의 본보기. 머리말의 규율을 그대로 따른다
- `src/lib/domain/progress-stats.ts` — 집계 함수의 본보기 (`now`를 인자로 받는 규율)
- `src/lib/view/team-slug.ts` — `TEAM_LABELS`의 키 순서
- `src/types/auth.ts` · `src/types/task.ts` — `ViewerRole` · `TeamKey`
- `supabase/migrations/0005_signup_approval.sql` (step 0) — `member_directory()`가 내는 행 모양

step 0의 `member_directory()`는 active admin만 부를 수 있고, 전 팀의 `profiles` +
`members` 조인 행을 낸다. **트리는 만들어 주지 않는다** — 그것이 이 step의 일이다.

## 작업

**이 step은 순수 함수 하나와 그 테스트뿐이다. 화면도 API도 만들지 마라.**

### `src/lib/domain/member-tree.ts`

```ts
export interface DirectoryRow {
  userId: string | null;      // 계정이 없는 명부 구성원은 null
  memberId: string | null;    // 계정만 있고 members에 안 붙은 사람은 null
  displayName: string | null;
  memberName: string | null;  // members.name (시트에서 온 이름)
  email: string | null;
  role: ViewerRole | null;
  status: 'pending' | 'active' | 'rejected' | null;
  teamId: TeamKey | null;
}

export interface MemberNode { /* 한 사람 */ }

export interface TeamBranch {
  teamId: TeamKey;
  leads: MemberNode[];
  members: MemberNode[];
}

export interface MemberTree {
  teams: TeamBranch[];
  /** 팀이 없는 사람 — admin, team_id가 null인 대기 계정 */
  unassigned: MemberNode[];
}

export function buildMemberTree(rows: readonly DirectoryRow[]): MemberTree
```

규칙:

- **팀 순서는 `TEAM_LABELS`의 키 순서를 따른다.** 행이 오는 순서에 기대지 마라 — DB의
  정렬이 바뀌면 화면의 팀 순서가 조용히 바뀐다.
- **행이 하나도 없는 팀도 배열에 남긴다.** 빈 팀이 사라지면 「그 팀이 없다」와 「그 팀에
  사람이 없다」가 화면에서 같아 보인다. 알림의 0건 묶음과 같은 규칙이다 (`role-layout.ts`).
- `leads`가 **배열인 것이 의도다.** 한 팀에 리더가 둘일 수 있는지 지금 규칙이 정하지
  않았고, 배열이면 둘이 생겨도 화면이 깨지지 않는다. `leads.length === 0`인 팀은
  화면이 「리더 없음」이라고 말할 수 있어야 한다.
- **`admin`은 어느 팀 가지에도 넣지 마라.** `profiles.team_id`가 `null`일 수 있고
  (`0003_auth_rls.sql`의 컬럼 주석), 전사를 보는 사람이라 팀 아래 놓이면 상하관계가 거짓이 된다.
  `unassigned`로 보낸다.
- **`pending`·`rejected`도 트리에 넣되 상태를 그대로 싣는다.** 화면이 흐리게 그리거나
  배지를 붙일 수 있어야 한다. 여기서 걸러 버리면 어드민이 「승인 대기 중인 사람이 있다」는
  사실을 이 화면에서 못 본다.
- **정렬은 결정적이어야 한다.** 같은 입력에 같은 순서가 나와야 한다. 이름이 같을 수 있으므로
  최종 tie-break를 `userId`·`memberId` 같은 안정 키로 잡아라.
- **`Date.now()`·`new Date()`를 부르지 마라** (CLAUDE.md CRITICAL). 이 함수는 시각을 쓰지
  않지만, 나중에 「최근 가입순」을 넣고 싶어지면 `now`를 **인자로 받아라.**
- 입력 배열을 **고치지 마라.** 정렬은 사본에 한다.

### 파일명

`src/lib/` 아래 파일명은 **전역 유니크**해야 한다 (TDD 가드가 basename만 본다). 작업 전
`src/lib/`를 훑어 `member-tree.ts`·`member-tree.test.ts`가 이미 없는지 확인하라.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/domain/member-tree.test.ts

# 시계를 부르지 않는지 (결과가 비어 있어야 한다)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/member-tree.ts

# basename 충돌이 없는지 — 각각 1이어야 한다
find src/lib -name 'member-tree.ts' | wc -l
find src/lib -name 'member-tree.test.ts' | wc -l
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 테스트가 아래를 전부 덮는지 확인한다:
   - 빈 입력 → 팀 셋이 전부 빈 가지로 남는다
   - `admin` → `unassigned`
   - 리더가 없는 팀 → `leads`가 빈 배열
   - 같은 입력을 순서만 섞어 넣으면 **같은 결과**가 나온다 (결정적 정렬)
   - 입력 배열이 변형되지 않는다
3. 아키텍처 체크리스트:
   - 순수 함수인가? 저장소·환경변수·시계를 보지 않는가?
   - `src/lib/domain/`에 있는가?
   - SQL 집계를 쓰지 않았는가? (memory·supabase 두 구현의 결과가 갈라진다)
   - 파일명이 전역 유니크한가?
4. `phases/t11-signup-approval/index.json`의 step 7을 업데이트한다.
   `summary`에 `buildMemberTree`의 시그니처와 `MemberTree` 타입 모양을 적는다 —
   step 8이 그것을 그린다.

## 금지사항

- **화면·API·라우트를 만들지 마라.** 이유: 이 step은 도메인 레이어 하나만 다룬다.
  섞으면 순수 함수의 테스트가 화면 사정에 끌려다닌다.
- **SQL로 트리를 만들지 마라.** 이유: CLAUDE.md CRITICAL — 집계·판정은 JS 순수 함수로 한다.
- **`Date.now()`·`new Date()`를 부르지 마라.** 이유: CLAUDE.md CRITICAL.
- **빈 팀을 결과에서 빼지 마라.** 이유: 규칙 2번에 근거가 있다.
- 기존 테스트를 깨뜨리지 마라
