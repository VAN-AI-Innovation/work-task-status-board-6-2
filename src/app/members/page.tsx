/**
 * 전사 멤버 화면 (T11 · `/members`). 조직 전체를 팀 트리로 보고 **팀장을 세우거나 내리는**
 * 자리다.
 *
 * ## 자기 API를 부르지 않는다
 *
 * 최초 렌더는 `rpc('member_directory')`를 **직접** 부른다 (`ADR-007`). `POST
 * /api/members/role`은 브라우저에서 일어나는 상호작용이라 그쪽이 라우트를 쓴다.
 *
 * 저장소(`view.repo`)가 아니라 raw 클라이언트를 쓰는 이유는 이것이 테이블이 아니라
 * **`security definer` 함수**이기 때문이다. 접근 제어가 함수 안에 있고 그 검사는
 * `auth.uid()`에 기댄다 — 사용자 JWT로 나가야 성립한다 (`0005` 4-2 · `ADR-024`).
 *
 * ## 권한이 없으면 404다
 *
 * `/team/requests`와 같은 판단이고 근거도 같다 — 403 화면은 「어드민 전용 기능이 존재한다」를
 * 알려 준다. **다만 문턱이 한 칸 높다**: 저쪽은 팀장도 열지만 여기는 대표·실장뿐이다
 * (`canManageMembers` 머리말).
 *
 * ## 화면에 계산이 없다
 *
 * 역할 판정은 `canManageMembers`, 행 읽기는 `toMemberDirectoryResponse`, 묶고 세우는 것은
 * `buildMemberTree`가 진다 (`ADR-006`). 이 파일은 그 셋을 잇기만 한다 — **트리를 여기서
 * 다시 묶으면** 테스트가 보는 것과 화면이 그리는 것이 갈린다.
 */

import { notFound, redirect } from 'next/navigation';

import { MemberTreeView } from '@/components/members/member-tree-view';
import { PageShell } from '@/components/shell/page-shell';
import { toMemberDirectoryResponse } from '@/lib/api/member-role-schema';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentSessionClient, currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { kstToday } from '@/lib/domain/kst-today';
import { canManageMembers } from '@/lib/domain/member-admin';
import { buildMemberTree } from '@/lib/domain/member-tree';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { describeSync } from '@/lib/view/sync-freshness';

/** 명부도 저장소 연결도 빌드 시각이 아니라 요청 시각의 사실이다 */
export const dynamic = 'force-dynamic';

const PATH = '/members';

export default async function MembersPage({ searchParams }: PageProps<'/members'>) {
  const view = await currentViewerContext();

  // 승인을 기다리는 계정은 여기서 `/pending`으로 간다 (`pending-gate.ts`)
  const gate = gateForSession(view.session, PATH);
  if (gate.kind === 'redirect') redirect(gate.to);

  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  /*
   * 다른 화면과 **같은 함수**가 역할을 정한다 — 세션이 이기고, 프로덕션+실저장소에서는
   * `?as=`가 무시된다 (`ADR-026`·`S4`). 데모에는 붙을 함수가 없어 트리가 늘 비어 있다.
   */
  const role = resolveViewerRole(
    sp.get('as'),
    { nodeEnv: process.env.NODE_ENV, mode: view.base.mode },
    view.session
  );
  if (!canManageMembers(role)) notFound();

  const client = await currentSessionClient();

  /*
   * 자격증명이 없는 환경(데모 클론)에는 붙을 함수가 없다. 사고가 아니라 **없는 것**이라
   * 빈 명부로 둔다 — 팀 가지는 그래도 남는다. 반대로 부르다 실패한 것은 조회 실패라
   * `error.tsx`로 올린다: 빈 트리로 접으면 「사람이 없다」와 「읽지 못했다」가 같아 보인다
   * (`X3`).
   */
  let members = toMemberDirectoryResponse(null).members;
  if (client !== null) {
    const { data, error } = await client.rpc('member_directory');
    // 메시지를 싣지 않는다. `error.tsx`가 예외 문자열을 한 글자도 렌더하지 않는다 (`X1`)
    if (error) throw new Error('member_directory failed');
    members = toMemberDirectoryResponse(data).members;
  }

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
      <h1 className="text-brand text-xl font-semibold">멤버</h1>
      <p className="text-ink-body mt-1 text-sm">
        조직 전체의 계정과 시트 명부입니다. 팀장 승격·해제는 여기서 합니다 — 대표·실장은
        화면에서 만들지 않습니다.
      </p>

      <div className="mt-6">
        <MemberTreeView tree={buildMemberTree(members)} />
      </div>
    </PageShell>
  );
}
