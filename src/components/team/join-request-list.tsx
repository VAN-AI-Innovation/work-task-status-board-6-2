'use client';

/**
 * 팀 합류 요청. **카드 하나가 한 사람**이고, 카드마다 승인·거절 두 버튼이 붙는다.
 *
 * 사는 자리는 `/members`의 조직도 **아래**다 — 승인하면 그 사람이 곧바로 위 트리에
 * 나타나므로, 별도 화면으로 두면 결과를 보려고 화면을 옮겨야 했다.
 *
 * **판단을 들고 있지 않다.** 누가 이 화면을 보는지는 `canReviewJoinRequests`가, 승인이 명부에
 * 무엇을 하는지는 `toJoinRequestRows`가, 실제 허용은 `approve_join`·`reject_join`이 정한다.
 * 이 파일이 아는 것은 **props와 보내는 중인지**뿐이다.
 *
 * ## 고르는 칸이 없다
 *
 * 예전에는 카드마다 「시트 담당자 연결」 `<select>`가 있었고 그것을 고르지 않으면 승인이
 * 막혔다. 리더가 실제로 답하는 질문은 **「이 사람을 받아들일까」 하나**인데, 매번 드롭다운을
 * 열어 뻔한 값을 고르게 만들고 있었다. 명부 연결은 이름으로 정해지므로 `toJoinRequestRows`가
 * 정하고(`link`), 화면은 **그 결과를 한 줄로 알려 준다** — 감추지는 않는다. 승인 뒤 명부에
 * 무엇이 생기는지 모른 채 누르게 하면 그것대로 나쁘다.
 *
 * ## 서버가 준 목록을 다시 그린다 — 화면이 줄이지 않는다
 *
 * 성공하면 `router.refresh()`로 서버 컴포넌트를 다시 그린다. 응답 본문에도 갱신된 목록이
 * 실려 오지만(`POST .../approve`) 그것을 상태에 넣지 않는 이유는 **명부도 함께 바뀌기**
 * 때문이다 — 승인으로 새 행이 생기거나 빈 행에 계정이 붙으면 다음 요청의 연결 판정이
 * 달라진다. 다시 그리면 둘 다 한 번에 새것이 된다.
 *
 * **낙관적 업데이트를 하지 않는다** (`task-detail-fields.tsx`와 같은 규칙). 거부당한 승인이
 * 잠깐 성공한 것처럼 보이는 것이 이 화면에서 가장 위험한 거짓말이다.
 *
 * ## 누를 수 없는 버튼을 두지 않는다
 *
 * 반려된 줄에는 버튼이 없다 — `approve_join`·`reject_join`은 대상이 `pending`일 때만 통하고
 * (`0005` 4-4·4-5), 되돌리는 길은 **본인의 재요청**뿐이다. `link`가 `null`인 줄도 같다:
 * 팀을 모르거나 가입 이름이 없어 승인이 성립하지 않는다. 그때는 사유를 적는다.
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

export function JoinRequestList({ rows }: { rows: readonly JoinRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-ink-muted text-sm">
        기다리는 합류 요청이 없습니다. 새로 가입한 사람이 있으면 여기에 나타납니다.
      </p>
    );
  }

  /* 카드가 줄줄이 서는 자리다. 넓은 화면에서는 **셋씩** — 한 장이 화면 폭을 다 쓰면 이름
     하나와 버튼 둘 사이가 통째로 빈다. 카드 안이 짧아(이름·이메일·팀·버튼) 셋이 나란히
     서도 줄이 접히지 않는다 */
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <li key={row.userId}>
          <JoinRequestCard row={row} />
        </li>
      ))}
    </ul>
  );
}

function JoinRequestCard({ row }: { row: JoinRequestRow }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const busy = sending || refreshing;

  async function send(action: 'approve' | 'reject'): Promise<void> {
    /*
     * 승인 본문은 `link`에서 **그대로** 나온다. 화면이 여기서 이름을 고르거나 기본값을
     * 채우면 규칙이 두 곳이 되고, 그 두 벌은 `approve_join`이 보는 것과 또 갈린다.
     */
    const body: { userId: string; memberId?: string; newMemberName?: string } = {
      userId: row.userId,
    };

    if (action === 'approve') {
      if (row.link === null) return;
      if (row.link.kind === 'existing') body.memberId = row.link.memberId;
      else body.newMemberName = row.link.name;
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

      // 목록도 명부도 서버가 다시 그린 것이 진실이다 (머리말)
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-line bg-panel flex h-full flex-col rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink text-sm font-medium break-words">
          {row.displayName ?? '(이름 없음)'}
        </span>
        {/* 요청일은 오른쪽 끝이다 — 오래 기다린 줄을 찾는 데만 쓰는 값이라 이름과 다투지 않는다 */}
        <span className="text-ink-faint shrink-0 text-xs tabular-nums">
          {row.requestedOn ?? '요청일 미상'}
        </span>
      </div>

      <p className="text-ink-muted mt-1 truncate text-xs">{row.email ?? '(이메일 없음)'}</p>

      {/* 팀은 배지다. 「어느 팀에 들어오려는가」가 이 화면에서 가장 먼저 읽혀야 할 사실이다 */}
      <p className="mt-3">
        <span className="bg-brand-soft text-brand rounded-full px-2.5 py-1 text-xs font-medium">
          {row.teamName ?? '팀 미지정'}
        </span>
      </p>

      {/* 버튼을 카드 아래쪽에 붙인다 — 둘씩 세운 카드의 높이가 달라도 버튼 줄은 나란히 선다 */}
      <div className="mt-4 flex-1" />

      {row.status === 'rejected' ? (
        <p className="text-ink-muted text-xs">
          반려된 요청입니다. 본인이 다시 요청하면 대기 목록으로 돌아옵니다.
        </p>
      ) : row.link === null ? (
        /*
         * 승인이 성립하지 않는 상태다. **버튼을 흐리게 두지 않고 사유를 적는다** — 눌리지
         * 않는 버튼은 고장으로 읽힌다. 원인은 둘뿐이라(팀 미상·이름 없음) 둘 다 적는다.
         */
        <p className="text-warn text-xs">
          팀이 정해지지 않았거나 가입 이름이 비어 있어 승인할 수 없습니다. 본인이 팀을 골라
          다시 요청해야 합니다.
        </p>
      ) : (
        <>
          {/* 승인이 명부에 무엇을 하는지 **미리** 말한다 (머리말) */}
          <p className="text-ink-muted text-xs">
            {row.link.kind === 'existing'
              ? `승인하면 시트 명부의 「${row.link.memberName}」에 연결됩니다.`
              : `승인하면 시트 명부에 「${row.link.name}」을 새로 만듭니다.`}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void send('approve')}
              disabled={busy}
              className={`bg-brand text-canvas flex-1 rounded px-4 py-2 text-sm ${
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
        </>
      )}

      {message !== null && <p className="text-late mt-3 text-sm">{message}</p>}
    </div>
  );
}
