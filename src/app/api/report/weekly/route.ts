/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { getStorage } from '@/lib/store/store-factory';

/**
 * 대표·실장용 주간 보고 (`UC-08`, 과제 요구 5번).
 *
 * **마크다운을 문자열로만 내려보낸다.** 서버에서 HTML로 렌더하면 그 순간 sanitize가 필요해지고
 * (`S7`), 셀 값에서 온 문자열이 그대로 DOM이 된다. 화면은 「복사」까지만 한다.
 *
 * ⚠ **`events`가 빈 배열인 것은 데이터가 없어서가 아니라 읽을 길이 없어서다.**
 * `TaskRepository`에는 `recordEvents`(쓰기)만 있고 이벤트 **조회** 메서드가 없다 — T4가
 * 인터페이스를 정할 때 이력을 읽는 화면이 없었기 때문이다. 그래서 보고서의 「이번 주 변경 건수」는
 * 지금 0으로 나간다. **여기서 지어내지 않는다** — 없는 숫자를 채우면 주간 보고가 거짓이 된다.
 * 인터페이스를 넓히는 것은 사이드 패널의 변경 이력을 그리는 T6, 또는 `/report` 전용 화면을
 * 만드는 T9의 일이다 (`TICKETS.md`에 같은 메모를 남겼다).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const storage = await getStorage();
    const read = await buildReadContext(storage, new Date(), {
      as: url.searchParams.get('as'),
      filter: {},
    });

    return Response.json({
      markdown: buildWeeklyReport({
        tasks: read.tasks,
        stages: read.stages,
        goals: await storage.repo.listGoalMetrics(),
        events: [],
        ctx: read.ctx,
      }),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
