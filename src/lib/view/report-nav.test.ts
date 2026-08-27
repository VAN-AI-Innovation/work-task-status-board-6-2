/**
 * 주간 보고 화면의 **기간 이동 링크**. 달력 위젯을 만들지 않기로 했으므로(T9 step 5) 화면이
 * 가진 이동 수단은 이전/다음/이번 주 링크 셋뿐이고, 그 셋을 만드는 규칙이 여기 있다.
 *
 * 재는 것은 둘이다 — **어떤 주소가 나오는가**와 **언제 링크가 없어지는가.**
 */

import { describe, expect, it } from 'vitest';

import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildReportNav } from '@/lib/view/report-nav';

/** 2026-08-27은 목요일이라 그 주는 08-24(월)~08-30(일)이다 */
const TODAY = '2026-08-27';

function navFor(requested: string | null, today = TODAY) {
  return buildReportNav(resolveReportPeriod(today, requested), today);
}

describe('buildReportNav', () => {
  it('이전 주 링크는 한 주 앞의 절대 날짜다', () => {
    expect(navFor(null).prevHref).toBe('/report?week=2026-08-17');
  });

  it('이번 주를 보고 있으면 다음 주 링크가 없다', () => {
    // 미래 주는 `resolveReportPeriod`가 이번 주로 되돌린다. 링크로 두면 눌러도 제자리인
    // 「고장 난 버튼」이 되므로 아예 만들지 않는다
    expect(navFor(null).nextHref).toBeNull();
  });

  it('과거 주를 보고 있으면 다음 주 링크가 생긴다', () => {
    expect(navFor('2026-08-17').nextHref).toBe('/report?week=2026-08-24');
  });

  it('다음 주가 이번 주면 링크는 남는다 — 되돌려지지 않는 주다', () => {
    expect(navFor('2026-08-17').nextHref).toBe('/report?week=2026-08-24');
    expect(navFor('2026-08-10').nextHref).toBe('/report?week=2026-08-17');
  });

  it('이번 주를 보고 있으면 「이번 주」 링크가 없다', () => {
    expect(navFor(null).currentHref).toBeNull();
  });

  it('과거 주를 보고 있으면 「이번 주」는 쿼리 없는 주소다', () => {
    // 기본값을 URL에 싣지 않는다 — 같은 화면의 주소가 둘이면 공유된 두 링크가 같은 곳인지
    // 눌러 봐야 안다 (`dashboard-query.ts`의 같은 규율)
    expect(navFor('2026-08-17').currentHref).toBe('/report');
  });

  it('주 중간 날짜를 요청해도 링크는 주 시작 기준이다', () => {
    // `resolveReportPeriod`가 이미 월요일로 정규화한다. 여기서 다시 정규화하지 않는다
    expect(navFor('2026-08-19').prevHref).toBe('/report?week=2026-08-10');
  });

  it('형식이 틀린 요청은 이번 주로 되돌아온 뒤의 링크를 낸다', () => {
    const nav = navFor('어제');
    expect(nav.prevHref).toBe('/report?week=2026-08-17');
    expect(nav.nextHref).toBeNull();
  });

  it('기간 라벨은 시작·끝 날짜를 그대로 잇는다', () => {
    expect(navFor(null).rangeLabel).toBe('2026-08-24 ~ 2026-08-30');
    expect(navFor('2026-08-17').rangeLabel).toBe('2026-08-17 ~ 2026-08-23');
  });

  it('해가 바뀌는 경계에서도 날짜 산술이 맞는다', () => {
    // 2025-12-29(월)~2026-01-04(일). 문자열 비교가 아니라 실제 날짜 산술이어야 넘어간다
    const nav = navFor('2025-12-31', '2026-01-15');
    expect(nav.rangeLabel).toBe('2025-12-29 ~ 2026-01-04');
    expect(nav.prevHref).toBe('/report?week=2025-12-22');
    expect(nav.nextHref).toBe('/report?week=2026-01-05');
  });

  it('오늘이 주 시작일이어도 이번 주 판정이 흔들리지 않는다', () => {
    const nav = navFor(null, '2026-08-24');
    expect(nav.rangeLabel).toBe('2026-08-24 ~ 2026-08-30');
    expect(nav.nextHref).toBeNull();
    expect(nav.currentHref).toBeNull();
  });
});
