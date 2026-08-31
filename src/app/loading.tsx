/**
 * 이동 중에 서는 화면. **모든 라우트가 이것을 쓴다** (`app/` 최상단이라 아래로 상속된다).
 *
 * 이 앱의 라우트는 전부 동적이다 — 쿠키와 세션을 읽으므로 Next가 미리 그려 둘 수 없고,
 * 그래서 **링크 프리페치가 통째로 건너뛰어진다.** 누르면 서버가 답할 때까지 화면이 그대로
 * 서 있고, 사용자에게 그것은 「느리다」가 아니라 「눌리지 않았다」로 읽힌다. 그래서 다시
 * 누르고, 그 사이 첫 요청이 도착해 화면이 두 번 바뀐다.
 *
 * `loading.tsx`가 있으면 둘이 달라진다: 클릭 즉시 이 화면이 서고(반응이 생긴다), 동적
 * 라우트도 **부분 프리페치**가 된다 — 껍데기와 이 골격을 미리 받아 둔다.
 *
 * 스피너를 돌리지 않고 **자리만** 잡는다. 도는 것은 진행을 뜻하는데 우리는 얼마나 걸릴지
 * 모르고, 무엇보다 다음 화면의 골격이 그 자리에 서면 내용이 도착할 때 화면이 튀지 않는다.
 * 색은 `bg-raise` 하나다 — 회색 덩어리에 브랜드색을 쓰면 데이터인 척하게 된다
 * (`UI_GUIDE.md`「데이터에는 브랜드색을 쓰지 않는다」· `ADR-020`).
 */

/** 한 덩어리. `key`가 필요해 배열로 돌리므로 폭만 바꿔 가며 쓴다 */
function Bar({ className }: { className: string }): React.ReactNode {
  return <div className={`bg-raise rounded ${className}`} />;
}

export default function Loading() {
  return (
    <main className="flex-1" aria-busy="true" aria-label="불러오는 중">
      <div className="mx-auto max-w-[1280px] animate-pulse px-6 py-6">
        <Bar className="h-6 w-48" />

        {/* KPI 줄 */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Bar key={index} className="h-20" />
          ))}
        </div>

        {/* 표 — 머리 한 줄과 본문 여섯 줄 */}
        <div className="border-line mt-6 rounded-md border p-4">
          <Bar className="h-4 w-32" />
          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Bar key={index} className="h-8" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
