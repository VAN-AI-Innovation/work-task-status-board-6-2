/**
 * 화면 한 칸(`DisplayStatus`)을 **어떤 클래스로 그릴지**만 고른다. 어느 칸인지는 이미
 * `toDisplayStatus`가 정했고 조회 응답에 실려 온다 — 화면은 다시 판정하지 않는다 (`ADR-006`).
 *
 * 컴포넌트가 아니라 `lib/`에 있는 이유: 같은 배지를 업무 표·사이드 패널(step 7)·알림
 * 패널(step 8) 셋이 쓴다. 클래스 표가 컴포넌트 안에 있으면 세 화면의 색이 서로 갈라지고,
 * 갈라진 뒤에는 어느 쪽이 맞는지 화면만 봐서는 알 수 없다.
 *
 * 두 가지를 못박는다.
 *
 * - **라벨은 `DISPLAY_STATUS_LABELS`에서 온다.** 배지는 색만으로 구분되지 않는다 —
 *   색각 이상 대응이라 한글 라벨이 늘 함께 간다 (`UI_GUIDE.md`「상태 5색 구분」).
 * - **색을 갖는 칸은 「지연」 하나뿐이다.** 나머지는 명도와 형태로만 구분한다. 완료를
 *   초록으로 칠하는 순간 화면 절반이 색을 갖고 지연 빨강이 묻힌다.
 */

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import type { DisplayStatus } from '@/types/task';

export interface BadgeStyle {
  /** `DISPLAY_STATUS_LABELS`의 한글 */
  label: string;
  /** 배지 클래스 */
  className: string;
}

/** 행 좌측 3px 붉은 보더 (`UI_GUIDE.md`「표」). 문제 하나에만 붙는다 */
const ROW_ACCENT = 'border-l-[3px] border-l-late-line';

/**
 * **칸마다의 결정이 여기 한 줄씩 모여 있다** — 배지 클래스와 행 클래스가 같은 자리에 있어야
 * 「이 칸은 색을 갖는가」를 표 하나로 대조할 수 있다.
 *
 * **이 표는 색이 아니라 의미로 적혀 있다** — `bg-ink`는 「가장 진한 것」, `bg-raise`는 「배경에
 * 가장 가까운 것」이라는 뜻이다. 그래서 톤이 라이트↔다크로 뒤집혀도 여기는 고칠 것이 없고,
 * 실제로 두 번의 전환에서 한 글자도 바뀌지 않았다 (`ADR-018`).
 */
const STYLES: Readonly<Record<DisplayStatus, { badge: string; row: string }>> = {
  planned: { badge: 'bg-raise text-ink-muted', row: '' },
  in_progress: { badge: 'bg-ink text-canvas', row: '' },
  review: { badge: 'border border-line-strong text-ink', row: '' },
  done: { badge: 'bg-panel text-ink-faint', row: '' },
  overdue: { badge: 'bg-late-bg text-late', row: ROW_ACCENT },
  muted: { badge: 'text-ink-faint', row: '' },
};

/**
 * 라벨을 표에 적어 두지 않고 도메인에서 끌어온다. 손으로 적으면 언젠가 한쪽만 고치고,
 * 그날부터 배지와 상태 분포 막대가 같은 칸을 다른 말로 부른다.
 */
export const STATUS_BADGES: Readonly<Record<DisplayStatus, BadgeStyle>> = Object.freeze(
  Object.fromEntries(
    Object.entries(STYLES).map(([status, style]) => [
      status,
      { label: DISPLAY_STATUS_LABELS[status as DisplayStatus], className: style.badge },
    ])
  ) as Record<DisplayStatus, BadgeStyle>
);

export function badgeOf(status: DisplayStatus): BadgeStyle {
  return STATUS_BADGES[status];
}

/** 지연 행에만 좌측 보더. 그 외는 빈 문자열 */
export function rowClassOf(status: DisplayStatus): string {
  return STYLES[status].row;
}
