'use client';

/**
 * 업무 패널의 **단계 타임라인**. 읽을 때는 단계마다 라벨-값 목록이고, [수정하기]를 누르면
 * 그 자리에서 입력칸으로 바뀐다 — 기본·팀 전용 표와 **같은 방식이다**
 * (`task-detail-fields.tsx` 머리말).
 *
 * ## 왜 파일이 따로인가
 *
 * 고치는 대상이 다르다. 저쪽은 `tasks` 한 행이고 여기는 `task_stages` **여러 행**이라,
 * 폼 상태가 「칸 → 값」이 아니라 「줄 → 칸 → 값」이다. 한 컴포넌트에 두면 그 두 모양이
 * 한 `save()` 안에서 섞이고, 이미 600줄인 파일이 그만큼 더 길어진다.
 *
 * **편집팀이 이 표를 쓴다.** 그 팀의 실제 진행(컨셉·제작·최종본의 계획일·실제일·확인·내용)은
 * 팀 전용 칸이 아니라 여기 들어 있다 — 그래서 저쪽 표만 열려 있던 동안 편집팀 사람에게는
 * 화면에서 고칠 자리가 공통 13칸뿐이었다 (`0018`).
 *
 * ## 구조는 고치지 않는다
 *
 * 단계 이름·순서·SLA는 **시트가 정한다.** 여기서 바꿀 수 있으면 그 업무의 타임라인이 시트의
 * 것과 다른 물건이 되고, 다음 업로드가 단계를 통째로 교체하면서 그대로 사라진다. 그래서
 * 입력칸은 넷뿐이고, DB의 컬럼 GRANT가 같은 목록을 진다 (`0018` 2절).
 *
 * ## 여기서 하지 않는 것
 *
 * 저쪽 파일과 같다 — **판정하지 않고**(`canEdit`·`lockedFields`는 페이지가 내려 준다),
 * **문구를 짓지 않으며**(서버가 준 `message`를 그대로 띄운다), **낙관적 업데이트를 하지
 * 않는다**(응답을 받은 뒤에야 `router.refresh()`).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { EMPTY, formatDate } from '@/lib/view/kpi-format';
import type { ApiErrorBody } from '@/types/api';
import type { TaskStage } from '@/types/task';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-2 py-1 text-sm focus:outline-none';

/** 고칠 수 있는 칸 넷. 순서가 곧 화면의 줄 순서다 */
const STAGE_FIELDS = ['plannedDate', 'actualDate', 'confirmStatus', 'content'] as const;

type StageKey = (typeof STAGE_FIELDS)[number];

/** 한 단계의 폼 값. 서버 값이 `null`인 칸은 빈 문자열이다 */
type StageDraft = Record<StageKey, string>;

function toDraft(stage: TaskStage): StageDraft {
  return {
    plannedDate: stage.plannedDate ?? '',
    actualDate: stage.actualDate ?? '',
    confirmStatus: stage.confirmStatus ?? '',
    content: stage.content ?? '',
  };
}

/**
 * 실제일이 계획일보다 늦은 단계만 **그 날짜 한 칸**이 앰버다. 행 전체를 칠하면 지연 빨강과
 * 함께 화면에 색이 두 뜻으로 존재하게 된다 (`UI_GUIDE.md`「눈에 띄는 것은 문제뿐이다」).
 */
function isLate(stage: TaskStage): boolean {
  return (
    stage.plannedDate !== null && stage.actualDate !== null && stage.actualDate > stage.plannedDate
  );
}

export function TaskStageFields({
  taskId,
  stages,
  canEdit,
  lockedFields,
}: {
  taskId: string;
  /** `seq` 순서로 이미 세워져 있다 (`task-panel-slot.tsx`) */
  stages: TaskStage[];
  /** 이 업무를 고칠 수 있는가. 기본 표와 **같은 값**이다 (`task-panel-slot.tsx`) */
  canEdit: boolean;
  /**
   * 이 역할이 못 고치는 단계 칸 (`lockedStageFields`). 부원에게 계획일이 잠긴다 —
   * 잠긴 칸은 수정 중에도 값 그대로 서고, 그 이유를 한 줄로 적는다.
   */
  lockedFields: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** 원래 값. **저장할 때 이것과 비교해 바뀐 칸만 싣는다** (기본 표와 같은 규칙) */
  const original = Object.fromEntries(stages.map((stage) => [stage.id, toDraft(stage)]));
  const [draft, setDraft] = useState<Record<string, StageDraft>>(original);

  const busy = sending || pending;
  const open = (key: StageKey): boolean => editing && !lockedFields.includes(key);

  const set = (stageId: string, key: StageKey, value: string): void =>
    setDraft((prev) => ({ ...prev, [stageId]: { ...prev[stageId]!, [key]: value } }));

  function cancel(): void {
    setDraft(original);
    setMessage(null);
    setEditing(false);
  }

  async function save(): Promise<void> {
    setSending(true);
    setMessage(null);

    /*
     * **바뀐 줄의 바뀐 칸만** 싣는다. 전부 실어 보내면 남이 그 사이에 고친 칸을 이 폼이
     * 되돌린다. 빈 문자열은 `null`(비운다)이다.
     */
    const patches: Record<string, string | null>[] = [];
    for (const stage of stages) {
      const changed: Record<string, string | null> = {};
      for (const key of STAGE_FIELDS) {
        // 잠긴 칸은 아예 싣지 않는다 — 보내면 라우트가 요청 전체를 403으로 돌려보낸다
        if (lockedFields.includes(key)) continue;
        const next = draft[stage.id]?.[key] ?? '';
        if (next === original[stage.id]?.[key]) continue;
        changed[key] = next.trim() === '' ? null : next;
      }
      if (Object.keys(changed).length > 0) patches.push({ id: stage.id, ...changed });
    }

    if (patches.length === 0) {
      setMessage('바꾼 값이 없습니다.');
      setSending(false);
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stages: patches }),
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

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-brand text-sm font-semibold">단계</h3>
        {/* 단계가 없으면 고칠 것도 없다. 줄을 **만드는** 길은 이 화면에 없다 (구조는 시트다) */}
        {canEdit &&
          stages.length > 0 &&
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
          고친 값은 다음 시트 업로드가 시트의 값으로 되돌립니다. 단계 이름·순서·SLA는 시트가
          정합니다.
          {lockedFields.length > 0 && ' 계획일은 팀장·어드민이 고칩니다.'}
        </p>
      )}

      {stages.length === 0 ? (
        <p className="text-ink-muted mt-2 text-xs">단계 정보가 없습니다</p>
      ) : (
        <ol className="mt-2 space-y-3">
          {stages.map((stage) => (
            <li key={stage.id} className="border-line rounded border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink text-sm break-words">{stage.stageLabel}</span>
                <span className="text-ink-faint text-xs whitespace-nowrap tabular-nums">
                  {stage.slaDays === null ? EMPTY : `SLA ${stage.slaDays}일`}
                </span>
              </div>
              <dl className="mt-2">
                <StageRow label="계획일">
                  {open('plannedDate') ? (
                    <input
                      type="date"
                      value={draft[stage.id]?.plannedDate ?? ''}
                      onChange={(event) => set(stage.id, 'plannedDate', event.target.value)}
                      disabled={busy}
                      className={`${FIELD} tabular-nums`}
                    />
                  ) : (
                    <span className="text-ink-body tabular-nums">
                      {formatDate(stage.plannedDate)}
                    </span>
                  )}
                </StageRow>
                <StageRow label="실제일">
                  {open('actualDate') ? (
                    <input
                      type="date"
                      value={draft[stage.id]?.actualDate ?? ''}
                      onChange={(event) => set(stage.id, 'actualDate', event.target.value)}
                      disabled={busy}
                      className={`${FIELD} tabular-nums`}
                    />
                  ) : (
                    /* 계획보다 늦은 **날짜 한 칸**만 색을 갖는다 */
                    <span className={`tabular-nums ${isLate(stage) ? 'text-warn' : 'text-ink-body'}`}>
                      {formatDate(stage.actualDate)}
                    </span>
                  )}
                </StageRow>
                <StageRow label="확인 상태">
                  {open('confirmStatus') ? (
                    <input
                      type="text"
                      value={draft[stage.id]?.confirmStatus ?? ''}
                      onChange={(event) => set(stage.id, 'confirmStatus', event.target.value)}
                      disabled={busy}
                      className={FIELD}
                    />
                  ) : (
                    <Text value={stage.confirmStatus} />
                  )}
                </StageRow>
                <StageRow label="내용">
                  {open('content') ? (
                    <textarea
                      value={draft[stage.id]?.content ?? ''}
                      onChange={(event) => set(stage.id, 'content', event.target.value)}
                      disabled={busy}
                      rows={2}
                      className={FIELD}
                    />
                  ) : (
                    <Text value={stage.content} />
                  )}
                </StageRow>
              </dl>
            </li>
          ))}
        </ol>
      )}

      {message !== null && <p className="text-late mt-2 text-sm">{message}</p>}
    </section>
  );
}

/** 라벨-값 한 줄. 읽을 때와 고칠 때가 **같은 자리**여야 눈이 항목을 다시 찾지 않는다 */
function StageRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="border-line/60 grid grid-cols-[200px_1fr] items-center gap-3 border-b py-1.5 text-sm">
      <dt className="text-ink-muted text-xs break-words">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Text({ value }: { value: string | null }): React.ReactNode {
  return (
    <span className="text-ink-body break-words">
      {value === null || value.trim() === '' ? EMPTY : value}
    </span>
  );
}
