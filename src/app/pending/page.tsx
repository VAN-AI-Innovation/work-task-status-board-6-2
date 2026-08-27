/**
 * 승인 대기 화면 (T11).
 *
 * **이 파일은 step 2가 세운 자리표시자다.** 문구·재요청·거절 갈래는 step 4가 만든다.
 * 지금 필요한 것은 하나뿐 — `pending-gate.ts`가 여기로 보내는데 화면이 없으면 사용자가
 * 404를 보고, 그것은 「승인을 기다리는 중」이 아니라 「사이트가 고장 났다」로 읽힌다.
 *
 * **`PageShell`을 쓰지 않는다.** 상단 바가 지는 것(「마지막 반영」·역할)은 전부 승인된
 * 뒤에 뜻이 생기는 값이고, 그리려면 저장소를 읽어야 한다 — `/login`과 같은 판단이다.
 *
 * 로그인하지 않은 사람은 여기까지 오지 않는다. `proxy`가 `/login?next=/pending`으로 먼저
 * 보낸다 (`route-guard.ts` — `/pending`은 공개 경로가 **아니다**).
 */

/** 승인 여부는 요청 시각의 사실이다. 프리렌더하면 승인된 뒤에도 이 화면이 굳는다 */
export const dynamic = 'force-dynamic';

export default function PendingPage() {
  return (
    <main className="bg-canvas flex flex-1 items-center justify-center px-6 py-16">
      <div className="border-line bg-panel w-full max-w-[360px] rounded-md border p-6">
        <h1 className="text-brand text-xl font-semibold">승인 대기 중</h1>
        <p className="text-ink-body mt-2 text-sm">
          가입 요청이 접수되었습니다. 팀장 또는 관리자가 승인하면 현황판을 볼 수 있습니다.
        </p>
      </div>
    </main>
  );
}
