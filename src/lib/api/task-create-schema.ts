/**
 * `POST /api/tasks`의 문 앞 검증 — **웹에서 손으로 만드는 업무 한 건.**
 *
 * ## 필드 표를 패치와 공유한다
 *
 * `TASK_EDITABLE_FIELDS`(`task-patch-schema.ts`)를 그대로 쓴다. 두 벌로 두면 한쪽만 늘어나는
 * 날이 오고, 그때 「만들 때는 넣을 수 있는데 고칠 수는 없는 칸」(또는 그 반대)이 생긴다.
 *
 * ## 패치와 다른 점 둘
 *
 * 1. **팀과 업무명이 필수다.** 둘 없이 만들어진 업무는 표에서 어느 줄인지 알 수 없고,
 *    팀이 없으면 어느 화면에도 속하지 않는다. 나머지는 전부 선택이다 — 「일단 이름만 걸어
 *    두고 나중에 채운다」가 회의 자리의 실제 동작이다.
 * 2. **감사 칸을 받지 않는다.** `sourceKey`·`sourceSheetTab`·`sourceRowIndex`·`raw`는
 *    저장소가 채운다 (`task-repository.ts`의 `manualSourceKey`·`MANUAL_SHEET_TAB`). 요청이
 *    그것을 고를 수 있으면 웹에서 만든 업무가 **시트 행인 척**할 수 있고, 그 순간 업무
 *    패널의 「출처」 줄이 거짓말을 한다. `extras`(팀 전용 칸)는 감사 칸이 아니라 **그 팀이
 *    쓰는 칸**이라 열려 있다 — 만들 때 못 넣으면 촬영팀 업무가 절반만 담긴 채 만들어진다.
 *
 * `.strict()`인 이유는 패치 스키마와 같다: 모르는 키를 조용히 버리면 클라이언트가 잘못된
 * 모양을 보내고도 200을 받는다.
 *
 * **권한을 판정하지 않는다.** 「이 역할이 이 팀에 만들 수 있나」는 `creatableTeams`(앱)와
 * `tasks_insert_scope`(DB, `0013`)가 진다 — 여기서 보는 것은 모양뿐이다. `teamId`를 enum으로
 * 좁히는 것도 모양 검사다: `teams` 테이블에 없는 팀은 외래키가 막지만, 그 오류는 503이 되고
 * 「그런 팀은 없다」는 400이어야 한다.
 */

import { z } from 'zod';

import { EXTRAS_FIELD, TASK_EDITABLE_FIELDS } from '@/lib/api/task-patch-schema';
import { teamIdSchema } from '@/lib/api/signup-schema';

/**
 * 공동 담당자의 `members.id` 목록. 패치와 **같은 상한**이다 — 한 업무에 명부 전체를 실어
 * 보내는 요청을 문 앞에서 자른다.
 */
const CO_OWNER_MAX = 20;

/** 한 업무의 단계 수 상한. 패치 쪽과 같은 수다 — 편집팀 탭이 셋이라 넉넉하다 */
const STAGES_MAX = 30;

export const taskCreateSchema = z
  .object({
    /** `teams.id`. 가입·재요청과 **같은 목록**을 본다 (`signup-schema.ts`) */
    teamId: teamIdSchema,
    /** 필수다. 패치 쪽 정의를 그대로 쓰므로 상한·trim 규칙이 갈리지 않는다 */
    title: TASK_EDITABLE_FIELDS.title,

    status: TASK_EDITABLE_FIELDS.status.optional(),
    progress: TASK_EDITABLE_FIELDS.progress.optional(),
    priority: TASK_EDITABLE_FIELDS.priority.optional(),
    assignedAt: TASK_EDITABLE_FIELDS.assignedAt.optional(),
    dueAt: TASK_EDITABLE_FIELDS.dueAt.optional(),
    nextAction: TASK_EDITABLE_FIELDS.nextAction.optional(),
    nextActionOwner: TASK_EDITABLE_FIELDS.nextActionOwner.optional(),
    nextActionDue: TASK_EDITABLE_FIELDS.nextActionDue.optional(),
    riskStatus: TASK_EDITABLE_FIELDS.riskStatus.optional(),
    approvalStatus: TASK_EDITABLE_FIELDS.approvalStatus.optional(),
    note: TASK_EDITABLE_FIELDS.note.optional(),
    /** 팀 전용 칸. 패치와 **같은 정의**라 민감 키 차단·상한이 갈리지 않는다 */
    extras: EXTRAS_FIELD.optional(),

    /** 이름이 아니라 id다 — 이름은 라우트가 명부에서 찾아 채운다 (`task-patch-schema.ts`) */
    ownerMemberId: z.uuid().nullable().optional(),
    coOwnerMemberIds: z.array(z.uuid()).max(CO_OWNER_MAX).optional(),

    /**
     * 세울 단계. **`stageKey`와 값 넷뿐이다** — 담당자를 id로만 받는 것과 같은 규율이다:
     * 이름·순서·SLA를 클라이언트가 정할 수 있으면 웹에서 만든 업무의 타임라인이 시트의 것과
     * 다른 구조를 갖고, 그 차이는 나중에 「왜 이 업무만 단계가 넷이지」로만 드러난다.
     * 라우트가 `stageTemplateOf(teamId, stageKey)`로 나머지를 채우고, 모르는 키는 400이다.
     */
    stages: z
      .array(
        z
          .object({
            stageKey: z.string().trim().min(1).max(50),
            plannedDate: TASK_EDITABLE_FIELDS.assignedAt.optional(),
            actualDate: TASK_EDITABLE_FIELDS.assignedAt.optional(),
            confirmStatus: TASK_EDITABLE_FIELDS.priority.optional(),
            content: TASK_EDITABLE_FIELDS.note.optional(),
          })
          .strict()
      )
      .max(STAGES_MAX)
      .optional(),
  })
  .strict();

export type TaskCreateInputBody = z.infer<typeof taskCreateSchema>;
