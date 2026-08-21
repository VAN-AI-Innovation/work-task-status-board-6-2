/**
 * 진입 화면. **여기는 아직 대시보드가 아니다** — KPI·차트·필터는 T6의 범위이고, 이 화면이
 * 지는 것은 `X3`의 갈래 구분 중 둘뿐이다.
 *
 * ```
 * 데이터 없음      → "아직 데이터가 없습니다" + [샘플 데이터 불러오기] [시트 업로드하기]
 * 저장소 연결 실패  → "읽기 전용 — 저장소 연결 실패" 배너 (StorageBanner)
 * ```
 *
 * 「조회 실패」는 `error.tsx`가, 「필터 결과 0건」은 T6이 진다.
 *
 * `getStorage()`와 `lib/domain`을 **직접** 부른다. 자기 API를 `fetch`하지 않는다 (`ADR-007`).
 */

import Link from 'next/link';

import { PageShell } from '@/components/shell/page-shell';
import { SeedButton } from '@/components/upload/seed-button';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { kstToday } from '@/lib/domain/kst-today';
import { getStorage } from '@/lib/store/store-factory';
import { parseDashboardQuery } from '@/lib/view/dashboard-query';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결 여부도 건수도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 데이터를 넣어도 화면이 계속 "아직 데이터가 없습니다"라고 말한다.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const { repo, readOnly, mode } = await getStorage();

  // 건수를 세려면 목록이 필요하다. 조직 전체가 수백~수천 행이라 전량 로드가 문제가 아니라는
  // 것이 `ADR-006`의 전제이고, T6도 같은 방식으로 읽는다
  const tasks = await repo.listTasks();
  const lastSyncedAt = await repo.getLastSyncedAt();

  const freshness = describeSync(lastSyncedAt, kstToday(new Date()));
  // `searchParams`를 아직 받지 않는다 — 필터가 붙는 것은 step 3이다. 그때까지 셸은 기본
  // 쿼리로 링크를 만든다 (`?as=` 전환도 그 위에서 성립한다)
  const query = parseDashboardQuery(new URLSearchParams());
  const role = resolveViewerRole(query.as, { nodeEnv: process.env.NODE_ENV, mode });

  return (
    <PageShell mode={mode} freshness={freshness} role={role} query={query}>
      <h1 className="text-ink text-xl font-semibold">전사 업무 현황판</h1>

      {tasks.length === 0 ? (
        // 빈 상태 화면은 `UI_GUIDE.md`가 중앙 정렬을 금지하면서 **예외로 둔 유일한 자리**다
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="text-ink-muted text-sm">아직 데이터가 없습니다</p>
          <div className="flex items-center gap-3">
            {/* 읽기 전용에서는 비활성이다. 다만 방어는 서버가 한다 (`ADR-005`) */}
            <SeedButton disabled={readOnly} />
            <Link
              href="/upload"
              className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
            >
              시트 업로드하기
            </Link>
          </div>
          {readOnly && (
            <p className="text-ink-muted text-xs">
              저장소 연결이 복구되어야 샘플 데이터를 불러올 수 있습니다.
            </p>
          )}
        </div>
      ) : (
        // 대시보드는 T6이 짓는다. 여기서 만들면 T6이 지우고 다시 짜야 한다
        <div className="border-line bg-panel mt-6 rounded-md border p-5">
          <p className="text-ink-body text-sm">
            업무 <span className="text-ink font-semibold tabular-nums">{tasks.length}</span>건이
            반영돼 있습니다.
          </p>
          <p className="text-ink-muted mt-1 text-xs">통합 대시보드 화면은 준비 중입니다.</p>
          <Link
            href="/upload"
            className="border-line bg-panel text-ink hover:bg-raise mt-4 inline-block rounded border px-4 py-2 text-sm"
          >
            시트 업로드
          </Link>
        </div>
      )}
    </PageShell>
  );
}
