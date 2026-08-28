'use client';

/**
 * 팀장이 **자기 팀 보고를 올리는** 자리 (`/report`). 계산된 본문을 확인·수정하고 특이사항을
 * 적어 한 번에 보낸다.
 *
 * ## 왜 특이사항 칸이 따로 있나
 *
 * 계산된 본문(`buildWeeklyReport`)은 어드민도 같은 데이터에서 **이미 볼 수 있는 것**이다.
 * 보고가 보고인 이유는 그 숫자가 아니라 **숫자에 안 담기는 사정**이다 — 「장비 대여가 하루
 * 밀렸다」는 어느 집계에도 안 나온다. 그래서 그 칸을 본문과 나란히 두고, 병합 문서에서도
 * 팀마다 **특이사항이 먼저** 선다 (`report-merge.ts`).
 *
 * ## 본문을 고칠 수 있게 두는 것과 「진실의 원천」
 *
 * 시트가 진실의 원천이라는 규칙(`ADR-001`)과 부딪히지 않는다. 고친 본문은 **시트로 돌아가지
 * 않고** 이 주의 제출본으로만 남는다 — 보고서는 원래 사람이 회의에 들고 가는 문서이고,
 * 그 문서에 한 줄 덧붙이는 것을 막을 이유가 없다. 대신 원래 계산본으로 **되돌리는 버튼**을
 * 둔다: 고친 뒤 무엇이 원본이었는지 알 수 없게 되는 것이 진짜 위험이다.
 *
 * ## 반려는 감추지 않는다
 *
 * 돌려받은 보고는 사유와 함께 맨 위에 뜬다. 그 자리에서 고쳐 다시 보내면 상태가 「대기」로
 * 돌아간다 — 재보고 버튼을 따로 두지 않는 것은 **하는 일이 같기 때문이다**(`submit_report`
 * 하나가 둘을 다 한다). 버튼이 둘이면 사용자는 어느 쪽을 눌러야 하는지 매번 고른다.
 *
 * **낙관적 업데이트를 하지 않는다.** 서버 응답을 받은 뒤에야 `router.refresh()`한다
 * (`task-edit-form.tsx`와 같은 규칙).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { submissionStage, type ReportStatus } from '@/lib/domain/report-submission';
import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

const FIELD =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

export function ReportSubmitPanel({
  weekStart,
  computed,
  submittedBody,
  submittedNote,
  status,
  reviewNote,
  submittedOn,
}: {
  /** 이 화면이 보고 있는 주. 제출 대상이 그 주다 */
  weekStart: string;
  /** 지금 데이터로 계산한 본문. 「되돌리기」가 이 값으로 돌아간다 */
  computed: string;
  /** 이미 올린 본문. 없으면 `null`이고 그때는 계산본으로 시작한다 */
  submittedBody: string | null;
  submittedNote: string;
  status: ReportStatus | null;
  reviewNote: string | null;
  submittedOn: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
   * 이미 올린 것이 있으면 **그것을** 연다. 계산본으로 열면 팀장이 지난번에 고쳐 넣은 문장이
   * 화면에서 사라지고, 그 상태로 다시 보내면 조용히 지워진다.
   */
  const [body, setBody] = useState(submittedBody ?? computed);
  const [note, setNote] = useState(submittedNote);

  const stage = submissionStage(status);
  const busy = sending || pending;

  async function submit(): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch('/api/report/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weekStart, body, note }),
      });

      if (!response.ok) {
        // 문구를 여기서 짓지 않는다 — 서버가 코드를 바꾸면 화면도 따라 바뀌어야 한다
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="border-line bg-panel rounded-md border p-4 print:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-brand text-sm font-semibold">어드민에게 보고</h2>
        <StatusLine stage={stage} submittedOn={submittedOn} />
      </div>

      {stage === 'rejected' && (
        /*
         * **반려는 맨 위다.** 아래 본문을 고치기 전에 읽어야 하는 것이고, 접거나 아래에 두면
         * 사유를 못 본 채 같은 내용을 다시 보내게 된다.
         */
        <div className="border-late-line bg-late-bg mt-3 rounded border px-3 py-2">
          <p className="text-late text-sm font-medium">반려되었습니다</p>
          {/* 사유는 반려일 때 반드시 있다. 그래도 없는 값을 지어내지 않는다 */}
          <p className="text-ink-body mt-1 text-sm [overflow-wrap:anywhere]">
            {reviewNote ?? '사유가 기록되지 않았습니다.'}
          </p>
        </div>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="report-note" className="text-ink text-sm font-medium">
            특이사항
          </label>
          <span className="text-ink-muted text-xs">숫자에 안 담기는 사정을 적습니다</span>
        </div>
        <textarea
          id="report-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={busy}
          rows={4}
          placeholder="예) 촬영 장비 대여가 하루 밀려 촬영 일정이 이번 주로 넘어갔습니다."
          className={`${FIELD} mt-2`}
        />
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="report-body" className="text-ink text-sm font-medium">
            보고 본문
          </label>
          <button
            type="button"
            onClick={() => setBody(computed)}
            disabled={busy || body === computed}
            className={`text-xs underline-offset-4 ${
              busy || body === computed
                ? 'text-ink-faint cursor-not-allowed'
                : 'text-ink-muted hover:text-brand hover:underline'
            }`}
          >
            계산된 내용으로 되돌리기
          </button>
        </div>
        {/* 마크다운 원문을 그대로 고친다. 고정폭이라 표의 `|` 칸이 어긋나지 않는다 */}
        <textarea
          id="report-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={busy}
          rows={12}
          className={`${FIELD} mt-2 font-mono text-xs`}
        />
        {body !== computed && (
          // 고친 상태를 **말한다.** 말하지 않으면 다음 주에 열었을 때 왜 다른지 알 수 없다
          <p className="text-ink-muted mt-1 text-xs">계산된 내용에서 고친 상태입니다.</p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || body.trim() === ''}
          className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
            busy || body.trim() === '' ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
          }`}
        >
          {busy ? '보내는 중…' : stage === 'draft' ? '보고 보내기' : '고쳐서 다시 보내기'}
        </button>
        <span className="text-ink-muted text-xs">
          {stage === 'accepted'
            ? '이미 승인된 보고입니다. 다시 보내면 대기 상태로 돌아갑니다.'
            : '보낸 뒤에도 고쳐서 다시 보낼 수 있습니다.'}
        </span>
      </div>

      {message !== null && <p className="text-late mt-3 text-sm">{message}</p>}
    </section>
  );
}

/** 상태를 **낱말로** 적는다. 색은 반려 하나뿐이다 (`UI_GUIDE.md`) */
function StatusLine({
  stage,
  submittedOn,
}: {
  stage: ReturnType<typeof submissionStage>;
  submittedOn: string | null;
}) {
  const when = submittedOn === null ? '' : ` · ${submittedOn}`;

  switch (stage) {
    case 'draft':
      return <span className="text-ink-muted text-xs">아직 보내지 않았습니다</span>;
    case 'waiting':
      return <span className="text-ink-muted text-xs">검토 대기{when}</span>;
    case 'accepted':
      return <span className="text-ink-muted text-xs">승인됨{when}</span>;
    case 'rejected':
      return <span className="text-late text-xs">반려됨{when}</span>;
  }
}
