'use client';

/**
 * 업무 패널 **맨 아래**의 [업무 삭제]. 되돌릴 수 없는 조작이라 이 화면에서 가장 조심스러운
 * 자리다.
 *
 * ## 왜 맨 아래인가
 *
 * 이 패널을 여는 이유는 대부분 읽기이고, 삭제는 마지막에 한 번 하는 일이다. 위쪽에 두면
 * 스크롤하다 스치는 자리에 되돌릴 수 없는 버튼이 선다.
 *
 * ## `confirm()`을 쓰지 않는다
 *
 * 브라우저 모달은 페이지의 이벤트를 통째로 멈추고, 스타일을 못 입히며, 무엇을 지우는지
 * 보여 주지 못한다. 대신 **그 자리에서 한 칸 펼친다** — 업무명을 적어 무엇이 사라지는지
 * 말하고, 함께 사라지는 것(단계·이력)도 적는다.
 *
 * ## 지운 뒤에는 패널을 닫는다
 *
 * 지운 업무의 패널이 남아 있으면 화면이 「있는데 없는」 상태가 된다. 서버 응답을 받은 뒤에
 * 닫는 주소로 이동하고 그다음 새로 그린다 — 순서가 반대면 거부당한 삭제가 성공처럼 보인다
 * (`task-edit-form.tsx`와 같은 규칙).
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { ApiErrorBody } from '@/types/api';

const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function TaskDeleteButton({
  taskId,
  title,
  closeHref,
}: {
  taskId: string;
  /** 무엇이 사라지는지 확인 문장에 적는다. 이름 없는 업무면 `null`이다 */
  title: string | null;
  /** 지운 뒤 돌아갈 주소 — 패널을 닫은 목록이다 */
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const busy = sending || pending;

  async function remove(): Promise<void> {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(body?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }

      // 지워진 업무의 패널을 남기지 않는다 — 먼저 닫고 그다음 목록을 다시 그린다
      router.push(closeHref);
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-late-line text-late hover:bg-late-bg rounded border px-3 py-1.5 text-sm"
        >
          업무 삭제
        </button>
        {message !== null && <p className="text-late mt-2 text-sm">{message}</p>}
      </div>
    );
  }

  return (
    <div className="border-late-line bg-late-bg rounded border px-3 py-3">
      <p className="text-late text-sm font-medium">
        「{title ?? '이름 없는 업무'}」를 지웁니다
      </p>
      <p className="text-ink-body mt-1 text-xs">
        단계와 변경 이력도 함께 사라지고 되돌릴 수 없습니다. 시트에서 온 업무라면 다음 업로드가
        다시 만듭니다 — 시트에서도 지워야 사라집니다.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className={`border-late-line text-late rounded border px-4 py-2 text-sm ${
            busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-panel'
          }`}
        >
          {busy ? '지우는 중…' : '지웁니다'}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setMessage(null);
          }}
          disabled={busy}
          className="border-line bg-panel text-ink hover:border-brand hover:text-brand rounded border px-3 py-2 text-sm"
        >
          취소
        </button>
      </div>

      {message !== null && <p className="text-late mt-2 text-sm">{message}</p>}
    </div>
  );
}
