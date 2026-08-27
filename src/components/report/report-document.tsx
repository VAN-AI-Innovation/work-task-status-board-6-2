'use client';

/**
 * 주간 보고 **본문과 가져가는 수단 둘**(복사 · 내려받기).
 *
 * **마크다운을 HTML로 렌더하지 않는다.** 렌더하는 순간 sanitize가 필요해지고 시트 셀에서 온
 * 문자열이 그대로 DOM이 된다 (`S7` · 결정 O). 마크다운 라이브러리를 설치하지도 않는다 —
 * 이 화면의 용도는 읽는 것이 아니라 **회의록으로 가져가는 것**이다.
 *
 * **내려받기도 서버를 거치지 않는다** (결정 O). 파일을 주는 라우트를 새로 만들면 같은 보고서를
 * 두 경로가 만들게 되고, 그 둘이 갈라지면 화면에 보이는 것과 받은 파일이 달라진다. 여기서
 * 내리는 것은 **화면이 보고 있는 바로 그 문자열**이다.
 *
 * 대시보드의 `BriefingCard`와 형제지만 합치지 않았다 — 저쪽은 접힌 4칸 카드 안의 요약이고
 * 내려받기가 없다. 합치면 대시보드에도 없던 버튼이 생긴다.
 *
 * 실패를 조용히 삼키지 않는다. `navigator.clipboard`는 비 HTTPS에서 아예 없고, 있어도 권한이
 * 거부될 수 있다. 실패했는데 「복사됨」이 뜨면 사용자는 회의 자리에서 빈 클립보드를 붙여넣는다.
 */

import { useEffect, useRef, useState } from 'react';

type ActionState = 'idle' | 'done' | 'failed';

const COPY_LABELS: Readonly<Record<ActionState, string>> = {
  idle: '복사',
  done: '복사됨',
  failed: '복사 실패',
};

const DOWNLOAD_LABELS: Readonly<Record<ActionState, string>> = {
  idle: '.md 내려받기',
  done: '내려받음',
  failed: '내려받기 실패',
};

export function ReportDocument({ markdown, filename }: { markdown: string; filename: string }) {
  const [copy, setCopy] = useState<ActionState>('idle');
  const [download, setDownload] = useState<ActionState>('idle');
  // 언마운트 뒤에 타이머가 살아 있으면 없는 컴포넌트에 setState한다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  /** 두 버튼이 같은 방식으로 결과를 알린다 — 2초 뒤 원래 라벨로 돌아온다 */
  const settle = (apply: (state: ActionState) => void, state: ActionState): void => {
    apply(state);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopy('idle');
      setDownload('idle');
    }, 2000);
  };

  const onCopy = async (): Promise<void> => {
    try {
      // 비 HTTPS에서는 `navigator.clipboard` 자체가 없다
      await navigator.clipboard.writeText(markdown);
      settle(setCopy, 'done');
    } catch {
      settle(setCopy, 'failed');
    }
  };

  const onDownload = (): void => {
    try {
      /*
       * `text/markdown`이지 `text/html`이 아니다. 브라우저가 열어 보는 파일이 아니라
       * 저장되는 파일이어야 한다 — 화면에서 렌더하지 않기로 한 결정과 짝이다.
       */
      const url = URL.createObjectURL(
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      /*
       * **같은 턴에 되돌리지 않는다.** 클릭 직후 `revokeObjectURL`을 부르면 브라우저에 따라
       * 내려받기가 시작되기 전에 주소가 사라져 파일이 빈 채로 떨어진다. 다음 턴에 되돌린다 —
       * 놔두면 탭이 살아 있는 동안 문자열이 메모리에 남고 보고서에는 사람 이름이 있다 (`S6`).
       */
      setTimeout(() => URL.revokeObjectURL(url), 0);
      settle(setDownload, 'done');
    } catch {
      settle(setDownload, 'failed');
    }
  };

  return (
    <section className="border-line bg-panel rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-brand text-sm font-semibold">보고 본문</h2>
          <p className="text-ink-muted mt-1 text-xs">
            회의록에 그대로 붙여넣는 마크다운입니다 · 화면에는 원문 그대로 둡니다
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void onCopy()}
            className="border-line bg-panel text-ink hover:bg-raise rounded border px-3 py-1.5 text-xs"
          >
            {COPY_LABELS[copy]}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="border-line bg-panel text-ink hover:bg-raise rounded border px-3 py-1.5 text-xs"
          >
            {DOWNLOAD_LABELS[download]}
          </button>
        </div>
      </div>

      {(copy === 'failed' || download === 'failed') && (
        <p className="text-warn mt-3 text-xs">
          브라우저가 거부했습니다 — 아래 본문을 직접 선택해 복사하세요.
        </p>
      )}

      {/*
       * 줄을 **접지 않는다**(`whitespace-pre`). 접으면 마크다운 표의 `|` 칸이 어긋나 원문이
       * 무엇이었는지 알아볼 수 없다. 대신 **자기 안에서** 가로로 스크롤한다 — 페이지 본문이
       * 가로로 밀리면 1280·1024 두 폭에서 레이아웃이 깨진다 (`ADR-014`).
       */}
      <pre className="border-line bg-canvas text-ink-body mt-3 max-h-[640px] overflow-auto rounded border p-3 text-xs whitespace-pre">
        {markdown}
      </pre>
    </section>
  );
}
