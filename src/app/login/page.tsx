/**
 * 로그인 화면 (T8 완료 기준 7의 목적지).
 *
 * 갈래가 셋이다.
 *
 * ```
 * 이미 로그인함        → `/`로 보낸다. 로그인한 사람에게 로그인 폼은 막다른 길이다
 * 로그인은 됐고 프로필 없음 → 문구 + 로그아웃 버튼. 이게 없으면 그 계정이 고리에 갇힌다
 * 그 밖                → 로그인 폼
 * ```
 *
 * **`PageShell`을 쓰지 않는다.** 상단 바가 지고 있는 것(「마지막 반영」·역할 전환)은 전부
 * 로그인한 뒤에 뜻이 생기는 값이고, 그것을 그리려면 저장소를 읽어야 한다 — 로그인하지 않은
 * 사람에게 저장소 조회 비용을 물릴 이유가 없다. 사이드바도 같은 이유로 이 경로에서 빠진다
 * (`components/shell/app-sidebar.tsx`가 스스로 접는다).
 *
 * `?next=`는 화면에 그리지 않고 폼의 `action`에만 싣는다. 그전에 `safeRedirectPath`로 한 번
 * 접는다 — 그러지 않으면 `/login?next=https://evil.com`이 우리 화면을 거쳐 남의 사이트로
 * 사람을 보내는 링크가 된다.
 */

import { redirect } from 'next/navigation';

import { LoginForm, NoProfileNotice } from '@/components/auth/login-form';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { toURLSearchParams } from '@/lib/view/dashboard-query';

/** 세션에 따라 화면이 갈린다. 빌드 시각에 굳으면 늘 로그인 폼이다 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);
  const next = safeRedirectPath(sp.get('next'));

  const { session } = await currentViewerContext();
  if (session.status === 'ok') redirect(next);

  return (
    <main className="bg-canvas flex flex-1 items-center justify-center px-6 py-16">
      {/* 로그인 화면은 이 앱에서 중앙 정렬이 허용되는 유일한 자리다 (`UI_GUIDE.md`「정렬」의
          빈 상태 화면과 같은 이유 — 읽을 데이터가 없어 좌측 기준선을 세울 것이 없다) */}
      <div className="border-line bg-panel w-full max-w-[360px] rounded-md border p-6">
        <h1 className="text-brand text-xl font-semibold">전사 업무 현황판</h1>
        <p className="text-ink-muted mt-1 text-xs">
          {session.status === 'no_profile'
            ? '권한 지정이 필요합니다.'
            : '계속하려면 로그인해 주세요.'}
        </p>

        <div className="mt-5">
          {session.status === 'no_profile' ? (
            <NoProfileNotice email={session.email} />
          ) : (
            <LoginForm error={sp.get('error')} next={next} />
          )}
        </div>
      </div>
    </main>
  );
}
