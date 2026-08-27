/**
 * 주간 보고 화면의 **기간 이동 링크 셋**.
 *
 * 달력 위젯도 프리셋 드롭다운도 만들지 않는다 (T9 step 5). 이 화면이 필요로 하는 이동은
 * 「한 주 앞」·「한 주 뒤」·「이번 주로」 셋뿐이고, 그 셋은 평범한 `<a href>`면 된다 —
 * 링크라서 복사해 던질 수 있고(`UC-11`), JS 없이도 동작하며, 새 상태 관리가 생기지 않는다.
 *
 * 두 가지를 여기서 못박는다.
 *
 * - **주소는 절대 날짜다** (`?week=YYYY-MM-DD`). 「지난주」 같은 상대 표현을 URL에 싣지
 *   않는다 — 어제 받은 링크가 오늘 다른 주를 열면 거짓말이다 (`report-period.ts` 머리말).
 * - **없는 링크는 만들지 않는다.** 미래 주는 `resolveReportPeriod`가 이번 주로 되돌리므로,
 *   그쪽으로 가는 링크를 두면 눌러도 제자리인 버튼이 된다. 사용자에게 그것은 고장이다
 *   (`PageShell`이 역할 전환 버튼을 감추는 것과 같은 근거 · `ADR-026`).
 *
 * `lib/view`에 있는 이유는 표시 규칙이기 때문이다. 판정이 아니다 — 어느 주를 볼 것인가는
 * 이미 `lib/domain/report-period.ts`가 정했고 여기서는 그 결과를 링크로 옮긴다.
 */

import { addDays } from '@/lib/domain/kst-today';
import type { ReportPeriod } from '@/lib/domain/report-period';

/** 이 화면이 돌아올 자리. 링크가 전부 여기서 시작한다 */
const PATHNAME = '/report';

export interface ReportNav {
  /** 한 주 앞. 과거에는 하한이 없으므로 **항상 있다** (`report-period.ts`) */
  prevHref: string;
  /** 한 주 뒤. 그 주가 아직 오지 않았으면 `null` — 링크를 만들지 않는다 */
  nextHref: string | null;
  /** 이번 주로. 이미 이번 주면 `null` */
  currentHref: string | null;
  /** 사람이 읽는 기간 (`2026-08-24 ~ 2026-08-30`) */
  rangeLabel: string;
}

function weekHref(weekStart: string): string {
  return `${PATHNAME}?week=${weekStart}`;
}

/**
 * @param period `resolveReportPeriod`가 낸 값. 주 시작은 이미 월요일로 정규화돼 있다
 * @param todayYmd KST 오늘. 「다음 주가 미래인가」를 재는 데만 쓴다
 */
export function buildReportNav(period: ReportPeriod, todayYmd: string): ReportNav {
  const prev = addDays(period.weekStart, -7);
  const next = addDays(period.weekStart, 7);

  /*
   * `weekStart`는 `startOfWeek`가 낸 값이라 `addDays`가 `null`을 낼 수 없다. 그래도 좁히는
   * 것은 타입 때문이고, 폴백은 **제자리**다 — 없는 주소를 지어내는 것보다 낫다.
   */
  const prevHref = weekHref(prev ?? period.weekStart);

  /*
   * 다음 주 시작이 오늘보다 뒤면 아직 오지 않은 주다. 오늘이 그 주에 속하면(즉 다음 주
   * 시작이 오늘 이하) 그 주는 열 수 있다 — 「이번 주」가 정확히 그 경우다.
   */
  const nextHref = next === null || next > todayYmd ? null : weekHref(next);

  /*
   * 다음 주가 없다는 것은 곧 **지금 보는 주가 이번 주**라는 뜻이다(요청은 미래로 갈 수
   * 없으므로 `period.weekStart ≤ 이번 주`다). 그때는 「이번 주」 링크도 제자리라 없앤다.
   *
   * 기본값(이번 주)은 URL에 싣지 않는다. 같은 화면의 주소가 둘이면 공유된 두 링크가 같은
   * 곳인지 눌러 봐야 안다 (`dashboard-query.ts`의 「기본값은 싣지 않는다」와 같은 규율).
   */
  const currentHref = nextHref === null ? null : PATHNAME;

  return {
    prevHref,
    nextHref,
    currentHref,
    rangeLabel: `${period.weekStart} ~ ${period.weekEnd}`,
  };
}
