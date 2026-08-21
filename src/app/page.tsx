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

import { SeedButton } from '@/components/upload/seed-button';
import { StorageBanner } from '@/components/upload/storage-banner';
import { daysBetween, kstDateOf, kstToday } from '@/lib/domain/kst-today';
import { getStorage } from '@/lib/store/store-factory';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결 여부도 건수도 빌드 시각이 아니라 요청 시각의
 * 사실이다. 프리렌더하면 데이터를 넣어도 화면이 계속 "아직 데이터가 없습니다"라고 말한다.
 */
export const dynamic = 'force-dynamic';

/** 「마지막 반영」이 이 일수를 넘으면 경고색 (`UI_GUIDE.md`). 표시 규칙이라 T6이 이어받는다 */
const STALE_DAYS = 5;

export default async function Home() {
  const { repo, readOnly, mode } = await getStorage();

  // 건수를 세려면 목록이 필요하다. 조직 전체가 수백~수천 행이라 전량 로드가 문제가 아니라는
  // 것이 `ADR-006`의 전제이고, T6도 같은 방식으로 읽는다
  const tasks = await repo.listTasks();
  const lastSyncedAt = await repo.getLastSyncedAt();

  const syncedDate = kstDateOf(lastSyncedAt);
  const staleDays = syncedDate === null ? null : daysBetween(syncedDate, kstToday(new Date()));

  return (
    <main className="flex-1 bg-neutral-50">
      <StorageBanner mode={mode} />

      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold text-neutral-900">전사 업무 현황판</h1>
          <p
            className={`text-xs ${
              staleDays !== null && staleDays > STALE_DAYS ? 'text-amber-700' : 'text-neutral-500'
            }`}
          >
            {staleDays === null ? '마지막 반영: 기록 없음' : `마지막 반영: ${staleDays}일 전`}
          </p>
        </div>

        {tasks.length === 0 ? (
          // 빈 상태 화면은 `UI_GUIDE.md`가 중앙 정렬을 금지하면서 **예외로 둔 유일한 자리**다
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <p className="text-sm text-neutral-500">아직 데이터가 없습니다</p>
            <div className="flex items-center gap-3">
              {/* 읽기 전용에서는 비활성이다. 다만 방어는 서버가 한다 (`ADR-005`) */}
              <SeedButton disabled={readOnly} />
              <Link
                href="/upload"
                className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
              >
                시트 업로드하기
              </Link>
            </div>
            {readOnly && (
              <p className="text-xs text-neutral-500">
                저장소 연결이 복구되어야 샘플 데이터를 불러올 수 있습니다.
              </p>
            )}
          </div>
        ) : (
          // 대시보드는 T6이 짓는다. 여기서 만들면 T6이 지우고 다시 짜야 한다
          <div className="mt-6 rounded-md border border-neutral-200 bg-white p-5">
            <p className="text-sm text-neutral-700">
              업무 <span className="tabular-nums font-semibold text-neutral-900">{tasks.length}</span>건이
              반영돼 있습니다.
            </p>
            <p className="mt-1 text-xs text-neutral-500">통합 대시보드 화면은 준비 중입니다.</p>
            <Link
              href="/upload"
              className="mt-4 inline-block rounded border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
            >
              시트 업로드
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
