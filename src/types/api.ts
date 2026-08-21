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
import type { DisplayStatus, Task, TaskStage } from '@/types/task';

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
