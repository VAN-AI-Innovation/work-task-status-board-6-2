'use client';

/**
 * 업무 패널 **맨 위의 결재 두 개** — [승인]과 [반려].
 *
 * ## 왜 목록이 아니라 패널인가
 *
 * 승인 대기함의 줄마다 붙여 봤더니, 승인하는 사람이 **제목만 보고 누르는** 자리가 됐다.
 * 결재는 무엇을 결재하는지 보고 하는 일이라 상세가 열린 자리에 둔다. 대신 눈에 띄게
 * 맨 위에 세운다 — 스크롤해야 보이는 결재 버튼은 없는 것과 같다.
 *
 * **무엇으로 바뀌는지는 도메인이 정한다** (`APPROVAL_DECISION_STATUS`) — 화면이 한글 상태를
 * 적기 시작하면 시트에서 이름이 바뀔 때 조용히 미매핑된다 (`ADR-009`).
 *
 * ## 진행 상태만이 아니라 **「승인」 칸도 함께** 쓴다
 *
 * 예전에는 진행 상태만 바꿨다. 그래서 반려된 업무가 그냥 「수정 중」이 되었고, 담당자
 * 화면에서 **처음부터 수정 중이던 업무와 구별되지 않았다** — 돌려보낸 쪽은 사유를 적었는데
 * 받는 쪽은 그런 일이 있었는지도 몰랐다. 이제 `approvalStatus`에 결재 결과를 남기고,
 * 그것을 근거로 패널 맨 위에 반려 알림이 선다 (`isReworkAfterReject`).
 *
 * ## 반려에는 사유가 붙는다
 *
 * 사유 없는 반려는 담당자에게 「다시 하라」는 말만 남긴다 (주간 보고의 반려와 같은 규율 ·
 * `report-review-panel.tsx`). 적을 자리는 **지연·이슈 사유 칸**(`delayReason`)이다 —
 * 새 칸을 만들지 않는 대신, 이미 적혀 있던 값을 입력칸에 **채워서 보여 준다.** 덮어쓰는
 * 것을 눈으로 보고 고칠 수 있어야 조용히 지워지지 않는다.
 *
 * **낙관적 업데이트를 하지 않는다.** 서버 응답을 받은 뒤에야 `router.refresh()`한다
 * (`task-detail-fields.tsx`와 같은 규칙).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  APPROVAL_DECISION_APPROVAL,
  APPROVAL_DECISION_STATUS,
} from '@/lib/domain/task-semantic';
import type { ApiErrorBody } from '@/types/api';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function ApprovalActions({
  taskId,
  /** 지금 적혀 있는 지연·이슈 사유. 반려 칸의 초기값이다 (머리말) */
  defaultReason,
}: {
  taskId: string;
  defaultReason: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** 반려 사유 칸이 열려 있는가. 닫혀 있으면 `null` */
  const [rejecting, setRejecting] = useState<string | null>(null);

  const busy = sending || refreshing;

  async function decide(patch: Record<string, string>): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        // 문구를 여기서 짓지 않는다 — 서버가 코드를 바꾸면 화면도 따라 바뀐다
        const failure = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(failure?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      setRejecting(null);
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void decide({
              status: APPROVAL_DECISION_STATUS.approved,
              approvalStatus: APPROVAL_DECISION_APPROVAL.approved,
            })
          }
          disabled={busy}
          className={`rounded px-3 py-1 text-xs ${
            busy ? 'border-line text-ink-faint cursor-not-allowed border' : 'bg-brand text-canvas hover:bg-brand-strong'
          }`}
        >
          승인
        </button>
        <button
          type="button"
          onClick={() => setRejecting((prev) => (prev === null ? defaultReason : null))}
          disabled={busy}
          className="border-late-line text-late hover:bg-late-bg rounded border px-3 py-1 text-xs"
        >
          {rejecting === null ? '반려' : '취소'}
        </button>
      </div>

      {rejecting !== null && (
        <div className="mt-2">
          <label className="block">
            <span className="text-ink-muted text-xs">
              반려 사유 — 업무의 「지연·이슈 사유」에 적힙니다
            </span>
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
            onClick={() =>
              void decide({
                status: APPROVAL_DECISION_STATUS.rejected,
                approvalStatus: APPROVAL_DECISION_APPROVAL.rejected,
                delayReason: rejecting,
              })
            }
            disabled={busy || rejecting.trim() === ''}
            className={`border-late-line text-late mt-2 rounded border px-3 py-1.5 text-xs ${
              busy || rejecting.trim() === ''
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-late/10 hover:text-late-line hover:border-late-line'
            }`}
          >
            반려하기
          </button>
        </div>
      )}

      {message !== null && <p className="text-late mt-2 text-xs">{message}</p>}
    </div>
  );
}
