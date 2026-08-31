'use client';

/**
 * 누른 링크 옆에 뜨는 **점 하나.** `<Link>` 안에 넣어야 한다 — `useLinkStatus`는 자기를
 * 감싸고 있는 링크의 상태를 읽는다.
 *
 * 이 앱의 라우트는 전부 동적이라(쿠키·세션을 읽는다) Next가 미리 그려 둘 수 없고, 그래서
 * 누르고 나서 서버가 답할 때까지 **화면에 아무 일도 일어나지 않는다.** 사용자에게 그것은
 * 「느리다」가 아니라 **「눌리지 않았다」**로 읽힌다 — 그래서 다시 누르고, 그 사이 첫 요청이
 * 도착해 화면이 두 번 바뀐다.
 *
 * 페이지를 옮길 때는 `loading.tsx`가 그 답을 하지만, **패널은 같은 라우트다** (`?task=`만
 * 바뀐다). 같은 자리에 머무는 전환이라 골격이 서지 않고 — 그것이 맞다, 표가 사라지면 더
 * 나쁘다 — 그래서 반응을 **누른 그 줄에** 둔다.
 *
 * 스피너가 아니라 점이다. 표 한 줄 안에서 도는 것은 시선을 끌어 옆 줄을 읽기 어렵게 하고,
 * 여기서 말하려는 것은 「진행 중」이 아니라 「눌렸다」 하나다.
 */

import { useLinkStatus } from 'next/link';

export function LinkPendingDot() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      aria-label="여는 중"
      className="bg-brand ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full align-middle"
    />
  );
}
