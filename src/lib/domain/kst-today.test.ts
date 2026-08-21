/**
 * 날짜 계산은 뒤의 모든 판정(지연·마감 임박·장기 미갱신·D-DAY)이 딛고 선다.
 * 여기서 하루가 밀리면 전 화면이 하루씩 밀린다 (PLAN.md E4).
 */
import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysBetween,
  endOfWeek,
  kstDateOf,
  kstToday,
  startOfWeek,
} from '@/lib/domain/kst-today';

describe('kstToday', () => {
  it('UTC와 KST가 같은 날인 시각을 그 날짜로 환산한다', () => {
    expect(kstToday(new Date('2026-08-18T14:30:00Z'))).toBe('2026-08-18');
  });

  it('UTC로는 전날인 시각을 KST 기준 다음 날로 환산한다', () => {
    // UTC 8/17 15:30 = KST 8/18 00:30. 이 케이스가 없으면 시간대 처리가 검증되지 않는다
    expect(kstToday(new Date('2026-08-17T15:30:00Z'))).toBe('2026-08-18');
  });

  it('KST 오전(UTC 00:30)에도 같은 날을 유지한다', () => {
    expect(kstToday(new Date('2026-08-18T00:30:00Z'))).toBe('2026-08-18');
  });
});

describe('kstDateOf', () => {
  it('ISO 타임스탬프를 KST 날짜로 환산한다', () => {
    expect(kstDateOf('2026-08-17T15:30:00Z')).toBe('2026-08-18');
  });

  it('null과 파싱 불가 문자열은 null이다', () => {
    expect(kstDateOf(null)).toBeNull();
    expect(kstDateOf('')).toBeNull();
    expect(kstDateOf('abc')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('앞뒤 방향과 같은 날을 구분한다', () => {
    expect(daysBetween('2026-08-18', '2026-08-21')).toBe(3);
    expect(daysBetween('2026-08-21', '2026-08-18')).toBe(-3);
    expect(daysBetween('2026-08-18', '2026-08-18')).toBe(0);
  });

  it('평년 2월 말을 건너뛴다', () => {
    // 2026년은 윤년이 아니다
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('윤년 2월 말을 건너뛴다', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('형식이 아닌 입력은 null이다', () => {
    expect(daysBetween('2026.08.18', '2026-08-21')).toBeNull();
    expect(daysBetween('2026-08-18', '')).toBeNull();
    expect(daysBetween('abc', 'abc')).toBeNull();
  });
});

describe('addDays', () => {
  it('해를 넘긴다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('음수로 되돌린다', () => {
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('형식이 아닌 입력은 null이다', () => {
    expect(addDays('2026.08.18', 1)).toBeNull();
    expect(addDays('', 1)).toBeNull();
    expect(addDays('abc', 1)).toBeNull();
  });
});

describe('startOfWeek · endOfWeek', () => {
  it('화요일이 속한 주는 월요일에 시작해 일요일에 끝난다', () => {
    expect(startOfWeek('2026-08-18')).toBe('2026-08-17');
    expect(endOfWeek('2026-08-18')).toBe('2026-08-23');
  });

  it('일요일이 다음 주로 넘어가지 않는다', () => {
    expect(startOfWeek('2026-08-23')).toBe('2026-08-17');
    expect(endOfWeek('2026-08-23')).toBe('2026-08-23');
  });

  it('월요일 자신은 그대로 주의 시작이다', () => {
    expect(startOfWeek('2026-08-17')).toBe('2026-08-17');
  });

  it('형식이 아닌 입력은 null이고 예외를 던지지 않는다', () => {
    expect(startOfWeek('2026.08.18')).toBeNull();
    expect(startOfWeek('')).toBeNull();
    expect(endOfWeek('abc')).toBeNull();
  });
});
