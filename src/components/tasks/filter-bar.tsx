'use client';

/**
 * 필터 바. **화면 상태를 여기에 들지 않는다** — 칩은 전부 `<Link>`이고 입력은 URL로 이동한다.
 * 이유는 링크 공유(`UC-11`)와 뒤로 가기다. `useState`로 필터를 들면 사용자가 복사해 준 URL이
 * 상대 화면에서 다른 결과를 내고, 뒤로 가기가 필터를 되돌리지 않는다.
 *
 * 입력(담당자·마감 범위·검색)은 **Enter(form submit)에서만** 이동한다. 타이핑 한 글자마다
 * 서버 컴포넌트를 다시 그리면 응답이 오는 사이 입력이 밀려 글자를 놓친다 (`SearchBox`와 같다).
 * 값을 상태로 들지 않으므로 `key`를 현재 URL 값으로 두어, 밖에서 URL이 바뀌면 입력이 다시
 * 태어나게 한다.
 *
 * **적용 중인 필터 개수를 늘 보여 준다.** 필터가 걸린 줄 모르고 「데이터가 없다」고 오해하는
 * 것이 이 화면의 가장 흔한 사고다 (`X3`).
 *
 * 그래서 바는 **접어 두되 걸린 개수는 접어도 남는다.** 칩 열여섯이 표 위에 펼쳐져 있으면
 * 화면이 실제보다 복잡해 보이고, 정작 읽어야 할 업무 표가 아래로 밀린다. 접는 것은 **입력
 * 수단**이지 적용 상태가 아니다 — 그 개수는 여는 버튼의 **배지**가 진다. 문장 한 줄을 따로
 * 두지 않는 것은 배지가 같은 사실을 더 짧게, 더 눈에 띄게 말하기 때문이다.
 *
 * **필터가 하나라도 걸려 있으면 펼친 채로 시작한다.** 링크로 받은 필터가 접혀 있으면 무엇이
 * 걸렸는지 눌러 봐야 알고 되돌릴 링크도 그 안에 있다. 여닫은 뒤에는 사용자가 정한 상태를
 * 따른다 — 필터를 다 지웠다고 열어 둔 바가 손 밑에서 닫히면 안 된다.
 *
 * ⚠ 상태 칩은 `?display=`이고 `?status=`가 아니다. 뒤엣것은 시트 원문 문자열이라 저장소가
 * 그대로 비교한다 — 칩이 그 키를 쓰면 조용히 0건이 된다 (`dashboard-query.ts` 머리말).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { RowChevron } from '@/components/alerts/row-chevron';

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import {
  buildHref,
  countActiveFilters,
  FILTER_RESET_PATCH,
  type DashboardQuery,
} from '@/lib/view/dashboard-query';
import { teamLabel } from '@/lib/view/team-slug';
import type { DisplayStatus } from '@/types/task';

const CHIP_ON = 'rounded-full bg-brand text-canvas px-3 py-1 text-xs';
const CHIP_OFF =
  'rounded-full border border-line px-3 py-1 text-xs text-ink-muted hover:border-brand hover:text-brand';
const INPUT =
  'border-line bg-canvas text-ink placeholder:text-ink-faint focus:border-brand rounded border px-3 py-1.5 text-sm focus:outline-none';

const DISPLAY_KEYS = Object.keys(DISPLAY_STATUS_LABELS) as DisplayStatus[];

/** 켜져 있으면 끄고, 꺼져 있으면 켠다. 빈 배열은 `null`이라 링크에서 키가 사라진다 */
function toggled<T>(values: readonly T[], value: T): T[] | null {
  const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return next.length === 0 ? null : next;
}

/** 빈 입력은 「그 필터를 지운다」다 */
function submitted(data: FormData, key: string): string | null {
  const raw = data.get(key);
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  return trimmed === '' ? null : trimmed;
}

/**
 * `showTeamChips`가 꺼지는 자리는 부서별 탭이다 — 경로가 이미 팀을 정했으므로 칩이 그것을
 * 다시 물으면 「어느 쪽이 이기는가」를 사용자가 눌러 보고 알아내야 한다.
 */
export function FilterBar({
  query,
  pathname,
  showTeamChips = true,
}: {
  query: DashboardQuery;
  pathname: string;
  showTeamChips?: boolean;
}) {
  const router = useRouter();
  const active = countActiveFilters(query);
  /*
   * 첫 상태만 필터 유무가 정하고 그 뒤로는 사용자가 정한다. 매 렌더 `active > 0`으로 두면
   * 필터를 다 지우는 순간 열어 둔 바가 닫힌다.
   */
  const [open, setOpen] = useState(active > 0);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-line group border-b pb-4"
    >
      {/*
       * 접어도 남는 줄. 여기 적힌 것은 **적용 상태**이고 접히는 것은 입력 수단뿐이다.
       *
       * 여는 자리를 **버튼 모양으로 오른쪽에 세운다.** 글자만 있던 시절에는 이 줄이 표
       * 위의 설명문과 구분되지 않아 눌리는 자리인 줄 몰랐다. 테두리가 있으면 누를 것이라는
       * 사실이 hover 전에 보인다.
       */}
      <summary className="flex cursor-pointer list-none items-center justify-end">
        <span className="border-line text-ink-muted hover:border-brand hover:text-brand group-open:border-brand group-open:bg-brand-soft group-open:text-brand inline-flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-xs">
          필터
          {/*
           * 걸린 개수는 배지가 진다. **필터가 걸린 줄 모르는 것이 이 화면의 가장 흔한
           * 사고이므로**(`X3`) 접힌 채로도 보여야 하고, 문장 한 줄보다 배지가 먼저 눈에 든다
           */}
          {active > 0 && (
            <span className="bg-brand text-canvas rounded-full px-1.5 tabular-nums">{active}</span>
          )}
          {/* 오른쪽 화살표를 아래로 눕히고, 펼치면 위를 본다 */}
          <span className="inline-block rotate-90 group-open:-rotate-90">
            <RowChevron />
          </span>
        </span>
      </summary>

      <div className="mt-3 space-y-3">
        {showTeamChips && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-muted w-16 text-xs">팀</span>
            {TEAM_KEYS.map((teamKey) => (
              <Link
                key={teamKey}
                href={buildHref(pathname, query, { team: toggled(query.team, teamKey) })}
                aria-pressed={query.team.includes(teamKey)}
                className={query.team.includes(teamKey) ? CHIP_ON : CHIP_OFF}
              >
                {teamLabel(teamKey)}
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-muted w-16 text-xs">상태</span>
          {DISPLAY_KEYS.map((status) => (
            <Link
              key={status}
              href={buildHref(pathname, query, { display: toggled(query.display, status) })}
              aria-pressed={query.display.includes(status)}
              className={query.display.includes(status) ? CHIP_ON : CHIP_OFF}
            >
              {DISPLAY_STATUS_LABELS[status]}
            </Link>
          ))}
          {/*
           * 「지연만」은 `?display=overdue` 칩과 다른 축이다. 앞은 저장소를 거친 목록에
           * `buildReadContext`가 거는 판정 필터라, 지연이 아닌 건은 애초에 조회되지 않는다.
           */}
          <Link
            href={buildHref(pathname, query, { overdue: query.overdue ? null : true })}
            aria-pressed={query.overdue}
            className={query.overdue ? CHIP_ON : CHIP_OFF}
          >
            지연만
          </Link>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            router.push(
              buildHref(pathname, query, {
                owner: submitted(data, 'owner'),
                dueFrom: submitted(data, 'dueFrom'),
                dueTo: submitted(data, 'dueTo'),
                search: submitted(data, 'search'),
              })
            );
          }}
        >
          <span className="text-ink-muted w-16 text-xs">조건</span>
          <label className="sr-only" htmlFor="filter-owner">
            담당자
          </label>
          <input
            key={`owner:${query.owner ?? ''}`}
            id="filter-owner"
            name="owner"
            defaultValue={query.owner ?? ''}
            placeholder="담당자"
            className={`${INPUT} w-32`}
          />
          <label className="sr-only" htmlFor="filter-due-from">
            마감 시작
          </label>
          <input
            key={`dueFrom:${query.dueFrom ?? ''}`}
            id="filter-due-from"
            name="dueFrom"
            type="date"
            defaultValue={query.dueFrom ?? ''}
            className={`${INPUT} tabular-nums`}
          />
          <span className="text-ink-faint text-xs">~</span>
          <label className="sr-only" htmlFor="filter-due-to">
            마감 종료
          </label>
          <input
            key={`dueTo:${query.dueTo ?? ''}`}
            id="filter-due-to"
            name="dueTo"
            type="date"
            defaultValue={query.dueTo ?? ''}
            className={`${INPUT} tabular-nums`}
          />
          {/* 상단 바 검색과 같은 `?search=`에 묶인다. 상태는 URL 하나뿐이라 둘이 갈라지지 않는다 */}
          <label className="sr-only" htmlFor="filter-search">
            검색
          </label>
          <input
            key={`search:${query.search ?? ''}`}
            id="filter-search"
            name="search"
            type="search"
            defaultValue={query.search ?? ''}
            placeholder="업무명·비고 검색"
            className={`${INPUT} w-44`}
          />
          {/* 이 줄에서 사용자가 누르는 유일한 확정 버튼이다 — 기본 버튼(남색)으로 세운다 */}
          <button
            type="submit"
            className="bg-brand text-canvas hover:bg-brand-strong rounded px-4 py-1.5 text-sm"
          >
            적용
          </button>
        </form>

        {/*
         * 초기화 링크는 **요약 줄이 아니라 본문에 둔다.** `<summary>` 안의 링크는 눌렀을 때
         * 이동과 여닫기가 함께 일어나 되돌린 순간 바가 닫힌다. 필터가 걸린 화면은 어차피
         * 펼친 채로 시작하므로 이 링크는 그때 바로 보인다.
         */}
        {active > 0 && (
          <Link
            href={buildHref(pathname, query, FILTER_RESET_PATCH)}
            className="text-ink-muted hover:text-brand text-xs underline-offset-4 hover:underline"
          >
            필터 초기화
          </Link>
        )}
      </div>
    </details>
  );
}
