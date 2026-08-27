/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { toJoinRequestsResponse } from '@/lib/api/join-request-schema';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 팀 합류 요청 목록 (T11). 승인 화면(step 6)이 처음 그릴 때 읽는 자리다.
 *
 * ## 범위를 앱에서 거르지 않는다
 *
 * `pending_requests()`가 **호출자 역할에 따라 이미 좁힌다** — `active` admin은 전부,
 * `active` lead는 자기 팀, 그 밖(대기·거절·부원·미인증)은 0행이다 (`0005` 4-1). 여기서
 * 한 번 더 걸러 내면 범위 규칙이 두 벌이 되고, 둘이 어긋난 날 어느 쪽이 진짜인지 알 수 없다.
 * (`viewer-scope.ts`와 RLS가 두 벌인 것은 **데모 모드**라는 근거가 있어서인데, 이 경로에는
 * 그 근거가 없다 — 함수가 없으면 애초에 부를 것이 없다.)
 *
 * 그래서 이 라우트에는 역할 판정도 범위를 좁히는 줄도 하나 없다. **0행과 「권한 없음」을 구분해 답하지도
 * 않는다** — 부원이 이 주소를 눌러 보면 빈 목록을 받고, 그것으로 남의 팀에 요청이 몇 건
 * 있는지는 알 수 없다.
 *
 * ## 이메일이 실린다
 *
 * 리더가 요청자를 알아보려면 이름만으로는 부족하다. 노출을 좁히는 것은 위의 함수이고,
 * 앱은 **모양만** 강제한다 — `toJoinRequestsResponse`의 `.strict()`가 지정하지 않은 키를
 * 던진다 (`task-response.ts`와 같은 규율 · `S6`).
 *
 * ## 사용자 JWT다
 *
 * `service_role`로 부르면 `auth.uid()`가 없어 함수의 자격 검사가 **아무에게도 참이 아니게**
 * 되고, 그것을 고치려는 다음 사람은 함수에 호출자를 인자로 넘긴다 — 그 순간 방어가 앱 한
 * 겹으로 줄어든다 (`ADR-024`).
 */
export async function GET(): Promise<Response> {
  try {
    const client = await currentSessionClient();
    // 자격증명이 없는 환경(데모 클론)에는 붙을 Auth·DB가 없다. 권한 문제가 아니다
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    const { data, error } = await client.rpc('pending_requests');
    /*
     * 이 함수는 자격 미달에 예외를 내지 않고 **0행**을 낸다 (`0005` 4-1). 그러니 여기 오는
     * `error`는 권한이 아니라 연결·스키마 사고이고, 403으로 답하면 사실이 아니다.
     * 문구는 코드가 정한 한국어 한 문장이다 — DB 메시지를 실어 보내지 않는다.
     */
    if (error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toJoinRequestsResponse(data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
