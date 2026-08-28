'use client';

/**
 * **업무 생성** — 대시보드·팀 화면의 [＋ 업무 생성] 버튼과 그것이 여는 오른쪽 패널.
 *
 * ## 열림을 URL에 두지 않는다
 *
 * 업무 **상세** 패널은 `?task=`가 열림이다 — 링크를 받은 사람이 같은 업무를 봐야 하기
 * 때문이다 (`UC-15`). 만들기 패널에는 그럴 대상이 없다: 빈 폼의 딥링크는 아무것도 가리키지
 * 않고, 뒤로 가기로 되살아난 빈 폼은 오히려 「내가 뭘 하다 말았지」가 된다. 그래서 여기서는
 * 로컬 상태가 맞다.
 *
 * ## 팀 목록을 화면이 짓지 않는다
 *
 * `creatableTeams(role, teamId)`가 낸 목록을 그대로 받는다 — 어드민은 셋, 팀장은 자기 팀
 * 하나다. 화면이 역할을 다시 읽으면 「어느 팀에 만들 수 있나」의 규칙이 셋째 자리에 생기고,
 * 그 자리는 서버가 보지 않는다. 목록이 비면 버튼 자체가 뜨지 않는다.
 *
 * ## 만든 뒤에 그 업무를 연다
 *
 * 응답의 `task.id`로 상세 패널을 여는 주소로 옮긴다. 목록만 새로 그리면 방금 만든 줄을
 * 사용자가 표에서 찾아야 하고, 필터가 걸려 있으면 아예 안 보인다.
 *
 * ⚠ 그 주소를 **함수로 받지 않는다.** 서버 컴포넌트는 클라이언트 컴포넌트에 함수를 넘길 수
 * 없다(`Functions cannot be passed directly to Client Components`). 그래서 `pathname`과
 * `query`라는 **값**을 받고 `buildHref`를 여기서 부른다 — 링크를 짓는 규칙은 여전히
 * `lib/view/dashboard-query.ts` 한 곳이라, 걸어 둔 필터가 그대로 따라간다.
 *
 * **낙관적 업데이트를 하지 않는다** (`task-edit-form.tsx`와 같은 규칙).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { OwnerCandidate } from '@/components/tasks/owner-assign-form';
import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';
import { teamLabel } from '@/lib/view/team-slug';
import type { ApiErrorBody } from '@/types/api';
import type { TeamKey } from '@/types/task';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

interface Draft {
  teamId: TeamKey;
  title: string;
  status: string;
  progress: string;
  priority: string;
  assignedAt: string;
  dueAt: string;
  nextAction: string;
  nextActionDue: string;
  note: string;
  ownerMemberId: string;
  coOwnerMemberIds: string[];
}

function emptyDraft(teamId: TeamKey): Draft {
  return {
    teamId,
    title: '',
    status: '',
    progress: '',
    priority: '',
    assignedAt: '',
    dueAt: '',
    nextAction: '',
    nextActionDue: '',
    note: '',
    ownerMemberId: '',
    coOwnerMemberIds: [],
  };
}

export function TaskCreatePanel({
  teams,
  candidatesByTeam,
  statusOptions,
  pathname,
  query,
}: {
  /** `creatableTeams`가 낸 목록. 비어 있으면 이 컴포넌트가 아무것도 그리지 않는다 */
  teams: readonly TeamKey[];
  /**
   * 팀별 담당자 후보. 팀을 바꾸면 후보도 바뀌어야 해서 **팀 축으로 받는다** — 한 벌만 받아
   * 화면에서 걸러 내면 `assignableMembers`의 규칙이 두 곳이 된다.
   *
   * 브라우저로 나가는 것은 `{id, name}`뿐이다 (`MemberRecord`의 `authUserId`를 싣지 않는다 —
   * `S6`).
   */
  candidatesByTeam: Readonly<Partial<Record<TeamKey, readonly OwnerCandidate[]>>>;
  statusOptions: readonly string[];
  /** 만든 뒤 열 주소를 여기서 짓는다 (머리말의 ⚠). 둘 다 **값**이라 직렬화된다 */
  pathname: string;
  query: DashboardQuery;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(teams[0] ?? 'edit'));

  // 만들 수 있는 팀이 없으면 버튼도 없다 — 눌러도 400이 나는 버튼을 두지 않는다
  if (teams.length === 0) return null;

  const busy = sending || pending;
  const candidates = candidatesByTeam[draft.teamId] ?? [];
  const set = (patch: Partial<Draft>): void => setDraft((prev) => ({ ...prev, ...patch }));

  function close(): void {
    setDraft(emptyDraft(teams[0] ?? 'edit'));
    setMessage(null);
    setOpen(false);
  }

  async function submit(): Promise<void> {
    if (draft.title.trim() === '') {
      setMessage('업무명을 적어 주세요.');
      return;
    }

    setSending(true);
    setMessage(null);

    /*
     * **빈 칸은 아예 보내지 않는다.** 서버 스키마가 빈 문자열도 `null`로 접지만, 키를 빼는
     * 편이 「안 적었다」를 그대로 옮긴다 — 저장소가 기본값을 정하는 자리를 화면이 앞질러
     * 채우지 않는다.
     */
    const body: Record<string, unknown> = { teamId: draft.teamId, title: draft.title.trim() };
    for (const key of [
      'status',
      'priority',
      'assignedAt',
      'dueAt',
      'nextAction',
      'nextActionDue',
      'note',
    ] as const) {
      if (draft[key].trim() !== '') body[key] = draft[key];
    }
    if (draft.progress.trim() !== '') body.progress = Number(draft.progress);
    if (draft.ownerMemberId !== '') body.ownerMemberId = draft.ownerMemberId;
    if (draft.coOwnerMemberIds.length > 0) body.coOwnerMemberIds = draft.coOwnerMemberIds;

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      const created = (await response.json()) as { task?: { id?: string } };
      close();

      // 방금 만든 업무를 연다. id를 못 읽었으면 목록만 다시 그린다 (지어내지 않는다)
      if (typeof created.task?.id === 'string') {
        router.push(buildHref(pathname, query, { task: created.task.id }));
      }
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line text-ink hover:border-brand hover:text-brand rounded border px-3 py-1.5 text-xs"
      >
        ＋ 업무 생성
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={close}
        className="border-line text-ink-muted rounded border px-3 py-1.5 text-xs"
      >
        ＋ 업무 생성
      </button>

      {/* 상세 패널과 **같은 자리·같은 폭**이다 — 오른쪽에서 나오는 것이 둘이면 안 된다 */}
      <div className="fixed inset-0 z-40 flex justify-end">
        <button
          type="button"
          aria-label="패널 닫기"
          onClick={close}
          className="bg-ink/30 absolute inset-0"
        />

        <aside
          aria-label="업무 생성"
          className="border-line bg-panel relative z-10 h-full w-[660px] max-w-[92vw] overflow-y-auto border-l"
          style={{ animation: 'panel-slide-in 200ms ease-out' }}
        >
          <header className="border-line bg-panel sticky top-0 flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-brand text-sm font-semibold">업무 생성</h2>
              <p className="text-ink-muted mt-1 text-xs">
                시트에 없는 업무를 여기서 만듭니다. 시트 업로드가 덮어쓰지 않습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-2 py-1 text-xs"
            >
              닫기
            </button>
          </header>

          <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
            <Field label="팀">
              <select
                value={draft.teamId}
                onChange={(event) =>
                  // 팀이 바뀌면 담당자 후보가 통째로 바뀐다 — 고른 사람을 함께 비운다
                  set({
                    teamId: event.target.value as TeamKey,
                    ownerMemberId: '',
                    coOwnerMemberIds: [],
                  })
                }
                disabled={busy || teams.length === 1}
                className={FIELD}
              >
                {teams.map((team) => (
                  <option key={team} value={team}>
                    {teamLabel(team)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="상태">
              <select
                value={draft.status}
                onChange={(event) => set({ status: event.target.value })}
                disabled={busy}
                className={FIELD}
              >
                <option value="">선택 안 함</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="업무명" full>
              <input
                type="text"
                value={draft.title}
                onChange={(event) => set({ title: event.target.value })}
                disabled={busy}
                placeholder="예) [샘플] 카드뉴스 A"
                className={FIELD}
              />
            </Field>

            <Field label="담당자">
              <select
                value={draft.ownerMemberId}
                onChange={(event) => set({ ownerMemberId: event.target.value })}
                disabled={busy || candidates.length === 0}
                className={FIELD}
              >
                <option value="">지정 안 함</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="진행률 (%)">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={draft.progress}
                onChange={(event) => set({ progress: event.target.value })}
                disabled={busy}
                className={`${FIELD} tabular-nums`}
              />
            </Field>

            <Field label="공동 담당" full>
              {candidates.length === 0 ? (
                <p className="text-ink-muted text-xs">이 팀의 시트 명부가 비어 있습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {candidates
                    // 주 담당은 공동 담당 후보에서 뺀다 — 서버도 겹치면 지운다
                    .filter((candidate) => candidate.id !== draft.ownerMemberId)
                    .map((candidate) => (
                      <label key={candidate.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={draft.coOwnerMemberIds.includes(candidate.id)}
                          onChange={(event) =>
                            set({
                              coOwnerMemberIds: event.target.checked
                                ? [...draft.coOwnerMemberIds, candidate.id]
                                : draft.coOwnerMemberIds.filter((id) => id !== candidate.id),
                            })
                          }
                          disabled={busy}
                        />
                        <span className="text-ink">{candidate.name}</span>
                      </label>
                    ))}
                </div>
              )}
            </Field>

            <Field label="배정일">
              <input
                type="date"
                value={draft.assignedAt}
                onChange={(event) => set({ assignedAt: event.target.value })}
                disabled={busy}
                className={`${FIELD} tabular-nums`}
              />
            </Field>

            <Field label="마감">
              <input
                type="date"
                value={draft.dueAt}
                onChange={(event) => set({ dueAt: event.target.value })}
                disabled={busy}
                className={`${FIELD} tabular-nums`}
              />
            </Field>

            <Field label="다음 조치" full>
              <input
                type="text"
                value={draft.nextAction}
                onChange={(event) => set({ nextAction: event.target.value })}
                disabled={busy}
                className={FIELD}
              />
            </Field>

            <Field label="다음 조치 기한">
              <input
                type="date"
                value={draft.nextActionDue}
                onChange={(event) => set({ nextActionDue: event.target.value })}
                disabled={busy}
                className={`${FIELD} tabular-nums`}
              />
            </Field>

            <Field label="우선순위">
              <input
                type="text"
                value={draft.priority}
                onChange={(event) => set({ priority: event.target.value })}
                disabled={busy}
                className={FIELD}
              />
            </Field>

            <Field label="비고" full>
              <textarea
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
                disabled={busy}
                rows={3}
                className={FIELD}
              />
            </Field>
          </div>

          <div className="border-line flex flex-wrap items-center gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || draft.title.trim() === ''}
              className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
                busy || draft.title.trim() === ''
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-brand-strong'
              }`}
            >
              {busy ? '만드는 중…' : '업무 만들기'}
            </button>
            <span className="text-ink-muted text-xs">업무명 말고는 나중에 채워도 됩니다.</span>
          </div>

          {message !== null && <p className="text-late px-5 pb-5 text-sm">{message}</p>}
        </aside>
      </div>
    </>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${full === true ? 'sm:col-span-2' : ''}`}>
      <span className="text-ink-muted text-xs">{label}</span>
      {children}
    </label>
  );
}
