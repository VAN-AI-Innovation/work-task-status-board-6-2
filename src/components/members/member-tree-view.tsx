'use client';

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
 * ## 대표·실장 카드에는 버튼이 없다
 *
 * `set_role`은 대표·실장을 **만들지는** 못하지만 내리는 것은 막지 않는다 (`0005` 4-7).
 * 그 버튼을 두면 어드민이 자기 자신을 내려 **아무도 이 화면을 열 수 없는 상태**를 만들 수
 * 있다. 계정이 없는 명부 행에도 버튼이 없다 — 바꿀 `profiles` 행 자체가 없다.
 * 둘 다 **감추는 것이지 막는 것이 아니다**: 진짜 문은 DB다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { MemberNode, MemberTree, TeamBranch } from '@/lib/domain/member-tree';
import { roleLabel } from '@/lib/view/role-label';
import { teamLabel } from '@/lib/view/team-slug';
import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 팀을 바꾸지 않는다는 뜻. 「팀을 지운다」가 아니다 — 그 길은 이 화면에 없다 */
const KEEP_TEAM = '';

/**
 * 자식 칸 하나가 지는 연결선. 줄기(`::before`)는 칸 가운데에서 위로, 들보(`::after`)는
 * 좌우로 뻗다가 양 끝 칸에서 반씩 잘린다. `lg` 아래에서는 둘 다 끄고 세로로 쌓는다.
 */
const CONNECTOR =
  'relative lg:pt-8 ' +
  "lg:before:absolute lg:before:top-0 lg:before:left-1/2 lg:before:h-8 lg:before:w-px lg:before:bg-[var(--color-line-strong)] lg:before:content-['']" +
  " lg:after:absolute lg:after:top-0 lg:after:h-px lg:after:bg-[var(--color-line-strong)] lg:after:content-['']" +
  ' lg:after:left-0 lg:after:right-0 lg:first:after:left-1/2 lg:last:after:right-1/2';

export function MemberTreeView({ tree }: { tree: MemberTree }) {
  return (
    <div className="overflow-x-auto">
      {/* 조직도는 넓이를 먹는다. 좁은 화면에서 본문이 가로로 밀리지 않도록 자기 안에서 스크롤한다 */}
      <ul className="min-w-fit">
        <li className="flex flex-col items-center">
          <TopBox unassigned={tree.unassigned} />

          {/* 팀 칸들. 이 `<ul>`이 위 칸의 자식 목록이며, 연결선은 각 칸이 자기 몫만 그린다 */}
          <ul className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-5">
            {tree.teams.map((branch) => (
              <li key={branch.teamId} className={`${CONNECTOR} lg:w-64 lg:shrink-0`}>
                <TeamColumn branch={branch} />
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}

/**
 * 조직도의 머리. **대표·실장과 팀 미배정 계정이 함께 선다** — 팀 아래 놓을 수 없는 사람들이고
 * (`member-tree.ts`), 그 사실이 화면에서도 「팀 위」로 보여야 한다.
 */
function TopBox({ unassigned }: { unassigned: MemberNode[] }) {
  return (
    <div className="w-full max-w-sm">
      <div className="bg-brand text-canvas rounded-md px-4 py-2 text-center text-sm font-semibold">
        소속 없음 · 대표·실장
      </div>
      <ul className="mt-2 space-y-2">
        {unassigned.length === 0 ? (
          <EmptyCard label="해당 없음" />
        ) : (
          unassigned.map((node) => <MemberCard key={keyOf(node)} node={node} />)
        )}
      </ul>
    </div>
  );
}

function TeamColumn({ branch }: { branch: TeamBranch }) {
  return (
    <>
      <h2 className="bg-brand-soft text-brand border-brand rounded-md border-l-4 px-3 py-2 text-sm font-semibold">
        {teamLabel(branch.teamId)}
      </h2>

      {/* 팀 하나가 `<li>`이고 사람 목록이 그 안에 다시 들어간다 (머리말) */}
      <ul className="mt-3 space-y-2">
        {branch.leads.length === 0 ? (
          <EmptyCard label="팀장 없음" />
        ) : (
          branch.leads.map((node) => <MemberCard key={keyOf(node)} node={node} lead />)
        )}
        {branch.members.length === 0 ? (
          <EmptyCard label="팀원 없음" />
        ) : (
          branch.members.map((node) => <MemberCard key={keyOf(node)} node={node} />)
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
function keyOf(node: MemberNode): string {
  return `${node.userId ?? ''}:${node.memberId ?? ''}`;
}

/**
 * 사람 하나. **팀장 카드는 왼쪽 굵은 선으로 구분한다** — 조직도에서 팀장과 부원이 같은
 * 모양이면 세로 순서만으로 위아래를 말하게 되고, 그것은 목록으로 되돌아가는 것이다.
 */
function MemberCard({ node, lead = false }: { node: MemberNode; lead?: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [team, setTeam] = useState(KEEP_TEAM);

  const busy = sending || refreshing;
  /* 감추는 것이지 막는 것이 아니다 (머리말) */
  const changeable = node.userId !== null && node.role !== 'admin';

  async function send(role: 'lead' | 'member'): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch('/api/members/role', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: node.userId,
          role,
          // 「유지」면 아예 싣지 않는다. 무엇을 쓸지는 DB가 정한다 (`route.ts` 머리말)
          ...(team === KEEP_TEAM ? {} : { teamId: team }),
        }),
      });

      if (!response.ok) {
        // 문구를 여기서 짓지 않는다 — 서버가 코드를 바꾸면 화면도 따라 바뀌어야 한다
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      /*
       * 응답에도 갱신된 명부가 실려 오지만 그것을 상태에 넣지 않는다. 다시 그리면 트리를
       * 세우는 것이 여기가 아니라 `lib/domain`의 트리 함수로 남는다 — 화면이 자기 힘으로 사람을
       * 옮기면 서버가 본 것과 갈라진다 (`join-request-list.tsx`와 같은 규칙).
       *
       * **낙관적 업데이트를 하지 않는다.** 거부당한 승격이 잠깐 성공한 것처럼 보이는 것이
       * 이 화면에서 가장 위험한 거짓말이다.
       */
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <li
      className={`bg-panel rounded-md border px-3 py-2 ${
        lead ? 'border-line-strong border-l-4 border-l-[var(--color-brand)]' : 'border-line'
      }`}
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

      {changeable && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1">
            <span className="sr-only">팀</span>
            <select
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              disabled={busy}
              aria-label={`${node.name ?? '이 계정'}의 팀`}
              className="border-line bg-panel text-ink focus:border-brand rounded border px-1.5 py-1 text-xs focus:outline-none"
            >
              <option value={KEEP_TEAM}>팀 유지</option>
              {TEAM_KEYS.map((teamKey) => (
                <option key={teamKey} value={teamKey}>
                  {teamLabel(teamKey)}
                </option>
              ))}
            </select>
          </label>

          {node.role === 'lead' ? (
            <button
              type="button"
              onClick={() => void send('member')}
              disabled={busy}
              className={`border-line text-ink rounded border px-2 py-1 text-xs ${
                busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-raise'
              }`}
            >
              {busy ? '처리 중…' : '팀장 해제'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send('lead')}
              disabled={busy}
              className={`bg-brand text-canvas rounded px-2 py-1 text-xs ${
                busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
              }`}
            >
              {busy ? '처리 중…' : '팀장으로'}
            </button>
          )}
        </div>
      )}

      {message !== null && <p className="text-late mt-1 text-xs">{message}</p>}
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
    return <span className="bg-warn-bg text-warn rounded-full px-2 py-0.5 text-xs">반려됨</span>;
  }
  return null;
}
