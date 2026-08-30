/**
 * 독스 → 배정표 화면. `PLAN.md`「독스 추출 루프」에서 **고리가 시작되는** 자리다 —
 * 여기서 나온 xlsx를 사람이 채워 `/upload`에 올리면 현황판에 반영된다 (`UC-05`→`UC-06`).
 *
 * 서버 컴포넌트가 하는 일은 `/upload`와 같다. `currentViewerContext()`를 **직접** 부르고
 * (자기 API를 `fetch`하면 불필요한 HTTP 왕복이다 — `ADR-007`) 배너·「마지막 반영」·역할을
 * `PageShell`에 넘긴다.
 */

import { notFound, redirect } from 'next/navigation';

import { DocExtractPanel } from '@/components/extract/doc-extract-panel';
import { PageShell } from '@/components/shell/page-shell';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { kstToday } from '@/lib/domain/kst-today';
import { canUseDocExtract } from '@/lib/domain/staff-tools';
import { parseDashboardQuery } from '@/lib/view/dashboard-query';
import { describeSync } from '@/lib/view/sync-freshness';

/**
 * **정적 프리렌더를 막는다.** 저장소 연결의 결과(연결 성공/실패)는 빌드 시각이 아니라
 * 요청 시각의 사실이다. 프리렌더하면 배너가 빌드 때 상태로 굳어, 저장소가 죽어도 화면은
 * 「정상」이라고 말한다 — `ADR-005`가 막으려는 조용한 오해가 그대로 생긴다.
 */
export const dynamic = 'force-dynamic';

export default async function ExtractPage() {
  const view = await currentViewerContext();

  // 승인을 기다리는 계정은 여기서 `/pending`으로 간다 (T11 · `pending-gate.ts`)
  const gate = gateForSession(view.session, '/extract');
  if (gate.kind === 'redirect') redirect(gate.to);

  const { mode, driver } = view.base;

  const lastSyncedAt = await view.repo.getLastSyncedAt();
  const freshness = describeSync(lastSyncedAt, kstToday(new Date()));
  const query = parseDashboardQuery(new URLSearchParams());
  const role = resolveViewerRole(
    query.as,
    { nodeEnv: process.env.NODE_ENV, mode },
    view.session
  );

  /*
   * **부원에게는 이 화면이 없는 것처럼 보인다** (`staff-tools.ts`). 403이 아니라 404인
   * 이유는 `/team/requests`·`/members`와 같다 — 403 화면은 「리더 전용 기능이 존재한다」를
   * 알려 준다. 그리고 이것은 방어가 아니다: 주소를 직접 쳐도 배정표를 만드는 두 라우트가
   * 같은 함수로 403을 낸다.
   */
  if (!canUseDocExtract(role, view.session.status === 'ok')) notFound();

  return (
    <PageShell
      mode={mode}
      driver={driver}
      freshness={freshness}
      role={role}
      query={query}
      /* 로그인했으면 상단 바가 역할 전환 대신 계정을 말한다 (`ADR-026`) */
      account={toAccount(view.session)}
    >
      <h1 className="text-brand text-xl font-semibold">독스 → 배정표</h1>
      <p className="text-ink-body mt-1 text-sm">
        워크로드 문서(.docx)를 올리면 드롭다운이 붙은 업무 배정표 xlsx를 만들어 드립니다.
      </p>

      {/*
       * `readOnly`를 패널에 넘기지 않는다. 이 화면은 저장소에 **쓰지 않으므로**
       * 읽기 전용 모드에서도 정상 동작한다 (`ADR-022` — 라우트 둘 다 stateless다).
       * 잠가 버리면 「저장소가 죽었어도 배정표는 뽑을 수 있다」는 사실을 화면이 부정하게 된다.
       * 저장소 상태 고지는 `PageShell`의 배너가 이미 하고 있다.
       */}
      <div className="mt-6">
        <DocExtractPanel />
      </div>
    </PageShell>
  );
}
