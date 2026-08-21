/**
 * 승인 대기함 (`UC-09`). 「승인 대기」 KPI 타일에는 숫자만 있고 **무엇이 걸려 있는지**가
 * 없어서, 그 숫자의 목록을 알림 패널 옆에 둔다.
 *
 * 대기 일수는 `approvalQueue`가 이미 쟀다 (`daysBetween`). 여기서 날짜를 만지지 않는다.
 * 색을 붙이지 않는 것도 결정이다 — 승인 대기는 지연이 아니고, 빨강은 업무 지연 전용이다.
 */

import Link from 'next/link';

import type { WaitingItem } from '@/lib/view/alert-groups';
import { EMPTY, formatCount } from '@/lib/view/kpi-format';

export function ApprovalQueue({
  items,
  titleOf,
  hrefOf,
}: {
  items: WaitingItem[];
  titleOf: (taskId: string) => string;
  hrefOf: (taskId: string) => string;
}) {
  return (
    <section className="border-line bg-panel rounded-md border p-5">
      <div className="border-line flex items-baseline justify-between border-b pb-1">
        <h2 className="text-ink text-sm font-semibold">승인 대기함</h2>
        <span className="text-ink-muted text-xs tabular-nums">{items.length}건</span>
      </div>

      {items.length === 0 ? (
        <p className="text-ink-faint mt-2 text-xs">해당 없음</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.taskId} className="flex items-baseline justify-between gap-3">
              <Link
                href={hrefOf(item.taskId)}
                className="text-ink-body hover:text-ink truncate text-sm underline-offset-4 hover:underline"
              >
                {titleOf(item.taskId)}
              </Link>
              <span className="text-ink-muted shrink-0 text-xs tabular-nums">
                {/* 「모른다」를 「0일 대기」로 접지 않는다 — 방금 올라온 건과 같아진다 */}
                {item.days === null ? EMPTY : `${formatCount(item.days)}일 대기`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
