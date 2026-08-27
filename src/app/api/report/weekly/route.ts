/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { loadPeriodEvents, parseReportQuery } from '@/lib/api/report-context';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';

/**
 * 대표·실장용 주간 보고 (`UC-08`, 과제 요구 5번).
 *
 * **마크다운을 문자열로만 내려보낸다.** 서버에서 HTML로 렌더하면 그 순간 sanitize가 필요해지고
 * (`S7`), 셀 값에서 온 문자열이 그대로 DOM이 된다. 화면은 「복사」까지만 한다.
 *
 * **기간과 이력**: `?week=YYYY-MM-DD`로 주를 고른다. 값이 이상하면 400이 아니라 이번 주로
 * 되돌리고 그 사실을 `period.fellBack`으로 알린다 (결정 M) — 오타 하나로 보고서가 통째로
 * 안 뜨면 사용자는 URL이 아니라 도구를 의심한다. 변경 이력은 **사용자 JWT 저장소**
 * (`read`가 쓴 것과 같은 `view.repo`)로 읽고, 어느 행이 보이는지는 RLS가 정한다
 * (`ADR-024` · `0004_events_policy.sql`). 그래서 세 역할의 건수가 각자 다르다.
 *
 * 이 파일에 계산이 없다. 주를 정하는 것은 `resolveReportPeriod`, 이력을 읽는 것은
 * `loadPeriodEvents`, 세는 것은 `buildWeeklyReport`다 (T5 완료 기준 1).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const view = await currentViewerContext();
    // 승인 대기 계정은 403이다 (T11 · `pending-gate.ts`). 401이 아닌 이유는 이미 로그인했다는 것
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');

    const read = await buildReadContext(view, new Date(), {
      as: url.searchParams.get('as'),
      filter: {},
    });

    const period = resolveReportPeriod(read.ctx.today, parseReportQuery(url.searchParams));

    return Response.json({
      markdown: buildWeeklyReport({
        tasks: read.tasks,
        stages: read.stages,
        goals: await view.repo.listGoalMetrics(),
        period,
        events: await loadPeriodEvents(view.repo, period),
        ctx: read.ctx,
      }),
      /*
       * 화면이 「어느 주를 보고 있나」와 「내가 요청한 주가 아니다」를 말할 수 있어야 한다.
       * `since`·`until`은 싣지 않는다 — 저장소 필터에 넘기는 내부 값이고 화면이 쓸 데가 없다.
       */
      period: { weekStart: period.weekStart, weekEnd: period.weekEnd, fellBack: period.fellBack },
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
