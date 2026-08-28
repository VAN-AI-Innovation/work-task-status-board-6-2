'use client';

/**
 * 사이드 패널의 **업무 수정** 폼 (`UC-16`). 여는 필드는 `PATCH /api/tasks/[id]`의 zod가 받는
 * 것과 같고, 그 목록의 근거는 `task-patch-schema.ts` 머리말에 있다.
 *
 * ## 접혀 있다가 [수정하기]로 열린다
 *
 * 열두 칸을 늘 펼쳐 두면 패널이 **읽는 화면**이 아니라 **입력 화면**으로 보인다. 이 패널을
 * 여는 이유는 대부분 「이 업무 어떻게 돼 가지」를 읽는 것이고, 고치는 것은 그다음이다.
 * 그래서 기본은 접힘이고, 접힌 상태에서는 버튼 하나만 선다.
 *
 * ## 「안 건드린다」와 「비운다」를 버튼 하나로 뭉개지 않는다
 *
 * 폼은 **현재 값으로 열린다.** 사용자가 지운 칸은 `null`(비운다)로 나가고, 손대지 않은 칸은
 * 아예 보내지 않는다 — 그 구분이 이 제품의 오래된 규칙이다(빈 셀과 0을 구분한다,
 * `types/task.ts`). 그래서 저장할 때 **원래 값과 비교해 바뀐 것만** 싣는다: 전부 실어
 * 보내면 남이 그 사이에 고친 칸을 이 폼이 되돌린다.
 *
 * ## 시트가 덮어쓴다는 사실을 감추지 않는다
 *
 * 여기서 고친 값은 **다음 시트 업로드가 되돌린다** (`ADR-001`). 그것을 말하지 않으면
 * 사용자는 자기 수정이 조용히 사라진 것으로 본다 — 폼 안에 한 줄로 적는다.
 *
 * ## UI 숨김은 방어가 아니다
 *
 * 이 폼이 보이지 않는 것은 「할 수 없는 조작을 눈앞에 두지 않는다」는 뜻일 뿐이고, **실제
 * 거부는 서버가 한다** — `PATCH`가 미인증에 401, 범위 밖에 403을 낸다(`viewer-scope.ts`의
 * `taskEditable`과 RLS 두 층). `canEdit`을 항상 `true`로 만들어도 남의 업무는 저장되지 않는다.
 *
 * ## 화면이 문구를 지어내지 않는다
 *
 * 실패하면 서버가 준 `message`를 그대로 한 줄로 띄운다. 「권한이 없습니다」를 여기서 짓기
 * 시작하면 서버가 코드를 바꿔도 화면은 옛 문장을 말한다. 서버가 아예 답하지 못했을 때
 * (네트워크 끊김)만 이 파일의 한 문장을 쓴다 — `seed-button.tsx`와 같은 규칙이다.
 *
 * ## 낙관적 업데이트를 하지 않는다
 *
 * 서버 응답을 받은 뒤에야 `router.refresh()`로 서버 컴포넌트를 다시 그린다. 먼저 그리면
 * 거부당한 수정이 잠깐 성공한 것처럼 보이고, 그 잠깐이 이 화면에서 가장 위험한 거짓말이다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

/**
 * 폼이 들고 있는 값. **전부 문자열이다** — `<input>`이 문자열만 다루고, 빈 문자열이 곧
 * 「비운다」다. 숫자·`null` 변환은 저장 직전에 한 번만 한다.
 */
interface Draft {
  title: string;
  status: string;
  progress: string;
  priority: string;
  assignedAt: string;
  dueAt: string;
  nextAction: string;
  nextActionOwner: string;
  nextActionDue: string;
  delayReason: string;
  note: string;
}

export interface TaskEditValues {
  title: string | null;
  status: string | null;
  progress: number | null;
  priority: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  delayReason: string | null;
  note: string | null;
}

/** 서버 값 → 폼 값. `null`도 `0`도 화면에서는 문자열이라 `??`가 아니라 명시적으로 나눈다 */
function toDraft(values: TaskEditValues): Draft {
  return {
    title: values.title ?? '',
    status: values.status ?? '',
    // `0`은 빈칸이 아니다 — falsy 검사를 쓰면 진행률 0%가 화면에서 사라진다
    progress: values.progress === null ? '' : String(values.progress),
    priority: values.priority ?? '',
    assignedAt: values.assignedAt ?? '',
    dueAt: values.dueAt ?? '',
    nextAction: values.nextAction ?? '',
    nextActionOwner: values.nextActionOwner ?? '',
    nextActionDue: values.nextActionDue ?? '',
    delayReason: values.delayReason ?? '',
    note: values.note ?? '',
  };
}

export function TaskEditForm({
  taskId,
  values,
  statusOptions,
}: {
  taskId: string;
  /** 현재 저장된 값. 폼이 이것으로 열리고, 저장할 때 이것과 **비교해** 바뀐 칸만 싣는다 */
  values: TaskEditValues;
  /** 상태 드롭다운 목록. 문자열을 화면에 다시 적지 않는다 (`ADR-009`) */
  statusOptions: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const original = toDraft(values);
  const [draft, setDraft] = useState<Draft>(original);

  const busy = sending || pending;
  const set = (key: keyof Draft, value: string): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  /** 접을 때는 고치던 값을 버린다 — 남겨 두면 다음에 열었을 때 저장한 줄 알게 된다 */
  function close(): void {
    setDraft(original);
    setMessage(null);
    setOpen(false);
  }

  async function save(): Promise<void> {
    setSending(true);
    setMessage(null);

    /*
     * **바뀐 칸만 싣는다** (머리말). 빈 문자열은 `null`(비운다)로 보내는데, 서버 스키마도
     * 같은 규칙이라 어느 쪽이 접든 결과가 같다 — 다만 `title`은 비울 수 없어서 아예 뺀다.
     */
    const patch: Record<string, string | number | null> = {};
    const text = (key: keyof Draft): void => {
      if (draft[key] === original[key]) return;
      patch[key] = draft[key].trim() === '' ? null : draft[key];
    };

    // 업무명은 비울 수 없다 — 서버가 400을 내기 전에 여기서 말한다
    if (draft.title !== original.title) {
      if (draft.title.trim() === '') {
        setMessage('업무명은 비울 수 없습니다.');
        setSending(false);
        return;
      }
      patch.title = draft.title;
    }
    // 상태도 `null`을 받지 않는다 — 「선택 안 함」은 「안 바꾼다」다
    if (draft.status !== original.status && draft.status !== '') patch.status = draft.status;

    if (draft.progress !== original.progress) {
      patch.progress = draft.progress.trim() === '' ? null : Number(draft.progress);
    }

    for (const key of [
      'priority',
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

    if (Object.keys(patch).length === 0) {
      setMessage('바꾼 값이 없습니다.');
      setSending(false);
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
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
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-line text-ink hover:border-brand hover:text-brand rounded border px-3 py-1.5 text-sm"
        >
          수정하기
        </button>
        <span className="text-ink-muted text-xs">
          고친 값은 다음 시트 업로드가 시트의 값으로 되돌립니다.
        </span>
      </div>
    );
  }

  return (
    <div className="border-line rounded border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="업무명" full>
          <input
            type="text"
            value={draft.title}
            onChange={(event) => set('title', event.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </Field>

        <Field label="상태">
          <select
            value={draft.status}
            onChange={(event) => set('status', event.target.value)}
            disabled={busy}
            className={FIELD}
          >
            {/* 시트 원문이 목록 밖일 수 있다 — 그때 목록의 첫 값을 고른 것처럼 그리지 않는다 */}
            <option value="">선택 안 함</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {draft.status !== '' && !statusOptions.includes(draft.status) && (
              <option value={draft.status}>{draft.status} (시트 값)</option>
            )}
          </select>
        </Field>

        <Field label="진행률 (%)">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={draft.progress}
            onChange={(event) => set('progress', event.target.value)}
            disabled={busy}
            className={`${FIELD} tabular-nums`}
          />
        </Field>

        <Field label="우선순위">
          <input
            type="text"
            value={draft.priority}
            onChange={(event) => set('priority', event.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </Field>

        <Field label="배정일">
          <input
            type="date"
            value={draft.assignedAt}
            onChange={(event) => set('assignedAt', event.target.value)}
            disabled={busy}
            className={`${FIELD} tabular-nums`}
          />
        </Field>

        <Field label="마감">
          <input
            type="date"
            value={draft.dueAt}
            onChange={(event) => set('dueAt', event.target.value)}
            disabled={busy}
            className={`${FIELD} tabular-nums`}
          />
        </Field>

        <Field label="다음 조치 기한">
          <input
            type="date"
            value={draft.nextActionDue}
            onChange={(event) => set('nextActionDue', event.target.value)}
            disabled={busy}
            className={`${FIELD} tabular-nums`}
          />
        </Field>

        <Field label="다음 조치" full>
          <input
            type="text"
            value={draft.nextAction}
            onChange={(event) => set('nextAction', event.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </Field>

        <Field label="다음 조치 담당">
          <input
            type="text"
            value={draft.nextActionOwner}
            onChange={(event) => set('nextActionOwner', event.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </Field>

        <Field label="지연 사유">
          <input
            type="text"
            value={draft.delayReason}
            onChange={(event) => set('delayReason', event.target.value)}
            disabled={busy}
            className={FIELD}
          />
        </Field>

        <Field label="비고" full>
          <textarea
            value={draft.note}
            onChange={(event) => set('note', event.target.value)}
            disabled={busy}
            rows={3}
            className={FIELD}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
            busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
          }`}
        >
          {busy ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-3 py-2 text-sm"
        >
          취소
        </button>
        <span className="text-ink-muted text-xs">
          다음 시트 업로드가 시트의 값으로 되돌립니다.
        </span>
      </div>

      {message !== null && <p className="text-late mt-3 text-sm">{message}</p>}
    </div>
  );
}

/** 라벨-입력 한 칸. `full`이면 두 단을 다 쓴다 (긴 문장이 들어가는 칸) */
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
