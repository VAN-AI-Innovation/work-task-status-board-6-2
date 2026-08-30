'use client';

/**
 * 값 하나를 클립보드로 가져가는 작은 버튼. 사이드 패널의 링크 칸에 붙는다 — 시트의 링크는
 * **다른 문서로 옮겨 붙이려고** 있는 것이라, 열어 보는 것만큼 복사가 잦다.
 *
 * 규율은 하나다: 실패를 조용히 삼키지 않는다. `navigator.clipboard`는
 * 비 HTTPS에서 아예 없고, 있어도 권한이 거부될 수 있다. 실패했는데 「복사됨」이 뜨면 사용자는
 * 붙여넣기를 하고 나서야 빈 클립보드를 발견한다.
 *
 * 상태를 2초 뒤 되돌리는 타이머는 **언마운트에서 정리**한다. 패널은 URL이 바뀌면 통째로
 * 사라지므로, 정리하지 않으면 없어진 컴포넌트에 `setState`가 날아든다.
 */

import { useEffect, useRef, useState } from 'react';

type State = 'idle' | 'done' | 'failed';

const LABELS: Readonly<Record<State, string>> = {
  idle: '복사',
  done: '복사됨',
  failed: '실패',
};

export function CopyButton({ value, label = '링크' }: { value: string; label?: string }) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  async function copy() {
    if (timer.current !== null) clearTimeout(timer.current);

    try {
      await navigator.clipboard.writeText(value);
      setState('done');
    } catch {
      setState('failed');
    }

    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      /* 값 옆에 붙는 보조 동작이라 [필터]·[복사]와 같은 규격이다 (`UI_GUIDE.md`「버튼」) */
      className="border-line bg-panel text-ink-muted hover:border-brand hover:text-brand shrink-0 self-start rounded border px-2 py-0.5 text-xs"
      /* 버튼 글자는 상태를 말하고, 무엇을 복사하는지는 여기서 말한다 */
      aria-label={`${label} 복사`}
      title={`${label} 복사`}
    >
      {LABELS[state]}
    </button>
  );
}
