/**
 * 어드민 멤버 관리 라우트(`POST /api/members/role`)의 계약 (T11).
 *
 * `join-request-schema.ts`와 같은 자리이고 같은 규율이다 — 라우트 핸들러는 **zod 검증 →
 * lib 호출 → 직렬화 3단계뿐**이고 판단을 들고 있지 않는다.
 *
 * ## `'admin'`이 여기 없는 것이 결정이다
 *
 * `set_role`은 `new_role not in ('lead','member')`이면 예외를 던진다 (`0005` 4-6). 즉 DB가
 * 이미 막는다. 그런데도 앱 스키마에서 한 번 더 좁히는 것은 **다음 사람이 읽을 것을 정하기**
 * 위해서다 — 앱이 `'admin'`을 받아 넘기고 있으면 그것은 「DB만 고치면 승격이 열린다」는
 * 뜻으로 읽히고, 실제로 언젠가 그렇게 열린다. **최초 admin은 SQL로만 심는다**: 화면에서
 * admin을 만들 수 있으면 계정 하나가 뚫렸을 때 admin이 번식한다.
 *
 * 덤으로 답이 정직해진다. DB 예외는 라우트에서 403이 되는데(사유를 갈라 알리지 않는다),
 * 잘못된 것은 권한이 아니라 요청의 모양이다. 400이 그 사실을 말한다.
 *
 * ## 팀을 **선택**으로 두는 것도 결정이다
 *
 * 「팀이 없는 사람을 팀장으로 올리려면 팀을 정해야 한다」는 규칙은 **DB만 진다** —
 * `set_role`이 `coalesce(new_team, p.team_id)`로 풀고 그 값이 null이면 `team required`다
 * (`0005` 4-6). 앱이 같은 조건을 다시 쓰면 규칙이 두 벌이 되고, 그때 어느 쪽이 진짜인지
 * 알 수 없다. 여기서는 **모양만** 본다: 있으면 팀 키여야 한다.
 *
 * ## 응답에 이메일이 실린다
 *
 * 노출을 좁히는 것은 앱이 아니라 DB다 — `member_directory()`가 `active` admin에게만 행을
 * 낸다(`0005` 4-2). 앱은 그 위에 아무것도 더하지 않고 **모양만 강제한다**: `.strict()`라
 * 함수가 칸을 늘리면 조용히 실리는 대신 던진다.
 */

import { z } from 'zod';

import { teamIdSchema } from '@/lib/api/signup-schema';
import type { DirectoryRow } from '@/lib/domain/member-tree';
import type { MemberDirectoryResponse } from '@/types/api';

/**
 * 역할 바꾸기. **승격(`member` → `lead`)과 해제(`lead` → `member`)뿐이다.**
 *
 * `.strict()`인 이유는 `join-request-schema.ts`와 같다: 모르는 키를 조용히 버리면
 * 클라이언트가 잘못된 모양을 보내고도 200을 받는다.
 */
export const roleChangeSchema = z
  .object({
    userId: z.uuid(),
    role: z.enum(['lead', 'member']),
    /** 없으면 대상의 현재 팀을 그대로 쓴다 — 그 판단은 DB가 한다 (머리말) */
    teamId: teamIdSchema.optional(),
  })
  .strict();

export type RoleChangeInput = z.infer<typeof roleChangeSchema>;

/**
 * `member_directory()`가 내는 행. 키가 스네이크케이스인 것은 SQL과 글자 그대로 같아야 하기
 * 때문이다 (`0005` 4-2의 `returns table`).
 *
 * **`user_id`·`member_id`가 둘 다 nullable인 것이 요점이다** — full outer join이라 계정만
 * 있는 사람과 명부에만 있는 사람이 둘 다 정상 행이다. 둘 다 null인 행은 나오지 않는다.
 */
const directoryRowSchema = z
  .object({
    user_id: z.uuid().nullable(),
    member_id: z.uuid().nullable(),
    display_name: z.string().nullable(),
    member_name: z.string().nullable(),
    email: z.string().nullable(),
    /** 계정이 없는 명부 행은 `null`이다 */
    role: z.enum(['admin', 'lead', 'member']).nullable(),
    status: z.enum(['pending', 'active', 'rejected']).nullable(),
    team_id: teamIdSchema.nullable(),
  })
  .strict();

const directoryMemberSchema: z.ZodType<DirectoryRow> = z
  .object({
    userId: z.string().nullable(),
    memberId: z.string().nullable(),
    displayName: z.string().nullable(),
    memberName: z.string().nullable(),
    email: z.string().nullable(),
    role: z.enum(['admin', 'lead', 'member']).nullable(),
    status: z.enum(['pending', 'active', 'rejected']).nullable(),
    teamId: teamIdSchema.nullable(),
  })
  .strict();

export const memberDirectoryResponseSchema: z.ZodType<MemberDirectoryResponse> = z
  .object({ members: z.array(directoryMemberSchema) })
  .strict();

/**
 * DB 행 → 응답. **거르지 않는다** — 범위는 함수가 이미 좁혔고, 앱이 한 번 더 좁히면 규칙이
 * 두 벌이 되어 어긋났을 때 어느 쪽이 진짜인지 알 수 없다. 대기·반려 계정도 그대로 실린다:
 * 지우면 어드민이 「승인을 기다리는 사람이 있다」를 이 화면에서 못 본다.
 *
 * **순서를 바꾸지 않는다.** 묶고 세우는 것은 `buildMemberTree`의 몫이고(`ADR-006`), 여기서
 * 손대면 서버가 본 목록과 화면이 그린 트리가 갈린다.
 *
 * `rows`가 `null`인 것은 사고가 아니다 — 행이 없을 때 그 자리에 `null`이 오는 클라이언트
 * 갈래가 있어 둘을 같은 「빈 목록」으로 접는다.
 */
export function toMemberDirectoryResponse(rows: unknown): MemberDirectoryResponse {
  const parsed = z.array(directoryRowSchema).parse(rows ?? []);

  return memberDirectoryResponseSchema.parse({
    members: parsed.map((row) => ({
      userId: row.user_id,
      memberId: row.member_id,
      displayName: row.display_name,
      memberName: row.member_name,
      email: row.email,
      role: row.role,
      status: row.status,
      teamId: row.team_id,
    })),
  });
}
