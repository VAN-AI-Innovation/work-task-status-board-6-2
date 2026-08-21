/**
 * 페이지 하나가 부르는 **유일한 틀**. 배너 · 상단 바 · 본문 폭이 여기서 한 번 정해진다.
 *
 * 페이지마다 헤더를 복사하면 「마지막 반영」이 어느 화면엔 있고 어느 화면엔 없는 상태가 되고,
 * T6 완료 기준 8은 *모든* 페이지를 요구한다. 그래서 페이지는 이것 하나만 부른다.
 *
 * 계산이 없다 — 저장소를 읽고 `describeSync`·`resolveViewerRole`을 부르는 것은 페이지의 몫이고,
 * 여기는 받은 값을 배치만 한다.
 */

import type { ReactNode } from 'react';

import { AppTopbar } from '@/components/shell/app-topbar';
import { StorageBanner } from '@/components/upload/storage-banner';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { StorageMode } from '@/lib/store/store-factory';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import type { SyncFreshness } from '@/lib/view/sync-freshness';

export function PageShell({
  mode,
  freshness,
  role,
  query,
  children,
}: {
  mode: StorageMode;
  freshness: SyncFreshness;
  role: ViewerRole;
  query: DashboardQuery;
  children: ReactNode;
}) {
  return (
    <main className="flex-1">
      <StorageBanner mode={mode} />
      <AppTopbar freshness={freshness} role={role} query={query} />
      <div className="mx-auto max-w-[1280px] px-6 py-6">{children}</div>
    </main>
  );
}
