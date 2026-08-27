/**
 * 주간 보고가 볼 **기간 하나**를 정한다 (`PLAN.md`「T9 착수 시 확정」결정 M).
 *
 * 규칙 넷.
 * - **시계를 부르지 않는다.** KST 오늘은 `kst-today.ts`가 내고 여기서는 인자로 받는다
 *   (CLAUDE.md CRITICAL). 날짜에 따라 깨지는 테스트를 만들지 않는다.
 * - **화면이 주는 것은 절대 날짜다** (`?week=YYYY-MM-DD`). 「몇 주 전」이 아니다 — 링크는
 *   「이거 봐」 하고 던지는 물건이라(`UC-11`), 어제 받은 링크가 오늘 다른 주를 열면 거짓말이다.
 *   값은 그 주의 아무 날이어도 되고 여기서 주 시작으로 정규화한다.
 * - **하드 실패시키지 않는다.** 형식 오류·미래 주는 이번 주로 되돌리고 `fellBack`으로
 *   알린다. 오타 하나로 보고서가 통째로 안 뜨면 사용자는 URL이 아니라 도구를 의심한다.
 * - **`since`·`until`은 `TaskEventFilter`에 그대로 넘어간다.** 경계 규칙은 그쪽 계약과 같다 —
 *   `since`는 포함, `until`은 제외라 이어 붙인 두 주가 같은 이벤트를 두 번 세지 않는다.
 */

import { addDays, startOfWeek } from '@/lib/domain/kst-today';

export interface ReportPeriod {
  /** 주 시작일 (KST, `YYYY-MM-DD`). 주는 월요일에 시작한다 */
  weekStart: string;
  /** 주 종료일 (KST, `YYYY-MM-DD`). 사람이 읽는 값이다 */
  weekEnd: string;
  /** `listEvents`에 그대로 넘기는 값. **포함**(`>=`) */
  since: string;
  /** `listEvents`에 그대로 넘기는 값. **제외**(`<`) */
  until: string;
  /** 요청이 이상해서 이번 주로 되돌렸으면 true. 요청이 아예 없었으면 false다 */
  fellBack: boolean;
}

type Week = Omit<ReportPeriod, 'fellBack'>;

/** 그 날의 KST 자정. 오프셋을 문자열에 남긴다 — `Z`로 바꿔 적으면 하루가 어긋난다 (`E4`) */
function kstMidnight(ymd: string): string {
  return `${ymd}T00:00:00+09:00`;
}

/** `YYYY-MM-DD`가 속한 주. 형식이 아니거나 실재하지 않는 날짜면 null이다 */
function weekOf(ymd: string): Week | null {
  const weekStart = startOfWeek(ymd);
  if (weekStart === null) return null;

  const weekEnd = addDays(weekStart, 6);
  const nextWeekStart = addDays(weekStart, 7);
  // `startOfWeek`가 낸 값이라 실제로는 일어나지 않는다. 타입을 좁히는 자리다
  if (weekEnd === null || nextWeekStart === null) return null;

  return {
    weekStart,
    weekEnd,
    since: kstMidnight(weekStart),
    until: kstMidnight(nextWeekStart),
  };
}

/**
 * @param todayYmd KST 오늘 (`kstToday`가 낸 값). 이 함수는 시계를 부르지 않는다
 * @param requested 화면이 준 주의 아무 날. `null`·빈 값·형식 오류·미래 주는 이번 주로 되돌린다
 */
export function resolveReportPeriod(todayYmd: string, requested: string | null): ReportPeriod {
  const current = weekOf(todayYmd);
  if (current === null) {
    // 사용자 입력이 아니라 호출자 버그다. 되돌릴 「이번 주」가 없으므로 감출 수 없다
    throw new TypeError(`resolveReportPeriod: todayYmd가 YYYY-MM-DD가 아니다 (${todayYmd})`);
  }

  // 요청이 없는 것은 되돌린 것이 아니라 기본값이다. 둘을 같게 말하면 사용자가 오타를 찾는다
  if (requested === null) return { ...current, fellBack: false };

  const asked = weekOf(requested);
  if (asked === null) return { ...current, fellBack: true };

  // 과거에는 하한을 두지 않는다. 아직 오지 않은 주만 되돌린다
  if (asked.weekStart > current.weekStart) return { ...current, fellBack: true };

  return { ...asked, fellBack: false };
}
