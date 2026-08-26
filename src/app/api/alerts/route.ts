/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { collectAlerts } from '@/lib/domain/alert-rules';

/**
 * 알림 4종 + 담당자 오타 의심 (`UC-12`·`UC-13`, 과제 요구 3번).
 *
 * **`Alert`에 업무명·담당자를 붙이지 않는다.** 친절해 보이지만 이 응답은 화면 밖으로도 나갈 수
 * 있고(T10 디스코드 웹훅), 그 순간 실명과 업무명이 외부 서비스에 실린다 (`S6`).
 * 화면은 `taskId`를 `?task=id` 딥링크로 이어 이름을 자기가 붙인다.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const view = await currentViewerContext();
    const query = parseTaskQuery(url.searchParams);
    const read = await buildReadContext(view, new Date(), {
      as: url.searchParams.get('as'),
      ...query,
    });

    return Response.json({
      alerts: collectAlerts(read.tasks, read.stages, read.ctx),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
