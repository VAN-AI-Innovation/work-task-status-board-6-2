/**
 * API 응답 DTO. **저장 모델(`types/task.ts`)과 다른 타입인 것이 요점이다** —
 * `Task`에는 감사용 원본 행이 붙어 있고 그것은 실명·연락처·문의자 계정 덩어리다
 * (CLAUDE.md 보안 규칙 · `S6`).
 *
 * 여기에는 **타입만** 둔다. zod 스키마는 검증 로직이라 `src/lib/api/`가 지고 TDD 가드가
 * 강제한다. 타입만으로는 강제가 아니다 — `as`나 `any`가 한 번 끼면 조용히 뚫린다.
 */

import type { ApiErrorCode } from '@/lib/api/api-error';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { TaskFlags } from '@/lib/domain/task-derive';
import type { StorageDriver, StorageMode } from '@/lib/store/store-factory';
import type { DisplayStatus, Task, TaskStage, TeamKey } from '@/types/task';

/** 모든 조회 응답에 함께 실리는 화면 상태. 배너·「마지막 반영」 표시의 근거다 */
export interface ApiMeta {
  /** KST 기준 오늘 `YYYY-MM-DD` */
  today: string;
  /** 마지막으로 시트를 반영한 시각 (ISO) 또는 null */
  lastSyncedAt: string | null;
  driver: StorageDriver;
  /** `demo`와 `fallback`은 둘 다 memory지만 하나는 의도고 하나는 사고다 (`ADR-005`) */
  mode: StorageMode;
  readOnly: boolean;
  role: ViewerRole;
}

/**
 * 저장 모델에서 감사용 원본 행을 **뺀** 것 + 파생 판정.
 * 그 필드가 없다는 것이 이 타입의 존재 이유이며, 실제 강제는
 * `lib/api/task-response.ts`의 `.strict()` 스키마가 한다.
 */
export type TaskResponse = Omit<Task, 'raw'> & {
  flags: TaskFlags;
  /** `toDisplayStatus`의 결과. 화면 5색 중 어느 칸인지 */
  displayStatus: DisplayStatus;
  /** `DISPLAY_STATUS_LABELS`의 한글. 배지는 색만으로 구분되지 않는다 (`UI_GUIDE.md`) */
  statusLabel: string;
};

export interface TaskDetailResponse {
  task: TaskResponse;
  /** 민감 키가 없어 마스킹 대상이 아니다. `TaskEvent`는 싣지 않는다 */
  stages: TaskStage[];
}

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/**
 * 팀 합류 요청 한 건 (T11). `pending_requests()`가 낸 행을 카멜케이스로 옮긴 것이며,
 * **이메일이 실리는 것이 의도다** — 리더가 요청자를 알아보려면 이름만으로는 부족하다.
 *
 * 그 노출을 좁히는 것은 앱이 아니라 DB다. `pending_requests()`가 `active` admin·lead에게만
 * 행을 내므로(`0005` 4-1) 이 타입이 실려 나가는 응답 자체가 그 둘에게만 만들어진다.
 * 실제 강제는 `lib/api/join-request-schema.ts`의 `.strict()` 스키마가 한다 — 타입만으로는
 * 강제가 아니다.
 */
export interface JoinRequest {
  userId: string;
  /** 가입 폼에 적은 이름. 트리거가 비어 있으면 `null`로 접는다 (`0005` 3절) */
  displayName: string | null;
  email: string | null;
  /** 트리거가 `teams`에 실재하는 값일 때만 넣는다. `null`이면 admin만 볼 수 있다 */
  teamId: TeamKey | null;
  /** `rejected`도 목록에 남는다 — 거절이 재요청으로 되돌아오는 것을 리더가 본다 */
  status: JoinRequestStatus;
  /** ISO. `profiles.created_at` */
  createdAt: string;
}

export type JoinRequestStatus = 'pending' | 'rejected';

/**
 * 조회·승인·거절 **세 라우트가 모두** 돌려주는 모양이다. 승인 직후 화면이 자기 힘으로
 * 목록을 다시 계산하면 그것이 곧 계산 로직이므로, 서버가 갱신된 목록을 함께 준다.
 */
export interface JoinRequestsResponse {
  requests: JoinRequest[];
}
