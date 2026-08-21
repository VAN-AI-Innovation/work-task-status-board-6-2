/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { toTaskListResponse } from '@/lib/api/task-response';
import { getStorage } from '@/lib/store/store-factory';

/**
 * 업무 목록. **초기 렌더는 서버 컴포넌트가 `lib/`를 직접 부르므로 이 라우트를 쓰지 않는다**
 * (`ADR-007`). 여기가 지는 것은 셋이다 — 클라이언트의 필터·리프레시(T6), 외부 소비(`curl`),
 * 그리고 **완료 기준 9의 검증면**이다: `curl /api/tasks | grep raw`가 비어야 한다
 * (`PLAN.md`「검증 방법」 21번).
 *
 * 이 파일에 계산이 없다. 거르기는 `buildReadContext`, 판정은 `lib/domain/`,
 * 마스킹과 원본 배제는 `toTaskListResponse`가 진다 (T5 완료 기준 1).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const storage = await getStorage();
    const query = parseTaskQuery(url.searchParams);
    const read = await buildReadContext(storage, new Date(), {
      as: url.searchParams.get('as'),
      ...query,
    });

    return Response.json({
      // `read.ctx.flags`는 이미 만들어져 있다. 다시 판정하면 화면과 갈라진다
      tasks: toTaskListResponse(read.tasks, read.ctx.flags, read.role),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
