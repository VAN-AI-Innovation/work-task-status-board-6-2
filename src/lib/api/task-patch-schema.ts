/**
 * `PATCH /api/tasks/[id]`의 문 앞 검증. **허용 필드는 `status`·`progress`·`ownerMemberId`·
 * `coOwnerMemberIds` 넷이다** (`PLAN.md`「T8 착수 시 확정」 결정 F에 담당자 지정을 더했다).
 *
 * 늘리지 않는 이유는 스코프가 아니라 데이터의 출처다 — 시트가 진실의 원천이고
 * (`ADR-001`) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 **자기 수정이 조용히
 * 사라지는 것**을 본다. 여는 칸을 이 셋으로 묶는 기준은 「사람이 오늘 바꾼 것」과 「다음
 * 업로드가 가져올 것」이 겹치는 자리인가이며, 담당자 재지정도 그 성질을 그대로 진다
 * (다음 업로드가 시트의 담당자로 되돌린다). 더 늘리려면 문서가 먼저다.
 *
 * ## 담당자는 **id만** 받는다
 *
 * 이름(`ownerNameRaw`·`coOwnerNames`)은 클라이언트에서 받지 않고 라우트가 id에서 유도한다.
 * 둘을 따로 받으면 「담당자는 A인데 이름은 B」인 행을 만들 수 있고, 그 행은 화면에서 데이터가
 * 틀린 것으로 보인다.
 *
 * ## 담당자가 여럿일 수 있다 — 다만 **주 담당은 하나다**
 *
 * `ownerMemberId`(주 담당)와 `coOwnerMemberIds`(공동 담당)로 나눈다. 시트가 그 모양이고
 * (「담당자」 칸과 「공동 담당」 칸), 무엇보다 **`member`의 열람 범위가 주 담당 하나로
 * 정해지기 때문이다** (`viewer-scope.ts` · RLS). 평평한 목록으로 받아 첫 번째를 주 담당으로
 * 삼으면, 화면에서 순서를 바꾸는 것만으로 누가 그 업무를 보는지가 조용히 바뀐다.
 *
 * `.strict()`인 이유는 `assignment-schema.ts`와 같다: 모르는 키를 조용히 버리면 클라이언트가
 * 잘못된 모양을 보내고도 200을 받아, 안 바뀐 값을 나중에 화면에서야 발견한다.
 *
 * **권한을 판정하지 않는다.** 여기서 보는 것은 모양뿐이고, 「누가 무엇을 고칠 수 있나」는
 * `viewer-scope.ts`(앱)와 RLS·컬럼 GRANT(DB)가 진다.
 */

import { z } from 'zod';


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
 * 담당자로 세울 `members.id`. **`null`은 「담당자를 비운다」**이고 키 없음은 「안 건드린다」다 —
 * `progress`와 같은 규칙이다.
 *
 * uuid로 좁히는 것은 모양 검사이지 권한이 아니다. 「그 구성원이 이 업무의 팀인가」는 라우트가
 * `assignableMembers`로 보고, 「이 역할이 담당자를 바꿀 수 있는가」는 `canAssignOwner`와
 * `tasks_update_scope`가 진다.
 */
const ownerMemberIdSchema = z.uuid().nullable();

/**
 * 공동 담당자의 `members.id` 목록. **빈 배열은 「공동 담당을 비운다」**이고 키 없음은
 * 「안 건드린다」다.
 *
 * 상한을 두는 것은 한 업무에 명부 전체를 실어 보내는 요청을 문 앞에서 자르기 위해서다 —
 * 팀 하나의 인원을 훌쩍 넘는 수라 정상 사용에는 닿지 않는다. 중복·주 담당과의 겹침은
 * 여기서 보지 않는다: 그것은 모양이 아니라 **그 업무의 팀 명부**를 알아야 하는 판정이라
 * 라우트가 진다.
 */
const CO_OWNER_MAX = 20;

const coOwnerMemberIdsSchema = z.array(z.uuid()).max(CO_OWNER_MAX);

/**
 * 키가 하나도 없는 본문(`{}`)은 거부한다. 아무것도 안 바꾸는 요청에 200을 주면 클라이언트
 * 버그가 **성공으로 보인다** — 사용자는 저장됐다고 믿고 화면을 닫는다.
 */
/**
 * ⚠ 출력 타입이 `TaskPatch`와 **일부러 다르다.** 클라이언트가 보내는 것은 id(`coOwnerMemberIds`)
 * 이고 저장소로 가는 것은 이름(`coOwnerNames`)이라, 그 사이를 라우트가 잇는다.
 */
export const taskPatchSchema = z
  .object({
    status: statusSchema.optional(),
    progress: progressSchema.optional(),
    ownerMemberId: ownerMemberIdSchema.optional(),
    coOwnerMemberIds: coOwnerMemberIdsSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: '바꿀 값이 없습니다.',
  });
