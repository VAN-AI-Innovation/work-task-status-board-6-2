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
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="bg-panel border-line sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r lg:w-[220px]">
      <div className="border-line flex h-14 shrink-0 items-center border-b px-4">
        <span className="text-ink hidden text-sm font-semibold lg:inline">현황판</span>
        {/* 좁은 폭에서는 로고 자리도 아이콘 하나만큼이다 */}
        <span className="text-ink text-sm font-semibold lg:hidden">현</span>
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
                active ? 'bg-raise text-ink' : 'text-ink-muted hover:text-ink'
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
