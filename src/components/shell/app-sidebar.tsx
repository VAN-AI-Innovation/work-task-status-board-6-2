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
 *
 * ## 역할에 따라 항목이 갈린다 (T11)
 *
 * 「멤버」는 로그인 여부가, 「주간 보고」·「독스 → 배정표」는 `staff-tools.ts`의
 * 두 함수가 참일 때만 선다 — 뒤의 둘은 **부원에게 없다.** 합류 요청은 항목이 아니라
 * 「멤버」 화면 안에 있다. ⚠ **이것은 권한이 아니다.**
 * 실제 방어는 그 화면들이 `notFound()`를 내는 것과 그 아래 DB 함수들이고, 여기서
 * 감추는 것은 **누를 수 없는 자리를 눈앞에 두지 않는** 편의다. 이 순서를 뒤집어 「사이드바에서
 * 뺐으니 됐다」고 하면 주소를 직접 친 사람에게 그대로 열린다 (`role-layout.ts` 머리말이
 * 같은 사고를 기록하고 있다).
 *
 * `role`은 루트 레이아웃이 세션에서 읽어 내려보낸다. 로그인하지 않았거나 프로필이 없으면
 * `null`이고, 그때는 두 항목이 없다 — **데모 모드에도 없다.** 메모리 저장소에는 `profiles`도
 * `members`도 없어 승인할 요청도 세울 명부도 존재하지 않는다 (`ADR-026`).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { canReadWeeklyReport, canSeeOrgDashboard, canUseDocExtract } from '@/lib/domain/staff-tools';
import { visibleTeamKeys } from '@/lib/domain/team-visibility';
import { teamLabel, toTeamSlug } from '@/lib/view/team-slug';
import type { TeamKey } from '@/types/task';

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

/** 주간 보고. 문서 한 장에 줄 몇 개 — 「가져가는 글」이라는 뜻이다 */
function ReportIcon() {
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
      <path d="M3.5 2h6l3 3v9h-9z" />
      <path d="M9.5 2v3h3" />
      <path d="M5.5 8.5h5" />
      <path d="M5.5 11h3" />
    </svg>
  );
}

/** 멤버. 사람 셋이 겹쳐 선다 — 「조직 전체의 명부」라는 뜻이다 */
function MembersIcon() {
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
      <circle cx="5.5" cy="5" r="2.5" />
      <path d="M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4" />
      <path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.6" />
      <path d="M11.5 9.8c1.7.4 3 1.9 3 3.7" />
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

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/**
 * **팀 탭도 역할에 따라 갈린다.** 팀장·부원에게는 자기 팀 하나만 선다 — 누를 수 없는 남의
 * 팀 항목이 셋 서 있으면 매번 「내 것이 아닌 곳」을 확인하게 된다.
 *
 * 판정은 `visibleTeamKeys`가 지고 여기서 다시 하지 않는다. 팀 화면(`/teams/[teamSlug]`)이
 * **같은 함수로** 404를 내므로, 목록에서 사라진 것과 주소로 못 여는 것이 늘 같다 —
 * 두 곳이 각자 판단하면 사이드바에는 없는데 주소로는 열리는 날이 온다.
 *
 * ⚠ 감추는 것은 방어가 아니다. 진짜 문은 `viewer-scope.ts`와 RLS다 (`role-layout.ts` 머리말).
 */
function navItemsFor(role: ViewerRole | null, teamId: TeamKey | null, hasSession: boolean): NavItem[] {
  const effective = role ?? 'member';

  const items: NavItem[] = [
    // 부원에게는 없다 — 그 사람의 열람 범위는 자기 팀이라, 전사 화면은 같은 데이터를
    // 「전사」라는 제목으로 다시 보는 자리가 된다 (`canSeeOrgDashboard` · `0015`)
    ...(canSeeOrgDashboard(effective, hasSession)
      ? [{ href: '/', label: '대시보드', icon: <DashboardIcon /> }]
      : []),
    // 대시보드 바로 아래다. 둘 다 **읽고 가져가는** 화면이고, 주간 보고 문서가 서는 자리는
    // 이제 여기뿐이다 (`UC-08`). 데이터를 넣는 두 화면(업로드·추출)은 팀 탭 아래에 모여 있다.
    // 부원에게는 없다 — 회의에 들고 가는 문서다 (`canReadWeeklyReport`)
    ...(canReadWeeklyReport(effective, hasSession)
      ? [{ href: '/report', label: '주간 보고', icon: <ReportIcon /> }]
      : []),
    ...visibleTeamKeys(effective, teamId, hasSession).map((teamKey) => ({
      href: `/teams/${toTeamSlug(teamKey)}`,
      label: teamLabel(teamKey),
      icon: <TeamIcon />,
    })),
    { href: '/upload', label: '시트 업로드', icon: <UploadIcon /> },
    // 「시트 업로드」 바로 아래다. 둘 다 데이터를 넣는 화면이고, 이 순서가 곧 `UC-05`→`UC-06`
    // 이다 — 배정표를 뽑아(`/extract`) 채운 뒤 시트로 다시 올리면 고리가 닫힌다.
    // 부원에게는 없다 — 남에게 일을 나눠 주려고 뽑는 표다 (`canUseDocExtract`)
    ...(canUseDocExtract(effective, hasSession)
      ? [{ href: '/extract', label: '독스 → 배정표', icon: <ExtractIcon /> }]
      : []),
  ];

  /*
   * 「멤버」 하나다. 예전에는 「팀원 요청」이 그 위에 따로 섰는데, 그 화면을 조직도 아래로
   * 옮겼다 — 승인한 사람이 곧바로 트리에 나타나므로 둘을 나눠 두면 결과를 보려고 화면을
   * 옮겨야 했다 (`members/page.tsx`).
   *
   * **세 역할이 다 본다** (`0016`). 보는 것과 여는 것이 다른 질문이라서다: 부원도 조직도는
   * 보되 상세 패널은 자기 것만 열린다 (`canOpenMemberPanel`). 로그인하지 않은 데모에는
   * 그릴 조직이 없어 항목도 없다.
   */
  if (role !== null) {
    items.push({ href: '/members', label: '멤버', icon: <MembersIcon /> });
  }

  return items;
}

/**
 * 사이드바가 뜻을 갖지 않는 경로 — **아직 아무 화면도 열 수 없는 사람**이 서는 자리다.
 * 로그인 전(`/login`)과 승인 전(`/pending`, T11)이 같은 처지다: 아래 목록의 링크를 누르면
 * 전부 지금 있는 화면으로 되돌아온다 (`lib/auth/pending-gate.ts`).
 */
const HIDDEN_ON = ['/login', '/signup', '/pending'];

export function AppSidebar({
  role,
  teamId,
  hasSession,
}: {
  role: ViewerRole | null;
  /** 로그인한 사람의 팀. 팀 탭을 좁히는 데만 쓴다 */
  teamId: TeamKey | null;
  /** 세션이 없으면 팀을 좁히지 않는다 — 데모에서는 범위가 갈리지 않는다 */
  hasSession: boolean;
}) {
  const pathname = usePathname();

  /*
   * **로그인·승인 대기 화면에서는 접는다.** 이 목록의 링크는 전부 로그인해야 열리는 화면이라
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
        {navItemsFor(role, teamId, hasSession).map((item) => {
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
