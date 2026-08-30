/**
 * 인증 계층이 주고받는 타입 (T8). 결정 근거는 `PLAN.md`「8. 권한」의 **T8 착수 시 확정**.
 *
 * `ViewerRole`·`TeamKey`를 **여기서 다시 선언하지 않는다.** `ViewerRole`은 이미 마스킹
 * 판정의 입력이고(`lib/domain/extras-visibility.ts`), 두 벌이 되면 어느 쪽이 진짜 역할인지
 * 갈린다 — 한쪽에 값을 더하는 날 다른 쪽은 조용히 그대로 남는다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { ExtraValue, TeamKey } from '@/types/task';

/** 로그인한 사람 하나. 쿠키 세션을 `src/lib/auth/`가 이 모양으로 푼다 */
export interface Viewer {
  /** `auth.users.id` */
  userId: string;
  email: string;
  role: ViewerRole;
  /** `profiles.team_id`. `admin`은 null일 수 있다 */
  teamId: TeamKey | null;
  /**
   * `members.auth_user_id`로 이은 행의 id. 시트 담당자는 자유 입력 문자열이라 안 붙는
   * 이름이 남고, 그때 null이다 (`unknown_owner`). **`member` 범위에서 빠진다** — null을
   * 「내 것」으로 치면 담당자 미상 업무가 전원에게 보인다.
   */
  memberId: string | null;
  /**
   * 위 `memberId`가 가리키는 `members.name`. **공동 담당 판정이 이름으로 이뤄지기 때문에**
   * 함께 들고 다닌다 (`viewer-scope.ts`·`0013_task_authoring.sql` 1절) — `tasks.co_owner_names`가
   * 이름 배열이라 id로는 맞춰 볼 것이 없다. `memberId`가 null이면 이 값도 null이다.
   */
  memberName: string | null;
}

/**
 * 상단 바가 그리는 로그인 상태. **`Viewer`를 그대로 내리지 않는다** — 화면은 `userId`·
 * `teamId`·`memberId`를 쓸 일이 없고, 쓰지 않는 값을 클라이언트 번들까지 내려보낼 이유가
 * 없다 (`S6`). `role`이 `null`이면 로그인은 됐는데 `profiles` 행이 없는 계정이다.
 */
export interface SessionAccount {
  email: string;
  role: ViewerRole | null;
}

/**
 * `PATCH /api/tasks/[id]`가 저장소에 넘기는 전부. 목록의 근거는 `task-patch-schema.ts`
 * 머리말에 있다 — **`raw`·`source_*`는 없다.** 그쪽은 시트 원본과 감사 기록이다.
 * `extras`(팀 전용 칸)는 열려 있고, **라우트가 기존 값에 합쳐서** 넘긴다.
 *
 * `ownerNameRaw`·`coOwnerNames`는 **클라이언트가 보낼 수 없다** (`task-patch-schema.ts`).
 * 라우트가 id에서 **유도해** 채운다 — 둘을 따로 받으면 「담당자는 A인데 이름은 B」인 행이
 * 만들어지고, 그것은 데이터가 틀린 것으로 보인다.
 *
 * ⚠ 여기 있는 칸은 전부 **다음 시트 업로드가 덮어쓴다** (`ADR-001`). 그 사실을 감추지 않고
 *   화면이 말한다 (`task-detail-fields.tsx`).
 */
export interface TaskPatch {
  /** 업무명. **`null`을 받지 않는다** — 이름 없는 업무를 만들지 않는다 */
  title?: string;
  status?: string;
  /** 0~100 정수 또는 null(값을 지운다) */
  progress?: number | null;
  /** 아래 여섯은 전부 `null`이 「비운다」다 */
  priority?: string | null;
  riskStatus?: string | null;
  approvalStatus?: string | null;
  nextAction?: string | null;
  nextActionOwner?: string | null;
  delayReason?: string | null;
  note?: string | null;
  /** `YYYY-MM-DD` 또는 null. **문자열로만 다룬다** — `Date`는 하루를 어긋나게 한다 (`E4`) */
  assignedAt?: string | null;
  dueAt?: string | null;
  nextActionDue?: string | null;
  /**
   * 담당자로 세울 `members.id`. `null`은 「담당자를 비운다」다.
   *
   * 이것을 바꿀 수 있는 역할은 `canAssignOwner`가 정하고, DB에서는
   * `tasks_update_scope`의 `with check`가 같은 자리를 막는다 (`0008` 2절).
   */
  ownerMemberId?: string | null;
  /**
   * 팀 전용 칸 **전량**. 저장소는 이 객체로 통째 바꾸므로, 보낸 키만 바꾸는 합치기는
   * 라우트가 이미 끝낸 상태여야 한다 (`app/api/tasks/[id]/route.ts`).
   */
  extras?: Record<string, ExtraValue>;
  /** 표와 패널이 읽는 담당자 이름. **라우트만 채운다** (위 주석) */
  ownerNameRaw?: string | null;
  /**
   * 공동 담당자 이름들. 시트의 「공동 담당」 칸과 같은 자리다.
   *
   * `ownerNameRaw`와 마찬가지로 **라우트만 채운다** — 클라이언트는 `coOwnerMemberIds`(명부 id
   * 배열)를 보내고 라우트가 이름으로 옮긴다. 빈 배열은 「공동 담당을 비운다」다.
   */
  coOwnerNames?: string[];
}

/**
 * 단계 한 줄의 수정 (`PATCH /api/tasks/[id]`의 `stages`). **`TaskPatch`와 나란한 자리이고
 * 같은 규칙을 따른다** — 키 없음은 「안 건드린다」, `null`은 「비운다」다.
 *
 * 고칠 수 있는 칸이 넷뿐인 것이 요점이다. `seq`·`stageKey`·`stageLabel`·`slaDays`는 **시트가
 * 정하는 구조**라 화면에서 손대지 않는다 — 단계의 이름과 순서를 사람이 바꾸면 그 업무의
 * 타임라인이 시트의 것과 다른 물건이 되고, 다음 업로드가 통째로 되돌린다(단계는 교체다).
 *
 * `id`는 **바꾸는 대상**이지 바뀌는 값이 아니다.
 */
export interface TaskStagePatch {
  /** `task_stages.id`. 그 업무의 단계가 아니면 라우트가 거부한다 */
  id: string;
  plannedDate?: string | null;
  actualDate?: string | null;
  confirmStatus?: string | null;
  content?: string | null;
}

/**
 * `members` 한 행. **시트의 담당자 이름과 로그인 계정을 잇는 표다.**
 *
 * `types/task.ts`가 아니라 여기 있는 이유: 업무가 아니라 **신원**이고,
 * `Viewer.memberId`가 가리키는 대상이다 (과제 요구 7번의 접점 — `0001_init.sql` 주석).
 */
export interface MemberRecord {
  id: string;
  teamId: TeamKey;
  /** 시트에 적힌 이름 원문. `(team_id, name)`이 유니크다 */
  name: string;
  /** T8에서 채워진다. 아직 계정이 없는 구성원은 null */
  authUserId: string | null;
}

/**
 * `POST /api/tasks`가 저장소에 넘기는 전부 (`createTask`). **`TaskPatch`와 갈라 두는 이유**는
 * 필수 칸이 있기 때문이다 — 팀과 업무명 없이 만들어진 업무는 표에서 어느 줄인지 알 수 없다.
 *
 * 나머지 감사 칸(`sourceKey`·`sourceSheetTab`·`sourceRowIndex`·`extras`·`raw`)은 **저장소가
 * 채운다** (`task-repository.ts`의 `manualSourceKey`). 클라이언트도 라우트도 그 값을 정하지
 * 않는 것이 요점이다: 시트에서 온 행과 웹에서 만든 행을 가르는 것이 그 값들이고, 요청이
 * 그것을 고를 수 있으면 웹에서 만든 업무가 시트 행인 척할 수 있다.
 */
export interface TaskCreate {
  teamId: TeamKey;
  title: string;
  status: string | null;
  progress: number | null;
  priority: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  riskStatus: string | null;
  approvalStatus: string | null;
  note: string | null;
  /** 팀 전용 칸. 없으면 빈 객체다 — 시트에서 온 행과 달리 처음에는 비어 있다 */
  extras: Record<string, ExtraValue>;
  /** 라우트가 id에서 유도해 채운다 (`TaskPatch`와 같은 규칙) */
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
  coOwnerNames: string[];
  /**
   * 세울 단계 줄. **뼈대는 서버가 정한다** — 클라이언트는 `stageKey`와 값 넷만 보내고,
   * 라우트가 `stageTemplateOf`에서 `stageLabel`·`seq`·`slaDays`를 채운다. 그러지 않으면
   * 웹에서 만든 업무의 타임라인이 시트의 것과 다른 구조를 갖게 된다.
   *
   * 빈 배열이면 단계가 없는 업무다 — 촬영·마케팅팀이 그렇다.
   */
  stages: TaskStageSeed[];
}

/** 만들 때 넣는 단계 한 줄. `TaskStage`에서 저장소가 정하는 `id`·`taskId`만 뺀 모양이다 */
export interface TaskStageSeed {
  seq: number;
  stageKey: string;
  stageLabel: string;
  slaDays: number | null;
  plannedDate: string | null;
  actualDate: string | null;
  confirmStatus: string | null;
  content: string | null;
}
