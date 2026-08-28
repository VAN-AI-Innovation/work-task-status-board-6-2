'use client';

/**
 * 어드민의 **제출 현황과 검토** (`/report`). 팀마다 한 줄이고, 올라온 보고를 받거나
 * 사유를 적어 돌려보낸다.
 *
 * ## 안 낸 팀도 줄로 남는다
 *
 * 이 화면의 첫 정보는 「누가 안 냈는가」다. 제출한 팀만 그리면 어드민이 빠진 팀을 세야 하고,
 * 그러다 잊는다 — 병합 문서가 미제출 팀을 남기는 것과 같은 규칙이다 (`report-merge.ts`).
 *
 * ## 반려 사유는 접었다 편다
 *
 * 입력칸을 늘 펼쳐 두면 팀 셋에 텍스트 상자 셋이 서고, 그 화면은 「반려하는 화면」처럼
 * 보인다. 대부분의 조작은 승인이다. [반려] 를 누르면 그 줄만 사유 칸이 열리고, 사유가
 * 비어 있으면 보내지 못한다 — **사유 없는 반려는 팀장에게 「다시 하라」는 말만 남긴다**
 * (서버도 같은 자리를 막는다: `review_report`).
 *
 * **판단을 들고 있지 않다.** 누가 이 화면을 보는지는 `canReviewReport`가, 상태 낱말은
 * `submissionStage`가, 실제 허용은 `review_report`가 정한다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { submissionStage, type ReportStatus } from '@/lib/domain/report-submission';
import { teamLabel } from '@/lib/view/team-slug';
import type { ApiErrorBody } from '@/types/api';
import type { TeamKey } from '@/types/task';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export interface ReviewRow {
  teamId: TeamKey;
  status: ReportStatus | null;
  note: string;
  reviewNote: string | null;
  submittedOn: string | null;
}

export function ReportReviewPanel({
  weekStart,
  rows,
}: {
  weekStart: string;
  /** **팀 전부.** 미제출 팀은 `status`가 `null`이다 (머리말) */
  rows: readonly ReviewRow[];
}) {
  return (
    <section className="border-line bg-panel rounded-md border p-4 print:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-brand text-sm font-semibold">팀 보고 제출 현황</h2>
        <span className="text-ink-muted text-xs">
          받은 보고는 아래 「보고 본문」에 팀별로 합쳐집니다
        </span>
      </div>

      <ul className="divide-line mt-3 divide-y">
        {rows.map((row) => (
          <li key={row.teamId} className="py-3 first:pt-0 last:pb-0">
            <ReviewItem row={row} weekStart={weekStart} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewItem({ row, weekStart }: { row: ReviewRow; weekStart: string }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 반려 사유 칸이 열려 있는가. 닫혀 있으면 `null` */
  const [rejecting, setRejecting] = useState<string | null>(null);

  const stage = submissionStage(row.status);
  const busy = sending || refreshing;

  async function review(decision: 'accepted' | 'rejected', reviewNote?: string): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch('/api/report/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ teamId: row.teamId, weekStart, decision, reviewNote }),
      });

      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      setRejecting(null);
      // 목록도 병합 문서도 서버가 다시 그린 것이 진실이다
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ink text-sm font-medium">{teamLabel(row.teamId)}</span>
        <StatusBadge stage={stage} />
        {row.submittedOn !== null && (
          <span className="text-ink-faint text-xs tabular-nums">{row.submittedOn}</span>
        )}

        {/* 미제출 팀에는 버튼이 없다 — 없는 보고를 받거나 돌려보낼 수 없다 */}
        {stage !== 'draft' && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void review('accepted')}
              disabled={busy || stage === 'accepted'}
              className={`rounded px-3 py-1.5 text-xs ${
                busy || stage === 'accepted'
                  ? 'border-line text-ink-faint cursor-not-allowed border'
                  : 'bg-brand text-canvas hover:bg-brand-strong'
              }`}
            >
              {stage === 'accepted' ? '승인됨' : '승인'}
            </button>
            <button
              type="button"
              onClick={() => setRejecting((prev) => (prev === null ? (row.reviewNote ?? '') : null))}
              disabled={busy}
              className="border-late-line text-late hover:bg-late-bg rounded border px-3 py-1.5 text-xs"
            >
              {rejecting === null ? '반려' : '취소'}
            </button>
          </div>
        )}
      </div>

      {/* 특이사항 한 줄 미리보기. 전문은 아래 병합 문서에 있다 */}
      {row.note.trim() !== '' && (
        <p className="text-ink-body mt-1 line-clamp-2 text-xs [overflow-wrap:anywhere]">
          특이사항 — {row.note.trim()}
        </p>
      )}

      {stage === 'rejected' && rejecting === null && (
        <p className="text-late mt-1 text-xs [overflow-wrap:anywhere]">
          반려 사유 — {row.reviewNote ?? '기록되지 않음'}
        </p>
      )}

      {rejecting !== null && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-ink-muted text-xs">반려 사유</span>
            <input
              type="text"
              value={rejecting}
              onChange={(event) => setRejecting(event.target.value)}
              disabled={busy}
              placeholder="무엇을 고쳐야 하는지 적어 주세요"
              className="border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand mt-1 w-full rounded border px-3 py-2 text-sm focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void review('rejected', rejecting)}
            disabled={busy || rejecting.trim() === ''}
            className={`border-late-line text-late rounded border px-4 py-2 text-sm ${
              busy || rejecting.trim() === '' ? 'cursor-not-allowed opacity-50' : 'hover:bg-late-bg'
            }`}
          >
            반려
          </button>
        </div>
      )}

      {message !== null && <p className="text-late mt-2 text-sm">{message}</p>}
    </div>
  );
}

/** 손댈 것이 있는 줄만 색을 갖는다 — 승인은 색이 없다 (`UI_GUIDE.md`) */
function StatusBadge({ stage }: { stage: ReturnType<typeof submissionStage> }) {
  switch (stage) {
    case 'draft':
      return (
        <span className="border-line-strong text-ink-muted rounded-full border px-2 py-0.5 text-xs">
          미제출
        </span>
      );
    case 'waiting':
      return <span className="bg-warn-bg text-warn rounded-full px-2 py-0.5 text-xs">검토 대기</span>;
    case 'accepted':
      return <span className="text-ink-muted text-xs">승인됨</span>;
    case 'rejected':
      return <span className="bg-late-bg text-late rounded-full px-2 py-0.5 text-xs">반려됨</span>;
  }
}
