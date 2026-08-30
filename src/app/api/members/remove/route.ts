/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { memberRemovalSchema, toMemberDirectoryResponse } from '@/lib/api/member-role-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 팀원 **내보내기** (`0006`의 `remove_member`). 지우지 않고 **끊는다** —
 * `profiles.status='rejected'` + `members.auth_user_id=null`이다. 명부 행도 업무 이력도
 * 그대로 남고, 팀원 요청 탭에서 다시 승인하면 돌아온다. 근거 전문은 `0006_member_offboard.sql`
 * 머리말에 있다.
 *
 * ## 이 라우트는 규칙을 만들지 않는다
 *
 * 「어드민만」·「자기 자신은 안 됨」·「다른 어드민도 안 됨」 셋 다 `remove_member`가 진다.
 * 여기서 다시 쓰면 규칙이 두 벌이 되고, 한쪽만 고쳐지는 날 화면은 막는데 DB는 통과시킨다
 * (또는 그 반대다).
 *
 * ## 실패 갈래를 사유별로 갈라 알리지 않는다
 *
 * `../role/route.ts`와 **같은 판단**이다 — 갈라 답하면 uuid를 훑어 계정의 존재와 역할을
 * 세는 도구가 된다 (`S6`). 「자기 자신이라 안 된다」와 「없는 계정이다」가 같은 403이다.
 *
 * ## 사용자 JWT다. `service_role`이 아니다
 *
 * 호출 자격 검사가 함수 안에 있고 그 검사는 `auth.uid()`에 기댄다 (`ADR-024`).
 * `service_role`로 부르면 「자기 자신인가」를 물을 대상 자체가 없어진다.
 */
export async function POST(request: Request): Promise<Response> {
  // 남의 페이지에 숨긴 폼이 로그인한 어드민의 쿠키로 내보내기를 밀어 넣는 것을 막는다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  try {
    // JSON이 아닌 것은 보낸 쪽의 잘못이라 아래 `catch`(503)에 맡기지 않는다
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const input = memberRemovalSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 인자 이름은 SQL과 글자 그대로 같다
    const { error } = await client.rpc('remove_member', { target: input.userId });
    if (error) return errorResponse('FORBIDDEN');

    /*
     * 갱신된 명부를 함께 준다 (`../role/route.ts`와 같은 이유·같은 대가).
     * ⚠ 여기서 실패하면 **내보내기는 됐는데 503**이 나간다. 되돌리는 편이 훨씬 나쁘다.
     */
    const reloaded = await client.rpc('member_directory');
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toMemberDirectoryResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
