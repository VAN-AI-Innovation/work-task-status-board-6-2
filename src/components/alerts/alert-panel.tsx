/**
 * 알림 패널 (과제 요구 3번 · `UC-12`·`UC-13`). **묶음 5개를 항상 그린다** — 0건이라고
 * 숨기면 「그 문제가 없는 것」과 「그 검사를 안 한 것」이 화면에서 같아진다.
 *
 * 종류는 **한글 라벨로 구분한다.** 아이콘을 쓰지 않는다 (`UI_GUIDE.md`「아이콘」).
 *
 * 업무명은 `titleOf`가 붙인다 — `Alert`에는 이름이 없고, 그것이 의도다 (`S6`). 서버가
 * 두 함수를 만들어 넘기므로 이 컴포넌트에 업무 배열이 통째로 딸려 들어오지 않는다.
 */

import Link from 'next/link';

import { alertDetail, type AlertGroup } from '@/lib/view/alert-groups';

/** 이미 지난 건만 붉다. 「내일까지」와 「어제까지였다」를 같은 색으로 두지 않는다 */
function toneOf(severity: 'warn' | 'danger'): string {
  return severity === 'danger' ? 'text-late' : 'text-warn';
}

export function AlertPanel({
  groups,
  titleOf,
  hrefOf,
}: {
  groups: AlertGroup[];
  titleOf: (taskId: string) => string;
  hrefOf: (taskId: string) => string;
}) {
  return (
    <section className="border-line bg-panel rounded-md border p-5">
      <h2 className="text-ink text-sm font-semibold">알림</h2>
      <p className="text-ink-muted mt-1 text-xs">
        건수가 0이어도 묶음은 남는다 · 항목을 누르면 그 업무의 상세가 열린다
      </p>

      <div className="mt-3 space-y-4">
        {groups.map((group) => (
          <div key={group.kind}>
            <div className="border-line flex items-baseline justify-between border-b pb-1">
              <span className="text-ink text-xs font-medium">{group.label}</span>
              <span className="text-ink-muted text-xs tabular-nums">{group.items.length}건</span>
            </div>

            {group.items.length === 0 ? (
              <p className="text-ink-faint mt-2 text-xs">해당 없음</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {group.items.map((alert) => (
                  <li
                    key={`${alert.taskId}:${alert.stageKey ?? ''}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <Link
                      href={hrefOf(alert.taskId)}
                      className="text-ink-body hover:text-ink truncate text-sm underline-offset-4 hover:underline"
                    >
                      {titleOf(alert.taskId)}
                    </Link>
                    <span className={`shrink-0 text-xs tabular-nums ${toneOf(alert.severity)}`}>
                      {alertDetail(alert)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
