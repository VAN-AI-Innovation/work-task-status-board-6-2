/**
 * 알림 패널 (과제 요구 3번 · `UC-12`·`UC-13`). **묶음 5개를 항상 그린다** — 0건이라고
 * 숨기면 「그 문제가 없는 것」과 「그 검사를 안 한 것」이 화면에서 같아진다.
 *
 * **폭에 맞춰 열 수가 바뀐다** (`@container`). 대시보드에서는 5칸(약 490px)이라 한 열이고,
 * 팀 화면에서는 폭 전체라 두 열이다 — 뷰포트가 아니라 **제 칸의 폭**을 보므로 어느 화면에
 * 놓이든 이름과 건수 사이가 벌어지지 않는다. 12칸을 혼자 쓰면서 그 사이가 화면 폭만큼
 * 벌어졌던 것이 이 패널을 좁힌 이유다 (`ADR-019`).
 *
 * 0건 묶음은 **한 줄**이다. 「해당 없음」을 아래 줄에 따로 두면 묶음 다섯이 열 줄이 되어,
 * 아무 문제가 없는 날 이 패널이 화면에서 가장 큰 카드가 된다.
 *
 * 종류는 **한글 라벨로 구분한다.** 아이콘을 쓰지 않는다 (`UI_GUIDE.md`「아이콘」).
 *
 * 업무명은 `titleOf`가 붙인다 — `Alert`에는 이름이 없고, 그것이 의도다 (`S6`). 서버가
 * 두 함수를 만들어 넘기므로 이 컴포넌트에 업무 배열이 통째로 딸려 들어오지 않는다.
 */

import Link from 'next/link';

import { RowChevron } from '@/components/alerts/row-chevron';
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
    <section className="border-line bg-panel @container flex flex-col rounded-md border p-4">
      {/* 설명이 제목 **옆에** 붙는다. 카드 여섯 장이 서는 화면이라 카드마다 설명 한 줄이
          20px이고, 그 스무 픽셀들이 모여 요약을 첫 화면 밖으로 밀어낸다 (`ADR-019`) */}
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-brand text-sm font-semibold">알림</h2>
        <p className="text-ink-muted text-xs">
          0건이어도 묶음은 남는다 · 누르면 상세가 열린다
        </p>
      </div>

      {/*
        * 그리드가 아니라 **단(column)** 이다. 그리드면 행 높이가 가장 긴 묶음에 맞춰지고,
        * 그 옆 묶음 아래가 통째로 빈다 — 이 패널을 좁힌 이유가 바로 그 빈 공간이었다.
        *
        * **높이 상한이 여기 있다.** 알림은 데이터가 늘면 끝없이 길어질 수 있고, 그러면 같은
        * 행의 옆 카드가 그만큼 빈 채로 늘어난다. 카드가 아니라 **목록만** 스크롤하므로
        * 제목과 「0건이어도 묶음은 남는다」는 늘 보인다. `max-h`는 옆 카드가 없을 때의
        * 상한이고, 옆에 카드가 있으면 `flex-1`이 행 높이에 맞춘다.
        *
        * `-mx-2 px-2`가 짝으로 붙은 이유: **스크롤 상자는 삐져나온 것을 자른다.** 줄의 hover
        * 배경이 `-mx-2`로 좌우 8px씩 넓어지는데, 그 8px이 이 상자의 경계 밖이라 **왼쪽만**
        * 잘려 나가 한쪽은 각지고 한쪽은 둥근 모양이 됐다. 상자를 8px 넓히고 같은 만큼 안쪽
        * 패딩을 주면 글자 위치는 그대로면서 배경이 잘릴 자리가 사라진다.
        */}
      <div className="mt-3 -mx-2 max-h-[360px] flex-1 overflow-y-auto px-2 @2xl:columns-2 @2xl:gap-x-6">
        {groups.map((group) => (
          <div key={group.kind} className="mb-3 break-inside-avoid last:mb-0">
            {/*
              * 묶음 제목은 **바탕을 깔아** 항목과 가른다. 밑줄 한 줄로는 부족했다 — 제목이
              * `text-xs`고 항목이 `text-sm`이라 오히려 항목이 더 커 보였고, 「마감 임박」이
              * 업무 이름인지 묶음 이름인지 한눈에 안 갈렸다. 항목의 hover 배경(옅은 남색)과
              * 다른 색(회색)이라 둘이 섞이지도 않는다.
              */}
            <div className="bg-raise -mx-2 flex items-baseline justify-between gap-2 rounded px-2 py-1">
              <span className="text-ink text-xs font-semibold">{group.label}</span>
              <span className="flex items-baseline gap-1.5 text-xs">
                {/* 0건에도 「해당 없음」을 남긴다 (`PLAN.md`「사용자 여정」12) — 다만 같은 줄이다 */}
                {group.items.length === 0 && <span className="text-ink-faint">해당 없음</span>}
                <span className="text-ink-muted tabular-nums">{group.items.length}건</span>
              </span>
            </div>

            {group.items.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {group.items.map((alert) => (
                  <li key={`${alert.taskId}:${alert.stageKey ?? ''}`}>
                    {/*
                     * **줄 전체가 누르는 자리다.** 이름만 링크이던 시절에는 hover하기 전까지
                     * 눌리는 줄인지 알 수 없었고(밑줄은 마우스를 올려야 나온다), 그래서 오른쪽
                     * 화살표를 정지 상태에도 남긴다. 음수 마진은 hover 배경이 카드 안쪽
                     * 여백까지 자연스럽게 닿게 한다.
                     */}
                    <Link
                      href={hrefOf(alert.taskId)}
                      className="group/row hover:bg-brand-soft -mx-2 flex items-center justify-between gap-2 rounded px-2 py-1"
                    >
                      <span className="text-ink-body group-hover/row:text-brand truncate text-sm">
                        {titleOf(alert.taskId)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className={`text-xs tabular-nums ${toneOf(alert.severity)}`}>
                          {alertDetail(alert)}
                        </span>
                        <span className="text-ink-faint group-hover/row:text-brand">
                          <RowChevron />
                        </span>
                      </span>
                    </Link>
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
