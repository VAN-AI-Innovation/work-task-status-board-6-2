/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { toTaskResponse } from '@/lib/api/task-response';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { deriveTaskFlags } from '@/lib/domain/task-derive';

/**
 * 업무 하나 + 단계 타임라인. 사이드 패널(`UC-15`)이 `?task=id`로 여는 것과 같은 대상이다.
 *
 * 쿼리 필터를 읽지 않는다 (`filter: {}`). 상세는 **id로 가리키는 한 건**이라 목록의 필터가
 * 걸리면 안 된다 — 지연만 보는 화면에서 링크를 복사했다고 정상 업무가 404가 되면 안 된다.
 *
 * 없으면 `TASK_NOT_FOUND`(404)다. `VALIDATION_FAILED`로 뭉개면 「id 형식이 틀렸다」와
 * 구분되지 않고, `UPLOAD_NOT_FOUND`를 재활용하면 사용자가 할 일이 뒤바뀐다.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const url = new URL(request.url);

  try {
    // Next 16에서 동적 세그먼트는 Promise다
    const { id } = await params;
    const view = await currentViewerContext();
    const read = await buildReadContext(view, new Date(), {
      as: url.searchParams.get('as'),
      filter: {},
    });

    const task = await view.repo.getTask(id);
    if (task === null) return errorResponse('TASK_NOT_FOUND');

    return Response.json({
      task: toTaskResponse(
        task,
        // 목록에 있으면 그 판정을 그대로 쓴다. 없을 때만 같은 함수로 만든다
        read.ctx.flags.get(task.id) ?? deriveTaskFlags(task, read.ctx),
        read.role
      ),
      stages: await view.repo.listStages([task.id]),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
