/**
 * 주간 보고 전용 화면 (`UC-08`, 과제 요구 5번). 이 문서가 서는 **유일한 자리다** — 대시보드에
 * 접힌 카드로도 두었다가, 같은 문서가 두 화면에 있을 이유가 없어 이쪽만 남겼다.
 * 기간을 고를 수 있고, 본문 전체가 접히지 않은 채로 서고, 복사에 더해 내려받을 수 있다.
 *
 * 데이터 경로는 `/`·`/teams/*`와 같다. 자기 API(`/api/report/weekly`)를 `fetch`하지 않고
 * `lib/`를 직접 부른다 (`ADR-007`) — 그리고 라우트와 **같은 함수들**을 부른다
 * (`resolveReportPeriod` · `loadPeriodEvents` · `buildWeeklyReport`). 화면이 따로 세기
 * 시작하면 같은 주의 보고서가 API와 화면에서 다른 숫자를 내고, 그날 둘 다 못 믿게 된다.
 *
 * **부원에게는 열지 않는다** (`staff-tools.ts`). T9 결정 N은 「역할로 막지 않는다」였고
 * 근거는 「범위는 이미 데이터에서 잘렸다」였다 — 그 근거는 지금도 참이다(팀장이 여는
 * 보고서에는 자기 팀 업무만 들어 있다). 바뀐 것은 **이 문서의 쓰임**이다: 주간 보고는 회의에
 * 들고 가는 물건이고 부원에게는 그 자리가 없다. 그래서 여기서 빼는 것은 권한이 아니라
 * 메뉴이며, 진짜 문은 `GET /api/report/weekly`가 같은 함수로 내는 403이다.
 * 로그인 자체는 `src/proxy.ts`가 요구한다.
 *
 * **마크다운을 렌더하지 않는다** (`S7` · 결정 O). 서버에서 HTML로 바꾸면 sanitize가 필요해지고
 * 시트 셀에서 온 문자열이 그대로 DOM이 된다. 화면은 원문을 `<pre>`로 보여주고 복사·내려받기
 * 까지만 한다 — 내려받기도 클라이언트 `Blob`이라 파일을 주는 라우트가 없다.
 *
 * 이 화면에 계산이 없다. 주를 정하는 것은 `resolveReportPeriod`, 이동 링크는 `buildReportNav`,
 * 이력은 `loadPeriodEvents`, 세는 것은 `buildWeeklyReport`, 빈 화면의 사유는 `emptyReason`이다.
 */

import { notFound, redirect } from 'next/navigation';

import { ReportComposer } from '@/components/report/report-composer';
import { ReportDocument } from '@/components/report/report-document';
import { ReportPeriodNav } from '@/components/report/report-period-nav';
import { ReportReviewPanel, type ReviewRow } from '@/components/report/report-review-panel';
import { PageShell } from '@/components/shell/page-shell';
import { EmptyState } from '@/components/tasks/empty-state';
import { buildReadContext } from '@/lib/api/read-context';
import { loadPeriodEvents, parseReportQuery } from '@/lib/api/report-context';
import { toReportSubmissionsResponse } from '@/lib/api/report-submission-schema';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentSessionClient, currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { reportTeams, scopeReportInputs } from '@/lib/domain/report-scope';
import { canReviewReport, canSubmitReport } from '@/lib/domain/report-submission';
import { canReadWeeklyReport } from '@/lib/domain/staff-tools';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { emptyReason } from '@/lib/view/empty-reason';
import { mergeTeamReports } from '@/lib/view/report-merge';
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

  /*
   * **부원에게는 이 화면이 없는 것처럼 보인다** (`staff-tools.ts`). 아래 머리말이 「역할로
   * 막지 않는다」였던 자리다 — 부원이 열면 자기 업무만 담긴 보고서가 나왔고 그것 자체는
   * 사실이지만, 이 문서의 쓰임이 **회의에 들고 가는 것**이라 부원에게는 쓸 자리가 없다.
   * 범위는 여전히 데이터에서 잘린다(`viewer-scope.ts`·RLS) — 팀장이 여는 보고서에는
   * 자기 팀 업무만 들어 있다.
   */
  if (!canReadWeeklyReport(read.role, read.viewer !== null)) notFound();

  const period = resolveReportPeriod(read.ctx.today, parseReportQuery(sp));
  const nav = buildReportNav(period, read.ctx.today);

  const freshness = describeSync(read.meta.lastSyncedAt, read.meta.today);
  const query = parseDashboardQuery(sp);

  /*
   * 이력을 **읽지 못한 것**과 0건은 다르다. `loadPeriodEvents`가 `null`을 주면 보고서가
   * 「집계되지 않음」이라 적고, 빈 배열이면 「0건」이라 적는다 (T9 step 3·4).
   */
  /*
   * **보는 범위와 보고 범위가 다르다.** 팀장의 `read.tasks`는 전사이지만(`0012`), 자기
   * 이름으로 나가는 문서에는 자기 팀만 담는다 — 남의 팀 숫자가 섞인 보고서는 어드민이
   * 병합할 때 같은 업무를 두 번 세게 만든다 (`report-scope.ts` 머리말).
   *
   * `GET /api/report/weekly`가 **같은 두 함수**를 부른다. 화면과 API가 각자 좁히면 같은 주의
   * 보고서가 두 자리에서 다른 숫자를 낸다.
   */
  const reportScope = reportTeams(read.role, read.viewer?.teamId ?? null, read.viewer !== null);
  const scoped = scopeReportInputs(reportScope, {
    tasks: read.tasks,
    stages: read.stages,
    goals: await view.repo.listGoalMetrics(),
    events: await loadPeriodEvents(view.repo, period),
  });

  const markdown = buildWeeklyReport({
    teams: reportScope ?? undefined,
    tasks: scoped.tasks,
    stages: scoped.stages,
    goals: scoped.goals,
    period,
    events: scoped.events,
    ctx: read.ctx,
  });

  /*
   * **제출 목록.** `list_reports()`가 역할로 범위를 가른다 — 어드민은 전 팀, 팀장은 자기 팀
   * 하나다 (`0010` 5절). 저장소(`view.repo`)가 아니라 raw 클라이언트를 쓰는 이유는 이것이
   * 테이블이 아니라 `security definer` 함수이고, 그 검사가 `auth.uid()`에 기대기 때문이다
   * (`ADR-024` · `/members`·`/team/requests`와 같은 자리).
   *
   * 로그인하지 않았으면(데모) 부를 함수가 없다 — 빈 목록이고 아래 패널 둘 다 뜨지 않는다.
   */
  const viewerRole = view.session.status === 'ok' ? view.session.viewer.role : null;
  let submissions = toReportSubmissionsResponse(null).submissions;
  if (viewerRole !== null) {
    const client = await currentSessionClient();
    if (client !== null) {
      const { data, error } = await client.rpc('list_reports', { week: period.weekStart });
      // 메시지를 싣지 않는다. `error.tsx`가 예외 문자열을 한 글자도 렌더하지 않는다 (`X1`)
      if (error) throw new Error('list_reports failed');
      submissions = toReportSubmissionsResponse(data).submissions;
    }
  }

  /** 팀장이 보는 것은 자기 팀 하나다 — 함수가 이미 좁혔으므로 여기서 팀을 대조하지 않는다 */
  const mine = submissions[0] ?? null;

  /*
   * **어드민의 본문은 병합 문서다.** 팀장이 올린 본문과 특이사항을 팀 순서대로 잇는다 —
   * 여기서 다시 세지 않는다 (`report-merge.ts`). 팀장·데모는 계산본을 그대로 본다.
   */
  const canReview = viewerRole !== null && canReviewReport(viewerRole);
  const document = canReview ? mergeTeamReports(period, submissions) : markdown;

  /**
   * 제출 칸을 여는가. **어드민은 여기서 빠진다** — 받는 사람이 올리는 자리를 겸하면 반려라는
   * 절차가 성립하지 않는다 (`report-submission.ts`). 데모(로그인 없음)도 빠진다: 올릴 팀이
   * 없고 부를 함수도 없다.
   */
  const canCompose = viewerRole !== null && !canReview && canSubmitReport(viewerRole);

  /** 미제출 팀도 줄로 남는다 — 이 화면의 첫 정보는 「누가 안 냈는가」다 */
  const reviewRows: ReviewRow[] = TEAM_KEYS.map((teamId) => {
    const found = submissions.find((item) => item.teamId === teamId);
    return {
      teamId,
      status: found?.status ?? null,
      note: found?.note ?? '',
      reviewNote: found?.reviewNote ?? null,
      submittedOn: found?.submittedOn ?? null,
    };
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
      {/*
        제목 줄과 기간 이동은 **화면 장치라 인쇄물에서 뺀다** — 보고 본문이 자기 제목과
        기간을 이미 들고 있어(`# 주간 업무 보고 — …`) 종이에서는 같은 말이 두 번 뜬다.
        사이드바·상단바는 `globals.css`의 `@media print`가 접는다.
      */}
      <div className="print:hidden">
        <h1 className="text-brand text-xl font-semibold">주간 보고</h1>
        <p className="text-ink-body mt-1 text-sm">
          회의 직전에 열어 그대로 가져가는 화면입니다. 보이는 범위는 로그인한 계정의 권한을
          따릅니다.
        </p>

        <div className="mt-6">
          <ReportPeriodNav nav={nav} fellBack={period.fellBack} />
        </div>
      </div>

      {canReview && (
        <div className="mt-6">
          <ReportReviewPanel weekStart={period.weekStart} rows={reviewRows} />
        </div>
      )}

      {canCompose ? (
        /*
         * 팀장의 제출 칸 **과 보고 본문이 한 덩어리다** (`ReportComposer`). 아래 문서가
         * 그리는 것은 위 칸이 들고 있는 문자열이라, 한 줄을 고치면 문서도 그 자리에서
         * 바뀐다 — 예전에는 둘이 갈려서 「올린 것」과 「PDF로 저장한 것」이 달랐다.
         *
         * **업무가 0건이어도 뜬다** — 그 주에 올릴 것이 없다는 것도 보고이고, 특이사항은
         * 업무 건수와 무관하게 적을 수 있다. 그래서 아래 빈 화면 갈래보다 앞에 선다.
         */
        <ReportComposer
          weekStart={period.weekStart}
          computed={markdown}
          submittedBody={mine?.body ?? null}
          submittedNote={mine?.note ?? ''}
          status={mine?.status ?? null}
          reviewNote={mine?.reviewNote ?? null}
          submittedOn={mine?.submittedOn ?? null}
          filename={`weekly-${period.weekStart}.md`}
        />
      ) : read.tasks.length === 0 && !canReview ? (
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
          {/* 어드민은 병합 문서를, 나머지는 계산본을 본다. PDF·복사·내려받기는 같은 문자열이다 */}
          <ReportDocument
            markdown={document}
            filename={`weekly-${period.weekStart}${canReview ? '-all' : ''}.md`}
          />
        </div>
      )}
    </PageShell>
  );
}
