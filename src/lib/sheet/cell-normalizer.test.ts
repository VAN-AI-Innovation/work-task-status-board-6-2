import { describe, expect, it } from 'vitest';

import {
  toDateString,
  toNumber,
  toProgress,
  toText,
  unwrapCellValue,
} from '@/lib/sheet/cell-normalizer';
import type { SheetCellValue } from '@/types/sheet';

/** 엑셀 시리얼을 exceljs가 만들어주는 UTC Date로 (1899-12-30 기준) */
const serialAsDate = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86400000);

describe('unwrapCellValue — 셀 형태 8종 (T2 완료 기준 4)', () => {
  it('null과 undefined는 값 없음이고 경고도 없다', () => {
    expect(unwrapCellValue(null)).toEqual({ value: null, warning: null, hyperlink: null });
    expect(unwrapCellValue(undefined)).toEqual({ value: null, warning: null, hyperlink: null });
  });

  it('원시값(문자열·숫자·불리언)은 그대로 통과한다', () => {
    expect(unwrapCellValue('컨셉 회의')).toEqual({
      value: '컨셉 회의',
      warning: null,
      hyperlink: null,
    });
    expect(unwrapCellValue(46000)).toEqual({ value: 46000, warning: null, hyperlink: null });
    expect(unwrapCellValue(false)).toEqual({ value: false, warning: null, hyperlink: null });
  });

  it('Date는 그대로 통과한다', () => {
    const d = new Date(Date.UTC(2026, 8, 1));
    expect(unwrapCellValue(d)).toEqual({ value: d, warning: null, hyperlink: null });
  });

  it('{formula, result}는 result를 쓴다', () => {
    expect(unwrapCellValue({ formula: 'SUM(A1:A3)', result: 12 })).toEqual({
      value: 12,
      warning: null,
      hyperlink: null,
    });
  });

  it('{formula, result}의 result가 Date·richText여도 재귀적으로 푼다', () => {
    const d = new Date(Date.UTC(2026, 6, 22));
    expect(unwrapCellValue({ formula: 'TODAY()', result: d }).value).toBe(d);
    expect(
      unwrapCellValue({
        formula: 'A1',
        result: { richText: [{ text: '초안 ' }, { text: '검토' }] },
      })
    ).toEqual({ value: '초안 검토', warning: null, hyperlink: null });
  });

  it('result 키가 없는 {formula}는 null + FORMULA_WITHOUT_RESULT', () => {
    expect(unwrapCellValue({ formula: 'COUNTIFS(#REF!,1)' })).toEqual({
      value: null,
      warning: 'FORMULA_WITHOUT_RESULT',
      hyperlink: null,
    });
  });

  it('{sharedFormula}는 result가 있으면 쓰고 없으면 FORMULA_WITHOUT_RESULT', () => {
    expect(unwrapCellValue({ sharedFormula: 'C10', result: '진행 중' })).toEqual({
      value: '진행 중',
      warning: null,
      hyperlink: null,
    });
    expect(unwrapCellValue({ sharedFormula: 'C10' })).toEqual({
      value: null,
      warning: 'FORMULA_WITHOUT_RESULT',
      hyperlink: null,
    });
  });

  it('{text, hyperlink}는 text가 값이고 hyperlink는 원문 그대로 별도로 나온다', () => {
    expect(
      unwrapCellValue({ text: '기획안 문서', hyperlink: 'https://docs.example.com/a' })
    ).toEqual({
      value: '기획안 문서',
      warning: null,
      hyperlink: 'https://docs.example.com/a',
    });
  });

  it('하이퍼링크 스킴은 이 계층에서 거르지 않는다 (렌더 시점 방어는 T6)', () => {
    expect(unwrapCellValue({ text: '링크', hyperlink: 'javascript:alert(1)' }).hyperlink).toBe(
      'javascript:alert(1)'
    );
  });

  it('{richText}는 조각의 text를 순서대로 이어붙인다', () => {
    expect(
      unwrapCellValue({ richText: [{ text: '촬영 ' }, { text: '준비' }, { text: ' 완료' }] })
    ).toEqual({ value: '촬영 준비 완료', warning: null, hyperlink: null });
  });

  it('{error}는 null + CELL_ERROR', () => {
    expect(unwrapCellValue({ error: '#REF!' })).toEqual({
      value: null,
      warning: 'CELL_ERROR',
      hyperlink: null,
    });
  });

  it('알 수 없는 객체는 String()으로 뭉개지 않고 null + UNSUPPORTED_CELL_SHAPE', () => {
    const unknown = { somethingNew: 1 } as unknown as SheetCellValue;
    expect(unwrapCellValue(unknown)).toEqual({
      value: null,
      warning: 'UNSUPPORTED_CELL_SHAPE',
      hyperlink: null,
    });
  });
});

describe('toDateString — 전부 YYYY-MM-DD 또는 null (T2 완료 기준 3·5)', () => {
  const opts = { baseYear: 2026 };

  it('Date를 UTC 게터로 포맷한다 (서버 타임존에 흔들리지 않는다)', () => {
    expect(toDateString(new Date(Date.UTC(2026, 8, 1)), opts)).toEqual({
      value: '2026-09-01',
      warning: null,
    });
  });

  it('정상 엑셀 시리얼이 날짜로 변환된다', () => {
    // 픽스처가 쓰는 시리얼 46000 = 2025-12-09 (기준점 1899-12-30).
    expect(toDateString(46000, opts)).toEqual({ value: '2025-12-09', warning: null });
    // 2026년 값도 같은 경로로 돈다.
    expect(toDateString(46266, opts)).toEqual({ value: '2026-09-01', warning: null });
  });

  it('시리얼 0과 1은 유령 행 아티팩트라 null + DATE_OUT_OF_RANGE (E1)', () => {
    expect(toDateString(0, opts)).toEqual({ value: null, warning: 'DATE_OUT_OF_RANGE' });
    expect(toDateString(1, opts)).toEqual({ value: null, warning: 'DATE_OUT_OF_RANGE' });
  });

  it('1899-12-31·1900-01-01 Date 객체도 둘 다 null + DATE_OUT_OF_RANGE', () => {
    expect(toDateString(new Date(Date.UTC(1899, 11, 31)), opts)).toEqual({
      value: null,
      warning: 'DATE_OUT_OF_RANGE',
    });
    expect(toDateString(new Date(Date.UTC(1900, 0, 1)), opts)).toEqual({
      value: null,
      warning: 'DATE_OUT_OF_RANGE',
    });
  });

  it('유령 행의 수식 날짜 셀({formula, result: 1900-01-01})도 죽는다', () => {
    expect(toDateString({ formula: 'IF(A11="",0,A11)', result: serialAsDate(1) }, opts)).toEqual({
      value: null,
      warning: 'DATE_OUT_OF_RANGE',
    });
  });

  it('문자열 날짜 표기 4종이 모두 정규화된다', () => {
    expect(toDateString('2026-09-01', opts).value).toBe('2026-09-01');
    expect(toDateString('2026.07.22', opts).value).toBe('2026-07-22');
    expect(toDateString('2026. 09. 01.', opts).value).toBe('2026-09-01');
    expect(toDateString('2026/9/1', opts).value).toBe('2026-09-01');
  });

  it('연도 없는 9/1·9.1은 주입된 baseYear를 붙인다', () => {
    expect(toDateString('9/1', opts)).toEqual({ value: '2026-09-01', warning: null });
    expect(toDateString('9.1', { baseYear: 2025 })).toEqual({ value: '2025-09-01', warning: null });
  });

  it('빈칸·공백·-·—는 정상적인 빈칸이라 경고 없이 null', () => {
    for (const v of ['', '   ', '-', '—', null]) {
      expect(toDateString(v as SheetCellValue, opts)).toEqual({ value: null, warning: null });
    }
  });

  it('불리언은 경고 없이 null (유령 행의 false가 잡음이 되면 안 된다)', () => {
    expect(toDateString(false, opts)).toEqual({ value: null, warning: null });
  });

  it('달력에 없는 날짜와 알 수 없는 문자열은 DATE_UNPARSABLE', () => {
    expect(toDateString('2026-02-30', opts)).toEqual({ value: null, warning: 'DATE_UNPARSABLE' });
    expect(toDateString('미정', opts)).toEqual({ value: null, warning: 'DATE_UNPARSABLE' });
  });

  it('푸는 단계의 경고를 그대로 돌려준다', () => {
    expect(toDateString({ formula: 'TODAY()' }, opts)).toEqual({
      value: null,
      warning: 'FORMULA_WITHOUT_RESULT',
    });
    expect(toDateString({ error: '#REF!' }, opts)).toEqual({
      value: null,
      warning: 'CELL_ERROR',
    });
  });

  it('하이퍼링크·리치텍스트 셀도 푼 뒤 날짜 규칙을 적용한다', () => {
    expect(toDateString({ text: '2026-09-01', hyperlink: 'https://e.com' }, opts).value).toBe(
      '2026-09-01'
    );
    expect(toDateString({ richText: [{ text: '2026.' }, { text: '07.22' }] }, opts).value).toBe(
      '2026-07-22'
    );
  });
});

describe('toProgress — 퍼센트 서식 판별 (T2 완료 기준 6)', () => {
  it('numFmt에 %가 있으면 100을 곱한다', () => {
    expect(toProgress(0.66, '0%')).toEqual({ value: 66, warning: null });
  });

  it('numFmt가 없으면 값 그대로 쓴다', () => {
    expect(toProgress(66)).toEqual({ value: 66, warning: null });
  });

  it('수식 셀 + 퍼센트 서식이 겹쳐도 처리된다 (부동소수 잔재를 여기서 끝낸다)', () => {
    expect(toProgress({ formula: 'D10/E10', result: 0.33 }, '0%')).toEqual({
      value: 33,
      warning: null,
    });
  });

  it("문자열 '66%'와 '66' 모두 66이 된다", () => {
    expect(toProgress('66%')).toEqual({ value: 66, warning: null });
    expect(toProgress('66')).toEqual({ value: 66, warning: null });
  });

  it('빈 셀은 null, 0은 0 — 반드시 구분한다', () => {
    expect(toProgress(null)).toEqual({ value: null, warning: null });
    expect(toProgress('')).toEqual({ value: null, warning: null });
    expect(toProgress(0, '0%')).toEqual({ value: 0, warning: null });
  });

  it('0~100 밖의 값은 잘라내지 않고 보존 + PROGRESS_OUT_OF_RANGE', () => {
    expect(toProgress(1.2, '0%')).toEqual({ value: 120, warning: 'PROGRESS_OUT_OF_RANGE' });
    expect(toProgress(-10)).toEqual({ value: -10, warning: 'PROGRESS_OUT_OF_RANGE' });
  });

  it('푸는 단계의 경고를 그대로 돌려준다', () => {
    expect(toProgress({ formula: 'D10/E10' }, '0%')).toEqual({
      value: null,
      warning: 'FORMULA_WITHOUT_RESULT',
    });
  });
});

describe('toText', () => {
  it('앞뒤 공백을 제거하고, 빈 문자열은 null', () => {
    expect(toText('  기획안  ')).toEqual({ value: '기획안', warning: null });
    expect(toText('   ')).toEqual({ value: null, warning: null });
    expect(toText(null)).toEqual({ value: null, warning: null });
  });

  it('숫자·불리언은 문자열로, Date는 ISO 날짜 문자열로 바꾼다', () => {
    expect(toText(12).value).toBe('12');
    expect(toText(false).value).toBe('false');
    expect(toText(new Date(Date.UTC(2026, 8, 1))).value).toBe('2026-09-01');
  });

  it('리치텍스트를 이어붙이고, 오류 셀은 null + CELL_ERROR', () => {
    expect(toText({ richText: [{ text: 'A' }, { text: 'B' }] }).value).toBe('AB');
    expect(toText({ error: '#REF!' })).toEqual({ value: null, warning: 'CELL_ERROR' });
  });
});

describe('toNumber', () => {
  it('숫자와 숫자로 읽히는 문자열을 변환한다 (쉼표 포함)', () => {
    expect(toNumber(5)).toEqual({ value: 5, warning: null });
    expect(toNumber(' 12 ')).toEqual({ value: 12, warning: null });
    expect(toNumber('1,200')).toEqual({ value: 1200, warning: null });
    expect(toNumber(0.95)).toEqual({ value: 0.95, warning: null });
  });

  it('수식 셀의 result도 숫자로 읽는다', () => {
    expect(toNumber({ formula: 'SUM(B4:B11)', result: 8 })).toEqual({ value: 8, warning: null });
  });

  it('숫자가 아니면 경고 없이 null', () => {
    expect(toNumber('해당 없음')).toEqual({ value: null, warning: null });
    expect(toNumber('')).toEqual({ value: null, warning: null });
    expect(toNumber(true)).toEqual({ value: null, warning: null });
  });

  it('푸는 단계의 경고는 그대로 돌려준다', () => {
    expect(toNumber({ sharedFormula: 'C10' })).toEqual({
      value: null,
      warning: 'FORMULA_WITHOUT_RESULT',
    });
  });
});
