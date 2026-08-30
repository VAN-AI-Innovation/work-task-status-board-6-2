import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { currentViewerContext } from "@/lib/auth/request-viewer";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "전사 업무 현황판",
  description: "팀별 업무 시트를 통합 조회하고 업무 배정표를 추출하는 현황판",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /*
   * 사이드바의 「팀원 요청」한 줄 때문에 역할이 필요하다 (T11 · `app-sidebar.tsx`).
   * 저장소를 **조회하지는 않는다** — `currentViewerContext()`가 푸는 것은 저장소 핸들과
   * 세션뿐이고, 화면이 자기 본문에서 부르는 것과 같은 호출이라 `cache`가 요청당 하나로
   * 접는다 (`request-viewer.ts`). 위 주석이 거절한 「전량 조회」는 여전히 각 화면의 몫이다.
   *
   * **`?as=`를 보지 않는다.** 레이아웃에는 `searchParams`가 없고, 데모 모드에는 승인할
   * 요청 자체가 없어 이 항목이 뜰 이유도 없다 (`ADR-026`).
   */
  const { session } = await currentViewerContext();
  const role = session.status === "ok" ? session.viewer.role : null;
  /*
   * 팀 탭을 좁히는 데 쓴다 (`team-visibility.ts`). **세션이 없으면 좁히지 않는다** —
   * 데모에는 「우리 팀」이라고 부를 대상이 없고, 여기서 좁히면 `.env` 없이 클론한 사람이
   * 팀 메뉴가 하나도 없는 화면을 본다 (`ARCHITECTURE.md`「권한」).
   */
  const viewerTeamId = session.status === "ok" ? session.viewer.teamId : null;

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* 상단 바는 여기서 그리지 않는다 — 「마지막 반영」과 역할은 저장소를 읽어야 나오는데,
          루트 레이아웃이 저장소를 읽으면 그것을 볼 필요가 없는 화면까지 전량 조회 비용을 진다.
          각 페이지가 `PageShell`을 부른다 (`components/shell/page-shell.tsx`). */}
      <body className="bg-canvas text-ink min-h-full">
        <div className="flex min-h-screen">
          <AppSidebar
            role={role}
            teamId={viewerTeamId}
            hasSession={session.status === "ok"}
          />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
