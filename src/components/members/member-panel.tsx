'use client';

/**
 * 사람 하나의 상세 (`/members?member=<key>`). 조직도 카드를 누르면 오른쪽에서 열린다 —
 * 업무 표의 `?task=` 패널과 **같은 방식이고 같은 껍데기**다 (`task-panel.tsx`). 두 화면이
 * 다르게 열리면 같은 앱을 쓰는 사람이 매번 새로 배운다.
 *
 * ## 손대는 일이 전부 여기 모인다
 *
 * 승격·해제·팀 이동·내보내기가 카드에서 이리로 옮겨 왔다. 카드마다 `<select>`와 버튼이
 * 붙어 있으면 열에 아홉은 쓰지 않는 컨트롤이 늘 자리를 차지하고, 그 줄들이 조직도를 다시
 * 목록처럼 보이게 만든다.
 *
 * ## 세는 것은 도메인이 한다
 *
 * 집계 숫자와 할 일 목록은 **props로 받는다.** 이 파일에서 세면 같은 낱말(「완료」·「지연」)이
 * 팀 요약과 여기서 다른 수를 갖게 되고, 그 차이는 화면에서 영영 드러나지 않는다
 * (`member-workload.ts` · `ADR-006`).
 *
 * ## 위험한 버튼은 한 번 더 묻는다
 *
 * 내보내기는 되돌리는 데 **다른 사람의 손**이 필요하다(팀원 요청 탭에서 재승인). 그래서 이
 * 버튼만 확인 단계를 둔다 — 승격·해제는 같은 자리에서 바로 되돌릴 수 있어 묻지 않는다.
 * `confirm()`을 쓰지 않는 것은 이 앱의 규칙이다(JS 없이도 도는 화면) — 대신 버튼이
 * 「정말 내보낼까요?」로 **바뀐다.**
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { MemberNode } from '@/lib/domain/member-tree';
import { TEAM_KEYS, type TeamSummary } from '@/lib/domain/progress-stats';
import { roleLabel } from '@/lib/view/role-label';
import { teamLabel } from '@/lib/view/team-slug';
import type { ApiErrorBody } from '@/types/api';
import type { Task } from '@/types/task';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 팀을 바꾸지 않는다는 뜻. 「팀을 지운다」가 아니다 — 그 길은 이 화면에 없다 */
const KEEP_TEAM = '';

export function MemberPanel({
  node,
  summary,
  openTasks,
  closeHref,
}: {
  node: MemberNode;
  /** 팀을 모르면 null이다 — 0건과 다르다 (`member-workload.ts`) */
  summary: TeamSummary | null;
  openTasks: Task[];
  closeHref: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [team, setTeam] = useState(KEEP_TEAM);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const busy = sending || refreshing;
  /*
   * 감추는 것이지 막는 것이 아니다 — 진짜 문은 DB다. 대표·실장에게 버튼을 주지 않는 것은
   * `set_role`이 대표·실장을 **만들지는** 못하기 때문이다 (`0005` 4-7): 한 번 내리면 화면으로
   * 되돌릴 수 없고, 자기 자신을 내리면 아무도 이 화면을 열 수 없다.
   * 계정이 없는 명부 행에도 버튼이 없다 — 바꿀 `profiles` 행 자체가 없다.
   */
  const changeable = node.userId !== null && node.role !== 'admin';

  async function post(url: string, body: unknown): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        // 문구를 여기서 짓지 않는다 — 서버가 코드를 바꾸면 화면도 따라 바뀌어야 한다
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      /*
       * **낙관적 업데이트를 하지 않는다.** 거부당한 승격이 잠깐 성공한 것처럼 보이는 것이
       * 이 화면에서 가장 위험한 거짓말이다. 서버를 다시 읽어 트리를 세우는 일은 여전히
       * `lib/domain`의 트리 함수가 진다.
       */
      startTransition(() => router.refresh());
      setConfirmingRemoval(false);
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  const setRole = (role: 'lead' | 'member') =>
    post('/api/members/role', {
      userId: node.userId,
      role,
      // 「유지」면 아예 싣지 않는다. 무엇을 쓸지는 DB가 정한다 (`route.ts` 머리말)
      ...(team === KEEP_TEAM ? {} : { teamId: team }),
    });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* 오버레이는 불투명도만 쓴다. 흐림 효과는 안티패턴 1번이다 (`UI_GUIDE.md`) */}
      <Link href={closeHref} aria-label="패널 닫기" className="bg-ink/30 absolute inset-0" />

      <aside
        aria-label="멤버 상세"
        className="border-line bg-panel relative z-10 h-full w-[560px] max-w-[92vw] overflow-y-auto border-l"
        // keyframe은 `globals.css`에 있다. 이 화면의 유일한 애니메이션이다 (`UI_GUIDE.md`)
        style={{ animation: 'panel-slide-in 200ms ease-out' }}
      >
        <header className="border-line bg-panel sticky top-0 z-10 flex items-start gap-3 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {node.role !== null && (
                <span className="bg-brand-soft text-brand rounded px-2 py-0.5 text-xs font-medium">
                  {roleLabel(node.role)}
                </span>
              )}
              <span className="text-ink-muted text-xs">
                {node.teamId === null ? '소속 없음' : teamLabel(node.teamId)}
              </span>
              <AccountBadge node={node} />
            </div>
            <h2 className="text-ink mt-2 text-sm font-semibold break-words">
              {node.name ?? '(이름 없음)'}
            </h2>
            {node.email !== null && node.email !== '' && (
              <p className="text-ink-muted mt-0.5 text-xs break-all">{node.email}</p>
            )}
          </div>
          <Link
            href={closeHref}
            className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-2 py-1 text-xs"
          >
            닫기
          </Link>
        </header>

        <div className="flex flex-col gap-6 px-5 py-5">
          <WorkloadSection summary={summary} node={node} />
          <OpenTaskList tasks={openTasks} />

          {changeable && (
            <section>
              <h3 className="text-ink text-sm font-semibold">직책·소속</h3>

              <label className="mt-3 flex flex-col gap-1">
                <span className="text-ink-muted text-xs">팀 이동</span>
                <select
                  value={team}
                  onChange={(event) => setTeam(event.target.value)}
                  disabled={busy}
                  className="border-line bg-panel text-ink focus:border-brand rounded border px-2 py-1.5 text-sm focus:outline-none"
                >
                  <option value={KEEP_TEAM}>팀 유지</option>
                  {TEAM_KEYS.map((teamKey) => (
                    <option key={teamKey} value={teamKey}>
                      {teamLabel(teamKey)}
                    </option>
                  ))}
                </select>
                <span className="text-ink-faint text-xs">
                  아래 버튼을 눌러야 반영됩니다. 팀장으로 올릴 때는 어느 팀인지가 반드시
                  정해져야 합니다.
                </span>
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                {node.role === 'lead' ? (
                  <button
                    type="button"
                    onClick={() => void setRole('member')}
                    disabled={busy}
                    className={`border-line text-ink rounded border px-3 py-1.5 text-sm ${
                      busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-raise'
                    }`}
                  >
                    {busy ? '처리 중…' : '팀장 해제'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void setRole('lead')}
                    disabled={busy}
                    className={`bg-brand text-canvas rounded px-3 py-1.5 text-sm font-medium ${
                      busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
                    }`}
                  >
                    {busy ? '처리 중…' : '팀장으로'}
                  </button>
                )}

                {team !== KEEP_TEAM && node.role !== null && (
                  <button
                    type="button"
                    onClick={() => void setRole(node.role === 'lead' ? 'lead' : 'member')}
                    disabled={busy}
                    className={`border-line text-ink rounded border px-3 py-1.5 text-sm ${
                      busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-raise'
                    }`}
                  >
                    {busy ? '처리 중…' : `${teamLabel(team as never)}으로 이동`}
                  </button>
                )}
              </div>
            </section>
          )}

          {changeable && node.status !== 'rejected' && (
            <section className="border-line border-t pt-5">
              <h3 className="text-ink text-sm font-semibold">내보내기</h3>
              <p className="text-ink-muted mt-1 text-xs">
                계정 접근을 끊습니다. <strong className="font-semibold">지우지 않습니다</strong> —
                명부와 업무 이력은 그대로 남고, 팀원 요청 탭에서 다시 승인하면 돌아옵니다.
              </p>

              {confirmingRemoval ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void post('/api/members/remove', { userId: node.userId })}
                    disabled={busy}
                    className={`bg-late text-canvas rounded px-3 py-1.5 text-sm font-medium ${
                      busy ? 'cursor-not-allowed opacity-50' : 'opacity-90 hover:opacity-100'
                    }`}
                  >
                    {busy ? '처리 중…' : '정말 내보냅니다'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoval(false)}
                    disabled={busy}
                    className="border-line text-ink hover:bg-raise rounded border px-3 py-1.5 text-sm"
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRemoval(true)}
                  disabled={busy}
                  className="border-late-line text-late hover:bg-late-bg mt-3 rounded border px-3 py-1.5 text-sm"
                >
                  이 사람 내보내기
                </button>
              )}
            </section>
          )}

          {message !== null && (
            <p role="alert" className="border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm">
              {message}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function AccountBadge({ node }: { node: MemberNode }) {
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

/**
 * 업무 부하. **팀을 모를 때와 0건일 때가 다른 말을 한다** — 「셀 기준이 없다」와 「할 일이
 * 없다」를 같은 화면으로 두면 신입 계정이 늘 「업무 0건」으로 보인다.
 */
function WorkloadSection({ summary, node }: { summary: TeamSummary | null; node: MemberNode }) {
  if (summary === null) {
    return (
      <section>
        <h3 className="text-ink text-sm font-semibold">업무</h3>
        <p className="text-ink-muted mt-2 text-xs">
          팀이 정해지지 않아 업무를 셀 기준이 없습니다.
        </p>
      </section>
    );
  }

  if (node.memberId === null) {
    return (
      <section>
        <h3 className="text-ink text-sm font-semibold">업무</h3>
        <p className="text-ink-muted mt-2 text-xs">
          시트 명부에 연결되지 않은 계정입니다. 팀원 요청 탭에서 담당자를 이어 주면 그 사람의
          업무가 여기 나타납니다.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-ink text-sm font-semibold">업무</h3>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="전체" value={summary.total} />
        <Stat label="진행 중" value={summary.inProgress} />
        <Stat label="완료" value={summary.done} />
        <Stat label="지연" value={summary.overdue} tone={summary.overdue > 0 ? 'late' : undefined} />
        <Stat label="마감 임박" value={summary.dueSoon} tone={summary.dueSoon > 0 ? 'warn' : undefined} />
        <Stat label="승인 대기" value={summary.approvalWaiting} />
      </dl>

      <dl className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="완료율" value={percent(summary.completionRate)} />
        <Stat label="평균 진행률" value={percent(summary.avgProgress)} />
        <Stat label="지연율" value={percent(summary.delayRate)} />
      </dl>

      {/* 「가장 이른 마감」은 목록 맨 위와 같은 값이지만, 숫자 옆에 있어야 부하가 읽힌다 */}
      <p className="text-ink-muted mt-2 text-xs">
        가장 이른 마감: {summary.nearestDueAt ?? '없음'}
      </p>
    </section>
  );
}

/** 모수가 0이면 `null`이다. 그때 `0%`라고 적으면 「하나도 못 했다」로 읽힌다 */
function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'late' | 'warn';
}) {
  return (
    <div className="border-line rounded border px-2 py-1.5">
      <dt className="text-ink-muted text-xs">{label}</dt>
      <dd
        className={`mt-0.5 text-base font-semibold ${
          tone === 'late' ? 'text-late' : tone === 'warn' ? 'text-warn' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * 할 일 목록. 마감이 급한 순서로 이미 세워져 온다 (`openTasksOf`) — 화면이 다시 정렬하지
 * 않는다. 열 개까지만 보여 주고 나머지는 수로 알린다: 패널이 표가 되면 대시보드와 같은
 * 것을 두 곳에서 유지하게 된다.
 */
function OpenTaskList({ tasks }: { tasks: Task[] }) {
  const shown = tasks.slice(0, 10);

  return (
    <section>
      <h3 className="text-ink text-sm font-semibold">할 일 ({tasks.length})</h3>

      {tasks.length === 0 ? (
        <p className="text-ink-muted mt-2 text-xs">남은 업무가 없습니다.</p>
      ) : (
        <ul className="divide-line mt-2 divide-y">
          {shown.map((task) => (
            <li key={task.id} className="flex items-baseline gap-2 py-2">
              <span className="text-ink min-w-0 flex-1 truncate text-sm">
                {task.title ?? '(제목 없음)'}
              </span>
              {task.status !== null && (
                <span className="text-ink-muted shrink-0 text-xs">{task.status}</span>
              )}
              <span className="text-ink-muted shrink-0 text-xs tabular-nums">
                {task.dueAt ?? '마감 없음'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tasks.length > shown.length && (
        <p className="text-ink-muted mt-2 text-xs">
          그 밖에 {tasks.length - shown.length}건이 더 있습니다.
        </p>
      )}
    </section>
  );
}
