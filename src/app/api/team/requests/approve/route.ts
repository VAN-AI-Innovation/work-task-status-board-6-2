/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { approveSchema, toJoinRequestsResponse } from '@/lib/api/join-request-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 합류 요청 **승인** (T11). 대상을 `active`로 바꾸고 `members` 행에 잇는다 (`0005` 4-4).
 *
 * ## 거절과 라우트를 나눈다
 *
 * 하나의 라우트에 `action: 'approve' | 'reject'`를 두지 않았다. 두 조작은 **결과가 정반대**
 * 인데 그렇게 두면 한 글자 오타가 승인을 거절로 바꾸고, 그 실수는 요청을 보낸 쪽에서도
 * 받은 쪽에서도 에러로 보이지 않는다. 주소가 다르면 오타는 404다.
 *
 * ## 실패 갈래를 사유별로 갈라 알리지 않는다
 *
 * `approve_join`은 자격 미달·다른 팀·이미 승인됨·남에게 붙은 구성원을 **전부 예외**로 낸다.
 * 그것을 갈라 답하면 리더가 uuid를 훑어 **다른 팀의 계정 존재와 상태**를 셀 수 있다 (`S6`).
 * `PATCH /api/tasks/[id]`가 없는 id에도 404가 아니라 403을 내는 것과 **같은 판단**이다.
 *
 * 그 대가로 **연결 사고도 403으로 보인다**(500·503과 구분되지 않는다). 알고 두는 값이며,
 * 여기서 갈래를 열면 위의 열거 도구가 함께 열린다. 앞의 `VALIDATION_FAILED`(400)만 따로
 * 두는 것은 그것이 대상에 대한 사실을 **하나도 말하지 않기** 때문이다 — 「당신이 보낸 모양이
 * 틀렸다」는 대상이 존재하든 말든 같은 답이다.
 *
 * ## 사용자 JWT다. `service_role`이 아니다
 *
 * 호출 자격 검사가 함수 안에 있고 그 검사는 `auth.uid()`에 기댄다 (`0005` 4-3).
 * `service_role`로 부르면 검사가 무너지거나, 앱이 「내가 확인했으니 통과시켜라」는 인자를
 * 넘기게 된다 — 그 순간 방어가 한 겹이 되고 그 한 겹은 앱이다 (`ADR-024`).
 */
export async function POST(request: Request): Promise<Response> {
  /*
   * 1. 남의 페이지에 숨긴 폼·스크립트가 로그인한 리더의 쿠키로 승인을 밀어 넣는 것을 막는다.
   *    `Origin`이 없는 요청(`curl`)은 통과한다 — 근거는 `same-origin.ts` 머리말에 있다.
   *    `requestIsSameOrigin`이 헤더를 꺼내 `isSameOrigin`에 넘긴다 — 헤더 이름을 아는 곳은
   *    그 파일 하나이고, 라우트가 직접 꺼내면 `x-forwarded-proto`를 빠뜨린 실패가 프록시
   *    뒤에서만 나타난다.
   */
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  try {
    // 2. 본문. JSON이 아닌 것은 보낸 쪽의 잘못이라 아래 `catch`(503)에 맡기지 않는다
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    // 「정확히 하나」는 DB도 막지만 그쪽 답은 403이다. 모양 문제에 권한 문구를 주지 않는다
    const input = approveSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 3. 인자 이름은 SQL과 글자 그대로 같다. 빠진 쪽은 `null`이어야 함수의 배타 검사가 선다
    const { error } = await client.rpc('approve_join', {
      target: input.userId,
      member_id: input.memberId ?? null,
      new_member_name: input.newMemberName ?? null,
    });
    if (error) return errorResponse('FORBIDDEN');

    /*
     * 4. 갱신된 목록을 함께 준다. 승인 직후 화면이 자기 힘으로 목록을 줄이면 그것이 곧
     *    계산 로직이고, 서버가 본 것과 화면이 그린 것이 갈라진다 (`ADR-006`).
     *
     *    ⚠ 여기서 실패하면 **승인은 됐는데 503**이 나간다. 다시 눌러도 대상이 이미
     *    `pending`이 아니라 403이 되므로 사용자는 새로고침해야 한다. 같은 요청 안의 두
     *    왕복 사이에서만 생기는 갈래라 감수한다 — 승인을 되돌리는 편이 훨씬 나쁘다.
     */
    const reloaded = await client.rpc('pending_requests');
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toJoinRequestsResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
