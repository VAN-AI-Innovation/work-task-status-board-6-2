/**
 * 페이지 하나가 부르는 **유일한 틀**. 배너 · 상단 바 · 본문 폭이 여기서 한 번 정해진다.
 *
 * 페이지마다 헤더를 복사하면 「마지막 반영」이 어느 화면엔 있고 어느 화면엔 없는 상태가 되고,
 * T6 완료 기준 8은 *모든* 페이지를 요구한다. 그래서 페이지는 이것 하나만 부른다.
 *
 * 계산이 없다 — 저장소를 읽고 신선도·역할을 판정하는 것은 페이지의 몫이고(`lib/view`·`lib/api`),
 * 여기는 받은 값을 배치만 한다.
 */

import type { ReactNode } from 'react';

import { AppTopbar } from '@/components/shell/app-topbar';
import { StorageBanner } from '@/components/upload/storage-banner';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { StorageDriver, StorageMode } from '@/lib/store/store-factory';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import type { SyncFreshness } from '@/lib/view/sync-freshness';

export function PageShell({
  mode,
  driver,
  freshness,
  role,
  query,
  children,
}: {
  mode: StorageMode;
  driver: StorageDriver;
  freshness: SyncFreshness;
  role: ViewerRole;
  query: DashboardQuery;
  children: ReactNode;
}) {
  return (
    <main className="flex-1">
      <StorageBanner mode={mode} />
      <AppTopbar
        freshness={freshness}
        role={role}
        query={query}
        /*
         * 역할 전환은 `?as=`가 실제로 먹는 자리에서만 보인다 (`S4`·`ADR-013`). 프로덕션 +
         * 실제 저장소에서는 `lib/api/viewer-role.ts`가 그것을 무시하는데, 그때도 버튼이 남아 있으면
         * 눌러도 안 바뀌는 버튼이 되어 사용자에게는 고장으로 보인다.
         */
        showRoleSwitch={mode === 'demo' || driver === 'memory'}
      />
      {/*
       * 아래 여백이 위보다 넓다(`pb-16`). 마지막 카드가 뷰포트 바닥에 붙으면 스크롤이 끝난
       * 것인지 잘린 것인지 알 수 없고, 접히는 카드 셋이 맨 아래에 서는 화면이라 펼칠 때
       * 손이 닿는 자리이기도 하다.
       */}
      <div className="mx-auto max-w-[1280px] px-6 pt-6 pb-16">{children}</div>
    </main>
  );
}
