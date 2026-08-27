/**
 * 주간 보고 전용 화면 (`UC-08`, 과제 요구 5번). 대시보드의 브리핑 카드가 **확장된** 자리다 —
 * 기간을 고를 수 있고, 본문 전체가 접히지 않은 채로 서고, 복사에 더해 내려받을 수 있다.
 *
 * 데이터 경로는 `/`·`/teams/*`와 같다. 자기 API(`/api/report/weekly`)를 `fetch`하지 않고
 * `lib/`를 직접 부른다 (`ADR-007`) — 그리고 라우트와 **같은 함수들**을 부른다
 * (`resolveReportPeriod` · `loadPeriodEvents` · `buildWeeklyReport`). 화면이 따로 세기
 * 시작하면 같은 주의 보고서가 API와 화면에서 다른 숫자를 내고, 그날 둘 다 못 믿게 된다.
 *
 * **역할로 막지 않는다** (T9 결정 N). `member`가 열면 자기 업무만 담긴 보고서가 나오는데
 * 그것이 의도다 — 범위는 이미 **데이터에서** 잘렸고(`viewer-scope.ts` · RLS), 화면이 또
 * 막으면 같은 규칙이 두 벌이 된다. 로그인 자체는 `src/proxy.ts`가 요구한다(공개 목록 방식이라
 * 이 파일이 생기는 순간 이미 보호된다).
 *
 * **마크다운을 렌더하지 않는다** (`S7` · 결정 O). 서버에서 HTML로 바꾸면 sanitize가 필요해지고
 * 시트 셀에서 온 문자열이 그대로 DOM이 된다. 화면은 원문을 `<pre>`로 보여주고 복사·내려받기
 * 까지만 한다 — 내려받기도 클라이언트 `Blob`이라 파일을 주는 라우트가 없다.
 *
 * 이 화면에 계산이 없다. 주를 정하는 것은 `resolveReportPeriod`, 이동 링크는 `buildReportNav`,
 * 이력은 `loadPeriodEvents`, 세는 것은 `buildWeeklyReport`, 빈 화면의 사유는 `emptyReason`이다.
 */

import { redirect } from 'next/navigation';

import { ReportDocument } from '@/components/report/report-document';
import { ReportPeriodNav } from '@/components/report/report-period-nav';
import { PageShell } from '@/components/shell/page-shell';
import { EmptyState } from '@/components/tasks/empty-state';
import { buildReadContext } from '@/lib/api/read-context';
import { loadPeriodEvents, parseReportQuery } from '@/lib/api/report-context';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { emptyReason } from '@/lib/view/empty-reason';
import { buildReportNav } from '@/lib/view/report-nav';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 「이번 주」도 저장소 연결도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 빌드한 주의 보고서가 영원히 나온다.
 */
export const dynamic = 'force-dynamic';

export default async function ReportPage({ searchParams }: PageProps<'/report'>) {
  const view = await currentViewerContext();

  // 승인을 기다리는 계정은 여기서 `/pending`으로 간다 (T11 · `pending-gate.ts`)
  const gate = gateForSession(view.session, '/report');
  if (gate.kind === 'redirect') redirect(gate.to);

  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  /*
   * 필터를 걸지 않는다 — `GET /api/report/weekly`와 같다. 이 화면에는 필터 바가 없고,
   * 보고서는 「그 사람이 볼 수 있는 전부」를 요약하는 물건이다. 범위는 `buildReadContext`
   * 안에서 `scopeTasks`와 RLS가 이미 자른다 (`ADR-024`).
   */
  const read = await buildReadContext(view, new Date(), { as: sp.get('as'), filter: {} });

  const period = resolveReportPeriod(read.ctx.today, parseReportQuery(sp));
  const nav = buildReportNav(period, read.ctx.today);

  const freshness = describeSync(read.meta.lastSyncedAt, read.meta.today);
  const query = parseDashboardQuery(sp);

  /*
   * 이력을 **읽지 못한 것**과 0건은 다르다. `loadPeriodEvents`가 `null`을 주면 보고서가
   * 「집계되지 않음」이라 적고, 빈 배열이면 「0건」이라 적는다 (T9 step 3·4).
   */
  const markdown = buildWeeklyReport({
    tasks: read.tasks,
    stages: read.stages,
    goals: await view.repo.listGoalMetrics(),
    period,
    events: await loadPeriodEvents(view.repo, period),
    ctx: read.ctx,
  });

  /*
   * 빈 화면의 사유를 화면이 고르지 않는다 (`lib/view/empty-reason.ts`). 이 화면에는 필터가
   * 없으므로 `no-match`는 나올 수 없고, 갈리는 것은 「저장소가 비었다」와 「담당자로 연결된
   * 계정이 없다」 둘이다. 뒤쪽에는 진입점을 주지 않는다 — 시트를 올려도 달라지지 않는다.
   */
  const reason = emptyReason(read.viewer, 0);

  return (
    <PageShell
      mode={read.meta.mode}
      driver={read.meta.driver}
      freshness={freshness}
      role={read.role}
      query={query}
      account={toAccount(view.session)}
    >
      <h1 className="text-brand text-xl font-semibold">주간 보고</h1>
      <p className="text-ink-body mt-1 text-sm">
        회의 직전에 열어 그대로 복사해 가는 화면입니다. 보이는 범위는 로그인한 계정의 권한을
        따릅니다.
      </p>

      <div className="mt-6">
        <ReportPeriodNav nav={nav} fellBack={period.fellBack} />
      </div>

      {read.tasks.length === 0 ? (
        /*
         * 업무가 0건이면 보고서에 담을 것이 없다. **주를 바꿔도 달라지지 않는다** —
         * 업무 목록은 기간으로 자르지 않기 때문이다(기간을 타는 것은 마감 섹션과 변경
         * 건수뿐이다). 그래서 본문 대신 사유를 말한다.
         */
        <div className="mt-6">
          <EmptyState kind={reason} />
        </div>
      ) : (
        <div className="mt-4">
          <ReportDocument markdown={markdown} filename={`weekly-${period.weekStart}.md`} />
        </div>
      )}
    </PageShell>
  );
}
