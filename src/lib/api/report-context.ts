/**
 * 주간 보고가 쓰는 준비 둘 — **기간을 어떻게 받는가**와 **이력을 어떻게 읽는가**.
 *
 * 부르는 곳이 둘이라 여기 있다: `GET /api/report/weekly`와 대시보드의 브리핑 카드
 * (`src/app/page.tsx`). 같은 주의 보고서가 두 자리에서 다른 숫자를 내면 회의에서 둘 다
 * 못 믿게 되므로, 라우트마다 다시 쓰지 않고 한 곳에서 나온다 (`read-context.ts`와 같은 규율).
 *
 * 두 가지를 못박는다.
 *
 * - **zod는 모양만 본다. 뜻은 `resolveReportPeriod`가 정한다.** 여기서 `YYYY-MM-DD`를
 *   강제하면 오타 하나가 400이 되는데, 그것은 결정 M(「하드 실패시키지 않는다」)을 어긴다.
 *   값이 비면 키가 없는 것으로 보는 것은 `read-context.ts`의 `optionalValue`와 같은 규칙이다.
 * - **이력을 읽지 못한 것과 0건은 다르다.** 실패를 빈 배열로 뭉개면 보고서가 「이번 주 아무
 *   일도 없었다」고 거짓말한다. `null`을 돌려주면 `buildWeeklyReport`가 「집계되지 않음」이라
 *   적는다. 보고서 전체를 500으로 떨어뜨리지 않는 것도 의도다 — 이력은 요약 한 줄이고,
 *   그 한 줄 때문에 나머지 보고서를 못 보게 만들 이유가 없다.
 */

import { z } from 'zod';

import type { ReportPeriod } from '@/lib/domain/report-period';
import type { TaskRepository } from '@/lib/store/task-repository';
import type { TaskEvent } from '@/types/task';

/** `?week=`의 값. 그 주의 아무 날이어도 된다 — 주 시작으로 맞추는 것은 도메인이 한다 */
const reportQuerySchema: z.ZodType<string | null> = z
  .object({ week: z.string().optional() })
  .transform((query) => {
    const trimmed = query.week?.trim() ?? '';
    return trimmed === '' ? null : trimmed;
  });

export function parseReportQuery(searchParams: URLSearchParams): string | null {
  return reportQuerySchema.parse({ week: searchParams.get('week') ?? undefined });
}

/**
 * 그 기간의 변경 이력. **`taskIds`로 좁히지 않는다** — 범위는 RLS(`0004_events_policy.sql`)와
 * `viewer-scope.ts`가 이미 자르고, 여기서 또 좁히면 범위 규칙이 세 벌이 된다.
 *
 * 저장소가 던지면 `null`이다. 사유는 밖으로 내보내지 않는다 (에러 메시지에 내부 문자열을
 * 담지 않는다 — CLAUDE.md 보안 규칙).
 */
export async function loadPeriodEvents(
  repo: Pick<TaskRepository, 'listEvents'>,
  period: ReportPeriod
): Promise<TaskEvent[] | null> {
  try {
    return await repo.listEvents({ since: period.since, until: period.until });
  } catch {
    return null;
  }
}
