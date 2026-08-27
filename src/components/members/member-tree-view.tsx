/**
 * 전사 멤버 **조직도** (`/members`). 팀 아래 팀장과 부원이 서고, 각 카드에서 승격·해제가
 * 일어난다.
 *
 * **판단을 들고 있지 않다.** 누가 이 화면을 보는지는 `canManageMembers`가, 트리를 묶고
 * 세우는 것은 `lib/domain/member-tree.ts`가, 실제 허용은 `set_role`이 정한다 (`ADR-006`).
 * 이 파일이 아는 것은 **props와 폼 상태**뿐이다.
 *
 * ## 선으로 잇되, 뼈대는 여전히 중첩 목록이다
 *
 * 상하관계를 선으로 그린다 — 세로로 나열된 줄 목록은 「누가 누구 아래인가」를 들여쓰기
 * 폭으로만 말해서, 팀이 셋을 넘으면 읽는 사람이 자를 대야 한다.
 *
 * **그리는 방법이 요점이다.** 선은 `::before`(세로 줄기)와 `::after`(가로 들보)로만 만들고,
 * 마크업은 `<ul>`/`<li>` 중첩을 그대로 둔다. 스크린리더에는 여전히 「편집팀 목록 안에 사람
 * 목록」으로 읽히고, 눈에는 조직도로 보인다. SVG로 그리면 그 둘이 갈라진다 — 보이는 구조와
 * 읽히는 구조가 다른 화면은 한쪽이 고쳐질 때 다른 쪽이 남는다.
 *
 * 가로 들보는 **첫 칸의 왼쪽 절반과 끝 칸의 오른쪽 절반을 잘라** 만든다 (`first:`·`last:`).
 * 칸이 하나뿐이면 양쪽이 다 잘려 들보가 사라지고 줄기만 남는다 — 그것이 맞다.
 *
 * ## 넓을 때만 가로로 선다
 *
 * 좁은 화면에서 팀 셋을 가로로 세우면 카드가 글자 폭보다 좁아진다. `lg` 아래에서는 세로로
 * 쌓고 선을 끄며, 그때는 팀 제목이 구분을 진다.
 *
 * ## 비어 있는 것을 빈 줄로 두지 않는다
 *
 * 리더가 없는 팀에는 **「팀장 없음」이라고 적는다.** 빈 줄로 두면 「리더가 없다」와 「아직
 * 안 불러왔다」가 화면에서 같아 보인다 — 알림 패널이 0건 묶음을 남기는 것과 같은 이유다
 * (`UI_GUIDE.md`).
 *
 * ## 상태는 색이 아니라 글자로 구분한다
 *
 * 「승인 대기」·「반려됨」·「계정 없음」을 **낱말로** 적는다. 색만으로 구분하지 않는 것은
 * 상태 배지의 규칙 그대로이고(`UI_GUIDE.md`), 여기 쓰이는 유일한 색은 주의(앰버) 하나다 —
 * 대기·반려는 **손댈 것이 있다는 신호**이지 지연이 아니라서 빨강을 쓰지 않는다.
 *
 * ## 카드는 링크다. 손대는 일은 전부 패널에서 한다
 *
 * 예전에는 카드마다 팀 `<select>`와 승격 버튼이 붙어 있었다. 열에 아홉은 팀을 바꾸지 않는데
 * 늘 자리를 차지했고, 그 줄들이 조직도를 다시 **목록처럼** 보이게 만들었다. 지금 카드가
 * 아는 것은 「누구인가」뿐이고, 누르면 `?member=`가 붙어 오른쪽 패널이 열린다 —
 * 업무 표의 `?task=`와 같은 방식이다 (`task-table.tsx`).
 *
 * 그래서 이 파일은 **더 이상 클라이언트 컴포넌트가 아니다.** 상태도 `fetch`도 없다.
 */

import Link from 'next/link';

import type { MemberNode, MemberTree, TeamBranch } from '@/lib/domain/member-tree';
import { roleLabel } from '@/lib/view/role-label';
import { teamLabel } from '@/lib/view/team-slug';

/**
 * 자식 칸 하나가 지는 연결선. 줄기(`::before`)는 칸 가운데에서 위로, 들보(`::after`)는
 * 좌우로 뻗다가 양 끝 칸에서 반씩 잘린다. `lg` 아래에서는 둘 다 끄고 세로로 쌓는다.
 *
 * 줄기 길이(`h-10`)와 위 칸이 띄워 둔 여백(`mt-10`)이 **같은 수여야 한다.** 다르면 선이
 * 위 카드 위로 올라타거나 허공에서 끊긴다.
 */
const CONNECTOR =
  'relative lg:pt-10 ' +
  "lg:before:absolute lg:before:top-0 lg:before:left-1/2 lg:before:h-10 lg:before:w-px lg:before:bg-[var(--color-line-strong)] lg:before:content-['']" +
  " lg:after:absolute lg:after:top-0 lg:after:h-px lg:after:bg-[var(--color-line-strong)] lg:after:content-['']" +
  ' lg:after:left-0 lg:after:right-0 lg:first:after:left-1/2 lg:last:after:right-1/2';

/**
 * `selectedKey`는 지금 패널이 열려 있는 사람. 카드 하나가 **눌린 상태로** 보여야 조직도와
 * 패널이 같은 사람을 말하고 있다는 것이 읽힌다.
 */
export function MemberTreeView({
  tree,
  selectedKey,
  hrefFor,
}: {
  tree: MemberTree;
  selectedKey: string | null;
  /** `?member=`를 갈아끼운 주소. 나머지 쿼리는 호출자가 들고 간다 */
  hrefFor: (key: string) => string;
}) {
  return (
    <ul>
      <li className="flex flex-col items-center">
        <TopBox unassigned={tree.unassigned} selectedKey={selectedKey} hrefFor={hrefFor} />

        {/* 팀 칸들. 이 `<ul>`이 위 칸의 자식 목록이며, 연결선은 각 칸이 자기 몫만 그린다.
            `mt-10`이 줄기가 설 자리를 미리 비운다 — 없으면 들보가 위 카드를 가로지른다 */}
        <ul className="flex w-full flex-col gap-8 lg:mt-10 lg:flex-row lg:items-stretch lg:gap-10">
          {tree.teams.map((branch) => (
            <li key={branch.teamId} className={`${CONNECTOR} lg:min-w-0 lg:flex-1`}>
              <TeamColumn branch={branch} selectedKey={selectedKey} hrefFor={hrefFor} />
            </li>
          ))}
        </ul>
      </li>
    </ul>
  );
}

/**
 * 조직도의 머리. **대표·실장과 팀 미배정 계정이 함께 선다** — 팀 아래 놓을 수 없는 사람들이고
 * (`member-tree.ts`), 그 사실이 화면에서도 「팀 위」로 보여야 한다.
 */
function TopBox({
  unassigned,
  selectedKey,
  hrefFor,
}: {
  unassigned: MemberNode[];
  selectedKey: string | null;
  hrefFor: (key: string) => string;
}) {
  return (
    <div className="w-full max-w-md">
      <div className="bg-brand text-canvas rounded-md px-4 py-2.5 text-center text-sm font-semibold">
        소속 없음 · 대표·실장
      </div>
      <ul className="mt-3 space-y-2">
        {unassigned.length === 0 ? (
          <EmptyCard label="해당 없음" />
        ) : (
          unassigned.map((node) => (
            <MemberCard
              key={keyOf(node)}
              node={node}
              selectedKey={selectedKey}
              hrefFor={hrefFor}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function TeamColumn({
  branch,
  selectedKey,
  hrefFor,
}: {
  branch: TeamBranch;
  selectedKey: string | null;
  hrefFor: (key: string) => string;
}) {
  return (
    <>
      <h2 className="bg-brand-soft text-brand border-brand rounded-md border-l-4 px-3 py-2.5 text-sm font-semibold">
        {teamLabel(branch.teamId)}
      </h2>

      {/* 팀 하나가 `<li>`이고 사람 목록이 그 안에 다시 들어간다 (머리말) */}
      <ul className="mt-3 space-y-2">
        {branch.leads.length === 0 ? (
          <EmptyCard label="팀장 없음" />
        ) : (
          branch.leads.map((node) => (
            <MemberCard
              key={keyOf(node)}
              node={node}
              lead
              selectedKey={selectedKey}
              hrefFor={hrefFor}
            />
          ))
        )}
        {branch.members.length === 0 ? (
          <EmptyCard label="팀원 없음" />
        ) : (
          branch.members.map((node) => (
            <MemberCard
              key={keyOf(node)}
              node={node}
              selectedKey={selectedKey}
              hrefFor={hrefFor}
            />
          ))
        )}
      </ul>
    </>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <li className="border-line text-ink-faint rounded-md border border-dashed px-3 py-2 text-xs">
      {label}
    </li>
  );
}

/** `userId`·`memberId` 중 적어도 하나는 있다 (full outer join) */
export function keyOf(node: MemberNode): string {
  return `${node.userId ?? ''}:${node.memberId ?? ''}`;
}

/**
 * 사람 하나. **팀장 카드는 왼쪽 굵은 선으로 구분한다** — 조직도에서 팀장과 부원이 같은
 * 모양이면 세로 순서만으로 위아래를 말하게 되고, 그것은 목록으로 되돌아가는 것이다.
 *
 * 카드 전체가 링크다. 누르는 자리가 이름 글자뿐이면 눌러야 할 곳을 찾아야 한다.
 */
function MemberCard({
  node,
  lead = false,
  selectedKey,
  hrefFor,
}: {
  node: MemberNode;
  lead?: boolean;
  selectedKey: string | null;
  hrefFor: (key: string) => string;
}) {
  const key = keyOf(node);
  const selected = key === selectedKey;

  return (
    <li>
      <Link
        href={hrefFor(key)}
        aria-current={selected ? 'true' : undefined}
        className={`bg-panel hover:border-line-strong block rounded-md border px-3 py-2 ${
          lead ? 'border-l-4 border-l-[var(--color-brand)]' : ''
        } ${selected ? 'border-brand ring-brand-soft ring-2' : 'border-line'}`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-ink text-sm font-medium">{node.name ?? '(이름 없음)'}</span>
          {/* 역할 이름은 한 곳에서만 온다 (`role-label.ts`). 계정이 없으면 부를 역할이 없다 */}
          {node.role !== null && (
            <span className="text-ink-muted text-xs">{roleLabel(node.role)}</span>
          )}
          <StatusBadge node={node} />
        </div>
        {node.email !== null && node.email !== '' && (
          <p className="text-ink-muted mt-0.5 truncate text-xs">{node.email}</p>
        )}
      </Link>
    </li>
  );
}

/**
 * 손댈 것이 있는 줄만 표시가 붙는다. `active`에는 아무것도 없다 — 정상인 것에 색을 주면
 * 화면의 절반이 색을 갖고 진짜 신호가 묻힌다 (`UI_GUIDE.md`).
 */
function StatusBadge({ node }: { node: MemberNode }) {
  if (node.userId === null) {
    return (
      <span className="border-line-strong text-ink-muted rounded-full border px-2 py-0.5 text-xs">
        계정 없음
      </span>
    );
  }
  if (node.status === 'pending') {
    return <span className="bg-warn-bg text-warn rounded-full px-2 py-0.5 text-xs">승인 대기</span>;
  }
  if (node.status === 'rejected') {
    return <span className="bg-warn-bg text-warn rounded-full px-2 py-0.5 text-xs">내보냄</span>;
  }
  return null;
}
