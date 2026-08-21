/**
 * 이 파일이 지키는 것은 하나다 — **`0`은 `—`가 아니다.** 화면에서 가장 흔한 실수라
 * 모든 포맷터에 그 케이스를 넣는다. `null`(셀 것이 없어 계산되지 않음)과 `0`(세어 보니 0)은
 * 다른 사실이고, 둘을 뭉개면 대시보드가 거짓말을 한다.
 */

import { describe, expect, it } from 'vitest';

import { formatCount, formatDate, formatDday, formatKpi, formatPercent } from '@/lib/view/kpi-format';

describe('formatCount', () => {
  it('null은 —, 0은 0이다', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });

  it('천 단위 구분자를 넣는다 — 실행 환경의 로케일에 기대지 않는다', () => {
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('음수도 부호를 잃지 않는다', () => {
    expect(formatCount(-1234)).toBe('-1,234');
  });
});

describe('formatPercent', () => {
  it('null은 —, 0은 0%다 — 모수가 없는 것과 0%는 다른 사실이다', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0)).toBe('0%');
  });

  it('정수 + %', () => {
    expect(formatPercent(66)).toBe('66%');
    expect(formatPercent(120)).toBe('120%');
  });
});

describe('formatKpi', () => {
  it('unit에 따라 갈린다', () => {
    expect(formatKpi({ key: 'a', label: 'a', value: 1200, unit: 'count' })).toBe('1,200');
    expect(formatKpi({ key: 'b', label: 'b', value: 0, unit: 'percent' })).toBe('0%');
    expect(formatKpi({ key: 'c', label: 'c', value: null, unit: 'percent' })).toBe('—');
  });
});

describe('formatDday', () => {
  it('남았으면 D-, 오늘이면 D-DAY, 지났으면 D+', () => {
    expect(formatDday(3)).toBe('D-3');
    expect(formatDday(0)).toBe('D-DAY');
    expect(formatDday(-2)).toBe('D+2');
  });

  it('마감일이 없으면 일수를 말할 수 없다', () => {
    expect(formatDday(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('YYYY-MM-DD를 그대로 둔다 — 표기를 바꾸면 시트와 대조할 수 없다', () => {
    expect(formatDate('2026-08-22')).toBe('2026-08-22');
  });

  it('null과 빈 문자열은 —', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});
