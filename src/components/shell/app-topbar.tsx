'use client';

/**
 * 상단 바 — 검색 · 「마지막 반영」 · 역할 전환.
 *
 * **`layout.tsx`가 아니라 각 페이지가 그린다.** 「마지막 반영」과 역할은 저장소를 읽어야
 * 나오는데, 루트 레이아웃에서 `getStorage()`를 부르면 저장소를 볼 필요가 없는 화면까지
 * 전량 조회 비용을 진다. 대신 **모든 페이지가 `PageShell`을 부르는지**로 누락을 막는다.
 *
 * 현재 경로는 훅으로 읽어 아래 두 컴포넌트에 내려준다 — 링크를 만들려면 경로가 필요한데,
 * 페이지마다 `pathname`을 손으로 넘기게 하면 언젠가 한 곳이 틀린 경로를 넘긴다.
 */

import { usePathname } from 'next/navigation';

import { RefreshButton } from '@/components/shell/refresh-button';
import { RoleSwitch } from '@/components/shell/role-switch';
import { SearchBox } from '@/components/shell/search-box';
import { SyncBadge } from '@/components/shell/sync-badge';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import type { SyncFreshness } from '@/lib/view/sync-freshness';

export function AppTopbar({
  freshness,
  role,
  query,
  showRoleSwitch,
}: {
  freshness: SyncFreshness;
  role: ViewerRole;
  query: DashboardQuery;
  /** 판정은 `PageShell`이 넘긴다. 여기서 `?as=` 규칙을 다시 읽지 않는다 (`S4`) */
  showRoleSwitch: boolean;
}) {
  const pathname = usePathname();

  return (
    <header className="bg-panel border-line relative flex h-14 shrink-0 items-center gap-4 border-b px-6">
      <SearchBox pathname={pathname} query={query} />
      <SyncBadge freshness={freshness} />
      <RefreshButton />
      {showRoleSwitch && <RoleSwitch pathname={pathname} query={query} role={role} />}
    </header>
  );
}
