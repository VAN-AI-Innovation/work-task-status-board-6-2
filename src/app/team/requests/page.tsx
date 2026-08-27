/**
 * 팀 합류 요청 화면 (T11 · `/team/requests`). 가입한 사람을 **받아들이거나 반려하는** 자리다.
 *
 * ## 자기 API를 부르지 않는다
 *
 * 최초 렌더는 `rpc('pending_requests')`를 **직접** 부른다 (`ADR-007`) — 서버 컴포넌트가
 * 자기 라우트를 `fetch`하면 불필요한 HTTP 왕복이 생긴다. `POST .../approve`·`.../reject`는
 * 브라우저에서 일어나는 상호작용이라 그쪽이 라우트를 쓴다.
 *
 * 저장소(`view.repo`)가 아니라 raw 클라이언트를 쓰는 이유는 이것이 테이블이 아니라
 * **`security definer` 함수**이기 때문이다. 접근 제어가 함수 안에 있고 그 검사는
 * `auth.uid()`에 기댄다 — 사용자 JWT로 나가야 성립한다 (`0005` 4-1 · `ADR-024`).
 *
 * ## 권한이 없으면 404다
 *
 * 403 화면을 그리지 않는다. 「이 화면은 있지만 당신은 못 본다」가 곧 **「팀장 전용 기능이
 * 존재한다」는 정보**이고, 없는 것처럼 보이는 편이 좁다 (`PATCH /api/tasks/[id]`가 없는
 * id에도 403을 내는 것과 같은 결의 판단이다 — 덜 흘리는 쪽을 고른다).
 *
 * **그리고 이것은 방어가 아니다.** 부원이 주소를 직접 쳐도 `pending_requests()`가 0행을
 * 내고 `approve_join`이 예외를 던진다. 화면이 하는 일은 정보를 줄이는 것뿐이다.
 *
 * ## 화면에 계산이 없다
 *
 * 역할 판정은 `canReviewJoinRequests`, 행 만들기는 `toJoinRequestRows`, 범위는
 * `pending_requests()`가 진다. 이 파일은 그 결과를 잇기만 한다.
 */

import { notFound, redirect } from 'next/navigation';

import { PageShell } from '@/components/shell/page-shell';
import { JoinRequestList } from '@/components/team/join-request-list';
import { toJoinRequestsResponse } from '@/lib/api/join-request-schema';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentSessionClient, currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { canReviewJoinRequests } from '@/lib/domain/join-review';
import { kstToday } from '@/lib/domain/kst-today';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { toJoinRequestRows } from '@/lib/view/join-request-rows';
import { describeSync } from '@/lib/view/sync-freshness';

/** 대기 목록도 저장소 연결도 빌드 시각이 아니라 요청 시각의 사실이다 */
export const dynamic = 'force-dynamic';

const PATH = '/team/requests';

export default async function TeamRequestsPage({ searchParams }: PageProps<'/team/requests'>) {
  const view = await currentViewerContext();

  // 승인을 기다리는 계정은 여기서 `/pending`으로 간다 (`pending-gate.ts`)
  const gate = gateForSession(view.session, PATH);
  if (gate.kind === 'redirect') redirect(gate.to);

  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  /*
   * 다른 화면과 **같은 함수**가 역할을 정한다 — 세션이 이기고, 프로덕션+실저장소에서는
   * `?as=`가 무시된다 (`ADR-026`·`S4`). 데모에는 붙을 함수가 없어 목록이 늘 비어 있다.
   */
  const role = resolveViewerRole(
    sp.get('as'),
    { nodeEnv: process.env.NODE_ENV, mode: view.base.mode },
    view.session
  );
  if (!canReviewJoinRequests(role)) notFound();

  const client = await currentSessionClient();

  /*
   * 자격증명이 없는 환경(데모 클론)에는 붙을 함수가 없다. 사고가 아니라 **없는 것**이라
   * 빈 목록으로 둔다. 반대로 부르다 실패한 것은 조회 실패라 `error.tsx`로 올린다 —
   * 빈 목록으로 접으면 「요청이 없다」와 「읽지 못했다」가 화면에서 같아 보인다 (`X3`).
   */
  let requests = toJoinRequestsResponse(null).requests;
  if (client !== null) {
    const { data, error } = await client.rpc('pending_requests');
    // 메시지를 싣지 않는다. `error.tsx`가 예외 문자열을 한 글자도 렌더하지 않는다 (`X1`)
    if (error) throw new Error('pending_requests failed');
    requests = toJoinRequestsResponse(data).requests;
  }

  const rows = toJoinRequestRows(requests, await view.repo.listMembers());

  const freshness = describeSync(await view.repo.getLastSyncedAt(), kstToday(new Date()));

  return (
    <PageShell
      mode={view.base.mode}
      driver={view.base.driver}
      freshness={freshness}
      role={role}
      query={parseDashboardQuery(sp)}
      account={toAccount(view.session)}
    >
      <h1 className="text-brand text-xl font-semibold">팀원 요청</h1>
      <p className="text-ink-body mt-1 text-sm">
        승인하면 곧바로 현황판을 볼 수 있습니다. 시트 담당자에 연결해야 본인 업무가 보입니다.
      </p>

      <div className="mt-6">
        <JoinRequestList rows={rows} />
      </div>
    </PageShell>
  );
}
