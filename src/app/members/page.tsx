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

import { MemberPanel } from '@/components/members/member-panel';
import { MemberTreeView, keyOf } from '@/components/members/member-tree-view';
import { PageShell } from '@/components/shell/page-shell';
import { toMemberDirectoryResponse } from '@/lib/api/member-role-schema';
import { buildReadContext } from '@/lib/api/read-context';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentSessionClient, currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { kstToday } from '@/lib/domain/kst-today';
import { canManageMembers, canViewMembers } from '@/lib/domain/member-admin';
import { buildMemberTree, type MemberNode } from '@/lib/domain/member-tree';
import { openTasksOf, summarizeMemberWorkload } from '@/lib/domain/member-workload';
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
  if (!canViewMembers(role)) notFound();
  /** 팀장은 보기만 한다 — 직책·팀·내보내기는 admin만이다 (`0005` 4-7 · `0006`) */
  const manageable = canManageMembers(role);

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

  const tree = buildMemberTree(members);

  /*
   * `?member=`가 곧 패널의 열림이다 — 업무 표의 `?task=`와 같은 방식이라 뒤로 가기가
   * 패널을 닫고, 링크를 복사하면 같은 사람이 열린다 (`task-panel-slot.tsx`).
   *
   * 키는 트리가 쓰는 것과 **같은 함수**에서 온다. 여기서 따로 지으면 카드가 만든 주소와
   * 페이지가 찾는 키가 갈라져, 눌러도 아무것도 열리지 않는 날이 온다.
   */
  const selectedKey = sp.get('member');
  const everyone: MemberNode[] = [
    ...tree.unassigned,
    ...tree.teams.flatMap((branch) => [...branch.leads, ...branch.members]),
  ];
  /*
   * **누를 수 있는 카드**. 어드민은 전부, 팀장은 자기 팀만이다.
   *
   * 판정 기준이 `teamId`인 것이 요점이다 — `member_directory()`가 남의 팀 사람의 이메일을
   * null로 내려보내므로(`0007`), 팀장이 남의 팀 카드를 열어도 볼 것이 이름뿐이다. 여기서
   * 막는 것은 그 헛걸음을 없애는 일이고, **진짜 문은 DB다.**
   */
  const viewerTeamId = view.session.status === 'ok' ? view.session.viewer.teamId : null;
  const openable = (node: MemberNode): boolean =>
    manageable || (viewerTeamId !== null && node.teamId === viewerTeamId);

  const found = everyone.find((node) => keyOf(node) === selectedKey) ?? null;
  // 주소를 직접 쳐도 열리지 않는다. 열 수 없는 카드의 패널은 **없는 것으로 둔다**
  const selected = found !== null && openable(found) ? found : null;

  /** `?member=`만 갈아끼우고 나머지 쿼리는 그대로 들고 간다. `null`이면 닫는 주소다 */
  const hrefFor = (key: string | null): string => {
    const next = new URLSearchParams(sp);
    if (key === null) next.delete('member');
    else next.set('member', key);
    const qs = next.toString();
    return qs === '' ? PATH : `${PATH}?${qs}`;
  };

  /*
   * **고른 사람이 있을 때만 업무를 읽는다.** 패널이 닫혀 있는데 전사 업무를 끌어오면
   * 이 화면이 조직도를 그리는 값보다 훨씬 무거운 조회를 늘 하게 된다.
   *
   * 조회 라우트와 **같은 함수**를 쓴다 — 화면이 따로 세기 시작하면 같은 낱말이 두 수를 갖는다
   * (`page.tsx` 머리말 · `ADR-006`).
   */
  let summary = null;
  let openTasks: Awaited<ReturnType<typeof buildReadContext>>['tasks'] = [];
  if (selected !== null) {
    const read = await buildReadContext(view, new Date(), { as: sp.get('as'), filter: {} });
    summary = summarizeMemberWorkload(read.tasks, read.ctx, selected.memberId, selected.teamId);
    openTasks = openTasksOf(read.tasks, read.ctx, selected.memberId);
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
        {manageable
          ? '조직 전체의 계정과 시트 명부입니다. 팀장 승격·해제는 여기서 합니다 — 대표·실장은 화면에서 만들지 않습니다.'
          : '조직 전체의 구성입니다. 자세히 볼 수 있는 사람은 우리 팀뿐입니다.'}
      </p>

      {/*
        **한 건도 없는 것과 못 읽은 것을 구분한다.** 조직도는 팀 가지를 늘 그리므로
        (`member-tree.ts`), 명부가 비어도 화면은 「팀 셋 + 전부 비어 있음」으로 똑같이 보인다 —
        그 상태에서 사용자가 알 수 있는 것이 하나도 없다.

        실제로 이 자리에 서는 원인은 둘이다: 시트를 아직 올리지 않았거나, 권한 함수가
        이 역할에 행을 내주지 않거나(`member_directory()`). 어느 쪽인지 화면은 모르므로
        **둘 다 적는다** — 지어내지 않는다 (`X3`).
      */}
      {members.length === 0 && (
        <p className="border-warn-line bg-warn-bg text-warn mt-6 rounded border px-3 py-2 text-sm">
          명부를 한 건도 읽지 못했습니다. 시트를 아직 올리지 않았거나, 이 계정에 명부 조회
          권한이 아직 반영되지 않았을 수 있습니다.
        </p>
      )}

      <div className="mt-6">
        <MemberTreeView
          tree={tree}
          selectedKey={selected === null ? null : selectedKey}
          hrefFor={hrefFor}
          openable={openable}
        />
      </div>

      {selected !== null && (
        <MemberPanel
          node={selected}
          summary={summary}
          openTasks={openTasks}
          manageable={manageable}
          closeHref={hrefFor(null)}
        />
      )}
    </PageShell>
  );
}
