'use client';

/**
 * 전사 멤버 트리 (`/members`). 팀 아래 팀장과 부원이 서고, 각 줄에서 승격·해제가 일어난다.
 *
 * **판단을 들고 있지 않다.** 누가 이 화면을 보는지는 `canManageMembers`가, 트리를 묶고
 * 세우는 것은 `lib/domain/member-tree.ts`가, 실제 허용은 `set_role`이 정한다 (`ADR-006`). 이 파일이
 * 아는 것은 **props와 폼 상태**뿐이다.
 *
 * ## 들여쓰기가 아니라 중첩 목록이다
 *
 * 상하관계를 여백으로만 그리면 스크린리더에는 **평평한 줄 목록**으로 읽힌다. 팀 하나가
 * `<li>`이고 그 안에 사람 목록이 다시 `<ul>`로 들어간다 — 들여쓰기는 그 구조를 눈에 보이게
 * 하는 시각 효과일 뿐이다.
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
 * ## 대표·실장 줄에는 버튼이 없다
 *
 * `set_role`은 대표·실장을 **만들지는** 못하지만 내리는 것은 막지 않는다 (`0005` 4-6).
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

export function MemberTreeView({ tree }: { tree: MemberTree }) {
  return (
    <ul className="border-line divide-line divide-y rounded-md border">
      {tree.teams.map((branch) => (
        <TeamGroup key={branch.teamId} branch={branch} />
      ))}

      <li className="p-4">
        <h2 className="text-brand text-sm font-semibold">소속 없음</h2>
        <p className="text-ink-muted mt-1 text-xs">
          대표·실장, 그리고 아직 팀이 정해지지 않은 계정입니다.
        </p>
        <ul className="divide-line mt-2 divide-y">
          {tree.unassigned.length === 0 ? (
            <EmptyRow label="해당 없음" />
          ) : (
            tree.unassigned.map((node) => <MemberRow key={keyOf(node)} node={node} />)
          )}
        </ul>
      </li>
    </ul>
  );
}

function TeamGroup({ branch }: { branch: TeamBranch }) {
  return (
    <li className="p-4">
      <h2 className="text-brand text-sm font-semibold">{teamLabel(branch.teamId)}</h2>

      {/* 팀 하나가 `<li>`이고 사람 목록이 그 안에 다시 들어간다 (머리말) */}
      <ul className="divide-line mt-2 divide-y">
        {branch.leads.length === 0 ? (
          <EmptyRow label="팀장 없음" />
        ) : (
          branch.leads.map((node) => <MemberRow key={keyOf(node)} node={node} />)
        )}
        {branch.members.length === 0 ? (
          <EmptyRow label="팀원 없음" />
        ) : (
          branch.members.map((node) => <MemberRow key={keyOf(node)} node={node} />)
        )}
      </ul>
    </li>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <li className="text-ink-faint py-2 text-sm">{label}</li>;
}

/** `userId`·`memberId` 중 적어도 하나는 있다 (full outer join) */
function keyOf(node: MemberNode): string {
  return `${node.userId ?? ''}:${node.memberId ?? ''}`;
}

function MemberRow({ node }: { node: MemberNode }) {
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
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 역할 이름은 한 곳에서만 온다 (`role-label.ts`). 계정이 없으면 부를 역할이 없다 */}
        <span className="text-ink-muted w-16 shrink-0 text-xs">
          {node.role === null ? '—' : roleLabel(node.role)}
        </span>
        <span className="text-ink text-sm font-medium">{node.name ?? '(이름 없음)'}</span>
        <span className="text-ink-muted min-w-0 truncate text-xs">{node.email ?? ''}</span>
        <StatusBadge node={node} />
      </div>

      {changeable && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-ink-muted text-xs">팀</span>
            <select
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              disabled={busy}
              className="border-line bg-panel text-ink focus:border-brand rounded border px-2 py-1 text-xs focus:outline-none"
            >
              <option value={KEEP_TEAM}>유지</option>
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
              className={`border-line text-ink rounded border px-3 py-1 text-xs ${
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
              className={`bg-brand text-canvas rounded px-3 py-1 text-xs ${
                busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
              }`}
            >
              {busy ? '처리 중…' : '팀장으로'}
            </button>
          )}
        </div>
      )}

      {message !== null && <p className="text-late text-xs">{message}</p>}
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
