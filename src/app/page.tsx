/**
 * 통합 대시보드 (`UC-07`). **T6 전체의 데이터 경로가 여기서 확정된다** — 뒤의 화면들이
 * 전부 같은 방식으로 읽는다.
 *
 * ```
 * getStorage() → buildReadContext(storage, now, …) → lib/domain 집계 함수
 * ```
 *
 * `buildReadContext`를 조회 라우트와 **같이** 쓰는 것이 요점이다. 화면이 따로 세기 시작하면
 * `/api/stats`와 대시보드가 다른 값을 말하는 날이 오고, 그날 둘 다 못 믿게 된다. 마스킹(`S6`)·
 * 역할 해석(`ADR-013`)·지연 필터도 그 함수 안에 있어서, 화면이 다시 만들면 그 규칙도 갈라진다.
 *
 * 자기 API를 `fetch`하지 않는다 (`ADR-007`). 계산도 한 줄 두지 않는다 (`CLAUDE.md` CRITICAL) —
 * 숫자는 전부 `buildKpiStrip`·`summarizeAllTeams`가 낸 것이다.
 *
 * 이 화면이 지는 갈래는 여전히 `X3`의 둘이다.
 *
 * ```
 * 데이터 없음      → "아직 데이터가 없습니다" + [샘플 데이터 불러오기] [시트 업로드하기]
 * 저장소 연결 실패  → "읽기 전용 — 저장소 연결 실패" 배너 (PageShell)
 * ```
 *
 * 「조회 실패」는 `error.tsx`가 지고, **「필터 결과 0건」은 업무 표가 따로 진다** —
 * 전체가 0건인 것과 조건에 맞는 게 없는 것은 다른 사실이라 문구를 섞지 않는다.
 * 알림 패널과 목표 대비 성과 섹션도 같은 규칙을 따른다. 알림의 판정은 `collectAlerts`가,
 * 달성률 재계산은 `summarizeGoals`가 한다 — **업무명만 화면이 붙인다.** `Alert`에 이름이
 * 없는 것은 의도이고(그 응답이 화면 밖으로도 나간다, `S6`), 그래서 이름을 못 붙이는
 * 항목(필터에 걸려 목록에서 빠진 건)은 알림에서도 뺀다.
 *
 * **섹션 순서는 역할이 정한다** (`sectionsFor`, 완료 기준 7). 세 역할이 보는 것은 같은
 * 데이터이고 같은 섹션이며, 다른 것은 무엇이 맨 위에 오느냐뿐이다 — 필요한 사람이 스크롤하면
 * 나머지도 다 있다. **삭제하지 않는 것이 요점이다**: 지금 섹션을 빼면 권한을 구현한 것처럼
 * 보이지만 서버는 아무것도 막지 않아 URL 하나로 뚫린다. 권한은 T8이다.
 *
 * 주간 브리핑도 여기서 짓지 않는다 — `buildWeeklyReport`가 만든 **마크다운 문자열**을 그대로
 * 카드에 넘긴다. 자기 API(`/api/report/weekly`)를 부르지 않는 것은 다른 섹션과 같은 이유다
 * (`ADR-007`).
 *
 * 차트도 여기서 세지 않는다. `buildStatusDonut`·`buildCompletionBars`가 만든 배열만
 * 클라이언트 컴포넌트로 넘어간다 — 업무 배열 전량을 넘기면 직렬화 비용을 치르고 클라이언트
 * 번들에 업무 데이터가 통째로 들어간다.
 */

import Link from 'next/link';

import { Fragment, type ReactNode } from 'react';

import { AlertPanel } from '@/components/alerts/alert-panel';
import { ApprovalQueue } from '@/components/alerts/approval-queue';
import { CompletionBars } from '@/components/charts/completion-bars';
import { StatusDonut } from '@/components/charts/status-donut';
import { BriefingCard } from '@/components/dashboard/briefing-card';
import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { TeamSummaryTable } from '@/components/dashboard/team-summary-table';
import { GoalSection } from '@/components/goals/goal-section';
import { PageShell } from '@/components/shell/page-shell';
import { EmptyState } from '@/components/tasks/empty-state';
import { FilterBar } from '@/components/tasks/filter-bar';
import { TaskPanelSlot } from '@/components/tasks/task-panel-slot';
import { TaskTable } from '@/components/tasks/task-table';
import { SeedButton } from '@/components/upload/seed-button';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { toGoalResponse, toTaskListResponse } from '@/lib/api/task-response';
import { collectAlerts } from '@/lib/domain/alert-rules';
import { summarizeGoals } from '@/lib/domain/goal-stats';
import { buildKpiStrip, summarizeAllTeams } from '@/lib/domain/progress-stats';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { getStorage } from '@/lib/store/store-factory';
import { approvalQueue, groupAlerts } from '@/lib/view/alert-groups';
import {
  buildCompletionBars,
  buildStatusDonut,
  unmeasurableTeams,
} from '@/lib/view/chart-series';
import {
  applyDisplayFilter,
  buildHref,
  countActiveFilters,
  FILTER_RESET_PATCH,
  parseDashboardQuery,
  toURLSearchParams,
} from '@/lib/view/dashboard-query';
import { toGoalRows } from '@/lib/view/goal-view';
import { COMPACT_KPI_KEYS, sectionsFor, type SectionKey } from '@/lib/view/role-layout';
import { sortTasks } from '@/lib/view/task-sort';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결 여부도 건수도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 데이터를 넣어도 화면이 계속 "아직 데이터가 없습니다"라고 말한다.
 */
export const dynamic = 'force-dynamic';

/** 이 화면의 링크가 돌아올 자리. 필터를 얹는 모든 링크가 여기서 시작한다 */
const PATHNAME = '/';

/**
 * 브리핑의 「이번 주 변경 건수」가 0인 이유를 카드에 그대로 적는다.
 * `TaskRepository`에 이벤트 **조회** 메서드가 없어 `events: []`를 넘기기 때문이고
 * (`/api/report/weekly`의 주석이 같은 말을 한다), 0을 그냥 두면 회의에서
 * 「이번 주 아무 일도 없었다」로 읽힌다. 없는 숫자를 지어내지 않는 대신 사실을 밝힌다.
 */
const BRIEFING_NOTE =
  '변경 건수는 이력 조회 경로가 없어 집계되지 않습니다 (T9에서 `listEvents`를 더한다).';

export default async function Home({ searchParams }: PageProps<'/'>) {
  const storage = await getStorage();
  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  const query = parseDashboardQuery(sp);
  const read = await buildReadContext(storage, new Date(), {
    as: sp.get('as'),
    ...parseTaskQuery(sp),
  });

  const freshness = describeSync(read.meta.lastSyncedAt, read.meta.today);
  const teams = summarizeAllTeams(read.tasks, read.ctx);
  /*
   * 도넛과 표가 보는 `displayStatus`는 조회 응답과 **같은 함수**가 만든 것이다. 화면이
   * 여기서 5색 판정을 다시 하면 마스킹·판정 규칙이 API와 갈라진다 (`ADR-006`).
   */
  const listed = toTaskListResponse(read.tasks, read.ctx.flags, read.role);
  /*
   * 표에 실제로 보이는 목록. 5색 칩(`?display=`)은 **판정을 거친 뒤**라야 거를 수 있어서
   * 저장소가 아니라 여기서 건다 (`ADR-006`). 팀·담당자·마감 범위·검색은 이미
   * `buildReadContext`가 걸어서 `read.tasks`가 좁혀져 있다.
   */
  const visible = sortTasks(applyDisplayFilter(listed, query), query.sort);
  /*
   * **「데이터 없음」과 「필터 0건」을 가르는 것이 이 숫자다** (`X3`). `read.tasks`는 이미
   * 필터를 거친 목록이라 0건이라는 사실만으로는 둘을 구분할 수 없다 — 담당자 이름을 잘못
   * 친 사용자에게 「아직 데이터가 없습니다」가 뜨면 멀쩡한 데이터를 두고 업로드하러 간다.
   * 걸린 필터가 하나도 없는데 0건일 때만 진짜 빈 저장소다.
   */
  const activeFilters = countActiveFilters(query);

  /*
   * 알림·승인 대기함이 보는 목록은 **표에 실제로 보이는 것**(`visible`)이다. 이름을 붙일 수
   * 없는 항목은 클릭할 수 없는 줄이 되므로 목록에서 빠진 `taskId`는 알림에서도 뺀다.
   */
  const titles = new Map(visible.map((task) => [task.id, task.title ?? task.sourceKey]));
  const titleOf = (taskId: string): string => titles.get(taskId) ?? taskId;
  const taskHrefOf = (taskId: string): string => buildHref(PATHNAME, query, { task: taskId });

  const alertGroups = groupAlerts(
    collectAlerts(read.tasks, read.stages, read.ctx),
    new Set(titles.keys())
  );
  const waiting = approvalQueue(visible, read.meta.today);

  /*
   * 목표 지표는 업무 필터를 타지 않는다 — 성과 지표는 진행 상태·마감·담당자 축이 아니라
   * 목표값 대 실적값 축으로 움직인다 (`ADR-002`). `toGoalResponse`를 반드시 거친다:
   * 성과 행에도 담당자·채널·문의자 계정이 섞여 들어온다 (`S6`).
   *
   * 저장소는 **한 번만** 읽는다 — 같은 목록을 목표 섹션과 브리핑이 함께 본다.
   */
  const goals = await storage.repo.listGoalMetrics();
  const goalStats = summarizeGoals(goals);
  const goalRows = toGoalRows(toGoalResponse(goalStats.items, read.role));

  /*
   * 브리핑은 `buildWeeklyReport`가 만든 마크다운 문자열 그대로다 (`UC-08`). 화면이 보고 있는
   * 것과 **같은 목록**(`read.tasks`)을 넘기므로, 필터를 걸어 둔 채 복사해도 회의록의 숫자가
   * 화면과 어긋나지 않는다. `events`가 빈 배열인 이유는 `BRIEFING_NOTE`에 적었다.
   */
  const briefing = buildWeeklyReport({
    tasks: read.tasks,
    stages: read.stages,
    goals,
    events: [],
    ctx: read.ctx,
  });

  /** `member`가 자기 업무를 고르지 않은 상태. 이름을 대신 채워 넣지 않는다 (`UC-14`) */
  const needsOwnerHint = read.role === 'member' && query.owner === null;

  /**
   * 섹션 하나를 그린다. **순서는 `sectionsFor`가 정하고 여기서는 무엇을 그릴지만 안다.**
   * 컴포넌트는 전부 앞 step들이 만들어 둔 것이라 이 함수에 계산이 없다.
   */
  const renderSection = (key: SectionKey): ReactNode => {
    switch (key) {
      case 'kpi':
        return <KpiStrip tiles={buildKpiStrip(read.tasks, read.ctx)} />;

      case 'kpi_compact':
        /*
         * 10칸을 다시 세지 않고 **`buildKpiStrip`의 결과에서 골라 쓴다** — 화면이 따로 세면
         * 같은 라벨이 두 값을 갖는다 (`ADR-006`). 순서는 원본 배열 순서 그대로다.
         */
        return (
          <KpiStrip
            compact
            tiles={buildKpiStrip(read.tasks, read.ctx).filter((tile) =>
              COMPACT_KPI_KEYS.includes(tile.key)
            )}
          />
        );

      case 'teams':
        return <TeamSummaryTable teams={teams} />;

      case 'charts':
        return (
          <div className="grid grid-cols-12 gap-6">
            <section className="border-line bg-panel col-span-5 rounded-md border p-5">
              <h2 className="text-ink text-sm font-semibold">상태 분포</h2>
              <p className="text-ink-muted mt-1 text-xs">
                지연이 다른 상태를 덮어쓴다 · 「기타」는 보류·취소·미등록
              </p>
              <div className="mt-3">
                <StatusDonut series={buildStatusDonut(listed)} />
              </div>
            </section>

            <section className="border-line bg-panel col-span-7 rounded-md border p-5">
              <h2 className="text-ink text-sm font-semibold">팀별 완료율</h2>
              <p className="text-ink-muted mt-1 text-xs">완료 ÷ (전체 − 취소)</p>
              <div className="mt-3">
                <CompletionBars
                  series={buildCompletionBars(teams)}
                  unmeasurable={unmeasurableTeams(teams)}
                />
              </div>
            </section>
          </div>
        );

      case 'goals':
        return (
          <GoalSection
            rows={goalRows}
            byTeam={goalStats.byTeam}
            mismatchCount={goalStats.warnings.length}
          />
        );

      case 'briefing':
        return <BriefingCard markdown={briefing} note={BRIEFING_NOTE} />;

      case 'alerts':
        return <AlertPanel groups={alertGroups} titleOf={titleOf} hrefOf={taskHrefOf} />;

      case 'approvals':
        return <ApprovalQueue items={waiting} titleOf={titleOf} hrefOf={taskHrefOf} />;

      case 'tasks':
        return (
          <section className="border-line bg-panel rounded-md border p-5">
            <h2 className="text-ink text-sm font-semibold">업무</h2>
            {needsOwnerHint && (
              // 아래 필터 바의 「담당자」 칸을 가리킨다. 입력을 하나 더 두면 같은 `?owner=`에
              // 두 소스가 생겨 어느 쪽이 현재 값인지 눌러 봐야 안다
              <p className="text-ink-muted mt-1 text-xs">
                담당자를 지정하면 내 업무만 볼 수 있습니다 — 아래 「담당자」 칸에 이름을 넣고
                Enter를 누르세요.
              </p>
            )}
            <div className="mt-3">
              <FilterBar query={query} pathname={PATHNAME} />
            </div>
            {/* 패널은 `fixed` 오버레이라 여기 있어도 오른쪽에 뜬다. 표 위에 두는 이유는
                「필터 밖」 안내 한 줄이 붙을 자리가 여기이기 때문이다 (`UC-15`) */}
            <div className="mt-3">
              <TaskPanelSlot
                tasks={visible}
                stages={read.stages}
                role={read.role}
                query={query}
                pathname={PATHNAME}
              />
            </div>
            {visible.length === 0 ? (
              // 전체가 0건인 화면과 **다른 문구**다. 여기서 「데이터가 없습니다」가 뜨면
              // 사용자는 멀쩡한 데이터를 두고 업로드하러 간다 (`X3`)
              <EmptyState
                kind="no-match"
                resetHref={buildHref(PATHNAME, query, FILTER_RESET_PATCH)}
              />
            ) : (
              <div className="mt-4">
                <TaskTable tasks={visible} query={query} pathname={PATHNAME} />
              </div>
            )}
          </section>
        );
    }
  };

  return (
    <PageShell
      mode={read.meta.mode}
      driver={read.meta.driver}
      freshness={freshness}
      role={read.role}
      query={query}
    >
      <h1 className="text-ink text-xl font-semibold">전사 업무 현황판</h1>

      {read.tasks.length === 0 && activeFilters === 0 ? (
        // 빈 상태 화면은 `UI_GUIDE.md`가 중앙 정렬을 금지하면서 **예외로 둔 유일한 자리**다
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="text-ink-muted text-sm">아직 데이터가 없습니다</p>
          <div className="flex items-center gap-3">
            {/* 읽기 전용에서는 비활성이다. 다만 방어는 서버가 한다 (`ADR-005`) */}
            <SeedButton disabled={read.meta.readOnly} />
            <Link
              href="/upload"
              className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
            >
              시트 업로드하기
            </Link>
          </div>
          {read.meta.readOnly && (
            <p className="text-ink-muted text-xs">
              저장소 연결이 복구되어야 샘플 데이터를 불러올 수 있습니다.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {sectionsFor(read.role).map((key) => (
            <Fragment key={key}>{renderSection(key)}</Fragment>
          ))}
        </div>
      )}
    </PageShell>
  );
}
