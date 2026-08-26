/**
 * 인증 계층이 주고받는 타입 (T8). 결정 근거는 `PLAN.md`「8. 권한」의 **T8 착수 시 확정**.
 *
 * `ViewerRole`·`TeamKey`를 **여기서 다시 선언하지 않는다.** `ViewerRole`은 이미 마스킹
 * 판정의 입력이고(`lib/domain/extras-visibility.ts`), 두 벌이 되면 어느 쪽이 진짜 역할인지
 * 갈린다 — 한쪽에 값을 더하는 날 다른 쪽은 조용히 그대로 남는다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { TeamKey } from '@/types/task';

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
 * `PATCH /api/tasks/[id]`가 받는 전부. **두 필드다** (`UC-16` 「내 업무 상태·진행률 수정」).
 * `note`·`dueAt`·`ownerNameRaw`를 열지 않는다 — 시트가 진실의 원천이라 재업로드가 덮어쓸
 * 필드를 화면에서 고치게 하면 사용자는 자기 수정이 사라지는 것을 본다 (`ADR-008`).
 */
export interface TaskPatch {
  status?: string;
  /** 0~100 정수 또는 null(값을 지운다) */
  progress?: number | null;
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
