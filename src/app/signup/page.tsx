/**
 * 가입 화면 (T11). `/login`의 구조·클래스·문구 톤을 그대로 따른다.
 *
 * 갈래가 셋이다.
 *
 * ```
 * 이미 로그인함   → `/`로 보낸다. 세션이 있는 사람에게 가입 폼은 막다른 길이다
 *                   (대기 중이면 `/`가 다시 `/pending`으로 보낸다 — `pending-gate.ts`)
 * ?sent=1        → 확인 메일 안내. 폼을 다시 보여 주지 않는다
 * 그 밖          → 가입 폼
 * ```
 *
 * **`PageShell`을 쓰지 않는다.** 상단 바가 지고 있는 것(「마지막 반영」·역할)은 전부
 * 로그인한 뒤에 뜻이 생기는 값이고, 그리려면 저장소를 읽어야 한다 — `/login`과 같은 판단이다.
 *
 * 이 경로는 `route-guard.ts`의 공개 목록에 있다 (step 2). 가입 화면이 로그인을 요구하면
 * 아무도 계정을 만들 수 없다.
 */

import { redirect } from 'next/navigation';

import { SignupForm, SignupSentNotice } from '@/components/auth/signup-form';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { toURLSearchParams } from '@/lib/view/dashboard-query';

/** 세션에 따라 화면이 갈린다. 빌드 시각에 굳으면 늘 가입 폼이다 */
export const dynamic = 'force-dynamic';

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  const { session } = await currentViewerContext();
  if (session.status === 'ok') redirect('/');

  const sent = sp.get('sent') === '1';

  return (
    <main className="bg-canvas flex flex-1 items-center justify-center px-6 py-16">
      {/* 가입 화면은 로그인과 함께 중앙 정렬이 허용되는 자리다 (`UI_GUIDE.md`「정렬」의
          빈 상태 화면과 같은 이유 — 읽을 데이터가 없어 좌측 기준선을 세울 것이 없다) */}
      <div className="border-line bg-panel w-full max-w-[360px] rounded-md border p-6">
        <h1 className="text-brand text-xl font-semibold">전사 업무 현황판</h1>
        <p className="text-ink-muted mt-1 text-xs">
          {sent ? '메일함을 확인해 주세요.' : '가입 요청 후 팀장 또는 관리자의 승인이 필요합니다.'}
        </p>

        <div className="mt-5">
          {sent ? <SignupSentNotice /> : <SignupForm error={sp.get('error')} />}
        </div>
      </div>
    </main>
  );
}
