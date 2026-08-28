/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import {
  reviewReportSchema,
  toReportSubmissionsResponse,
} from '@/lib/api/report-submission-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 제출된 팀 보고를 **받거나 돌려보낸다** (`review_report` · `0010` 4절). 어드민 전용이고,
 * 그 판정은 함수 안에 있다 — 앱은 부르기만 한다 (`ADR-024`).
 *
 * ## 제출과 라우트를 나눈다
 *
 * 하나의 라우트에 `action`을 두지 않은 것은 `team/requests`의 승인·거절과 같은 이유다:
 * 두 조작은 결과가 정반대인데 그렇게 두면 한 글자 오타가 승인을 반려로 바꾸고, 그 실수는
 * 어느 쪽에서도 에러로 보이지 않는다. 다만 여기서 `accepted`·`rejected`가 **한 라우트**인
 * 것은 둘이 같은 조작(검토 결과 기록)의 두 값이고, **반려에만 사유가 붙는다**는 규칙이
 * 한 스키마 안에 있어야 하기 때문이다.
 *
 * ## 사유 없는 반려는 400이다
 *
 * DB도 막지만(`review note required`) 그 답은 403이 되고, 그것은 「당신은 이걸 못 합니다」
 * 라는 거짓말이다. 잘못된 것은 권한이 아니라 요청의 모양이다
 * (`report-submission-schema.ts` 머리말).
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
    const input = reviewReportSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 인자 이름은 SQL과 글자 그대로 같다. 받아들일 때 사유 자리는 `null`이어야 한다
    const { error } = await client.rpc('review_report', {
      target_team: input.teamId,
      week: input.weekStart,
      decision: input.decision,
      review_note: input.decision === 'rejected' ? (input.reviewNote ?? null) : null,
    });
    // 자격 미달·없는 보고를 갈라 답하지 않는다 (`S6`)
    if (error) return errorResponse('FORBIDDEN');

    const reloaded = await client.rpc('list_reports', { week: input.weekStart });
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toReportSubmissionsResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
