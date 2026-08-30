/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import {
  submitReportSchema,
  toReportSubmissionsResponse,
} from '@/lib/api/report-submission-schema';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { currentSessionClient } from '@/lib/auth/request-viewer';

/**
 * 팀 주간 보고 **제출** (재보고도 이 라우트다). 팀장이 본문을 확인·수정하고 특이사항을 적어
 * 어드민에게 올린다 (`submit_report` · `0010` 3절).
 *
 * ## 팀을 받지 않는다
 *
 * 본문에 `teamId`가 없다 — `submit_report`가 `my_team()`으로 정한다. 인자로 받으면 남의 팀
 * 이름으로 보고를 올리는 요청이 성립하고, 그것을 막는 검사가 앱에 하나 더 생긴다.
 * `.strict()`라 실어 보내면 400이다.
 *
 * ## 실패 갈래를 사유별로 갈라 알리지 않는다
 *
 * `submit_report`는 자격 미달·팀 없음·빈 본문을 전부 예외로 낸다. 앞의 둘을 갈라 답하면
 * 남의 계정 상태를 물어보는 도구가 된다 (`S6`) — `team/requests/approve`와 **같은 판단**이다.
 * 빈 본문만 zod가 먼저 400으로 걸러 준다: 그것은 대상에 대한 사실을 하나도 말하지 않는다.
 *
 * ## 사용자 JWT다. `service_role`이 아니다
 *
 * 호출 자격 검사가 함수 안에 있고 그 검사는 `auth.uid()`에 기댄다 (`ADR-024`).
 */
export async function POST(request: Request): Promise<Response> {
  // 남의 페이지에 숨긴 폼이 로그인한 팀장의 쿠키로 보고를 밀어 넣는 것을 막는다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const input = submitReportSchema.parse(raw);

    const client = await currentSessionClient();
    if (client === null) return errorResponse('STORAGE_UNAVAILABLE');

    // 인자 이름은 SQL과 글자 그대로 같다 (`submit_report(week, body, note)`)
    const { error } = await client.rpc('submit_report', {
      week: input.weekStart,
      body: input.body,
      note: input.note,
    });
    if (error) return errorResponse('FORBIDDEN');

    /*
     * 갱신된 목록을 함께 준다. 제출 직후 화면이 자기 힘으로 상태를 바꾸면 그것이 곧 계산
     * 로직이고, 서버가 본 것과 화면이 그린 것이 갈라진다 (`ADR-006` · `.../approve`와 같다).
     *
     * ⚠ 여기서 실패하면 **제출은 됐는데 503**이 나간다. 사용자는 새로고침하면 제출된 상태를
     *   본다. 같은 요청 안의 두 왕복 사이에서만 생기는 갈래라 감수한다 — 제출을 되돌리는
     *   편이 훨씬 나쁘다 (`.../approve`가 같은 자리에 같은 주석을 달고 있다).
     */
    const reloaded = await client.rpc('list_reports', { week: input.weekStart });
    if (reloaded.error) return errorResponse('STORAGE_UNAVAILABLE');

    return Response.json(toReportSubmissionsResponse(reloaded.data));
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
