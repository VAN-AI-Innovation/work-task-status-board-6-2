/**
 * 주간 보고의 **기간 줄**. 지금 보는 주와 이동 링크 셋, 그리고 되돌림 고지가 여기 있다.
 *
 * 달력 위젯도 프리셋 드롭다운도 없다 (T9 step 5). 링크 셋을 만드는 것은 이 컴포넌트가
 * 아니라 `lib/view/report-nav.ts`이고, 여기는 받은 값을 배치만 한다 — 없는 링크(`null`)는
 * 누를 수 없는 **글자**로 남긴다. 지우면 버튼 자리가 흔들려 주를 넘길 때마다 줄이 출렁인다.
 */

import Link from 'next/link';

import type { ReportNav } from '@/lib/view/report-nav';

/** 링크와 비활성 글자가 같은 크기를 차지해야 줄이 흔들리지 않는다 */
const BOX = 'rounded border px-3 py-1.5 text-xs';

function NavItem({ href, label }: { href: string | null; label: string }) {
  if (href === null) {
    return (
      <span aria-disabled className={`${BOX} border-line text-ink-faint`}>
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={`${BOX} border-line bg-panel text-ink hover:bg-raise`}>
      {label}
    </Link>
  );
}

export function ReportPeriodNav({ nav, fellBack }: { nav: ReportNav; fellBack: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <NavItem href={nav.prevHref} label="← 이전 주" />
        <NavItem href={nav.currentHref} label="이번 주" />
        <NavItem href={nav.nextHref} label="다음 주 →" />
        <span className="text-ink-body ml-1 text-sm tabular-nums">{nav.rangeLabel}</span>
      </div>

      {fellBack && (
        /*
         * 요청한 주를 열지 못했다는 사실을 **감추지 않는다**. 되돌린 것을 말하지 않으면
         * 사용자는 자기가 요청한 주를 보고 있다고 믿고 회의에 그 숫자를 가져간다.
         * 저장소 배너(`StorageBanner`)와 문구를 섞지 않는다 — 이건 사고가 아니라 입력 오류다.
         */
        <p className="border-warn-line bg-warn-bg text-warn mt-3 rounded border px-3 py-2 text-xs">
          요청한 기간을 읽을 수 없어 이번 주로 되돌렸습니다 — 주소의 <code>?week=</code> 값은
          <code> YYYY-MM-DD</code> 형식이어야 하고 아직 오지 않은 주는 열 수 없습니다.
        </p>
      )}
    </div>
  );
}
