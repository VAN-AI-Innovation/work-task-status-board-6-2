/**
 * 전사 멤버 화면 (T11 · `/members`). 조직 전체를 팀 트리로 보고, **팀장을 세우거나 내리고**,
 * **합류 요청을 받아들이는** 자리다.
 *
 * 요청 목록은 원래 `/team/requests`라는 별도 화면이었다. 합친 이유는 아래 「합류 요청도
 * 이 화면이 진다」 주석에 있다.
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
 * ## 세 역할이 다 연다. 갈리는 것은 패널이다
 *
 * 조직도 자체에는 문턱이 없다 — 「우리 조직에 누가 있는가」도, 연락처인 이메일도 부원에게
 * 필요한 사실이라 404를 내던 것을 그만뒀다 (`0016`·`0017`). 대신 **카드를 눌러 열리는 범위**가 역할마다
 * 다르다: 어드민은 전사, 팀장은 자기 팀, 부원은 **자기 자신뿐**이다 (`canOpenMemberPanel`).
 * 합류 요청 목록과 승격 버튼은 여전히 각자의 문턱을 따로 묻는다.
 *
 * ## 화면에 계산이 없다
 *
 * 역할 판정은 `member-admin.ts`, 행 읽기는 `toMemberDirectoryResponse`, 묶고 세우는 것은
 * `buildMemberTree`가 진다 (`ADR-006`). 이 파일은 그 셋을 잇기만 한다 — **트리를 여기서
 * 다시 묶으면** 테스트가 보는 것과 화면이 그리는 것이 갈린다.
 */

import { redirect } from 'next/navigation';

import { MemberPanel } from '@/components/members/member-panel';
import { MemberTreeView, keyOf } from '@/components/members/member-tree-view';
import { PageShell } from '@/components/shell/page-shell';
import { JoinRequestList } from '@/components/team/join-request-list';
import { toJoinRequestsResponse } from '@/lib/api/join-request-schema';
import { toMemberDirectoryResponse } from '@/lib/api/member-role-schema';
import { buildReadContext } from '@/lib/api/read-context';
import { resolveViewerRole } from '@/lib/api/viewer-role';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentSessionClient, currentViewerContext } from '@/lib/auth/request-viewer';
import { toAccount } from '@/lib/auth/viewer-session';
import { kstToday } from '@/lib/domain/kst-today';
import { canReviewJoinRequests } from '@/lib/domain/join-review';
import { canManageMembers, canOpenMemberPanel } from '@/lib/domain/member-admin';
import { buildMemberTree, type MemberNode } from '@/lib/domain/member-tree';
import { openTasksOf, summarizeMemberWorkload } from '@/lib/domain/member-workload';
import { parseDashboardQuery, toURLSearchParams } from '@/lib/view/dashboard-query';
import { toJoinRequestRows } from '@/lib/view/join-request-rows';
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
  /** 팀장·부원은 보기만 한다 — 직책·팀·내보내기는 admin만이다 (`0005` 4-7 · `0006`) */
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

  /*
   * **합류 요청도 이 화면이 진다** — 예전에는 `/team/requests`라는 별도 화면이었다.
   * 두 화면이 같은 것을 다뤘다: 조직도는 「지금 우리 조직이 이렇다」이고 요청 목록은
   * 「여기에 들어오려는 사람이 있다」다. 승인하면 그 사람이 곧바로 위 트리에 나타나므로,
   * 나눠 두면 리더가 승인한 결과를 보려고 화면을 옮겨야 했다.
   *
   * 다만 **문턱은 각자 묻는다.** 조직도는 부원도 보지만(`0016`) 요청은 대표·팀장뿐이다 —
   * 한 화면에 있다고 한쪽 판정이 다른 쪽을 대신하면, 넓어지는 날 조용히 딸려 간다.
   */
  const reviewable = canReviewJoinRequests(role);
  let requests = toJoinRequestsResponse(null).requests;
  if (reviewable && client !== null) {
    const { data, error } = await client.rpc('pending_requests');
    if (error) throw new Error('pending_requests failed');
    requests = toJoinRequestsResponse(data).requests;
  }
  /* 명부 연결을 이름으로 정하는 데 시트 명부가 필요하다 (`join-request-rows.ts`) */
  const requestRows = reviewable
    ? toJoinRequestRows(requests, await view.repo.listMembers())
    : [];

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
   * **누를 수 있는 카드**. 어드민은 전부, 팀장은 자기 팀, 부원은 자기 자신뿐이다.
   *
   * 판정은 `canOpenMemberPanel`이 진다 — 화면이 세 갈래를 다시 쓰면 사이드바·패널과
   * 갈린다 (`ADR-006`). 여기서 막는 것은 헛걸음을 없애는 일이고 **진짜 문은 DB다**:
   * 업무는 팀 밖으로 나가지 않는다 (`0015`). 카드에 적히는 이메일은 연락처라
   * 세 역할이 다 본다 — 패널이 막는 것은 **업무 진행**이다 (`0017`).
   */
  const me =
    view.session.status === 'ok'
      ? { userId: view.session.viewer.userId, teamId: view.session.viewer.teamId }
      : { userId: null, teamId: null };
  const openable = (node: MemberNode): boolean => canOpenMemberPanel(role, me, node);

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
          : role === 'lead'
            ? '조직 전체의 구성입니다. 자세히 볼 수 있는 사람은 우리 팀뿐입니다.'
            : '조직 전체의 구성입니다. 자세히 볼 수 있는 것은 본인 카드뿐입니다.'}
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

      {reviewable && (
        /*
         * **트리 아래다.** 요청은 조직도에 「더해질」 사람들이라, 지금 조직을 본 다음에
         * 읽는 것이 순서다. 0건이어도 제목 줄은 남는다 — 목록이 비어 있는 것과 이 기능이
         * 없는 것이 화면에서 같아 보이면 안 된다 (알림 패널의 0건 묶음과 같은 규칙).
         */
        <section className="mt-10">
          <h2 className="text-brand text-sm font-semibold">팀원 요청</h2>
          <p className="text-ink-body mt-1 text-sm">
            승인하면 곧바로 현황판을 볼 수 있고 위 조직도에 나타납니다. 시트 명부 연결은 가입
            이름으로 자동으로 맞춰집니다.
          </p>
          <div className="mt-4">
            <JoinRequestList rows={requestRows} />
          </div>
        </section>
      )}

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
