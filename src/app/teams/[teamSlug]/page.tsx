/**
 * 부서별 탭 (`/teams/[teamSlug]`). 과제 원문의 「각 부서마다 new tabs」를 라우트로 충족한다.
 *
 * **새로 만든 것은 슬러그 변환 하나뿐이다.** KPI·상태 분포·필터 바·업무 표는 전부 대시보드와 같은
 * 컴포넌트이고, 데이터도 같은 경로(`currentViewerContext` → `buildReadContext` → `lib/domain`)로 읽는다.
 * 팀 화면 전용 컴포넌트를 만들면 같은 숫자를 두 곳에서 세게 되고 그때 둘이 갈라진다.
 *
 * ## 경로가 `?team=`을 이긴다
 *
 * 필터는 URL 쿼리가 단일 소스지만 **팀만은 예외**다 — 경로가 이미 팀을 말했으므로
 * `filter.teamKeys`를 이 팀 하나로 **덮어쓴다.** `/teams/edit?team=shoot`이 촬영팀을 보여 주면
 * 그 링크는 거짓말이고, 링크 공유(`UC-11`)가 이 화면의 존재 이유라 그것이 곧 기능의 실패다.
 * 같은 이유로 `query.team`을 비워 **이 화면이 만드는 링크에 `?team=`이 다시 실리지 않게** 한다.
 *
 * 모르는 슬러그는 `notFound()`다. 전사 대시보드로 넘기면 오타 링크가 조용히 다른 화면을
 * 보여 주고, 그것을 본 사람은 데이터를 의심한다.
 *
 * 팀별 요약표와 완료율 바는 **넣지 않는다** — 행이 하나뿐인 표와 막대 하나짜리 차트는
 * 정보가 아니다. 전사 비교는 `/`가 진다.
 *
 * 같은 이유로 **승인 대기함도 `/`가 진다.** 이 화면에는 알림 패널만 두고, 목표 대비 성과는
 * 그 팀 지표만 뽑아 보여준다 — 저장소에서 팀으로 좁혀 읽으므로 경고 건수도 그 팀 것이다.
 *
 * ## 섹션 순서는 `/`와 같은 표를 본다
 *
 * `sectionsFor(role)`가 정한다 (완료 기준 7). 다만 이 화면에 **없는 섹션은 건너뛴다** —
 * 팀 요약표·완료율 바(`teams`)·승인 대기함(`approvals`)·주간 브리핑(`briefing`)은 위 이유로
 * `/`가 지기 때문이고, 순서 표를 팀 화면용으로 따로 만들면 두 화면의 역할 규칙이 갈라진다.
 */

import { notFound, redirect } from 'next/navigation';

import type { ReactNode } from 'react';

import { AlertPanel } from '@/components/alerts/alert-panel';
import { StatusBars } from '@/components/charts/status-bars';
import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { GoalSection } from '@/components/goals/goal-section';
import { PageShell } from '@/components/shell/page-shell';
import { SectionGrid } from '@/components/shell/section-grid';
import { EmptyState } from '@/components/tasks/empty-state';
import { FilterBar } from '@/components/tasks/filter-bar';
import { TaskPanelSlot } from '@/components/tasks/task-panel-slot';
import { TaskTable } from '@/components/tasks/task-table';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { toGoalResponse, toTaskListResponse } from '@/lib/api/task-response';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { canSeeTeam } from '@/lib/domain/team-visibility';
import { toAccount } from '@/lib/auth/viewer-session';
import { collectAlerts } from '@/lib/domain/alert-rules';
import { summarizeGoals } from '@/lib/domain/goal-stats';
import { buildKpiStrip } from '@/lib/domain/progress-stats';
import { STATUS_OPTIONS } from '@/lib/domain/task-semantic';
import { scopeTasks } from '@/lib/domain/viewer-scope';
import { groupAlerts } from '@/lib/view/alert-groups';
import { buildStatusBreakdown, toStatusSeries } from '@/lib/view/chart-series';
import {
  applyDisplayFilter,
  buildHref,
  countActiveFilters,
  FILTER_RESET_PATCH,
  parseDashboardQuery,
  toURLSearchParams,
} from '@/lib/view/dashboard-query';
import { emptyReason } from '@/lib/view/empty-reason';
import { toGoalRows } from '@/lib/view/goal-view';
import {
  COMPACT_KPI_KEYS,
  layoutFor,
  TEAM_PAGE_LAYOUT,
  type SectionKey,
} from '@/lib/view/role-layout';
import { sortTasks } from '@/lib/view/task-sort';
import { describeSync } from '@/lib/view/sync-freshness';
import { teamLabel, toTeamKey, toTeamSlug } from '@/lib/view/team-slug';

/** `/`와 같은 이유다 — 건수도 저장소 연결 여부도 빌드 시각이 아니라 요청 시각의 사실이다 */
export const dynamic = 'force-dynamic';


export default async function TeamPage({ params, searchParams }: PageProps<'/teams/[teamSlug]'>) {
  // Next 16에서 `params`·`searchParams`는 **둘 다** Promise다
  const { teamSlug } = await params;
  const teamKey = toTeamKey(teamSlug);
  if (teamKey === null) notFound();

  const view = await currentViewerContext();
  const sp = toURLSearchParams(await searchParams);

  /* 이 화면의 링크가 돌아올 자리. `teamSlug` 원문이 아니라 정규화한 슬러그를 쓴다 */
  const pathname = `/teams/${toTeamSlug(teamKey)}`;

  // 승인을 기다리는 계정은 여기서 `/pending`으로 간다 (T11 · `pending-gate.ts`)
  const gate = gateForSession(view.session, pathname);
  if (gate.kind === 'redirect') redirect(gate.to);

  // `team`을 비운다 — 경로가 이미 팀이므로 링크가 그것을 다시 실으면 두 소스가 된다
  const query = { ...parseDashboardQuery(sp), team: [] };

  const parsed = parseTaskQuery(sp);
  const read = await buildReadContext(view, new Date(), {
    as: sp.get('as'),
    ...parsed,
    // 경로가 이긴다 (머리말)
    filter: { ...parsed.filter, teamKeys: [teamKey] },
  });

  const freshness = describeSync(read.meta.lastSyncedAt, read.meta.today);
  // 판정은 조회 응답과 **같은 함수**가 한다. 화면이 5색을 다시 매기면 API와 갈라진다 (`ADR-006`)
  const listed = toTaskListResponse(read.tasks, read.ctx.flags, read.role);
  const visible = sortTasks(applyDisplayFilter(listed, query), query.sort);
  const activeFilters = countActiveFilters(query);

  /* `/`와 같은 두 값이다 — 고르는 규칙도 판정도 화면이 아니라 `lib`이 진다 */
  const reason = emptyReason(read.viewer, activeFilters);
  const editableIds =
    read.viewer === null
      ? new Set<string>()
      : new Set(scopeTasks(read.tasks, read.viewer).map((task) => task.id));

  /* `/`와 같은 규칙이다 — 이름은 화면이 자기 목록에서 붙이고, 못 붙이는 항목은 빼낸다 (`S6`) */
  const titles = new Map(visible.map((task) => [task.id, task.title ?? task.sourceKey]));
  const alertGroups = groupAlerts(
    collectAlerts(read.tasks, read.stages, read.ctx),
    new Set(titles.keys())
  );

  // 성과 행에도 담당자·채널이 섞여 들어온다. `toGoalResponse`를 거른다 (`S6`)
  /*
   * **남의 팀 화면은 없는 것으로 둔다** (`team-visibility.ts`). 사이드바가 항목을 감추는
   * 것과 **같은 함수**를 쓴다 — 두 곳이 각자 판단하면 목록에는 없는데 주소로는 열리는 날이 온다.
   *
   * 403이 아니라 404인 이유는 `/members`와 같다: 「그 팀 화면은 있지만 당신 것이 아니다」가
   * 곧 정보다. 데이터는 이미 RLS가 막고 있어 열려도 빈 화면이지만, **빈 화면은 「데이터가
   * 없다」와 구분되지 않는다** — 그것이 이 줄이 없애는 헛걸음이다.
   */
  if (!canSeeTeam(read.role, read.viewer?.teamId ?? null, read.viewer !== null, teamKey)) {
    notFound();
  }

  const goalStats = summarizeGoals(await view.repo.listGoalMetrics({ teamKeys: [teamKey] }));
  const goalRows = toGoalRows(toGoalResponse(goalStats.items, read.role));

  /** `/`와 같다 — `member`가 자기 업무를 고르지 않은 상태. 이름을 대신 채워 넣지 않는다 */
  const needsOwnerHint = read.role === 'member' && query.owner === null;

  /**
   * 이 화면이 그리는 섹션. **`/`가 지기로 한 것(`teams`·`approvals`·`briefing`)은 `null`이라
   * 순서 배열에서 조용히 빠진다** — 역할 표는 하나이고 화면마다 있는 섹션만 다르다.
   */
  const renderSection = (key: SectionKey): ReactNode => {
    switch (key) {
      case 'kpi':
        return <KpiStrip tiles={buildKpiStrip(read.tasks, read.ctx)} />;

      case 'kpi_compact':
        // 10칸을 다시 세지 않고 `buildKpiStrip`의 결과에서 골라 쓴다 (`ADR-006`)
        return (
          <KpiStrip
            compact
            tiles={buildKpiStrip(read.tasks, read.ctx).filter((tile) =>
              COMPACT_KPI_KEYS.includes(tile.key)
            )}
          />
        );

      case 'charts':
        /*
         * 대시보드와 같은 가로 막대다 (`ADR-019`). 이 화면에서는 **알림 오른쪽 칸**에
         * 목표 대비 성과와 함께 세로로 선다.
         */
        return (
          <section className="border-line bg-panel flex h-full flex-col rounded-md border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-brand text-sm font-semibold">상태 분포</h2>
              <span className="text-ink-muted text-xs tabular-nums">전체 {listed.length}건</span>
            </div>
            <p className="text-ink-muted mt-1 text-xs">지연이 다른 상태를 덮어쓴다</p>
            {/* 차트 높이가 확정이라 여기서 늘이지 않는다 (`status-bars.tsx` 머리말) */}
            <div className="mt-3">
              <StatusBars series={toStatusSeries(buildStatusBreakdown(listed))} />
            </div>
          </section>
        );

      case 'goals':
        return (
          <GoalSection
            rows={goalRows}
            byTeam={goalStats.byTeam}
            mismatchCount={goalStats.warnings.length}
          />
        );

      case 'alerts':
        return (
          <AlertPanel
            groups={alertGroups}
            titleOf={(taskId) => titles.get(taskId) ?? taskId}
            hrefOf={(taskId) => buildHref(pathname, query, { task: taskId })}
          />
        );

      case 'tasks':
        return (
          <section className="border-line bg-panel rounded-md border p-4">
            {/* `/`와 **같은 격자**다 — 제목과 필터를 겹쳐 놓아 버튼은 제목 줄 오른쪽 끝에 서고
                펼친 패널은 카드 폭 전체를 쓴다. 안내문은 격자 밖에 둔다 */}
            <div className="grid grid-cols-1 items-start">
              <h2 className="text-brand col-start-1 row-start-1 text-sm font-semibold">업무</h2>
              <div className="col-start-1 row-start-1">
                <FilterBar query={query} pathname={pathname} showTeamChips={false} />
              </div>
            </div>
            {needsOwnerHint && (
              <p className="text-ink-muted mt-2 text-xs">
                담당자를 지정하면 내 업무만 볼 수 있습니다 — 「필터」를 열고 「담당자」 칸에 이름을
                넣고 Enter를 누르세요.
              </p>
            )}
            {/* `/`와 같은 자리다 — 패널은 오버레이지만 「필터 밖」 안내는 표 위에 붙는다 */}
            <div className="mt-3">
              <TaskPanelSlot
                tasks={visible}
                stages={read.stages}
                role={read.role}
                query={query}
                pathname={pathname}
                editableIds={editableIds}
                statusOptions={STATUS_OPTIONS}
              />
            </div>
            {visible.length === 0 ? (
              /*
               * 두 사실을 가른다 — 걸린 필터가 있으면 「조건에 맞는 업무가 없습니다」와
               * 초기화 링크이고, 없으면 이 팀에 업무가 없는 것이라 초기화할 것도 없다 (`X3`).
               */
              /*
               * 세 번째 갈래가 붙었다 — 로그인한 부원의 계정이 담당자에 이어지지 않으면
               * 필터를 지워도 결과가 같으므로 초기화 링크를 주지 않는다 (`emptyReason`).
               */
              reason === 'no-match' ? (
                <EmptyState
                  kind="no-match"
                  resetHref={buildHref(pathname, query, FILTER_RESET_PATCH)}
                />
              ) : (
                <EmptyState kind={reason} />
              )
            ) : (
              <div className="mt-4">
                <TaskTable tasks={visible} query={query} pathname={pathname} />
              </div>
            )}
          </section>
        );

      /*
       * `TEAM_PAGE_LAYOUT.only`가 이미 걸러 내므로 여기까지 오지 않는다. 그래도 남겨 두는 것은
       * `SectionKey`가 늘어날 때 **여기서 타입 에러가 나야** 새 섹션을 이 화면에 둘지
       * 결정하게 되기 때문이다 — 조용히 빠지면 아무도 그 결정을 하지 않는다.
       */
      case 'teams':
      case 'completion':
      case 'approvals':
      case 'briefing':
        return null;
    }
  };

  return (
    <PageShell
      mode={read.meta.mode}
      driver={read.meta.driver}
      freshness={freshness}
      role={read.role}
      query={query}
      account={toAccount(view.session)}
    >
      <h1 className="text-brand text-xl font-semibold">{teamLabel(teamKey)}</h1>

      <div className="mt-4">
        <SectionGrid
          rows={layoutFor(read.role, TEAM_PAGE_LAYOUT)}
          render={renderSection}
          /* 접힌 줄에도 건수가 남는다 — 접힌 것과 비어 있는 것이 같아 보이면 안 된다 */
          hint={() => `지표 ${goalRows.length}개`}
        />
      </div>
    </PageShell>
  );
}
