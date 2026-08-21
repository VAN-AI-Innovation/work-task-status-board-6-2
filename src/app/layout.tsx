import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppSidebar } from "@/components/shell/app-sidebar";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
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
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </body>
    </html>
  );
}
