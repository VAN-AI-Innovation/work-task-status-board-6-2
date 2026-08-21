import { describe, expect, it } from 'vitest';

import { describeSync, STALE_DAYS } from '@/lib/view/sync-freshness';

const TODAY = '2026-08-22';

/** `YYYY-MM-DD`을 KST 한낮의 ISO 타임스탬프로. UTC로 저장돼도 KST 날짜가 그대로여야 한다 */
function kstNoon(ymd: string): string {
  return `${ymd}T03:00:00.000Z`;
}

describe('describeSync', () => {
  it('오늘 반영됐으면 0일이고 경고가 아니다', () => {
    expect(describeSync(kstNoon('2026-08-22'), TODAY)).toEqual({
      days: 0,
      label: '마지막 반영: 오늘',
      stale: false,
    });
  });

  it('하루 지났으면 「1일 전」이다', () => {
    expect(describeSync(kstNoon('2026-08-21'), TODAY)).toEqual({
      days: 1,
      label: '마지막 반영: 1일 전',
      stale: false,
    });
  });

  it('경계 — 상한과 같은 5일은 아직 정상이다', () => {
    const freshness = describeSync(kstNoon('2026-08-17'), TODAY);
    expect(freshness.days).toBe(STALE_DAYS);
    expect(freshness.stale).toBe(false);
  });

  it('상한을 넘긴 6일은 경고다', () => {
    const freshness = describeSync(kstNoon('2026-08-16'), TODAY);
    expect(freshness.days).toBe(6);
    expect(freshness.stale).toBe(true);
    expect(freshness.label).toBe('마지막 반영: 6일 전');
  });

  it('기록이 없으면 경고다 — 「모른다」를 「괜찮다」로 표시하지 않는다', () => {
    expect(describeSync(null, TODAY)).toEqual({
      days: null,
      label: '마지막 반영: 기록 없음',
      stale: true,
    });
  });

  it('파싱할 수 없는 문자열도 기록 없음으로 접는다', () => {
    expect(describeSync('언제였더라', TODAY)).toEqual({
      days: null,
      label: '마지막 반영: 기록 없음',
      stale: true,
    });
  });

  it('미래 타임스탬프는 「오늘」로 접는다 — 화면에 「-2일 전」이 뜨면 데이터를 의심한다', () => {
    const freshness = describeSync(kstNoon('2026-08-24'), TODAY);
    expect(freshness.days).toBe(0);
    expect(freshness.label).toBe('마지막 반영: 오늘');
    expect(freshness.stale).toBe(false);
  });

  it('KST 경계 — UTC로 전날인 시각도 KST 오늘로 읽는다 (`E4`)', () => {
    // 2026-08-21T20:00Z = 2026-08-22 05:00 KST
    expect(describeSync('2026-08-21T20:00:00.000Z', TODAY).days).toBe(0);
  });

  it('오늘 날짜가 형식에 맞지 않으면 기록 없음으로 접는다', () => {
    expect(describeSync(kstNoon('2026-08-21'), '어제').days).toBeNull();
  });

  it('현재 시각을 스스로 읽지 않는다 — 같은 인자면 항상 같은 결과다', () => {
    const first = describeSync(kstNoon('2026-08-19'), TODAY);
    const second = describeSync(kstNoon('2026-08-19'), TODAY);
    expect(first).toEqual(second);
    expect(first.days).toBe(3);
  });
});
