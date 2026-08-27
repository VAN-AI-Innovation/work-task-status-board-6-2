'use client';

/**
 * 주간 브리핑 카드 (`UC-08`, 과제 요구 5번). 전용 화면은 T9지만 **카드는 T6다** —
 * `admin` 여정의 종착점이 「회의록에 붙여넣기」이기 때문이다.
 *
 * **마크다운을 원문 그대로 `<pre>`에 둔다. HTML로 렌더하지 않는다.** 렌더하는 순간 sanitize가
 * 필요해지고, 시트 셀에서 온 문자열이 그대로 DOM이 된다 (`S7`). 마크다운 렌더러를 설치하지도
 * 않는다 — 이 카드의 용도는 읽는 것이 아니라 **복사해서 가져가는 것**이다.
 *
 * 복사 실패를 조용히 삼키지 않는다. `navigator.clipboard`는 비 HTTPS에서 아예 없고, 있어도
 * 권한이 거부될 수 있다. 실패했는데 「복사됨」이 뜨면 사용자는 회의 자리에서 빈 클립보드를
 * 붙여넣는다. 브라우저 경고창을 띄우지 않는다 — 버튼 라벨이 결과를 말한다.
 */

import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'done' | 'failed';

const LABELS: Readonly<Record<CopyState, string>> = {
  idle: '복사',
  done: '복사됨',
  failed: '복사 실패',
};

export function BriefingCard({ markdown }: { markdown: string }) {
  const [state, setState] = useState<CopyState>('idle');
  // 언마운트 뒤에 타이머가 살아 있으면 없는 컴포넌트에 setState한다
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const copy = async (): Promise<void> => {
    let next: CopyState = 'failed';
    try {
      // 비 HTTPS에서는 `navigator.clipboard` 자체가 없다
      await navigator.clipboard.writeText(markdown);
      next = 'done';
    } catch {
      next = 'failed';
    }

    setState(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  return (
    <section className="border-line bg-panel rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-brand text-sm font-semibold">주간 브리핑</h2>
          <p className="text-ink-muted mt-1 text-xs">
            회의록에 그대로 붙여넣는 마크다운입니다 · 화면에는 원문 그대로 둡니다
          </p>
        </div>
        {/*
         * 카드 **안**의 보조 동작이라 필터 바의 [필터] 버튼과 같은 규격을 쓴다
         * (`px-3 py-1.5 text-xs`). 폼을 제출하는 Primary 크기(`px-4 py-2 text-sm`)로 두면
         * 설명 두 줄 옆에서 카드의 주인공처럼 커 보인다 — 주인공은 브리핑 본문이다.
         */}
        <button
          type="button"
          onClick={() => void copy()}
          className="border-line bg-panel text-ink hover:bg-raise shrink-0 self-start rounded border px-3 py-1.5 text-xs"
        >
          {LABELS[state]}
        </button>
      </div>

      {state === 'failed' && (
        <p className="text-warn mt-3 text-xs">
          클립보드를 쓸 수 없습니다 — 아래 본문을 직접 선택해 복사하세요.
        </p>
      )}

      {/*
        * 줄을 **접지 않는다**(`whitespace-pre` + 가로 스크롤). 접힌 카드가 4칸 안에서
        * 펼쳐지므로 폭이 좁은데, 거기서 줄을 접으면 마크다운 표의 `|` 칸이 어긋나 원문이
        * 무엇이었는지 알아볼 수 없다. 이 카드의 용도는 읽는 것이 아니라 **복사해 가는 것**이라
        * 원문 모양을 지키는 쪽이 맞다.
        */}
      <pre className="border-line bg-canvas text-ink-body mt-3 max-h-[320px] overflow-auto rounded border p-3 text-xs whitespace-pre">
        {markdown}
      </pre>
    </section>
  );
}
