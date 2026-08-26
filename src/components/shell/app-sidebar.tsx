'use client';

/**
 * 좌측 고정 사이드바. 현재 경로 판정 때문에 클라이언트 컴포넌트다.
 *
 * 팀 항목은 `TEAM_SLUGS`·`teamLabel`로 만든다. **팀 이름을 여기에 손으로 적지 않는다** —
 * 가운뎃점 한 글자가 달라지면 사이드바와 표가 같은 팀을 다른 이름으로 부른다.
 *
 * 1024px 미만에서는 `w-14`로 줄어 아이콘만 남는다 (`ADR-014` — 그 아래는 깨지지 않고 읽히면
 * 통과다). 여닫는 토글을 두지 않는다: `UI_GUIDE.md`가 허용한 애니메이션은 사이드 패널
 * 슬라이딩과 스켈레톤 페이드 둘뿐이고, 접힘 상태를 기억시키면 폭 규칙이 두 곳이 된다.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { teamLabel, toTeamSlug } from '@/lib/view/team-slug';

/** 아이콘은 인라인 SVG 16px · `strokeWidth 1.5` · 컨테이너 없이 (`UI_GUIDE.md`) */
function DashboardIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <rect x="2" y="2" width="5" height="5" />
      <rect x="9" y="2" width="5" height="5" />
      <rect x="2" y="9" width="5" height="5" />
      <rect x="9" y="9" width="5" height="5" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M8 11V2.5" />
      <path d="M4.5 6 8 2.5 11.5 6" />
      <path d="M2.5 11v2.5h11V11" />
    </svg>
  );
}

/** 독스 → 배정표. 왼쪽이 문서, 오른쪽이 거기서 나오는 표다 */
function ExtractIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M2.5 2.5h5v11h-5z" />
      <path d="M9.5 5h4v6h-4z" />
      <path d="M9.5 7h4" />
    </svg>
  );
}

/** 부서별 탭. 셋이 같은 아이콘을 쓴다 — 구분은 아이콘이 아니라 한글 이름이 진다 */
function TeamIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M2.5 13.5v-9l5-2 5 2v9" />
      <path d="M2.5 13.5h11" />
      <path d="M6 13.5v-3h3v3" />
    </svg>
  );
}

const ITEMS: readonly { href: string; label: string; icon: ReactNode }[] = [
  { href: '/', label: '대시보드', icon: <DashboardIcon /> },
  ...TEAM_KEYS.map((teamKey) => ({
    href: `/teams/${toTeamSlug(teamKey)}`,
    label: teamLabel(teamKey),
    icon: <TeamIcon />,
  })),
  { href: '/upload', label: '시트 업로드', icon: <UploadIcon /> },
  // 「시트 업로드」 바로 아래다. 둘 다 데이터를 넣는 화면이고, 이 순서가 곧 `UC-05`→`UC-06`
  // 이다 — 배정표를 뽑아(`/extract`) 채운 뒤 시트로 다시 올리면 고리가 닫힌다
  { href: '/extract', label: '독스 → 배정표', icon: <ExtractIcon /> },
];

/** 사이드바가 뜻을 갖지 않는 경로. 지금은 로그인 화면 하나다 */
const HIDDEN_ON = ['/login'];

export function AppSidebar() {
  const pathname = usePathname();

  /*
   * **로그인 화면에서는 접는다.** 이 목록의 링크는 전부 로그인해야 열리는 화면이라
   * (`src/proxy.ts`), 미인증 상태에서 보여 주면 누를 때마다 같은 로그인 화면으로 되돌아온다.
   * `layout.tsx`를 고치지 않고 여기서 접는 이유는 사이드바를 그리는 규칙이 두 곳으로
   * 갈리지 않게 하기 위해서다 — 「어디에 뜨는가」는 이 컴포넌트가 안다.
   */
  if (HIDDEN_ON.includes(pathname)) return null;

  return (
    <aside className="bg-panel border-line sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r lg:w-[220px]">
      <div className="border-line flex h-14 shrink-0 items-center border-b px-4">
        {/* 브랜드 색이 쓰이는 유일한 「데이터 아닌」 글자다 (`ADR-020`) */}
        <span className="text-brand hidden text-sm font-semibold lg:inline">현황판</span>
        {/* 좁은 폭에서는 로고 자리도 아이콘 하나만큼이다 */}
        <span className="text-brand text-sm font-semibold lg:hidden">현</span>
      </div>

      <nav aria-label="주요 화면" className="flex flex-col gap-1 p-2">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              className={`flex items-center gap-3 rounded px-3 py-2 text-sm ${
                active
                  ? 'bg-brand-soft text-brand font-medium'
                  : 'text-ink-muted hover:text-brand'
              }`}
            >
              {item.icon}
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
