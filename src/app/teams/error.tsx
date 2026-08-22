'use client';

/**
 * 부서별 탭의 조회 실패 바운더리 (`X3`). 완료 기준 14가 `app/`과 `app/teams/` **둘 다**
 * 요구한다 — 팀 화면 하나가 터졌다고 전체가 백지가 되면 안 된다.
 *
 * `app/error.tsx`와 같은 규칙을 그대로 따른다: **예외에 실려 온 문자열을 하나도 렌더하지
 * 않는다** (`X1`). 메시지·스택·Next가 붙이는 해시 식별자 전부다. 거기에는 내부 경로와 셀 값이
 * 들어 있고 이 화면은 로그인 없이 누구나 본다. 그래서 `props`에서 예외 자체를 꺼내지 않는다 —
 * 꺼내 두면 언젠가 화면에 붙는다.
 *
 * `PageShell`을 쓰지 않는 것도 같은 이유다. 저장소를 읽다가 터졌을 수 있는데 셸이 다시
 * 저장소를 읽으면 에러 화면이 같은 자리에서 또 터진다.
 */

export default function TeamsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-[1280px] px-6 py-16">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-ink-body text-sm">팀 화면을 불러오지 못했습니다</p>
          <button
            type="button"
            onClick={reset}
            className="bg-ink text-canvas hover:bg-ink-body rounded px-4 py-2 text-sm"
          >
            다시 시도
          </button>
        </div>
      </div>
    </main>
  );
}
