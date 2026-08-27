# Step 3: owner-link

## 읽어야 할 파일

- `CLAUDE.md` — 비즈니스 로직은 `src/lib/`에만 · 파서는 하드 실패시키지 않는다(검증 실패·
  미등록 값은 보존한다) · `src/lib/` 파일명 전역 유니크
- `docs/TICKETS.md` — T8 **범위 In**의 「`members.auth_user_id` 연결 — 시트의 담당자 이름과
  로그인 계정을 잇는다」, **리스크·미결**의 「매칭 실패는 `unknown_owner`로 두고 `member`
  범위 판정에서 제외한다」
- step 0 산출물: `docs/PLAN.md`「T8 착수 시 확정」의 **결정 D**
- step 2 산출물: `MemberRecord`, `TaskRepository.listMembers()`
- 고쳐야 할 파일:
  - `src/lib/upload/upload-commit.ts` — `applyPayload`가 `upsertTasks`를 부르기 **직전**이
    이 step이 끼어드는 자리다
- 참고:
  - `src/lib/store/task-repository.ts` — `TaskUpsertInput.ownerMemberId`
  - `src/lib/sheet/cell-normalizer.ts` — 문자열을 다듬는 기존 규칙. **새 정규화 규칙을
    만들기 전에 여기 있는 것을 먼저 본다**
  - `src/lib/domain/viewer-scope.ts` (step 1) — 이 step이 채우는 `ownerMemberId`가
    `member` 범위 판정의 **유일한 근거**다

## 배경

step 1이 정한 `member` 범위는 `task.ownerMemberId === viewer.memberId`인데, **지금 원격 DB의
`tasks.owner_member_id`는 전부 `null`이고 `members` 테이블은 0행이다.** 그대로 두면
`member`로 로그인한 사람은 완료 기준 1에서 **항상 빈 화면**을 보고, 그것이 「권한이 잘
걸렸다」인지 「연결이 안 됐다」인지 아무도 구별할 수 없다.

이 계층이 하는 일은 한 문장이다: **업로드를 확정할 때, 시트의 담당자 이름과 같은 이름의
구성원이 같은 팀에 있으면 그 id를 태스크에 적는다.** 없으면 `null`로 둔다.

**이름 매칭은 원래 신뢰할 수 없다.** 동명이인·오타·공백·직함이 섞인 자유 입력이다. 그래서
이 계층의 규율은 「최대한 붙인다」가 아니라 **「확실할 때만 붙인다」**이다 — 잘못 붙은 한 건은
남의 업무를 내 것으로 만들고, 그것이 곧 권한 사고다.

## 작업

### 1. `src/lib/upload/owner-link.test.ts` 를 **먼저** 쓴다

```ts
/** 정규화된 이름 → 구성원 id. 같은 팀 안에서만 유효하다 */
export function buildOwnerIndex(members: readonly MemberRecord[]): OwnerIndex;

export interface OwnerLinkResult {
  tasks: TaskUpsertInput[];
  /** id가 붙은 건수 */
  linked: number;
  /** 이름은 있는데 못 붙인 건수 (`unknown_owner`) */
  unresolved: number;
}

export function linkOwners(
  tasks: readonly TaskUpsertInput[],
  members: readonly MemberRecord[]
): OwnerLinkResult;
```

**매칭 규칙 — 이 다섯 줄이 전부다.**

1. **같은 팀 안에서만** 본다 (`task.teamId === member.teamId`). 팀을 넘나들면 동명이인이
   곧바로 권한 사고가 된다.
2. 비교 키는 `ownerNameRaw`를 **정규화**한 값이다: `trim` → 내부 연속 공백을 하나로 →
   `normalize('NFC')`. 소문자화는 하지 않는다 (한글에 무의미하고, 영문 이름의 대소문자가
   서로 다른 사람일 수 있다).
3. `ownerNameRaw`가 `null`·빈 문자열이면 **붙이지 않고 `unresolved`로도 세지 않는다.**
   담당자가 애초에 없는 행이다.
4. **정규화 후 같은 키가 한 팀에 둘 이상이면 그 키는 통째로 버린다.** 붙이지 않고
   `unresolved`로 센다. `(team_id, name)`이 DB에서 유니크여도 정규화가 둘을 같은 키로 접을 수
   있고, 그때 「먼저 온 사람」이 이기게 두면 그것이 곧 잘못 붙은 한 건이다.
5. **이미 `ownerMemberId`가 있는 태스크는 건드리지 않는다.**

테스트 케이스 (전부 리터럴. 픽스처를 읽지 마라):

- 정확히 같은 이름 → `linked: 1`, `ownerMemberId`가 그 구성원 id
- **다른 팀의 같은 이름 → 붙지 않는다.** `unresolved: 1` (핵심 케이스)
- `'  홍  길동 '` ↔ `'홍 길동'` → 붙는다 (공백 정규화)
- 한글 자모 분리형(NFD) ↔ 완성형(NFC)이 같은 이름이면 붙는다
- **한 팀에 정규화 충돌이 있으면(`'김 철수'`·`'김철수 '`가 서로 다른 행) 둘 다 안 붙는다**
- `ownerNameRaw: null` → `linked: 0`, `unresolved: 0`
- `ownerNameRaw: ''`·`'   '` → 같음
- 이미 `ownerMemberId`가 있는 행은 그대로 (덮어쓰지 않는다)
- **입력 배열·입력 객체를 고치지 않는다** (호출 후 원본 `ownerMemberId`가 그대로 `null`)
- `members`가 빈 배열이면 전건 `unresolved` (이름이 있는 건만)
- `coOwnerNames`는 보지 않는다 — 공동 담당자에 이름이 있어도 붙지 않는다

### 2. `src/lib/upload/owner-link.ts` 를 구현한다

- 순수 함수다. 저장소·시간·환경변수를 보지 않는다.
- 던지지 않는다. 어떤 입력에도 결과를 돌려준다 (`CLAUDE.md`「파서는 하드 실패시키지 말 것」의
  결을 그대로 따른다).
- 정규화 함수를 이 파일에 두되, `cell-normalizer.ts`에 **이미 같은 것이 있으면 그것을 쓴다.**
  먼저 읽고 판단하라. 두 벌이 되면 시트 값과 구성원 이름이 서로 다른 규칙으로 다듬어진다.
- 경고 문자열에 **이름을 담지 마라.** 건수만 돌려준다 (`S6`·`X1`).

### 3. `upload-commit.ts`에 잇는다 — **한 곳에서만**

`applyPayload`에서 `repo.upsertTasks`를 부르기 직전에 넣는다.

```ts
const members = await repo.listMembers();
const linked = linkOwners(payload.tasks, members);
const taskResult = await repo.upsertTasks(linked.tasks, options);
```

- `listMembers()`가 던지면 **삼키지 마라.** 기존 `try`가 그것을 잡아
  `STORAGE_UNAVAILABLE`로 접는다 — 저장소가 죽었는데 담당자 연결만 조용히 건너뛰면
  그 업로드는 영구히 `unknown_owner`인 채로 남는다.
- `UploadSummary`에 필드를 **추가하지 마라.** 그 타입은 업로드 이력에 저장되고 화면이 읽는다.
  건수를 남기려면 문서(`ARCHITECTURE.md` 「업로드 상태 전이」)가 먼저다.
- `upload-commit.test.ts`에 케이스 둘을 더한다:
  - 구성원이 있으면 `upsertTasks`가 **id가 붙은** 태스크를 받는다 (`repo`를 스텁으로 두고
    받은 인자를 잰다 — 「결과가 그렇더라」가 아니라 「그 인자로 불렀다」를 잰다)
  - `listMembers()`가 던지면 `STORAGE_UNAVAILABLE`이고 `markFailed`가 불린다

## Acceptance Criteria

```bash
npm run test -- src/lib/upload/owner-link.test.ts
npm run test -- src/lib/upload/upload-commit.test.ts
npm run lint && npm run build && npm run test
grep -rn 'listMembers' src/lib/upload/          # upload-commit.ts 한 줄만 (제품 코드 기준)
grep -n 'Date.now\|new Date' src/lib/upload/owner-link.ts   # 0줄
grep -rn 'ownerNameRaw' src/lib/domain/viewer-scope.ts      # 0줄 (권한이 이름으로 서면 안 된다)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 변이 테스트 넷을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - 팀 비교를 지운다 (이름만 본다) → 「다른 팀의 같은 이름」이 잡아야 한다
   - 정규화 충돌에서 「먼저 온 사람이 이긴다」로 바꾼다 → 충돌 케이스가 잡아야 한다
   - 이미 있는 `ownerMemberId`를 덮어쓰게 바꾼다 → 해당 케이스가 잡아야 한다
   - `applyPayload`에서 `linkOwners` 호출을 뺀다 → `upload-commit` 케이스가 잡아야 한다
3. 체크리스트:
   - `linkOwners`가 입력 객체를 고치지 않는가?
   - 매칭 실패가 **경고나 예외가 아니라 조용한 `null`**인가? (티켓의 「무시」다)
   - 어떤 테스트도 실명을 쓰지 않았는가? (`홍길동`·`김철수` 같은 관용 가명만)
4. `phases/t8-auth-rls/index.json`의 step 3을 갱신한다.

## 금지사항

- 구성원 행을 **자동으로 만들지 마라.** 시트에 새 이름이 나왔다고 `members`에 넣으면
  오타 하나가 신원 테이블에 영구히 남고, 그 행에 나중에 누가 계정을 붙이면 권한이 생긴다.
  구성원은 사람이 만든다 (step 5의 시드 스크립트).
- `tasks.owner_name_raw`를 지우거나 바꾸지 마라. 원문은 남는다.
- 부분 일치·유사도(레벤슈타인 등)를 쓰지 마라. 「확실할 때만 붙인다」가 이 계층의 규율이다.
- `src/lib/domain/`·`src/lib/store/`·`src/app/`을 고치지 마라.
- 기존 테스트를 깨뜨리지 마라.
