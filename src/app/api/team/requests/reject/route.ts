/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { rejectSchema, toJoinRequestsResponse } from '@/lib/api/join-request-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 합류 요청 **거절** (T11). `profiles.status`를 `rejected`로 둘 뿐 `members` 연결은 건드리지
 * 않는다 — 계정은 살아 있고 그 사람은 `/pending`에서 다른 팀으로 다시 요청할 수 있다
 * (`0005` 4-5 · `POST /api/auth/rejoin`).
 *
 * 규율은 승인과 **한 줄도 다르지 않다** — 출처를 보고, 모양이 틀리면 400이고, DB가 거절하면
 * 사유를 갈라 알리지 않는다. 근거는 `../approve/route.ts` 머리말에 있고 여기 되풀이하지
 * 않는다 — 출처도 승인과 같은 한 경로로 본다(`requestIsSameOrigin` → `isSameOrigin`).
 * **라우트를 나눈 것 자체**가 그 파일이 적은 이유다: 승인과 거절은 결과가 정반대라
 * `action` 필드 한 글자에 맡기지 않는다.
 *
 * 거절 **사유**를 받지 않는 것은 `profiles`에 그것을 담을 칸이 없기 때문이다 (`0005` 1절).
 * 받아서 버리면 리더는 적어 보낸 사유가 상대에게 갔다고 믿는다.
 */
export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const input = rejectSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 대상 하나뿐이다. 승인 인자가 섞이면 함수 시그니처가 달라 호출 자체가 실패한다
    const { error } = await client.rpc('reject_join', { target: input.userId });
    if (error) return errorResponse('FORBIDDEN');

    const reloaded = await client.rpc('pending_requests');
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toJoinRequestsResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
