/**
 * 팀 합류 요청 세 라우트(`GET /api/team/requests` · `.../approve` · `.../reject`)의 계약 (T11).
 *
 * 요청 스키마를 `lib/api/`에 두는 것은 이 프로젝트의 규율이다 (`task-patch-schema.ts`·
 * `signup-schema.ts`와 같은 자리) — 라우트 핸들러는 **zod 검증 → lib 호출 → 직렬화 3단계뿐**
 * 이고 판단을 들고 있지 않는다.
 *
 * ## 「정확히 하나」를 여기서도 막는 이유
 *
 * `approve_join`은 `member_id`와 `new_member_name` 중 정확히 하나가 아니면 **예외를 던진다**
 * (`0005` 4-4). 즉 DB가 이미 막는다. 그런데도 앱에서 한 번 더 막는 것은 **답이 달라지기**
 * 때문이다 — DB 예외는 라우트에서 403이 되고, 그것은 「당신은 이걸 못 합니다」라는 거짓말이다.
 * 잘못된 것은 권한이 아니라 요청의 모양이고, 사용자가 할 일은 포기가 아니라 고쳐 보내는
 * 것이다. 400이 500·403보다 정직하다.
 *
 * **두 곳이 같은 규칙을 지는 것은 의도다.** DB 쪽을 느슨하게 만들어 앱만 믿지 않는다 —
 * 이 라우트가 아닌 경로(psql·다른 클라이언트)로도 함수가 불릴 수 있고, 그때 남는 층은
 * DB뿐이다.
 *
 * ## 응답에 이메일이 실린다
 *
 * 리더가 요청자를 알아보려면 이름만으로는 부족하다. 그 노출을 좁히는 것은 **앱이 아니라 DB**
 * 다 — `pending_requests()`가 `active` admin·lead에게만 행을 낸다(`0005` 4-1). 앱은 그
 * 위에 아무것도 더하지 않는다(`viewer-scope.ts`와 RLS가 두 벌인 것은 데모 모드라는 근거가
 * 있어서인데, 여기에는 그 근거가 없다).
 *
 * 대신 **모양은 강제한다.** `task-response.ts`와 같은 규율로 `.strict()` 스키마를 두고
 * 변환 결과를 반드시 통과시킨다 — 지정하지 않은 키가 조용히 섞이는 대신 던진다.
 */

import { z } from 'zod';

import { teamIdSchema } from '@/lib/api/signup-schema';
import type { JoinRequest, JoinRequestsResponse } from '@/types/api';

/** `members.name`·`profiles.display_name`과 같은 40자다 (`0005` 1절) */
export const MEMBER_NAME_MAX_LENGTH = 40;

/**
 * 승인. **`memberId`(기존 명부 행에 잇기)와 `newMemberName`(새 행 만들기) 중 정확히 하나.**
 *
 * `.strict()`인 이유는 `task-patch-schema.ts`와 같다: 모르는 키를 조용히 버리면 클라이언트가
 * 잘못된 모양을 보내고도 200을 받는다. 특히 여기서는 `role` 같은 키가 섞였을 때 **그것이
 * 무시됐다는 사실**을 보낸 쪽이 알아야 한다 — 승인은 「받아들인다」이지 「승격」이 아니고
 * (`0005` 4-4), 역할은 `set_role`만 바꾼다.
 */
export const approveSchema = z
  .object({
    userId: z.uuid(),
    memberId: z.uuid().optional(),
    newMemberName: z.string().trim().min(1).max(MEMBER_NAME_MAX_LENGTH).optional(),
  })
  .strict()
  .refine(
    (input) => (input.memberId === undefined) !== (input.newMemberName === undefined),
    { message: '기존 구성원과 새 이름 중 하나만 지정해 주세요.' }
  );

export type ApproveJoinInput = z.infer<typeof approveSchema>;

/**
 * 거절. **사유 칸을 받지 않는다** — `profiles`에 그것을 담을 컬럼이 없고(`0005` 1절),
 * 받아서 버리면 리더는 적어 보낸 사유가 상대에게 갔다고 믿는다.
 */
export const rejectSchema = z.object({ userId: z.uuid() }).strict();

export type RejectJoinInput = z.infer<typeof rejectSchema>;

/**
 * `pending_requests()`가 내는 행. 키 이름이 스네이크케이스인 것은 SQL과 글자 그대로 같아야
 * 하기 때문이다 (`0005` 4-1의 `returns table`).
 *
 * `.strict()`라 함수가 칸을 하나 늘리면 **여기서 던진다.** 조용히 지나가면 다음 사람은
 * 새 칸이 응답에 실리는지 아닌지를 코드만 보고 알 수 없다.
 */
const joinRequestRowSchema = z
  .object({
    user_id: z.uuid(),
    display_name: z.string().nullable(),
    email: z.string().nullable(),
    team_id: teamIdSchema.nullable(),
    status: z.enum(['pending', 'rejected']),
    created_at: z.string(),
  })
  .strict();

const joinRequestSchema: z.ZodType<JoinRequest> = z
  .object({
    userId: z.string(),
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    teamId: teamIdSchema.nullable(),
    status: z.enum(['pending', 'rejected']),
    createdAt: z.string(),
  })
  .strict();

export const joinRequestsResponseSchema: z.ZodType<JoinRequestsResponse> = z
  .object({ requests: z.array(joinRequestSchema) })
  .strict();

/**
 * DB 행 → 응답. **거르지 않는다** — 범위는 함수가 이미 좁혔고, 앱이 한 번 더 `filter`를
 * 걸면 규칙이 두 벌이 되어 어긋났을 때 어느 쪽이 진짜인지 알 수 없다.
 *
 * `data`가 `null`인 것은 사고가 아니다. `rpc`는 행이 없을 때 빈 배열을 주지만, 그 자리에
 * `null`이 오는 클라이언트 갈래가 있어 둘을 같은 「빈 목록」으로 접는다.
 */
export function toJoinRequestsResponse(rows: unknown): JoinRequestsResponse {
  const parsed = z.array(joinRequestRowSchema).parse(rows ?? []);

  return joinRequestsResponseSchema.parse({
    requests: parsed.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      teamId: row.team_id,
      status: row.status,
      createdAt: row.created_at,
    })),
  });
}
