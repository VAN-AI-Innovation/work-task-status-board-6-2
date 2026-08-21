/**
 * 상태 배지 하나. **판정도 라벨도 여기서 만들지 않는다** — 어느 칸인지는 조회 응답의
 * `displayStatus`가 이미 말하고, 클래스와 한글은 `lib/view/status-badge.ts`의 표에서 온다.
 *
 * 라벨을 지우고 색만 남기지 않는다. 색각 이상 사용자에게는 다섯 칸이 같은 회색이다
 * (`UI_GUIDE.md`「상태 5색 구분」).
 */

import { badgeOf } from '@/lib/view/status-badge';
import type { DisplayStatus } from '@/types/task';

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const badge = badgeOf(status);

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs whitespace-nowrap ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}
