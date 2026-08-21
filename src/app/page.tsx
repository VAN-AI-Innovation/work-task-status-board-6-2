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
 * 알림·목표 섹션은 아직 없다 — 각각 뒤 step의 몫이라 자리를 비워 둔다.
 *
 * 차트도 여기서 세지 않는다. `buildStatusDonut`·`buildCompletionBars`가 만든 배열만
 * 클라이언트 컴포넌트로 넘어간다 — 업무 배열 전량을 넘기면 직렬화 비용을 치르고 클라이언트
 * 번들에 업무 데이터가 통째로 들어간다.
 */

import Link from 'next/link';

import { CompletionBars } from '@/components/charts/completion-bars';
import { StatusDonut } from '@/components/charts/status-donut';
import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { TeamSummaryTable } from '@/components/dashboard/team-summary-table';
import { PageShell } from '@/components/shell/page-shell';
import { EmptyState } from '@/components/tasks/empty-state';
import { FilterBar } from '@/components/tasks/filter-bar';
import { TaskTable } from '@/components/tasks/task-table';
import { SeedButton } from '@/components/upload/seed-button';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { toTaskListResponse } from '@/lib/api/task-response';
import { buildKpiStrip, summarizeAllTeams } from '@/lib/domain/progress-stats';
import { getStorage } from '@/lib/store/store-factory';
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
import { sortTasks } from '@/lib/view/task-sort';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결 여부도 건수도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 데이터를 넣어도 화면이 계속 "아직 데이터가 없습니다"라고 말한다.
 */
export const dynamic = 'force-dynamic';

/** 이 화면의 링크가 돌아올 자리. 필터를 얹는 모든 링크가 여기서 시작한다 */
const PATHNAME = '/';

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

  return (
    <PageShell mode={read.meta.mode} freshness={freshness} role={read.role} query={query}>
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
          <KpiStrip tiles={buildKpiStrip(read.tasks, read.ctx)} />
          <TeamSummaryTable teams={teams} />

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

          <section className="border-line bg-panel rounded-md border p-5">
            <h2 className="text-ink text-sm font-semibold">업무</h2>
            <div className="mt-3">
              <FilterBar query={query} pathname={PATHNAME} />
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
        </div>
      )}
    </PageShell>
  );
}
