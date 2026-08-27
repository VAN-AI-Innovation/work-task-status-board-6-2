'use client';

/**
 * 사이드 패널의 수정 폼 (`UC-16`). 받는 필드는 **상태·진행률 둘뿐**이다 — 시트가 진실의
 * 원천이라(`ADR-001`·`ADR-008`) 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는
 * 자기 수정이 사라지는 것을 본다. 목록은 `PATCH /api/tasks/[id]`의 zod가 받는 것과 같다.
 *
 * ## UI 숨김은 방어가 아니다
 *
 * 이 폼이 보이지 않는 것은 「할 수 없는 조작을 눈앞에 두지 않는다」는 뜻일 뿐이고, **실제
 * 거부는 서버가 한다** — `PATCH`가 미인증에 401, 범위 밖에 403을 낸다(`viewer-scope.ts`와
 * RLS 두 층). `canEdit`을 항상 `true`로 만들어도 남의 업무는 저장되지 않는다.
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

/** 값이 없는 상태를 고르는 자리. 「지운다」가 아니라 「이 값으로 두지 않는다」는 뜻이다 */
const KEEP = '';

export function TaskEditForm({
  taskId,
  status,
  progress,
  statusOptions,
}: {
  taskId: string;
  /** 현재 시트 원문 상태. 목록 밖 값일 수 있어 그대로 담아 둔다 */
  status: string | null;
  progress: number | null;
  /** 상태 드롭다운 목록. 문자열을 화면에 다시 적지 않는다 (`ADR-009`) */
  statusOptions: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
   * 시트 원문이 드롭다운 목록 밖일 수 있다 — 팀 전용 enum(`답변 완료`)이나 빈 칸이다.
   * 그때 목록의 첫 값을 고른 것처럼 그리면 저장하지도 않은 값이 현재 값으로 보인다.
   */
  const current = status !== null && statusOptions.includes(status) ? status : KEEP;
  const [nextStatus, setNextStatus] = useState(current);
  const [nextProgress, setNextProgress] = useState(progress === null ? KEEP : String(progress));

  async function save(): Promise<void> {
    setSending(true);
    setMessage(null);

    /*
     * **빈 칸은 보내지 않는다.** 「지운다」(`null`)와 「안 바꾼다」(키 없음)를 버튼 하나로
     * 뭉개면 사용자는 자기가 무엇을 했는지 모른다. 지우는 기능은 만들지 않았다.
     */
    const patch: { status?: string; progress?: number } = {};
    if (nextStatus !== KEEP) patch.status = nextStatus;
    if (nextProgress !== KEEP) patch.progress = Number(nextProgress);

    if (Object.keys(patch).length === 0) {
      setMessage('바꿀 값을 고른 뒤 저장해 주세요.');
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
      startTransition(() => router.refresh());
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  const busy = sending || pending;

  return (
    <div className="border-line rounded border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ink-muted text-xs">상태</span>
          <select
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            disabled={busy}
            className="border-line bg-panel text-ink focus:border-brand rounded border px-3 py-2 text-sm focus:outline-none"
          >
            <option value={KEEP}>선택 안 함</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-28 flex-col gap-1">
          <span className="text-ink-muted text-xs">진행률 (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={nextProgress}
            onChange={(event) => setNextProgress(event.target.value)}
            disabled={busy}
            className="border-line bg-panel text-ink focus:border-brand rounded border px-3 py-2 text-sm tabular-nums focus:outline-none"
          />
        </label>

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
      </div>

      {message !== null && <p className="text-late mt-3 text-sm">{message}</p>}
    </div>
  );
}
