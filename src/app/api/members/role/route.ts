/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { roleChangeSchema, toMemberDirectoryResponse } from '@/lib/api/member-role-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 팀장 **승격·해제** (T11). 대상의 `profiles.role`을 바꾼다 (`0005` 4-6의 `set_role`).
 *
 * ## 받는 역할은 둘뿐이다
 *
 * 대표·실장으로 올리는 길은 이 라우트에 **없다.** 목록을 좁히는 자리는
 * `member-role-schema.ts`이고 근거도 거기 있다 — 최초 대표·실장은 SQL로만 심는다.
 * 스키마에서 걸리므로 그 값은 DB에 닿지도 않는다(400이다. 403이 아니다).
 *
 * ## 팀 규칙은 여기서 지지 않는다
 *
 * 「팀이 없는 사람을 팀장으로 올리려면 팀을 정해야 한다」를 이 파일이 다시 쓰지 않는다.
 * `set_role`이 `coalesce(new_team, p.team_id)`로 풀고 그 값이 null이면 예외다 — 규칙이
 * 한 곳에만 있어야 어긋나지 않는다 (`PLAN.md` T11 step 8). 여기서 하는 일은 **빠진 값을
 * `null`로 넘기는 것**뿐이다.
 *
 * ## 실패 갈래를 사유별로 갈라 알리지 않는다
 *
 * `set_role`은 자격 미달·없는 대상·팀 미정·모르는 팀·대기 계정을 **전부 예외**로 낸다.
 * 갈라 답하면 uuid를 훑어 계정의 존재와 상태를 세는 도구가 된다 (`S6`) —
 * `../team/requests/approve/route.ts`와 **같은 판단**이고 대가도 같다: 연결 사고도 403으로
 * 보인다. 앞의 `VALIDATION_FAILED`(400)만 따로 두는 것은 그것이 대상에 대한 사실을
 * **하나도 말하지 않기** 때문이다.
 *
 * ## 사용자 JWT다. `service_role`이 아니다
 *
 * 호출 자격 검사가 함수 안에 있고 그 검사는 `auth.uid()`에 기댄다 (`0005` 4-6·4-2).
 * `service_role`로 부르면 그 검사가 무너진다 (`ADR-024`).
 */
export async function POST(request: Request): Promise<Response> {
  // 남의 페이지에 숨긴 폼이 로그인한 어드민의 쿠키로 승격을 밀어 넣는 것을 막는다.
  // 헤더 이름을 아는 곳은 `same-origin.ts` 하나다 — `isSameOrigin`이 판정을 진다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  try {
    // JSON이 아닌 것은 보낸 쪽의 잘못이라 아래 `catch`(503)에 맡기지 않는다
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const input = roleChangeSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 인자 이름은 SQL과 글자 그대로 같다. 빠진 팀은 `null`이어야 함수가 현재 팀을 쓴다
    const { error } = await client.rpc('set_role', {
      target: input.userId,
      new_role: input.role,
      new_team: input.teamId ?? null,
    });
    if (error) return errorResponse('FORBIDDEN');

    /*
     * 갱신된 명부를 함께 준다. 화면이 자기 힘으로 트리를 고쳐 그리면 그것이 곧 계산
     * 로직이고, 서버가 본 것과 화면이 그린 것이 갈라진다 (`ADR-006`).
     *
     * ⚠ 여기서 실패하면 **역할은 바뀌었는데 503**이 나간다. 승인 라우트와 같은 갈래이며
     *   같은 이유로 감수한다 — 되돌리는 편이 훨씬 나쁘다. 사용자는 새로고침하면 된다.
     */
    const reloaded = await client.rpc('member_directory');
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toMemberDirectoryResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
