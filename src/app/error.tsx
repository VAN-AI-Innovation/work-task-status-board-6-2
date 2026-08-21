'use client';

/**
 * 조회 실패 바운더리 (`X3`의 셋째 갈래). 하나 터졌다고 화면 전체가 백지가 되면 안 된다.
 *
 * **예외에 실려 온 문자열을 하나도 렌더하지 않는다** (`X1`) — 메시지·스택·Next가 붙이는
 * 해시 식별자 전부. 거기에는 내부 경로와 셀 값이 들어 있고, 이 화면은 로그인 없이 누구나 본다.
 * 그래서 `props`에서 예외 자체를 꺼내지 않는다 — 꺼내 두면 언젠가 화면에 붙는다.
 */

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex-1 bg-neutral-50">
      <div className="mx-auto max-w-[1280px] px-6 py-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-neutral-700">화면을 불러오지 못했습니다</p>
          <button
            type="button"
            onClick={reset}
            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
          >
            다시 시도
          </button>
        </div>
      </div>
    </main>
  );
}
