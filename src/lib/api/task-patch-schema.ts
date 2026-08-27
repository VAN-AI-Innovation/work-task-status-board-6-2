/**
 * `PATCH /api/tasks/[id]`의 문 앞 검증. **허용 필드는 `status`·`progress` 둘이 전부다**
 * (`PLAN.md`「T8 착수 시 확정」 결정 F · `UC-16`).
 *
 * 늘리지 않는 이유는 스코프가 아니라 데이터의 출처다 — 시트가 진실의 원천이고
 * (`ADR-001`) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 **자기 수정이 조용히
 * 사라지는 것**을 본다. 이 둘만 여는 것은 「사람이 오늘 바꾼 것」과 「다음 업로드가 가져올
 * 것」이 겹치는 칸이 여기뿐이기 때문이다. 늘리려면 문서가 먼저다.
 *
 * `.strict()`인 이유는 `assignment-schema.ts`와 같다: 모르는 키를 조용히 버리면 클라이언트가
 * 잘못된 모양을 보내고도 200을 받아, 안 바뀐 값을 나중에 화면에서야 발견한다.
 *
 * **권한을 판정하지 않는다.** 여기서 보는 것은 모양뿐이고, 「누가 무엇을 고칠 수 있나」는
 * `viewer-scope.ts`(앱)와 RLS·컬럼 GRANT(DB)가 진다.
 */

import { z } from 'zod';

import type { TaskPatch } from '@/types/auth';

/** 상태 원문의 상한. 시트 드롭다운 한 칸이라 이보다 길면 상태가 아니다 */
export const TASK_STATUS_MAX_LENGTH = 100;

/**
 * 상태를 **enum으로 좁히지 않는다** (`ADR-009`). 시트의 진행 상태 값은 `설정` 탭에서 오고
 * 늘어난다 — 미등록 값은 파서에서 **경고**이지 거부가 아니고, 그 규율이 여기서만 뒤집히면
 * 시트에 새 단계를 추가한 날 화면이 400을 뱉는다.
 *
 * `null`은 받지 않는다. 상태를 지우는 것은 「빈 셀」을 만드는 일이고, 그것은 업로드가 하는
 * 일이지 사람이 화면에서 하는 일이 아니다.
 */
const statusSchema = z.string().trim().min(1).max(TASK_STATUS_MAX_LENGTH);

/**
 * `null`은 「값을 지운다」이고 키 없음(`undefined`)은 「안 건드린다」다. **둘이 다르다** —
 * 빈 셀과 0을 구분하는 것이 이 프로젝트의 오래된 규칙이다 (`types/task.ts`).
 */
const progressSchema = z.number().int().min(0).max(100).nullable();

/**
 * 키가 하나도 없는 본문(`{}`)은 거부한다. 아무것도 안 바꾸는 요청에 200을 주면 클라이언트
 * 버그가 **성공으로 보인다** — 사용자는 저장됐다고 믿고 화면을 닫는다.
 */
export const taskPatchSchema: z.ZodType<TaskPatch> = z
  .object({
    status: statusSchema.optional(),
    progress: progressSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: '바꿀 값이 없습니다.',
  });
