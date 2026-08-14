/**
 * 시트 계층이 쓰는 자체 타입. 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 * `cell.value`의 형태들은 전부 평범한 JS 객체라서 그대로 기술할 수 있고,
 * 그 라이브러리를 아는 파일은 `lib/sheet/workbook-reader.ts` 하나뿐이다.
 */

export type SheetCellPrimitive = string | number | boolean | Date;

/** ExcelJS `cell.value`의 8가지 형태 (PLAN.md E2) */
export type SheetCellValue =
  | SheetCellPrimitive
  | null
  | { formula: string; result?: SheetCellValue }
  | { sharedFormula: string; result?: SheetCellValue }
  | { text: string; hyperlink: string }
  | { richText: { text: string }[] }
  | { error: string };

/**
 * 정규화 중 발생한 경고. **코드만 담는다 — 셀 값을 담지 않는다** (CLAUDE.md 보안 규칙).
 * 위치(`시트명!행:열`)는 이 값을 읽은 상위 계층이 붙인다.
 */
export type NormalizeWarning =
  | 'FORMULA_WITHOUT_RESULT'
  | 'CELL_ERROR'
  | 'UNSUPPORTED_CELL_SHAPE'
  | 'DATE_UNPARSABLE'
  | 'DATE_OUT_OF_RANGE'
  | 'PROGRESS_OUT_OF_RANGE';
