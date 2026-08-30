'use client';

/**
 * 업무 패널의 **기본 표와 팀 전용 표**. 읽을 때는 라벨-값 목록이고, [수정하기]를 누르면
 * **같은 표의 값 칸이 그 자리에서 입력칸으로 바뀐다.**
 *
 * ## 왜 별도 폼이 아니라 표인가
 *
 * 예전에는 표 아래에 열두 칸짜리 폼이 따로 열렸다. 그래서 고치는 사람이 **위의 표와 아래의
 * 폼을 번갈아 보며** 같은 항목을 두 번 찾아야 했고, 표에는 있는데 폼에는 없는 칸(팀 전용
 * 칸·담당자)이 생기면 「여기서는 왜 못 고치지」가 됐다. 값이 있는 자리에서 그 값을 고치면
 * 그 물음이 아예 생기지 않는다.
 *
 * ## 한 번에 저장한다
 *
 * 기본 칸·팀 전용 칸·담당자를 **요청 하나로** 보낸다. 나눠 보내면 그 사이에 화면을 새로
 * 그리는 순간이 생기고, 사용자는 자기가 만들지 않은 중간 상태를 본다 (담당자와 공동 담당을
 * 함께 보내던 규칙 그대로다).
 *
 * ## 「안 건드린다」와 「비운다」를 뭉개지 않는다
 *
 * 폼은 현재 값으로 열리고, 저장할 때 **원래 값과 비교해 바뀐 칸만** 싣는다. 전부 실어
 * 보내면 남이 그 사이에 고친 칸을 이 폼이 되돌린다. 빈 문자열은 `null`(비운다)이다.
 *
 * ## 여기서 하지 않는 것
 *
 * - **판정하지 않는다.** `canEdit`·`canAssign`·`lockedFields`는 페이지가 계산해 내려 준다.
 *   UI 잠금은 방어가 아니고 실제 거부는 `PATCH`가 한다 (`lockedTaskFields`를 라우트도 부른다).
 * - **문구를 짓지 않는다.** 실패하면 서버가 준 `message`를 그대로 띄운다. 서버가 아예 답하지
 *   못했을 때(네트워크 끊김)만 이 파일의 한 문장을 쓴다.
 * - **낙관적 업데이트를 하지 않는다.** 서버 응답을 받은 뒤에야 `router.refresh()`한다.
 *
 * 고친 값은 **다음 시트 업로드가 되돌린다** (`ADR-001`). 그것을 감추지 않고 한 줄로 적는다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { EMPTY, formatDate, formatDday, formatPercent } from '@/lib/view/kpi-format';
import type { ExtraField } from '@/lib/view/extras-edit';
import { type ExtraCell } from '@/lib/view/extras-render';
import type { ApiErrorBody } from '@/types/api';
import type { TaskResponse } from '@/types/api';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** 담당자 드롭다운의 「없음」. 빈 문자열은 「안 고름」과 구분되지 않아 값으로 쓰지 않는다 */
const UNASSIGNED = '__none__';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-2 py-1 text-sm focus:outline-none';

export interface OwnerCandidate {
  id: string;
  name: string;
}

/** 문자열 칸의 이름. `Draft`의 키이자 `PATCH` 본문의 키다 */
type TextKey =
  | 'title'
  | 'status'
  | 'progress'
  | 'priority'
  | 'riskStatus'
  | 'approvalStatus'
  | 'assignedAt'
  | 'dueAt'
  | 'nextAction'
  | 'nextActionOwner'
  | 'nextActionDue'
  | 'delayReason'
  | 'note';

type Draft = Record<TextKey, string>;

/** 서버 값 → 폼 값. `0`은 빈칸이 아니다 — falsy 검사를 쓰면 진행률 0%가 화면에서 사라진다 */
function toDraft(task: TaskResponse): Draft {
  return {
    title: task.title ?? '',
    status: task.status ?? '',
    progress: task.progress === null ? '' : String(task.progress),
    priority: task.priority ?? '',
    riskStatus: task.riskStatus ?? '',
    approvalStatus: task.approvalStatus ?? '',
    assignedAt: task.assignedAt ?? '',
    dueAt: task.dueAt ?? '',
    nextAction: task.nextAction ?? '',
    nextActionOwner: task.nextActionOwner ?? '',
    nextActionDue: task.nextActionDue ?? '',
    delayReason: task.delayReason ?? '',
    note: task.note ?? '',
  };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().join() === [...right].sort().join();
}

export function TaskDetailFields({
  task,
  cells,
  extraFields,
  canEdit,
  canAssign,
  statusOptions,
  ownerCandidates,
  lockedFields,
}: {
  task: TaskResponse;
  /** 읽기용 팀 전용 칸 **전량**. 민감 값은 「(비공개)」로 남는다 (`extras-render.ts`) */
  cells: readonly ExtraCell[];
  /** 고칠 수 있는 팀 전용 칸. 민감 키·하이퍼링크 칸은 빠져 있다 (`extras-edit.ts`) */
  extraFields: readonly ExtraField[];
  canEdit: boolean;
  /** 담당자 두 칸을 고칠 수 있는가. `canEdit`과 **다른 물음**이다 (`task-authoring.ts`) */
  canAssign: boolean;
  statusOptions: readonly string[];
  ownerCandidates: readonly OwnerCandidate[];
  /**
   * 이 역할이 **못 고치는 칸**. 부원에게 마감·우선순위·리스크·승인 …이 잠긴다
   * (`lockedTaskFields`). 잠긴 칸은 수정 중에도 값 그대로 서고, 그 이유를 한 줄로 적는다 —
   * 입력칸이 통째로 사라지면 「왜 여기만 없지」가 된다.
   */
  lockedFields: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const original = toDraft(task);
  const [draft, setDraft] = useState<Draft>(original);

  /** 팀 전용 칸은 키가 시트에서 오므로 못박지 못한다 — 키-값 표로 든다 */
  const originalExtras = Object.fromEntries(extraFields.map((field) => [field.key, field.value]));
  const [extras, setExtras] = useState<Record<string, string>>(originalExtras);

  /*
   * 지금 담당자가 후보에 없을 수 있다 — 시트 이름이 명부에 안 붙었거나 명부에서 빠진
   * 사람이다. 그때 후보의 첫 값을 고른 것처럼 그리면 **저장하지도 않은 사람이 현재 담당자로
   * 보인다.**
   */
  const currentOwner =
    task.ownerMemberId !== null && ownerCandidates.some((item) => item.id === task.ownerMemberId)
      ? task.ownerMemberId
      : UNASSIGNED;
  const [owner, setOwner] = useState(currentOwner);

  /* 공동 담당은 저장소에 **이름으로** 들어 있다. 명부에서 id로 되찾고, 못 찾은 이름은
     저장하면 사라지므로 아래에 미리 적는다 */
  const currentCoOwners = ownerCandidates
    .filter((item) => task.coOwnerNames.includes(item.name))
    .map((item) => item.id);
  const [coOwners, setCoOwners] = useState<string[]>(currentCoOwners);
  const orphanNames = task.coOwnerNames.filter(
    (name) => !ownerCandidates.some((item) => item.name === name)
  );

  const busy = sending || pending;
  const set = (key: TextKey, value: string): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  /** 그 칸을 지금 고칠 수 있는가. 잠긴 칸은 수정 중에도 읽기다 */
  const open = (key: TextKey): boolean => editing && !lockedFields.includes(key);

  function cancel(): void {
    setDraft(original);
    setExtras(originalExtras);
    setOwner(currentOwner);
    setCoOwners(currentCoOwners);
    setMessage(null);
    setEditing(false);
  }

  async function save(): Promise<void> {
    setSending(true);
    setMessage(null);

    const patch: Record<string, unknown> = {};
    const text = (key: TextKey): void => {
      // 잠긴 칸은 아예 싣지 않는다 — 보내면 라우트가 요청 전체를 403으로 돌려보낸다
      if (lockedFields.includes(key)) return;
      if (draft[key] === original[key]) return;
      patch[key] = draft[key].trim() === '' ? null : draft[key];
    };

    // 업무명은 비울 수 없다 — 서버가 400을 내기 전에 여기서 말한다
    if (!lockedFields.includes('title') && draft.title !== original.title) {
      if (draft.title.trim() === '') {
        setMessage('업무명은 비울 수 없습니다.');
        setSending(false);
        return;
      }
      patch.title = draft.title;
    }
    // 상태도 `null`을 받지 않는다 — 「선택 안 함」은 「안 바꾼다」다
    if (!lockedFields.includes('status') && draft.status !== original.status && draft.status !== '') {
      patch.status = draft.status;
    }

    if (!lockedFields.includes('progress') && draft.progress !== original.progress) {
      patch.progress = draft.progress.trim() === '' ? null : Number(draft.progress);
    }

    for (const key of [
      'priority',
      'riskStatus',
      'approvalStatus',
      'assignedAt',
      'dueAt',
      'nextAction',
      'nextActionOwner',
      'nextActionDue',
      'delayReason',
      'note',
    ] as const) {
      text(key);
    }

    // 팀 전용 칸도 **바뀐 키만** 싣는다 (라우트가 기존 값에 얹는다)
    const changedExtras: Record<string, string | null> = {};
    for (const field of extraFields) {
      const next = extras[field.key] ?? '';
      if (next === field.value) continue;
      changedExtras[field.key] = next.trim() === '' ? null : next;
    }
    if (Object.keys(changedExtras).length > 0) patch.extras = changedExtras;

    /*
     * 담당자 둘은 **함께** 보낸다. 따로 보내면 「같은 사람이 두 칸에 있는」 순간이 생기고,
     * 겹침 제거는 서버가 한 번에 한다.
     */
    if (canAssign && (owner !== currentOwner || !sameSet(coOwners, currentCoOwners))) {
      patch.ownerMemberId = owner === UNASSIGNED ? null : owner;
      patch.coOwnerMemberIds = coOwners;
    }

    if (Object.keys(patch).length === 0) {
      setMessage('바꾼 값이 없습니다.');
      setSending(false);
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(body?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      // 값을 여기서 갈아 끼우지 않는다 — 서버 컴포넌트가 다시 그린 것이 진실이다
      setEditing(false);
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  const textCell = (key: TextKey, type: 'text' | 'date' | 'number' = 'text'): React.ReactNode => (
    <input
      type={type}
      value={draft[key]}
      onChange={(event) => set(key, event.target.value)}
      disabled={busy}
      {...(type === 'number' ? { min: 0, max: 100, step: 1 } : {})}
      className={type === 'text' ? FIELD : `${FIELD} tabular-nums`}
    />
  );

  return (
    <>
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-brand text-sm font-semibold">기본</h3>
          {canEdit &&
            (editing ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy}
                  className={`bg-brand text-canvas rounded px-3 py-1 text-xs ${
                    busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
                  }`}
                >
                  {busy ? '저장 중…' : '저장'}
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={busy}
                  className="border-line text-ink hover:border-brand hover:text-brand rounded border px-3 py-1 text-xs"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="border-line text-ink hover:border-brand hover:text-brand rounded border px-3 py-1 text-xs"
              >
                수정하기
              </button>
            ))}
        </div>

        {editing && (
          <p className="text-ink-muted mt-1 text-xs">
            고친 값은 다음 시트 업로드가 시트의 값으로 되돌립니다.
            {lockedFields.length > 0 &&
              ' 마감·우선순위·리스크·승인처럼 팀의 판단이 담긴 칸은 팀장·어드민이 고칩니다.'}
          </p>
        )}

        <dl className="mt-2">
          {/* 업무명은 읽을 때 패널 머리말이 크게 그린다 — 고칠 때만 줄로 선다 */}
          {editing && <FieldRow label="업무명">{open('title') ? textCell('title') : <Text value={task.title} />}</FieldRow>}

          <FieldRow label="담당자">
            {editing && canAssign ? (
              <select
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                disabled={busy || ownerCandidates.length === 0}
                className={FIELD}
              >
                <option value={UNASSIGNED}>담당자 없음</option>
                {ownerCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            ) : (
              <Text value={task.ownerNameRaw} />
            )}
          </FieldRow>

          <FieldRow label="공동 담당">
            {editing && canAssign ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {/* 주 담당은 목록에서 뺀다 — 한 사람이 두 칸에 설 수 없는 것은 규칙이지 상태가 아니다 */}
                {ownerCandidates
                  .filter((candidate) => owner === UNASSIGNED || candidate.id !== owner)
                  .map((candidate) => (
                    <label key={candidate.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={coOwners.includes(candidate.id)}
                        onChange={() =>
                          setCoOwners((prev) =>
                            prev.includes(candidate.id)
                              ? prev.filter((item) => item !== candidate.id)
                              : [...prev, candidate.id]
                          )
                        }
                        disabled={busy}
                      />
                      <span className="text-ink-body">{candidate.name}</span>
                    </label>
                  ))}
                {ownerCandidates.length === 0 && (
                  <span className="text-ink-muted text-xs">
                    이 팀의 시트 명부가 비어 있어 고를 사람이 없습니다.
                  </span>
                )}
              </div>
            ) : (
              <Text
                value={task.coOwnerNames.length === 0 ? null : task.coOwnerNames.join(', ')}
              />
            )}
          </FieldRow>

          {editing && canAssign && orphanNames.length > 0 && (
            <p className="text-warn py-1.5 text-xs">
              명부에서 찾지 못한 공동 담당 {orphanNames.length}명은 저장하면 사라집니다.
            </p>
          )}

          {/* 시트 원문 그대로다. 5색은 패널 머리말의 배지가 말한다 (`ADR-009`) */}
          <FieldRow label="상태 (시트 원문)">
            {open('status') ? (
              <select
                value={draft.status}
                onChange={(event) => set('status', event.target.value)}
                disabled={busy}
                className={FIELD}
              >
                <option value="">선택 안 함</option>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {/* 시트 값이 목록에 없을 수 있다 — 고르지 않아도 사라지지 않게 남긴다 */}
                {draft.status !== '' && !statusOptions.includes(draft.status) && (
                  <option value={draft.status}>{draft.status} (시트 값)</option>
                )}
              </select>
            ) : (
              <Text value={task.status} />
            )}
          </FieldRow>

          <FieldRow label="승인">
            {open('approvalStatus') ? textCell('approvalStatus') : <Text value={task.approvalStatus} />}
          </FieldRow>
          <FieldRow label="우선순위">
            {open('priority') ? textCell('priority') : <Text value={task.priority} />}
          </FieldRow>
          <FieldRow label="리스크">
            {open('riskStatus') ? textCell('riskStatus') : <Text value={task.riskStatus} />}
          </FieldRow>
          <FieldRow label="진행률">
            {open('progress') ? (
              textCell('progress', 'number')
            ) : (
              <span className="text-ink-body tabular-nums">{formatPercent(task.progress)}</span>
            )}
          </FieldRow>
          <FieldRow label="배정일">
            {open('assignedAt') ? (
              textCell('assignedAt', 'date')
            ) : (
              <span className="text-ink-body tabular-nums">{formatDate(task.assignedAt)}</span>
            )}
          </FieldRow>
          <FieldRow label="마감">
            {open('dueAt') ? (
              textCell('dueAt', 'date')
            ) : (
              <span className="text-ink-body tabular-nums">{formatDate(task.dueAt)}</span>
            )}
          </FieldRow>
          {/* D-DAY는 마감에서 나온 값이다 — 고치는 칸이 아니라 읽는 칸이다 */}
          <FieldRow label="D-DAY">
            <span className="text-ink-body tabular-nums">{formatDday(task.flags.dday)}</span>
          </FieldRow>
          <FieldRow label="다음 조치">
            {open('nextAction') ? textCell('nextAction') : <Text value={task.nextAction} />}
          </FieldRow>
          <FieldRow label="다음 조치 담당">
            {open('nextActionOwner') ? (
              textCell('nextActionOwner')
            ) : (
              <Text value={task.nextActionOwner} />
            )}
          </FieldRow>
          <FieldRow label="다음 조치 기한">
            {open('nextActionDue') ? (
              textCell('nextActionDue', 'date')
            ) : (
              <span className="text-ink-body tabular-nums">{formatDate(task.nextActionDue)}</span>
            )}
          </FieldRow>
          <FieldRow label="지연 사유">
            {open('delayReason') ? textCell('delayReason') : <Text value={task.delayReason} />}
          </FieldRow>
          <FieldRow label="비고">
            {open('note') ? (
              <textarea
                value={draft.note}
                onChange={(event) => set('note', event.target.value)}
                disabled={busy}
                rows={2}
                className={FIELD}
              />
            ) : (
              <Text value={task.note} />
            )}
          </FieldRow>
        </dl>

        {message !== null && <p className="text-late mt-2 text-sm">{message}</p>}
      </section>

      <section>
        <h3 className="text-brand text-sm font-semibold">
          팀 전용 필드
          <span className="text-ink-muted ml-2 text-xs font-normal tabular-nums">
            {cells.length}칸
          </span>
        </h3>

        {/*
         * 읽을 때는 **전량이다** — 개수를 자르면 70컬럼 팀의 데이터가 화면에서 사라진다.
         * 고칠 때는 고칠 수 있는 칸만 선다: 민감 키와 하이퍼링크 칸은 빠져 있고
         * (`extras-edit.ts`), 그 값들은 저장에도 영향받지 않는다.
         */}
        {editing ? (
          extraFields.length === 0 ? (
            <p className="text-ink-muted mt-2 text-xs">고칠 수 있는 팀 전용 칸이 없습니다</p>
          ) : (
            <dl className="mt-2">
              {extraFields.map((field) => (
                <FieldRow key={field.key} label={field.key}>
                  {field.options === null ? (
                    <input
                      type="text"
                      value={extras[field.key] ?? ''}
                      onChange={(event) =>
                        setExtras((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      disabled={busy}
                      className={FIELD}
                    />
                  ) : (
                    <select
                      value={extras[field.key] ?? ''}
                      onChange={(event) =>
                        setExtras((prev) => ({ ...prev, [field.key]: event.target.value }))
                      }
                      disabled={busy}
                      className={FIELD}
                    >
                      <option value="">비움</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {/* 시트에 있던 값이 목록에 없을 수 있다 */}
                      {(extras[field.key] ?? '') !== '' &&
                        !field.options.includes(extras[field.key]!) && (
                          <option value={extras[field.key]}>{extras[field.key]} (시트 값)</option>
                        )}
                    </select>
                  )}
                </FieldRow>
              ))}
            </dl>
          )
        ) : cells.length === 0 ? (
          <p className="text-ink-muted mt-2 text-xs">팀 전용 필드가 없습니다</p>
        ) : (
          <dl className="mt-2">
            {cells.map((cell) => (
              <FieldRow key={cell.label} label={cell.label}>
                {cell.href === null ? (
                  <span className={cell.masked ? 'text-ink-faint' : 'text-ink-body'}>
                    {cell.text}
                  </span>
                ) : (
                  // 스킴 검사를 통과한 링크만 여기 온다. 외부로 나가므로 opener를 끊는다 (`S7`)
                  <a
                    href={cell.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink hover:text-brand break-words underline-offset-4 hover:underline"
                  >
                    {cell.text}
                  </a>
                )}
              </FieldRow>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}

/** 라벨-값 한 줄. 읽을 때와 고칠 때가 **같은 자리**여야 눈이 항목을 다시 찾지 않는다 */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <div className="border-line/60 grid grid-cols-[200px_1fr] items-center gap-3 border-b py-1.5 text-sm">
      <dt className="text-ink-muted text-xs break-words">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** 빈 값은 「—」다. 「없다」와 「가려졌다」의 구분은 팀 전용 표가 따로 진다 */
function Text({ value }: { value: string | null }): React.ReactNode {
  return <span className="text-ink-body break-words">{value === null || value.trim() === '' ? EMPTY : value}</span>;
}
