/**
 * 저장 모델 → API 응답. **감사용 원본 행이 응답에 실리지 않는다는 약속을 코드로 강제하는 곳**이다
 * (CLAUDE.md CRITICAL · `S6`).
 *
 * 강제 방법이 요점이다. 손으로 필드를 빼는 것만으로는 강제가 아니다 — 언젠가 하나 빠뜨리고,
 * 빠뜨린 그날 전 조직의 연락처가 API로 나간다. 그래서 `.strict()` 스키마를 두고 **변환 결과를
 * 반드시 그 스키마에 통과시킨다.** 지정되지 않은 키가 섞이면 조용히 지워지는 대신 던진다.
 * 조용히 통과하는 것보다 500이 낫다.
 *
 * 여기서 새로 계산하는 것은 없다. 마스킹은 `maskExtras`, 화면 칸은 `toDisplayStatus`,
 * 판정은 `deriveTaskFlags`(호출자가 미리 계산)의 결과를 옮겨 담을 뿐이다 — 규칙이 두 곳에
 * 생기면 화면과 API의 판정이 갈라진다 (`ADR-006`).
 */

import { z } from 'zod';

import { DISPLAY_STATUS_LABELS, toDisplayStatus } from '@/lib/domain/display-status';
import { maskExtras, type ViewerRole } from '@/lib/domain/extras-visibility';
import type { TaskFlags } from '@/lib/domain/task-derive';
import type { TaskResponse } from '@/types/api';
import type { ExtraValue, Task } from '@/types/task';

/** 하이퍼링크 셀은 텍스트와 URL을 둘 다 보존한다 — T6가 앵커를 그릴 근거다 (`S7`) */
const extraValueSchema: z.ZodType<ExtraValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({ text: z.string().nullable(), hyperlink: z.string() }).strict(),
]);

const extrasSchema = z.record(z.string(), extraValueSchema);

const flagsSchema = z
  .object({
    semantic: z
      .enum([
        'planned',
        'in_progress',
        'review',
        'approval',
        'rework',
        'pending_release',
        'done',
        'hold',
        'cancelled',
      ])
      .nullable(),
    dday: z.number().nullable(),
    isOverdue: z.boolean(),
    isDueSoon: z.boolean(),
    isStale: z.boolean(),
    hasNoOwner: z.boolean(),
    hasUnknownOwner: z.boolean(),
    hasNoDueDate: z.boolean(),
  })
  .strict();

/**
 * 응답에 실릴 수 있는 필드의 **전량 목록**이다. 여기 없는 키는 `.strict()`가 던진다.
 *
 * 저장 모델의 필드를 `Omit`으로 덜어내지 않고 하나씩 적은 이유: `Omit`은 저장 모델에 새 필드가
 * 생기면 그것을 **자동으로 통과시킨다.** 다음에 추가될 필드가 안전하다는 보장이 어디에도 없으므로
 * 기본값을 「나가지 않는다」로 두고, 내보내려면 이 목록에 손으로 적게 한다.
 */
export const taskResponseSchema: z.ZodType<TaskResponse> = z
  .object({
    id: z.string(),
    teamId: z.enum(['edit', 'shoot', 'marketing']),
    departmentId: z.string().nullable(),
    sourceKey: z.string(),
    title: z.string().nullable(),
    ownerMemberId: z.string().nullable(),
    ownerNameRaw: z.string().nullable(),
    coOwnerNames: z.array(z.string()),
    status: z.string().nullable(),
    approvalStatus: z.string().nullable(),
    priority: z.string().nullable(),
    riskStatus: z.string().nullable(),
    progress: z.number().nullable(),
    assignedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    nextAction: z.string().nullable(),
    nextActionOwner: z.string().nullable(),
    nextActionDue: z.string().nullable(),
    delayReason: z.string().nullable(),
    note: z.string().nullable(),
    extras: extrasSchema,
    lastProgressAt: z.string().nullable(),
    sourceUploadId: z.string().nullable(),
    sourceSheetTab: z.string(),
    sourceRowIndex: z.number(),
    flags: flagsSchema,
    displayStatus: z.enum(['planned', 'in_progress', 'review', 'done', 'overdue', 'muted']),
    statusLabel: z.string(),
  })
  .strict();

/**
 * 업무 하나를 응답 모양으로. **반드시 스키마를 통과한 값을 돌려준다** — 변환만 하고 검증을
 * 건너뛰면 위 `.strict()`가 장식이 된다.
 */
export function toTaskResponse(task: Task, flags: TaskFlags, role: ViewerRole): TaskResponse {
  const displayStatus = toDisplayStatus(flags.semantic, flags);

  return taskResponseSchema.parse({
    id: task.id,
    teamId: task.teamId,
    departmentId: task.departmentId,
    sourceKey: task.sourceKey,
    title: task.title,
    ownerMemberId: task.ownerMemberId,
    ownerNameRaw: task.ownerNameRaw,
    coOwnerNames: task.coOwnerNames,
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    riskStatus: task.riskStatus,
    progress: task.progress,
    assignedAt: task.assignedAt,
    dueAt: task.dueAt,
    nextAction: task.nextAction,
    nextActionOwner: task.nextActionOwner,
    nextActionDue: task.nextActionDue,
    delayReason: task.delayReason,
    note: task.note,
    // 직접 거르지 않는다. 민감 키 목록이 두 곳에 생기면 한쪽만 늘어난다
    extras: maskExtras(task.extras, role),
    lastProgressAt: task.lastProgressAt,
    sourceUploadId: task.sourceUploadId,
    sourceSheetTab: task.sourceSheetTab,
    sourceRowIndex: task.sourceRowIndex,
    flags,
    displayStatus,
    statusLabel: DISPLAY_STATUS_LABELS[displayStatus],
  });
}

/**
 * 목록 전체. `flags`의 키는 `task.id`이며 (`deriveAllFlags`가 만든 모양),
 * **빠진 건이 있으면 던진다** — 기본 플래그로 채우면 지연 업무가 정상으로 보인다.
 */
export function toTaskListResponse(
  tasks: readonly Task[],
  flags: ReadonlyMap<string, TaskFlags>,
  role: ViewerRole
): TaskResponse[] {
  return tasks.map((task) => {
    const taskFlags = flags.get(task.id);
    if (taskFlags === undefined) {
      throw new Error('파생 판정이 없는 업무가 있습니다.');
    }
    return toTaskResponse(task, taskFlags, role);
  });
}
