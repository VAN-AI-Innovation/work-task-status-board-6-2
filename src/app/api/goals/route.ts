/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { toGoalResponse } from '@/lib/api/task-response';
import { summarizeGoals } from '@/lib/domain/goal-stats';
import { getStorage } from '@/lib/store/store-factory';

/**
 * 목표 대비 성과 (`UC-10`, 과제 요구 4번). 시트의 `달성률`을 그대로 쓰지 않고
 * `summarizeGoals`가 `actual/target`으로 재계산하며, 시트 값과 벌어지면 `warnings`에 남는다 —
 * 그 불일치가 파서 정확성의 실측 지표다.
 *
 * `extras`는 `toGoalResponse`가 마스킹한다. 성과 행에도 담당자·채널·문의자 계정이 들어온다.
 *
 * 업무 필터(`parseTaskQuery`)를 읽지 않는다. 성과 지표는 진행 상태·마감·담당자 축이 아니라
 * 목표값 대 실적값 축으로 움직여서(`ARCHITECTURE.md`) 같은 필터가 성립하지 않는다.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const storage = await getStorage();
    const read = await buildReadContext(storage, new Date(), {
      as: url.searchParams.get('as'),
      filter: {},
    });

    const stats = summarizeGoals(await storage.repo.listGoalMetrics());

    return Response.json({
      items: toGoalResponse(stats.items, read.role),
      byTeam: stats.byTeam,
      warnings: stats.warnings,
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
