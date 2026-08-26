/**
 * 시트 업로드 화면. **주간 루프의 진입점**이라 여기가 귀찮으면 시스템 전체가 죽는다 (T5 목적문).
 *
 * 서버 컴포넌트가 하는 일은 저장소 상태를 읽어 배너를 고르고 패널에 넘기는 것뿐이다.
 * `currentViewerContext()`를 **직접** 부른다 — 자기 API를 `fetch`하면 불필요한 HTTP 왕복이 생긴다
 * (`ADR-007`).
 */

import { PageShell } from '@/components/shell/page-shell';
import { SheetUploadPanel } from '@/components/upload/sheet-upload-panel';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { kstToday } from '@/lib/domain/kst-today';
import { parseDashboardQuery } from '@/lib/view/dashboard-query';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결의 결과(연결 성공/실패)는 빌드 시각이 아니라
 * 요청 시각의 사실이다. 프리렌더하면 배너가 빌드 때 상태로 굳어, 저장소가 죽어도 화면은
 * 「정상」이라고 말한다 — `ADR-005`가 막으려는 조용한 오해가 그대로 생긴다.
 */
export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const view = await currentViewerContext();
  const { readOnly, mode, driver } = view.base;

  // 「마지막 반영」은 *모든* 페이지가 진다 (T6 완료 기준 8). 업로드 화면에서는 특히 —
  // 지금 올릴지 말지를 정하는 근거가 바로 이 숫자다
  const lastSyncedAt = await view.repo.getLastSyncedAt();
  const freshness = describeSync(lastSyncedAt, kstToday(new Date()));
  const query = parseDashboardQuery(new URLSearchParams());
  const role = resolveViewerRole(
    query.as,
    { nodeEnv: process.env.NODE_ENV, mode },
    view.session
  );

  return (
    <PageShell mode={mode} driver={driver} freshness={freshness} role={role} query={query}>
      <h1 className="text-brand text-xl font-semibold">시트 업로드</h1>
      <p className="text-ink-body mt-1 text-sm">
        Google Sheets에서 내보낸 .xlsx를 올리면 신규·변경·유지 건수를 먼저 보여 줍니다.
      </p>

      <div className="mt-6">
        <SheetUploadPanel readOnly={readOnly} mode={mode} />
      </div>
    </PageShell>
  );
}
