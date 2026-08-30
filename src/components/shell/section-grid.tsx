/**
 * 12열 그리드에 섹션을 깔고, `detail` zone은 `<details>`로 접는다 (`ADR-019`).
 *
 * **행과 칸을 만드는 것은 `layoutFor`이고 이 컴포넌트는 그리기만 한다** — 대시보드와 팀
 * 화면이 같은 배치 규칙을 쓰게 하려고 한곳에 뒀다. 화면마다 복사하면 한쪽만 고쳐지는 날이
 * 오고, 그날부터 두 화면의 카드 폭이 다른 이유를 아무도 설명하지 못한다.
 *
 * 칸 하나에 섹션이 **여럿일 수 있다**(`cell.keys`). 세로로 쌓아서 옆 칸의 높이를 채우는
 * 자리이며, 팀 화면의 「상태 분포 + 목표 대비 성과」가 그 경우다.
 */

import type { ReactNode } from 'react';

import {
  DETAIL_LABELS,
  FIXED_HEIGHT,
  SECTION_ZONE,
  type LayoutRow,
  type SectionKey,
} from '@/lib/view/role-layout';

/**
 * `col-span-*`은 **문자열을 조립해 만들 수 없다.** Tailwind는 소스를 훑어 클래스를 만들므로
 * `` `col-span-${n}` ``은 CSS가 생성되지 않아 그 칸이 통째로 12칸이 된다 — 화면에서만 보이고
 * 타입 검사에는 걸리지 않는 종류의 사고다. 폭은 `SECTION_SPAN`이 정하고 클래스는 여기 리터럴이다.
 */
const SPAN_CLASS: Readonly<Record<number, string>> = {
  4: 'col-span-4',
  5: 'col-span-5',
  6: 'col-span-6',
  7: 'col-span-7',
  12: 'col-span-12',
};

export function SectionGrid({
  rows,
  render,
  hint,
}: {
  rows: LayoutRow[];
  /** 섹션 하나를 그린다. 이 화면에 없는 섹션이면 `null` */
  render: (key: SectionKey) => ReactNode;
  /** 접힌 줄 오른쪽에 적을 한 조각 (「지표 4개」처럼) */
  hint: (key: SectionKey) => string;
}) {
  /** 접히는 섹션 하나. 제목 줄은 접혀도 남는다 — 접힌 것과 없는 것이 같아 보이면 안 된다 */
  const renderDetail = (key: SectionKey, className: string): ReactNode => (
    <details key={key} className={`${className} group`}>
      <summary className="border-line bg-panel text-brand hover:border-brand hover:bg-brand-soft flex cursor-pointer list-none items-baseline justify-between gap-3 rounded-md border px-4 py-2 text-sm font-semibold group-open:rounded-b-none">
        <span>
          <span className="text-ink-muted mr-1.5 inline-block group-open:rotate-90">▸</span>
          {DETAIL_LABELS[key]}
        </span>
        <span className="text-ink-muted text-xs font-normal tabular-nums">{hint(key)}</span>
      </summary>
      {/* 카드는 섹션 컴포넌트가 이미 들고 있다. 제목이 두 번 뜨지 않도록 펼친 카드의
          제목만 숨긴다 — 읽어 주는 것은 요약 줄이 한다.

          요약 줄과 카드 **사이를 띄우지 않는다.** 둘 사이에 여백과 테두리가 두 겹 들어가면
          펼친 내용이 요약 줄에 딸린 것이 아니라 그 아래 놓인 별개 카드로 읽힌다. 위쪽
          모서리와 테두리를 지워 요약 줄에 이어 붙인다 */}
      {/*
       * 제목 숨김은 **자손 선택자**여야 한다. `>section>h2`로 두었더니 제목을 `<div>`로 한 번
       * 감싼 카드(승인 대기함)에서 빗나가, 펼치면 그 제목이 요약 줄과
       * 카드에 두 번 떴다. 접히는 카드 둘 다 `h2`는 하나씩이라 자손으로 잡아도 안전하다.
       */}
      <div className="[&>section]:rounded-t-none [&>section]:border-t-0 [&>section_h2]:sr-only">
        {render(key)}
      </div>
    </details>
  );

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        /*
         * **사용자가 높이를 바꿀 수 있는 칸이 있으면 행을 늘여 맞추지 않는다.**
         * `items-stretch`는 카드 테두리를 맞춰 주지만, 접힌 카드를 펼치는 순간 그 칸이
         * 길어지면서 **옆 칸까지 끌고 간다** — 목표 대비 성과를 펼쳤더니 알림 아래가
         * 통째로 비는 일이 그것이다. 접힘이 없는 행에서만 높이를 맞춘다.
         */
        const adjustable = row.cells.some((cell) =>
          cell.keys.some((key) => SECTION_ZONE[key] === 'detail')
        );

        return (
          // 행의 정체성은 「어느 zone의 무엇이 들어 있나」다. 인덱스를 키로 쓰면 역할이 바뀔 때
          // React가 다른 섹션을 같은 자리로 착각한다. zone을 앞에 붙이는 것은 칸이 하나뿐인
          // 행의 키가 섹션 키와 같아지지 않게 하려는 것이다
          <div
            key={`${row.zone}:${row.cells.flatMap((cell) => cell.keys).join('+')}`}
            className={`grid grid-cols-12 gap-4 ${adjustable ? 'items-start' : 'items-stretch'}`}
          >
            {row.cells.map((cell) =>
              /*
               * 섹션 하나짜리 칸은 그 섹션이 곧 칸이다. **같은 행의 카드는 높이를 맞추고**
               * (`items-stretch`), 늘어난 높이는 카드가 콘텐츠로 채운다(`h-full`) — 차트는
               * 남는 세로를 먹고, 알림은 목록이 길어지면 그 안에서 스크롤한다.
               */
              cell.keys.length === 1 && SECTION_ZONE[cell.keys[0]!] === 'detail' ? (
                /*
                 * **펼쳐도 폭은 그대로다.** 예전에는 `open:col-span-12`로 12칸까지 넓혔는데,
                 * 나란히 접혀 있다가 하나만 갑자기 폭 전체를 차지하면 옆엣것이 아래로
                 * 밀려나 화면이 통째로 재배치된 것처럼 보인다. 가로로 세운 이상 **자기
                 * 폭 안에서 아래로 자라는 것**이 눈이 따라가기 쉽다. 좁은 칸에서 넘치는
                 * 표·마크다운은 각자 가로 스크롤을 들고 있다.
                 */
                renderDetail(cell.keys[0]!, SPAN_CLASS[cell.span]!)
              ) : (
                // 칸의 키는 섹션 키와 겹치면 안 된다. 겹치면 트리에 같은 키가 두 번 생기고,
                // 화면이 그린 순서를 키로 재는 테스트가 섹션을 두 번 센다
                <div
                  key={`cell:${cell.keys.join('+')}`}
                  className={`${SPAN_CLASS[cell.span]} flex flex-col gap-4`}
                >
                  {cell.keys.map((key) =>
                    SECTION_ZONE[key] === 'detail' ? (
                      // 쌓인 칸 안에서는 폭이 칸에 매여 있다 — 펼쳐도 넓어지지 않는다
                      renderDetail(key, 'shrink-0')
                    ) : (
                      // KPI 타일·알림은 옆 카드 높이를 따라 늘어나면 안 된다 (`FIXED_HEIGHT`) —
                      // 남는 세로는 같이 쌓인 차트가 먹는다
                      <div
                        key={key}
                        className={
                          FIXED_HEIGHT.includes(key)
                            ? 'shrink-0'
                            : 'flex flex-1 flex-col [&>section]:h-full'
                        }
                      >
                        {render(key)}
                      </div>
                    )
                  )}
                </div>
              )
            )}
            </div>
        );
      })}
    </div>
  );
}
