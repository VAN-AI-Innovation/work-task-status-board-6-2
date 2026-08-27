/**
 * 이 파일이 지키는 축은 넷이다.
 *
 * 1. **시계를 부르지 않는가.** 오늘은 인자로 온다. 모킹 없이 단언이 서야 한다
 *    (CLAUDE.md CRITICAL). 시각을 모킹해야 도는 테스트는 판정을 못 믿는다.
 * 2. **되돌리되 던지지 않는가.** 오타 하나로 보고서가 통째로 안 뜨면 사용자는 URL이 아니라
 *    도구를 의심한다 (`PLAN.md` 결정 M).
 * 3. **경계가 겹치지 않는가.** 이어 붙인 두 주가 같은 이벤트를 두 번 세면 「이번 주 변경」이
 *    부풀려진다. `since`는 포함이고 `until`은 제외다 (step 1의 `TaskEventFilter` 계약).
 * 4. **과거에 하한이 없는가.** 요청받지 않은 제약을 두지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { resolveReportPeriod } from '@/lib/domain/report-period';
import { matchesTaskEventFilter } from '@/lib/store/task-repository';
import type { TaskEvent } from '@/types/task';

/** 2026-07-25는 **토요일**이다 — 그 주는 월요일 07-20 ~ 일요일 07-26 */
const TODAY = '2026-07-25';

function event(occurredAt: string): TaskEvent {
  return { id: 'e1', taskId: 't1', uploadId: null, changedFields: ['status'], occurredAt };
}

describe('기본값 — 요청이 없을 때', () => {
  it('이번 주를 낸다', () => {
    const period = resolveReportPeriod(TODAY, null);

    expect(period.weekStart).toBe('2026-07-20');
    expect(period.weekEnd).toBe('2026-07-26');
  });

  it('되돌린 것이 아니므로 fellBack이 false다', () => {
    // 「요청이 없었다」와 「요청이 틀렸다」는 다른 사실이다. 화면이 둘을 같게 말하면
    // 사용자는 자기가 뭘 잘못 쳤는지 찾게 된다
    expect(resolveReportPeriod(TODAY, null).fellBack).toBe(false);
  });

  it('오늘이 월요일이어도 일요일이어도 같은 주를 연다', () => {
    const monday = resolveReportPeriod('2026-07-20', null);
    const sunday = resolveReportPeriod('2026-07-26', null);

    expect(monday).toEqual(sunday);
  });
});

describe('정규화 — 주 중간 날짜', () => {
  it('그 주의 월요일로 옮긴다', () => {
    const period = resolveReportPeriod(TODAY, '2026-07-08'); // 수요일

    expect(period.weekStart).toBe('2026-07-06');
    expect(period.weekEnd).toBe('2026-07-12');
    expect(period.fellBack).toBe(false);
  });

  it('같은 주의 어느 날을 줘도 같은 기간이 나온다', () => {
    const fromMonday = resolveReportPeriod(TODAY, '2026-07-06');
    const fromSunday = resolveReportPeriod(TODAY, '2026-07-12');

    expect(fromSunday).toEqual(fromMonday);
  });
});

describe('되돌림 — 하드 실패시키지 않는다', () => {
  it.each([
    ['실재하지 않는 날짜', '2026-13-45'],
    ['날짜가 아닌 말', '어제'],
    ['빈 문자열', ''],
    ['형식만 비슷한 값', '2026-07'],
    ['타임스탬프', '2026-07-08T00:00:00Z'],
  ])('%s이면 이번 주로 되돌리고 fellBack을 남긴다', (_label, requested) => {
    const period = resolveReportPeriod(TODAY, requested);

    expect(period.weekStart).toBe('2026-07-20');
    expect(period.fellBack).toBe(true);
  });

  it('미래 주는 되돌린다', () => {
    const period = resolveReportPeriod(TODAY, '2026-07-27'); // 다음 주 월요일

    expect(period.weekStart).toBe('2026-07-20');
    expect(period.fellBack).toBe(true);
  });

  it('이번 주 안의 미래 날짜는 되돌리지 않는다 — 같은 주이기 때문이다', () => {
    const period = resolveReportPeriod(TODAY, '2026-07-26'); // 오늘보다 뒤지만 같은 주

    expect(period.weekStart).toBe('2026-07-20');
    expect(period.fellBack).toBe(false);
  });

  it('어떤 입력에도 예외를 던지지 않는다', () => {
    expect(() => resolveReportPeriod(TODAY, ' |')).not.toThrow();
  });
});

describe('과거에 하한을 두지 않는다', () => {
  it('1년 전 주도 그대로 연다', () => {
    const period = resolveReportPeriod(TODAY, '2025-07-23');

    expect(period.weekStart).toBe('2025-07-21');
    expect(period.fellBack).toBe(false);
  });

  it('아주 오래된 주도 되돌리지 않는다', () => {
    expect(resolveReportPeriod(TODAY, '2019-01-05').fellBack).toBe(false);
  });
});

describe('listEvents 경계 — 이어 붙인 두 주가 같은 이벤트를 두 번 세지 않는다', () => {
  const first = resolveReportPeriod(TODAY, '2026-07-13');
  const second = resolveReportPeriod(TODAY, '2026-07-20');

  it('앞 주의 until과 뒤 주의 since가 같은 순간이다', () => {
    expect(Date.parse(first.until)).toBe(Date.parse(second.since));
  });

  it('경계의 이벤트는 뒤 주에만 들어간다 — since는 포함, until은 제외다', () => {
    // 2026-07-20 00:00 KST = 두 주가 맞닿는 순간
    const boundary = event('2026-07-20T00:00:00+09:00');

    expect(matchesTaskEventFilter(boundary, first)).toBe(false);
    expect(matchesTaskEventFilter(boundary, second)).toBe(true);
  });

  it('경계 1ms 전은 앞 주에만 들어간다', () => {
    const justBefore = event('2026-07-19T23:59:59.999+09:00');

    expect(matchesTaskEventFilter(justBefore, first)).toBe(true);
    expect(matchesTaskEventFilter(justBefore, second)).toBe(false);
  });

  it('주 시작·끝의 이벤트가 그 주에 들어간다', () => {
    expect(matchesTaskEventFilter(event('2026-07-20T00:00:00+09:00'), second)).toBe(true);
    expect(matchesTaskEventFilter(event('2026-07-26T23:59:59+09:00'), second)).toBe(true);
  });

  it('표기가 달라도 같은 순간이면 같게 판정한다 — 문자열이 아니라 시각을 비교한다', () => {
    // 2026-07-19T15:00:00Z = 2026-07-20T00:00:00+09:00
    expect(matchesTaskEventFilter(event('2026-07-19T15:00:00Z'), second)).toBe(true);
    expect(matchesTaskEventFilter(event('2026-07-19T15:00:00Z'), first)).toBe(false);
  });

  it('경계가 KST 자정이다 — 서버 TZ가 UTC여도 하루가 어긋나지 않는다 (`E4`)', () => {
    expect(second.since).toBe('2026-07-20T00:00:00+09:00');
    expect(second.until).toBe('2026-07-27T00:00:00+09:00');
  });
});

describe('시계를 부르지 않는다', () => {
  it('같은 인자로 두 번 부르면 같은 값이다', () => {
    expect(resolveReportPeriod(TODAY, '2026-07-08')).toEqual(
      resolveReportPeriod(TODAY, '2026-07-08')
    );
  });

  it('오늘이 달라지면 기본값만 따라 움직인다', () => {
    // 요청이 있으면 오늘과 무관하다 — 어제 받은 링크가 오늘 다른 주를 열면 안 된다 (결정 M)
    expect(resolveReportPeriod('2026-08-27', '2026-07-08').weekStart).toBe('2026-07-06');
    expect(resolveReportPeriod('2026-08-27', null).weekStart).toBe('2026-08-24');
  });
});
