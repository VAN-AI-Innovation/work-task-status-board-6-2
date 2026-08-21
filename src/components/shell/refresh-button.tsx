'use client';

/**
 * 「새로고침」. 이 시스템은 **업로드해야 데이터가 갱신되므로**(`ADR-001`) 「다른 탭에서
 * 업로드하고 이 탭을 새로고침」이 실제 사용 흐름이다.
 *
 * `router.refresh()`는 서버 컴포넌트 트리만 다시 받아온다 — 스크롤도 필터도 열려 있는 패널도
 * 그대로다. 그래서 `location.reload()`가 아니다.
 *
 * **「마지막 갱신 HH:mm」을 표시하지 않는다.** 그것은 클라이언트 시계이고, 화면에는 이미
 * 서버가 준 「마지막 반영: N일 전」이 있다. 둘이 나란히 있으면 어느 쪽이 데이터의 신선도인지
 * 사용자가 혼동한다 — 이 시스템에서 낡는 것은 화면이 아니라 데이터다.
 *
 * 진행 표시는 **불투명도 페이드 150ms**뿐이다 (`UI_GUIDE.md`). 스피너·펄스를 만들지 않는다 —
 * 허용된 애니메이션은 패널 슬라이딩과 이 페이드 둘뿐이다. 전체 화면 스켈레톤도 만들지 않는다:
 * 그러려면 서버 컴포넌트 트리를 통째로 클라이언트로 옮겨야 한다.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(() => router.refresh())}
        aria-busy={isPending}
        className="border-line bg-panel text-ink hover:bg-raise shrink-0 rounded border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? '갱신 중…' : '새로고침'}
      </button>
      {/* 상단 바 아래 1px. 늘 자리에 있고 불투명도만 바뀐다 — 레이아웃이 튀지 않는다 */}
      <span
        aria-hidden="true"
        className={`bg-ink absolute inset-x-0 -bottom-px h-px transition-opacity duration-150 ${
          isPending ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </>
  );
}
