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
 * 「조회 실패」는 `error.tsx`가, 「필터 결과 0건」은 업무 표(step 5)가 진다.
 * 차트·업무 표·알림·목표 섹션은 아직 없다 — 각각 뒤 step의 몫이라 자리를 비워 둔다.
 */

import Link from 'next/link';

import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { TeamSummaryTable } from '@/components/dashboard/team-summary-table';
import { PageShell } from '@/components/shell/page-shell';
import { SeedButton } from '@/components/upload/seed-button';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { buildKpiStrip, summarizeAllTeams } from '@/lib/domain/progress-stats';
import { getStorage } from '@/lib/store/store-factory';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결 여부도 건수도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 데이터를 넣어도 화면이 계속 "아직 데이터가 없습니다"라고 말한다.
 */
export const dynamic = 'force-dynamic';

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

  return (
    <PageShell mode={read.meta.mode} freshness={freshness} role={read.role} query={query}>
      <h1 className="text-ink text-xl font-semibold">전사 업무 현황판</h1>

      {read.tasks.length === 0 ? (
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
          <TeamSummaryTable teams={summarizeAllTeams(read.tasks, read.ctx)} />
        </div>
      )}
    </PageShell>
  );
}
