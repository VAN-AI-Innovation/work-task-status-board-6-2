/**
 * `?as=` 역할 전환 (`ADR-013`). **다른 필터를 유지한다** — `buildHref`가 현재 쿼리를 얹고
 * `as`만 갈아끼우므로, 지연 필터를 걸어 둔 채 역할을 바꿔도 화면이 초기화되지 않는다.
 *
 * 여기서 보여 주는 것은 `lib/api/viewer-role.ts`가 **판정한 결과**이지 URL에 적힌 문자열이 아니다.
 * 프로덕션 + 실제 저장소에서는 `?as=admin`이 무시되고 `member`로 떨어지는데(`S4`), 그때
 * 화면이 「admin」이라고 말하면 사용자는 권한이 있다고 믿는다.
 */

import Link from 'next/link';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';

const ROLES: readonly { key: ViewerRole; label: string }[] = [
  { key: 'admin', label: '대표·실장' },
  { key: 'lead', label: '팀장' },
  { key: 'member', label: '부원' },
];

export function RoleSwitch({
  pathname,
  query,
  role,
}: {
  pathname: string;
  query: DashboardQuery;
  role: ViewerRole;
}) {
  return (
    <nav aria-label="역할 전환" className="flex shrink-0 items-center gap-1">
      {ROLES.map((item) => {
        const active = item.key === role;
        return (
          <Link
            key={item.key}
            href={buildHref(pathname, query, { as: item.key })}
            aria-current={active ? 'true' : undefined}
            className={`rounded-full px-3 py-1 text-xs ${
              active ? 'bg-ink text-canvas' : 'border-line text-ink-muted hover:text-ink border'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
