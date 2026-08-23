'use client';

/**
 * 빈 상태의 `[샘플 데이터 불러오기]`. **쓰기 버튼이다** — 누르면 실제 확정 경로가 돌아
 * 저장소에 태스크가 들어간다 (`POST /api/uploads/seed`).
 *
 * 계산이 없다. 서버가 준 실패 문구를 그대로 띄우고, 성공하면 `router.refresh()`로 서버
 * 컴포넌트를 다시 그린다 — 화면이 스스로 건수를 세지 않는다.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ApiErrorBody } from '@/types/api';

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

export function SeedButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/uploads/seed', { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
        setMessage(body?.error?.message ?? UNREACHABLE_MESSAGE);
        return;
      }
      router.refresh();
    } catch {
      setMessage(UNREACHABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={load}
        // 읽기 전용에서 비활성이지만 **그것이 방어는 아니다** — 서버가 503으로 거부한다
        disabled={disabled || pending}
        className={`rounded bg-brand text-canvas px-4 py-2 text-sm ${
          disabled || pending ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
        }`}
      >
        {pending ? '불러오는 중…' : '샘플 데이터 불러오기'}
      </button>

      {message !== null && <p className="mt-3 text-sm text-late">{message}</p>}
    </div>
  );
}
