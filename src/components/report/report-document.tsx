'use client';

/**
 * 주간 보고 **본문과 가져가는 수단 셋**(PDF · 복사 · `.md` 내려받기).
 *
 * ## 이제 문서로 그린다 — 다만 HTML로 바꾸지는 않는다
 *
 * 예전에는 마크다운 원문을 `<pre>` 한 덩어리로만 보여줬다. 회의에 들고 갈 물건인데 표가
 * `| --- | ---: |`로 보이니 그대로는 못 쓰고, 「PDF로 저장」도 고정폭 덤프가 됐다.
 *
 * 그래서 `toReportBlocks`가 낸 **블록**을 그린다. T9 결정 O가 막은 것은 마크다운을
 * **HTML로 바꾸는 것**이고(그 순간 sanitize가 필요해진다 — `S7`), 여기서 다루는 것은
 * 문자열이 담긴 자료구조다. React가 텍스트를 이스케이프하므로 시트 셀 값이 마크업이 될
 * 길이 없다 — 이 경로에 `dangerouslySetInnerHTML`이 한 번도 없고, 마크다운 라이브러리도
 * 여전히 설치하지 않는다.
 *
 * **원문은 그대로 남긴다.** 아래 접힌 줄이 그것이고, 복사·내려받기가 내는 것도 화면이 보고
 * 있는 **바로 그 문자열**이다 (결정 O).
 *
 * ## PDF는 새 탭에 진짜 파일로 뜬다
 *
 * 예전에는 `window.print()` 하나였고, 「PDF로 저장」을 눌렀는데 인쇄 대화상자가 떠서 대상을
 * 다시 골라야 했다 — 버튼 이름과 일어나는 일이 달랐다. 이제 `buildReportPdf`가 파일을 만들고
 * 새 탭이 그것을 편다.
 *
 * **문서가 갈라지지 않는 이유는 `toReportBlocks`를 둘이 같이 쓰기 때문이다.** 화면이 그리는
 * 블록과 PDF가 그리는 블록이 같은 함수에서 나온다 — 마크다운을 두 번 읽지 않는다.
 *
 * `@media print` 규칙은 그대로 둔다. 브라우저 인쇄(Ctrl+P)는 여전히 되고, 그때 사이드바·
 * 상단바·버튼이 걷힌다.
 *
 * 실패를 조용히 삼키지 않는다. `navigator.clipboard`는 비 HTTPS에서 아예 없고, 있어도 권한이
 * 거부될 수 있다. 실패했는데 「복사됨」이 뜨면 사용자는 회의 자리에서 빈 클립보드를 붙여넣는다.
 */

import { useEffect, useRef, useState } from 'react';

import { toReportBlocks, type ReportBlock } from '@/lib/view/report-blocks';

type ActionState = 'idle' | 'done' | 'failed';

const COPY_LABELS: Readonly<Record<ActionState, string>> = {
  idle: '복사',
  done: '복사됨',
  failed: '복사 실패',
};

const PDF_LABELS: Readonly<Record<ActionState | 'working', string>> = {
  idle: 'PDF로 저장',
  working: 'PDF 만드는 중…',
  done: '새 탭에 열림',
  failed: 'PDF 실패',
};

const DOWNLOAD_LABELS: Readonly<Record<ActionState, string>> = {
  idle: '.md 내려받기',
  done: '내려받음',
  failed: '내려받기 실패',
};

/** 칸은 전부 왼쪽 정렬이고, 마크다운의 `right`는 이제 `tabular-nums`만 뜻한다 (숫자 칸) */
const ALIGN_CLASS = { left: 'text-left', right: 'text-left tabular-nums' } as const;

/**
 * 폰트를 base64로 받아 **탭이 사는 동안 한 번만** 붙든다. 두 번째 [PDF로 저장]에서 2.4MB를
 * 다시 받으면 눌러 놓고 기다리는 시간이 그대로 두 배가 된다.
 *
 * `btoa`는 문자열만 받고, 2.4MB를 `String.fromCharCode(...bytes)` 한 번으로 넘기면 인자
 * 개수 한계에 걸려 던진다. 그래서 32KB씩 끊는다.
 */
let fontCache: string | null = null;

async function loadFont(url: string): Promise<string> {
  if (fontCache !== null) return fontCache;

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }

  fontCache = btoa(binary);
  return fontCache;
}

function Block({ block }: { block: ReportBlock }) {
  switch (block.kind) {
    case 'heading':
      /*
       * `#`은 화면의 `<h1>`(「주간 보고」)과 같은 것을 말하므로 여기서는 한 단 낮춰 그린다 —
       * 한 화면에 `<h1>`이 둘이면 읽어 주는 순서가 무너진다.
       */
      return block.level === 1 ? (
        <h3 className="text-brand mt-6 text-base font-semibold first:mt-0">{block.text}</h3>
      ) : (
        <h4 className="text-ink border-line mt-6 border-b pb-1 text-sm font-semibold">
          {block.text}
        </h4>
      );

    case 'list':
      return (
        <ul className="text-ink-body mt-2 space-y-1 text-sm">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-ink-faint shrink-0" aria-hidden>
                ·
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
            </li>
          ))}
        </ul>
      );

    case 'table':
      return (
        // 넓은 표는 **자기 안에서** 가로로 스크롤한다 — 페이지 본문이 밀리면 안 된다
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-line bg-raise border-b">
                {block.header.map((label, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={`text-ink-muted px-3 py-2 text-xs font-medium ${
                      ALIGN_CLASS[block.align[index] ?? 'left']
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-line/60 border-b">
                  {row.map((value, index) => (
                    <td
                      key={index}
                      className={`text-ink-body px-3 py-2 ${ALIGN_CLASS[block.align[index] ?? 'left']}`}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'paragraph':
      return <p className="text-ink-body mt-2 text-sm [overflow-wrap:anywhere]">{block.text}</p>;
  }
}

export function ReportDocument({ markdown, filename }: { markdown: string; filename: string }) {
  const [copy, setCopy] = useState<ActionState>('idle');
  const [download, setDownload] = useState<ActionState>('idle');
  const [pdf, setPdf] = useState<ActionState | 'working'>('idle');
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
      setPdf('idle');
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

  const onPdf = async (): Promise<void> => {
    /*
     * **탭을 먼저 연다.** 폰트를 받고 문서를 그리는 사이에 클릭의 사용자 제스처가 만료되면
     * 그 뒤의 `window.open`은 팝업 차단에 걸린다. 빈 탭을 지금 열어 두고 주소만 나중에 넣는다.
     */
    const tab = window.open('', '_blank');
    if (tab === null) {
      settle(setPdf, 'failed');
      return;
    }

    setPdf('working');
    try {
      // `jspdf`와 2.4MB 폰트는 **이 버튼을 누른 사람만** 받는다 (`report-pdf.ts` 머리말)
      const { buildReportPdf, PDF_FONT_URL } = await import('@/lib/view/report-pdf');
      const blob = await buildReportPdf(toReportBlocks(markdown), await loadFont(PDF_FONT_URL));

      /*
       * 되돌리지 않는다 — 새 탭이 이 주소를 계속 붙들고 있고, 지우면 새로 고침에서 빈 뷰어가
       * 뜬다. 탭을 닫으면 브라우저가 함께 거둔다 (`.md` 내려받기와 사정이 다르다).
       */
      tab.location.href = URL.createObjectURL(blob);
      settle(setPdf, 'done');
    } catch {
      tab.close();
      settle(setPdf, 'failed');
    }
  };

  const onDownload = (): void => {
    try {
      /*
       * `text/markdown`이지 `text/html`이 아니다. 브라우저가 열어 보는 파일이 아니라
       * 저장되는 파일이어야 한다 — 원문을 그대로 내리기로 한 결정과 짝이다.
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
    <section className="border-line bg-panel rounded-md border p-4 print:rounded-none print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-brand text-sm font-semibold">보고 본문</h2>
          <p className="text-ink-muted mt-1 text-xs">
            「PDF로 저장」은 PDF를 만들어 새 탭에 엽니다 · 원문 마크다운은 아래에 그대로
            있습니다
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void onPdf()}
            disabled={pdf === 'working'}
            className="bg-brand text-canvas hover:bg-brand-strong rounded px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {PDF_LABELS[pdf]}
          </button>
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

      {(copy === 'failed' || download === 'failed' || pdf === 'failed') && (
        <p className="text-warn mt-3 text-xs print:hidden">
          브라우저가 거부했습니다 — 새 탭이 막혔다면 팝업을 허용하고, 그래도 안 되면 아래
          원문을 직접 선택해 복사하세요.
        </p>
      )}

      {/* 인쇄되는 것은 이 덩어리다. 화면에서 보는 것과 같은 요소라 둘이 갈라질 수 없다 */}
      <article className="mt-4 print:mt-0">
        {toReportBlocks(markdown).map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </article>

      {/*
       * 원문을 남긴다 — 복사·내려받기가 내는 것이 이 문자열이고, 화면이 그것과 다른 말을
       * 하고 있지 않다는 것을 사용자가 직접 볼 수 있어야 한다 (결정 O).
       *
       * 줄을 **접지 않는다**(`whitespace-pre`). 접으면 마크다운 표의 `|` 칸이 어긋나 원문이
       * 무엇이었는지 알아볼 수 없다. 대신 자기 안에서 가로로 스크롤한다.
       */}
      <details className="mt-6 print:hidden">
        <summary className="text-ink-muted cursor-pointer text-xs">마크다운 원문</summary>
        <pre className="border-line bg-canvas text-ink-body mt-2 max-h-[480px] overflow-auto rounded border p-3 text-xs whitespace-pre">
          {markdown}
        </pre>
      </details>
    </section>
  );
}
