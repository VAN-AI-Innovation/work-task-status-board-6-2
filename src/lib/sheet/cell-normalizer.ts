/**
 * 엑셀 셀 값 정규화. 파이프라인에서 가장 아래에 있고 가장 많이 불린다 —
 * 여기서 뭉개진 값은 어느 단계에서도 복구되지 않는다.
 *
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003). `SheetCellValue`만 안다.
 * - 하드 실패시키지 않는다. 실패는 경고 코드로 남기고 값은 가능한 한 보존한다.
 * - 경고에 셀 값을 담지 않는다. 위치는 호출자가 붙인다.
 * - 현재 시각을 읽지 않는다 (CLAUDE.md CRITICAL). 연도는 `baseYear`로 주입받는다.
 */

import type { NormalizeWarning, SheetCellPrimitive, SheetCellValue } from '@/types/sheet';

export type NormalizeResult<T> = { value: T | null; warning: NormalizeWarning | null };

export type UnwrapResult = NormalizeResult<SheetCellPrimitive> & { hyperlink: string | null };

/** 엑셀 시리얼 1이 1899-12-31이 되는 기준점 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/**
 * 이 값 이하는 전부 버린다. 티켓 문구는 "1900-01-01 이전"이지만 죽여야 할 값이
 * 시리얼 0(1899-12-30)과 1(1899-12-31)에 더해 엑셀이 1900-01-01로 보여주는 값까지라
 * 경계를 포함해 자른다 (E1의 유령 행 아티팩트).
 * 1900년 윤년 버그 구간의 시리얼 2~59는 하루 어긋날 수 있으나 실제·픽스처 데이터에 없어 다루지 않는다.
 */
const MIN_VALID_DATE = '1900-01-01';

/** 정상적인 빈칸으로 취급하는 문자열 — 경고를 내지 않는다 */
const BLANK_TEXTS = new Set(['', '-', '—']);

const isPrimitive = (v: unknown): v is SheetCellPrimitive =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date;

/** 셀 값의 8가지 형태를 원시값으로 푼다 (PLAN.md E2) */
export function unwrapCellValue(v: SheetCellValue | undefined): UnwrapResult {
  if (v === null || v === undefined) return { value: null, warning: null, hyperlink: null };
  if (isPrimitive(v)) return { value: v, warning: null, hyperlink: null };

  if (typeof v === 'object') {
    const shape = v as Record<string, unknown>;

    if (typeof shape.error === 'string') {
      return { value: null, warning: 'CELL_ERROR', hyperlink: null };
    }

    if (typeof shape.formula === 'string' || typeof shape.sharedFormula === 'string') {
      if (shape.result === undefined) {
        return { value: null, warning: 'FORMULA_WITHOUT_RESULT', hyperlink: null };
      }
      // result가 Date·richText일 수 있어 재귀로 다시 푼다.
      return unwrapCellValue(shape.result as SheetCellValue);
    }

    if (Array.isArray(shape.richText)) {
      const text = (shape.richText as { text?: unknown }[])
        .map((fragment) => (typeof fragment?.text === 'string' ? fragment.text : ''))
        .join('');
      return { value: text, warning: null, hyperlink: null };
    }

    if (typeof shape.text === 'string' && typeof shape.hyperlink === 'string') {
      // 스킴 검사는 렌더 시점의 방어라 T6 범위다. 여기서는 원문 그대로 돌려준다.
      return { value: shape.text, warning: null, hyperlink: shape.hyperlink };
    }
  }

  // 미지의 형태는 String()으로 뭉개지 않고 버린다 — [object Object]가 저장되는 경로를 막는다.
  return { value: null, warning: 'UNSUPPORTED_CELL_SHAPE', hyperlink: null };
}

/** UTC 게터로 포맷한다. 로컬 게터를 쓰면 서버 타임존에 따라 하루가 밀린다 (E4) */
function formatUtcDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inRange(iso: string): NormalizeResult<string> {
  if (iso <= MIN_VALID_DATE) return { value: null, warning: 'DATE_OUT_OF_RANGE' };
  return { value: iso, warning: null };
}

/** 달력에 실재하는 날짜인지 확인하고 `YYYY-MM-DD`로 만든다 */
function fromParts(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return formatUtcDate(d);
}

const FULL_DATE = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/;
const MONTH_DAY = /^(\d{1,2})\s*[-./]\s*(\d{1,2})\s*\.?$/;

function parseDateText(text: string, baseYear: number): NormalizeResult<string> {
  const full = FULL_DATE.exec(text);
  if (full) {
    const iso = fromParts(Number(full[1]), Number(full[2]), Number(full[3]));
    return iso ? inRange(iso) : { value: null, warning: 'DATE_UNPARSABLE' };
  }

  const short = MONTH_DAY.exec(text);
  if (short) {
    const iso = fromParts(baseYear, Number(short[1]), Number(short[2]));
    return iso ? inRange(iso) : { value: null, warning: 'DATE_UNPARSABLE' };
  }

  return { value: null, warning: 'DATE_UNPARSABLE' };
}

/** 날짜를 `YYYY-MM-DD` 또는 null로 수렴시킨다 (T2 완료 기준 3·5) */
export function toDateString(
  v: SheetCellValue | undefined,
  opts: { baseYear: number }
): NormalizeResult<string> {
  const unwrapped = unwrapCellValue(v);
  if (unwrapped.warning) return { value: null, warning: unwrapped.warning };

  const value = unwrapped.value;
  if (value === null) return { value: null, warning: null };

  if (value instanceof Date) {
    const iso = formatUtcDate(value);
    return iso ? inRange(iso) : { value: null, warning: 'DATE_UNPARSABLE' };
  }

  if (typeof value === 'number') {
    const iso = formatUtcDate(new Date(EXCEL_EPOCH_UTC + value * MS_PER_DAY));
    return iso ? inRange(iso) : { value: null, warning: 'DATE_UNPARSABLE' };
  }

  // 유령 행의 날짜 서식 컬럼에 false가 통째로 들어 있어, 경고를 내면 잡음만 늘어난다.
  if (typeof value === 'boolean') return { value: null, warning: null };

  const text = value.trim();
  if (BLANK_TEXTS.has(text)) return { value: null, warning: null };
  return parseDateText(text, opts.baseYear);
}

/** 문자열로 정규화한다. 빈 문자열은 null */
export function toText(v: SheetCellValue | undefined): NormalizeResult<string> {
  const unwrapped = unwrapCellValue(v);
  if (unwrapped.warning) return { value: null, warning: unwrapped.warning };

  const value = unwrapped.value;
  if (value === null) return { value: null, warning: null };

  if (value instanceof Date) {
    const iso = formatUtcDate(value);
    return { value: iso, warning: null };
  }

  const text = String(value).trim();
  return { value: text === '' ? null : text, warning: null };
}

/** 숫자로 읽히면 숫자로, 아니면 null. 경고 코드를 새로 만들지 않는다 */
export function toNumber(v: SheetCellValue | undefined): NormalizeResult<number> {
  const unwrapped = unwrapCellValue(v);
  if (unwrapped.warning) return { value: null, warning: unwrapped.warning };

  const value = unwrapped.value;
  if (typeof value === 'number') return { value, warning: null };
  if (typeof value !== 'string') return { value: null, warning: null };

  const text = value.replace(/,/g, '').trim();
  if (text === '') return { value: null, warning: null };
  const parsed = Number(text);
  return { value: Number.isFinite(parsed) ? parsed : null, warning: null };
}

/**
 * 진행률을 0~100 정수로. 엑셀에서 `66%`는 셀 값이 `0.66`이다 (E3).
 * `numFmt`의 `%`는 숫자 값에만 적용한다 — 문자열은 `'66%'`·`'66'` 모두 자체로 이미 퍼센트다.
 * 범위를 벗어난 값은 잘라내지 않고 보존한 뒤 경고만 남긴다.
 */
export function toProgress(
  v: SheetCellValue | undefined,
  numFmt?: string
): NormalizeResult<number> {
  const unwrapped = unwrapCellValue(v);
  if (unwrapped.warning) return { value: null, warning: unwrapped.warning };

  const value = unwrapped.value;
  if (value === null || typeof value === 'boolean' || value instanceof Date) {
    return { value: null, warning: null };
  }

  let percent: number;
  if (typeof value === 'number') {
    percent = numFmt?.includes('%') ? value * 100 : value;
  } else {
    const text = value.trim().replace(/%$/, '').replace(/,/g, '').trim();
    if (text === '') return { value: null, warning: null };
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return { value: null, warning: null };
    percent = parsed;
  }

  // 0.33 * 100이 33.000000000000004가 되는 부동소수 문제를 여기서 끝낸다 (progress는 smallint).
  const rounded = Math.round(percent);
  if (rounded < 0 || rounded > 100) {
    return { value: rounded, warning: 'PROGRESS_OUT_OF_RANGE' };
  }
  return { value: rounded, warning: null };
}
