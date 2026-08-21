/**
 * 「마지막 반영」 한 줄. **계산하지 않는다** — `describeSync`가 낸 값을 그대로 그린다
 * (`CLAUDE.md` — 컴포넌트는 props 받아 JSX만 뱉는다).
 *
 * `'use client'`를 붙이지 않는다. 서버 컴포넌트에서도 쓸 수 있는 순수 표시라서다.
 */

import type { SyncFreshness } from '@/lib/view/sync-freshness';

export function SyncBadge({ freshness }: { freshness: SyncFreshness }) {
  return (
    <p
      className={`flex shrink-0 items-center gap-1.5 text-xs tabular-nums ${
        freshness.stale ? 'text-warn' : 'text-ink-muted'
      }`}
    >
      {/* 색만으로 구분하지 않는다 — 앰버 점은 보조이고 문구가 본체다 */}
      {freshness.stale && <span aria-hidden className="bg-warn h-1.5 w-1.5 rounded-full" />}
      {freshness.label}
    </p>
  );
}
