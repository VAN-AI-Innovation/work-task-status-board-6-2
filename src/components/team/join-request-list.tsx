'use client';

/**
 * 팀 합류 요청 목록 (`/team/requests`). 한 줄이 한 사람이고, 줄마다 승인·거절이 붙는다.
 *
 * **판단을 들고 있지 않다.** 누가 이 화면을 보는지는 `canReviewJoinRequests`가, 어느 명부
 * 행을 고를 수 있는지는 `toJoinRequestRows`가, 실제 허용은 `approve_join`·`reject_join`이
 * 정한다. 이 파일이 아는 것은 **props와 폼 상태**뿐이다.
 *
 * ## 서버가 준 목록을 다시 그린다 — 화면이 줄이지 않는다
 *
 * 성공하면 `router.refresh()`로 서버 컴포넌트를 다시 그린다. 응답 본문에도 갱신된 목록이
 * 실려 오지만(`POST .../approve`) 그것을 상태에 넣지 않는 이유는 **후보 목록이 함께
 * 바뀌기** 때문이다 — 승인된 사람에게 명부 행이 붙으면 그 행은 다음 요청의 후보에서
 * 빠져야 한다. 응답에는 요청 목록만 있으므로 그것만 갈아 끼우면 후보가 낡고, 리더가
 * 이미 붙은 행을 다시 골라 403을 본다. 다시 그리면 둘 다 한 번에 새것이 된다.
 *
 * **낙관적 업데이트를 하지 않는다** (`task-edit-form.tsx`와 같은 규칙). 거부당한 승인이
 * 잠깐 성공한 것처럼 보이는 것이 이 화면에서 가장 위험한 거짓말이다.
 *
 * ## 반려된 줄에는 버튼이 없다
 *
 * `approve_join`·`reject_join`은 대상이 `pending`일 때만 통한다 (`0005` 4-4·4-5).
 * 반려된 사람의 상태를 되돌리는 것은 **본인의 재요청**(`request_join`)뿐이다. 눌러도
 * 반드시 실패하는 버튼을 두면 리더는 그것을 고장으로 읽는다.
 *
 * ## `confirm()`을 쓰지 않는다
 *
 * 거절은 되돌릴 수 있다 — 계정은 살아 있고 본인이 다시 요청할 수 있다. 그리고 이 프로젝트의
 * 화면은 JS 없이도 읽히는 평범한 폼이라(`ADR-027`) 브라우저 대화상자를 끼워 넣지 않는다.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { JoinRequestRow } from '@/lib/view/join-request-rows';
import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** `<select>`에서 「새로 만들기」를 고른 상태. 명부 행 id와 섞이지 않는 값이다 */
const NEW_MEMBER = '__new__';

/** 아직 고르지 않은 상태. 「지운다」가 아니라 「아직 정하지 않았다」는 뜻이다 */
const UNCHOSEN = '';

export function JoinRequestList({ rows }: { rows: readonly JoinRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        기다리는 합류 요청이 없습니다. 새로 가입한 사람이 있으면 여기에 나타납니다.
      </p>
    );
  }

  return (
    <ul className="border-line divide-line divide-y rounded-md border">
      {rows.map((row) => (
        <li key={row.userId} className="p-4">
          <JoinRequestItem row={row} />
        </li>
      ))}
    </ul>
  );
}

function JoinRequestItem({ row }: { row: JoinRequestRow }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
   * 고를 것이 하나뿐(「새로 만들기」)이면 그것을 미리 골라 둔다. 후보가 있으면 비워 두고
   * 리더가 고르게 한다 — 첫 후보를 미리 골라 두면 확인하지 않고 승인을 누르게 된다.
   */
  const [choice, setChoice] = useState(row.candidates.length === 0 ? NEW_MEMBER : UNCHOSEN);
  /* 가입 폼에 적은 이름이 기본값이다. 명부에 남는 이름이라 리더가 고칠 수 있게 둔다 */
  const [newName, setNewName] = useState(row.displayName ?? '');

  const busy = sending || refreshing;

  async function send(action: 'approve' | 'reject'): Promise<void> {
    const body: { userId: string; memberId?: string; newMemberName?: string } = {
      userId: row.userId,
    };

    if (action === 'approve') {
      if (choice === UNCHOSEN) {
        setMessage('시트 담당자를 고른 뒤 승인해 주세요.');
        return;
      }
      if (choice === NEW_MEMBER) body.newMemberName = newName.trim();
      else body.memberId = choice;
    }

    setSending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/team/requests/${action}`, {
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

      // 목록도 후보도 서버가 다시 그린 것이 진실이다 (머리말)
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-ink text-sm font-medium">{row.displayName ?? '(이름 없음)'}</span>
        <span className="text-ink-muted min-w-0 truncate text-xs">{row.email ?? '(이메일 없음)'}</span>
        <span className="text-ink-body text-xs">{row.teamName ?? '팀 미지정'}</span>
        <span className="text-ink-faint ml-auto text-xs tabular-nums">
          {row.requestedOn ?? '요청일 미상'}
        </span>
      </div>

      {row.status === 'rejected' ? (
        <p className="text-ink-muted text-xs">
          반려된 요청입니다. 본인이 다시 요청하면 대기 목록으로 돌아옵니다.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-ink-muted text-xs">시트 담당자 연결</span>
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={busy}
              className="border-line bg-panel text-ink focus:border-brand rounded border px-3 py-2 text-sm focus:outline-none"
            >
              <option value={UNCHOSEN}>선택 안 함</option>
              {row.candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
              <option value={NEW_MEMBER}>+ 새로 만들기</option>
            </select>
          </label>

          {choice === NEW_MEMBER && (
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-ink-muted text-xs">새 담당자 이름</span>
              <input
                type="text"
                value={newName}
                maxLength={40}
                onChange={(event) => setNewName(event.target.value)}
                disabled={busy}
                placeholder="시트에 적힌 이름"
                className="border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand rounded border px-3 py-2 text-sm focus:outline-none"
              />
            </label>
          )}

          <button
            type="button"
            onClick={() => void send('approve')}
            disabled={busy}
            className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
              busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
            }`}
          >
            {busy ? '처리 중…' : '승인'}
          </button>

          {/* 되돌릴 수 있는 조작이라 확인 단계를 두지 않는다 (머리말) */}
          <button
            type="button"
            onClick={() => void send('reject')}
            disabled={busy}
            className={`border-late-line text-late rounded border px-4 py-2 text-sm ${
              busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-late-bg'
            }`}
          >
            거절
          </button>
        </div>
      )}

      {message !== null && <p className="text-late text-sm">{message}</p>}
    </div>
  );
}
