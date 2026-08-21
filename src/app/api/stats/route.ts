/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { buildKpiStrip, summarizeAllTeams } from '@/lib/domain/progress-stats';
import { getStorage } from '@/lib/store/store-factory';

/**
 * KPI 10종 + 팀별 요약 (`UC-07`). **집계는 SQL이 아니라 `lib/domain/`의 순수 함수다**
 * (`ADR-006`) — memory·supabase 두 구현의 결과가 갈라지면 안 된다.
 *
 * 타일의 라벨·순서를 여기서 만들지 않는다. 시트 `00_통합 대시보드` 5행과의 1:1 대응이
 * `buildKpiStrip`의 배열 순서이고, 라우트가 손대면 그 대응이 두 곳에 생긴다.
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
      kpis: buildKpiStrip(read.tasks, read.ctx),
      teams: summarizeAllTeams(read.tasks, read.ctx),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
