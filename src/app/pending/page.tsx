/**
 * 승인 대기 화면 (T11). `pending-gate.ts`가 대기·거절·프로필 없음 셋을 전부 여기로 보낸다.
 *
 * 갈래가 다섯이다.
 *
 * ```
 * 승인됨(`ok`)  → `/`로 보낸다. 승인된 뒤 북마크로 돌아오는 경우가 실제로 생긴다
 * 미인증        → `/login`. 여기까지 올 일은 없지만(proxy가 먼저 막는다) 백지를 두지 않는다
 * pending      → 어느 팀에 요청했는지 + 기다리는 중
 * rejected     → 반려 + **다른 팀으로 재요청 폼**
 * no_profile   → 프로필 없음 + 관리자 문의
 * ```
 *
 * 셋 다 로그아웃 버튼을 단다 — 이 화면은 막다른 길이라 나갈 문이 없으면 계정이 갇힌다.
 * 근거는 `components/auth/pending-notice.tsx` 머리말에 있다.
 *
 * **`PageShell`을 쓰지 않는다.** 상단 바가 지는 것(「마지막 반영」·역할)은 전부 승인된
 * 뒤에 뜻이 생기는 값이고, 그리려면 저장소를 읽어야 한다 — `/login`과 같은 판단이다.
 *
 * **팀 이름을 여기서 적지 않는다.** `teamLabel()`이 유일한 출처다 (`team-slug.ts`).
 */

import { redirect } from 'next/navigation';

import {
  ApprovedNotice,
  MissingProfileNotice,
  PendingNotice,
  RejectedNotice,
} from '@/components/auth/pending-notice';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { toURLSearchParams } from '@/lib/view/dashboard-query';
import { teamLabel } from '@/lib/view/team-slug';

/** 승인 여부는 요청 시각의 사실이다. 프리렌더하면 승인된 뒤에도 이 화면이 굳는다 */
export const dynamic = 'force-dynamic';

/**
 * 제목은 **상태 하나에서만** 온다. 조건식을 늘려 가며 짓다 보면 갈래가 하나 늘 때 제목이
 * 조용히 빠지고, 그 화면은 이름 없이 뜬다.
 */
const TITLES = {
  ok: '승인 완료',
  pending: '승인 대기 중',
  rejected: '요청이 반려되었습니다',
  no_profile: '프로필이 준비되지 않았습니다',
  anonymous: '',
} as const;

export default async function PendingPage({ searchParams }: PageProps<'/pending'>) {
  // Next 16에서 `searchParams`는 Promise다
  const sp = toURLSearchParams(await searchParams);

  const { session } = await currentViewerContext();
  if (session.status === 'anonymous') redirect('/login?next=%2Fpending');

  /*
   * `no_profile`에는 팀 칸 자체가 없다. `ok`는 `Viewer` 안에 들어 있고, 나머지 둘은 평평하다 —
   * 셋의 모양이 달라서 여기서 한 번 고른다.
   */
  const teamId =
    session.status === 'no_profile'
      ? null
      : session.status === 'ok'
        ? session.viewer.teamId
        : session.teamId;
  const teamName = teamId === null ? null : teamLabel(teamId);

  return (
    <main className="bg-canvas flex flex-1 items-center justify-center px-6 py-16">
      {/* 로그인·가입과 함께 중앙 정렬이 허용되는 자리다 (`UI_GUIDE.md`「정렬」의 빈 상태
          화면과 같은 이유 — 읽을 데이터가 없어 좌측 기준선을 세울 것이 없다) */}
      <div className="border-line bg-panel w-full max-w-[360px] rounded-md border p-6">
        <h1 className="text-brand text-xl font-semibold">{TITLES[session.status]}</h1>
        <p className="text-ink-muted mt-1 text-xs">
          {session.status === 'no_profile'
            ? '권한 지정이 필요합니다.'
            : session.status === 'ok'
              ? '이제 현황판을 이용하실 수 있습니다.'
              : '승인되면 현황판을 볼 수 있습니다.'}
        </p>

        <div className="mt-5">
          {session.status === 'no_profile' && <MissingProfileNotice email={session.email} />}
          {session.status === 'ok' && (
            <ApprovedNotice
              teamName={teamName}
              displayName={null}
              email={session.viewer.email}
            />
          )}
          {session.status === 'pending' && (
            <PendingNotice
              teamName={teamName}
              displayName={session.displayName}
              email={session.email}
            />
          )}
          {session.status === 'rejected' && (
            <RejectedNotice
              teamName={teamName}
              email={session.email}
              error={sp.get('error')}
            />
          )}
        </div>
      </div>
    </main>
  );
}
