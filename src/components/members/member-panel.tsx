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
 * ## 세 동작 모두 한 번 더 묻는다
 *
 * 직책 변경·팀 변경·내보내기는 **남의 계정에 일어나는 일**이고, 잘못 눌러도 그 사실이
 * 이 화면에 바로 보이지 않는다(트리는 다시 그려지지만 되돌린 값이 무엇이었는지는 남지
 * 않는다). 그래서 셋 다 확인을 거친다.
 *
 * **`confirm()`을 쓰지 않는다.** 브라우저 모달은 모든 스크립트를 멈춰 세우고 문구를 우리가
 * 고를 수 없다 — 「무엇이 어떻게 바뀌는지」를 문장으로 말해 주는 것이 이 확인의 목적이다.
 * 대신 패널 위에 작은 대화상자를 띄우고, `Esc`와 바깥 클릭으로 닫는다.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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
  const [role, setRoleChoice] = useState<'lead' | 'member'>(node.role === 'lead' ? 'lead' : 'member');
  /** 확인을 기다리는 동작. `null`이면 대화상자가 닫혀 있다 */
  const [pending, setPending] = useState<PendingAction | null>(null);

  const busy = sending || refreshing;
  /*
   * 감추는 것이지 막는 것이 아니다 — 진짜 문은 DB다. 대표·실장에게 버튼을 주지 않는 것은
   * `set_role`이 대표·실장을 **만들지는** 못하기 때문이다 (`0005` 4-7): 한 번 내리면 화면으로
   * 되돌릴 수 없고, 자기 자신을 내리면 아무도 이 화면을 열 수 없다.
   * 계정이 없는 명부 행에도 버튼이 없다 — 바꿀 `profiles` 행 자체가 없다.
   */
  const changeable = node.userId !== null && node.role !== 'admin';
  /** `admin`은 위에서 걸러졌다. 남은 값은 둘뿐이라 여기서 좁혀 둔다 */
  const currentRole: 'lead' | 'member' = node.role === 'lead' ? 'lead' : 'member';

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
      setPending(null);
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  /**
   * 확인된 동작을 실제로 보낸다. **팀 변경도 `set_role`을 쓴다** — 역할을 그대로 실어
   * 보내면 팀만 바뀐다. 팀 전용 함수를 따로 두면 「팀은 여기, 역할은 저기」로 규칙이
   * 갈라지고, `set_role`이 지고 있는 「팀 없는 팀장을 만들지 않는다」가 한쪽에서 빠진다.
   */
  function run(action: PendingAction): void {
    if (action.kind === 'remove') {
      void post('/api/members/remove', { userId: node.userId });
      return;
    }

    void post('/api/members/role', {
      userId: node.userId,
      role: action.kind === 'role' ? action.role : currentRole,
      // 「유지」면 아예 싣지 않는다. 무엇을 쓸지는 DB가 정한다 (`route.ts` 머리말)
      ...(action.kind === 'team' ? { teamId: action.teamId } : {}),
    });
  }

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

              {/* 고르는 칸과 누르는 버튼을 **짝으로** 둔다. 고르기만 하면 아무 일도 일어나지
                  않는다는 것이 두 동작에서 같은 모양이어야 헷갈리지 않는다 */}
              <ChangeRow
                label="직책"
                hint="팀장으로 올릴 때는 어느 팀인지가 반드시 정해져야 합니다."
                value={role}
                onChange={(value) => setRoleChoice(value as 'lead' | 'member')}
                options={[
                  { value: 'member', label: roleLabel('member') },
                  { value: 'lead', label: roleLabel('lead') },
                ]}
                action="직책 변경"
                disabled={busy || role === currentRole}
                onSubmit={() => setPending({ kind: 'role', role })}
              />

              <ChangeRow
                label="소속 팀"
                value={team}
                onChange={setTeam}
                options={[
                  { value: KEEP_TEAM, label: '팀 유지' },
                  ...TEAM_KEYS.map((teamKey) => ({ value: teamKey, label: teamLabel(teamKey) })),
                ]}
                action="팀 변경"
                disabled={busy || team === KEEP_TEAM || team === node.teamId}
                onSubmit={() =>
                  setPending({ kind: 'team', teamId: team as (typeof TEAM_KEYS)[number] })
                }
              />
            </section>
          )}

          {changeable && node.status !== 'rejected' && (
            <section className="border-line border-t pt-5">
              <h3 className="text-ink text-sm font-semibold">내보내기</h3>
              <p className="text-ink-muted mt-1 text-xs">
                계정 접근을 끊습니다. <strong className="font-semibold">지우지 않습니다</strong> —
                명부와 업무 이력은 그대로 남고, 팀원 요청 탭에서 다시 승인하면 돌아옵니다.
              </p>
              <button
                type="button"
                onClick={() => setPending({ kind: 'remove' })}
                disabled={busy}
                className={`border-late-line text-late mt-3 rounded border px-3 py-1.5 text-sm ${
                  busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-late-bg'
                }`}
              >
                이 사람 내보내기
              </button>
            </section>
          )}

          {message !== null && (
            <p role="alert" className="border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm">
              {message}
            </p>
          )}
        </div>
      </aside>

      {pending !== null && (
        <ConfirmDialog
          action={pending}
          node={node}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => run(pending)}
        />
      )}
    </div>
  );
}

/** 확인을 기다리는 동작. 어느 것이든 **남의 계정에 일어나는 일**이다 (머리말) */
type PendingAction =
  | { kind: 'role'; role: 'lead' | 'member' }
  | { kind: 'team'; teamId: (typeof TEAM_KEYS)[number] }
  | { kind: 'remove' };

/**
 * 고르는 칸 + 누르는 버튼 한 쌍. 두 동작(직책·팀)이 **같은 모양**이어야 「고르기만 해서는
 * 아무 일도 안 일어난다」가 학습되지 않고도 읽힌다.
 *
 * 고른 값이 지금 값과 같으면 버튼이 죽는다 — 아무것도 바꾸지 않는 요청을 보내면 서버는
 * 성공을 돌려주고 사용자는 뭔가 됐다고 믿는다.
 */
function ChangeRow({
  label,
  hint,
  value,
  onChange,
  options,
  action,
  disabled,
  onSubmit,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  action: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ink-muted text-xs">{label}</span>
          <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="border-line bg-panel text-ink focus:border-brand rounded border px-2 py-1.5 text-sm focus:outline-none"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className={`shrink-0 rounded border px-3 py-1.5 text-sm ${
            disabled
              ? 'border-line text-ink-faint cursor-not-allowed'
              : 'border-brand text-brand hover:bg-brand-soft'
          }`}
        >
          {action}
        </button>
      </div>
      {hint !== undefined && <p className="text-ink-faint mt-1 text-xs">{hint}</p>}
    </div>
  );
}

/**
 * 확인 대화상자. **무엇이 어떻게 바뀌는지 문장으로 말한다** — 「정말입니까?」만 묻는 확인은
 * 사용자가 방금 무엇을 눌렀는지 기억하는 데 기대는 것이고, 잘못 누른 사람은 그것을
 * 기억하지 못한다.
 *
 * `Esc`와 바깥 클릭으로 닫힌다. 브라우저 `confirm()`을 쓰지 않는 이유는 머리말에 있다.
 */
function ConfirmDialog({
  action,
  node,
  busy,
  onCancel,
  onConfirm,
}: {
  action: PendingAction;
  node: MemberNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const who = node.name ?? '이 계정';
  const destructive = action.kind === 'remove';

  const { title, body } =
    action.kind === 'role'
      ? {
          title: '직책을 바꿉니다',
          body: `${who}의 직책을 ${roleLabel(action.role)}(으)로 바꿉니다. 보이는 범위가 함께 바뀝니다.`,
        }
      : action.kind === 'team'
        ? {
            title: '팀을 옮깁니다',
            body: `${who}을(를) ${teamLabel(action.teamId)}으로 옮깁니다. 이전 팀의 업무는 더 이상 보이지 않습니다.`,
          }
        : {
            title: '이 사람을 내보냅니다',
            body: `${who}의 계정 접근을 끊습니다. 명부와 업무 이력은 남으며, 되돌리려면 팀원 요청 탭에서 다시 승인해야 합니다.`,
          };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <button
        type="button"
        aria-label="확인 취소"
        onClick={onCancel}
        className="bg-ink/40 absolute inset-0"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="border-line bg-panel relative z-10 w-full max-w-[380px] rounded-md border p-5 shadow-lg"
      >
        <h4 className="text-ink text-sm font-semibold">{title}</h4>
        <p className="text-ink-body mt-2 text-sm">{body}</p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border-line text-ink hover:bg-raise rounded border px-3 py-1.5 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              destructive ? 'bg-late text-canvas' : 'bg-brand text-canvas'
            } ${busy ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90'}`}
          >
            {busy ? '처리 중…' : destructive ? '내보내기' : '변경'}
          </button>
        </div>
      </div>
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
 *
 * ## 아홉 칸을 늘어놓지 않는다
 *
 * 예전에는 같은 크기의 숫자 상자 아홉 개였다. 전부 같은 무게라 **무엇을 먼저 볼지 화면이
 * 말해 주지 않았고**, 읽는 사람이 매번 아홉 개를 훑어야 했다.
 *
 * 지금은 층이 셋이다.
 *   1. 완료율 하나를 크게 — 이 사람의 상태를 한 눈에 말하는 값
 *   2. 한 줄 막대 — 「얼마나 남았나」를 숫자보다 빨리 말한다
 *   3. 신호 배지 — 손댈 것이 있는 값(지연·임박·대기)만. 0이면 색을 뺀다
 */
function WorkloadSection({ summary, node }: { summary: TeamSummary | null; node: MemberNode }) {
  if (summary === null) {
    return (
      <section>
        <h3 className="text-ink text-sm font-semibold">업무</h3>
        <p className="text-ink-muted mt-2 text-xs">팀이 정해지지 않아 업무를 셀 기준이 없습니다.</p>
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

  /*
   * 막대의 모수는 **취소를 뺀 수**다. `completionRate`가 같은 모수를 쓰므로
   * (`progress-stats.ts`), 여기서 다른 수로 나누면 막대와 퍼센트가 어긋난다.
   */
  const counted = summary.total - summary.cancelled;
  const remaining = Math.max(0, counted - summary.done - summary.inProgress);
  const width = (value: number): string => (counted === 0 ? '0%' : `${(value / counted) * 100}%`);

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h3 className="text-ink text-sm font-semibold">업무</h3>
        <span className="text-ink-muted text-xs tabular-nums">
          완료 {summary.done} / {counted}건
        </span>
      </div>

      <p className="text-brand mt-2 text-3xl leading-none font-semibold tabular-nums">
        {percent(summary.completionRate)}
      </p>
      <p className="text-ink-muted mt-1 text-xs">완료율</p>

      <div
        className="bg-raise mt-3 flex h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`완료 ${summary.done}건, 진행 중 ${summary.inProgress}건, 남은 일 ${remaining}건`}
      >
        <span className="bg-brand block h-full" style={{ width: width(summary.done) }} />
        <span
          className="bg-brand block h-full opacity-45"
          style={{ width: width(summary.inProgress) }}
        />
      </div>
      <p className="text-ink-muted mt-1.5 text-xs">
        진행 중 {summary.inProgress}건 · 남은 일 {remaining}건
        {summary.cancelled > 0 && ` · 취소 ${summary.cancelled}건`}
      </p>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        <Signal label="지연" value={summary.overdue} tone="late" />
        <Signal label="마감 임박" value={summary.dueSoon} tone="warn" />
        <Signal label="승인 대기" value={summary.approvalWaiting} />
        <Signal label="검토 대기" value={summary.reviewWaiting} />
      </ul>

      <p className="text-ink-muted mt-2 text-xs">
        평균 진행률 {percent(summary.avgProgress)} · 가장 이른 마감 {summary.nearestDueAt ?? '없음'}
      </p>
    </section>
  );
}

/** 0이면 색을 뺀다. 정상인 것에 색을 주면 화면의 절반이 색을 갖고 진짜 신호가 묻힌다 */
function Signal({ label, value, tone }: { label: string; value: number; tone?: 'late' | 'warn' }) {
  const live = value > 0;
  const paint =
    !live || tone === undefined
      ? 'border-line text-ink-muted'
      : tone === 'late'
        ? 'border-late-line bg-late-bg text-late'
        : 'border-warn-line bg-warn-bg text-warn';

  return (
    <li className={`rounded-full border px-2.5 py-1 text-xs ${paint} ${live ? 'font-medium' : ''}`}>
      {label} <span className="tabular-nums">{value}</span>
    </li>
  );
}

/** 모수가 0이면 `null`이다. 그때 `0%`라고 적으면 「하나도 못 했다」로 읽힌다 */
function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`;
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
