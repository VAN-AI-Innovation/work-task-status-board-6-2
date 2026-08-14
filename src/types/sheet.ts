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

/**
 * 워크북을 좌표 붙은 격자로 옮긴 것. 해석은 하지 않는다.
 *
 * **좌표 규칙 — 여기서 흔들리면 off-by-one이 파이프라인 끝까지 간다.**
 * `cells`·`merges`·`hiddenRows`·`hiddenColumns`는 전부 **0-based**이고 `cells[0][0]`이 A1이다.
 * 예외는 `ParseWarning`의 `row`·`column` 둘뿐이며 **1-based**다 (사람이 읽는 좌표).
 */
export interface SheetCell {
  value: SheetCellValue;
  /** `0%` 같은 엑셀 표시 서식. 없으면 null. `toProgress`가 퍼센트 판별에 쓴다 */
  numFmt: string | null;
}

/** 병합 범위. 0-based, 양끝 포함 */
export interface MergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface SheetGrid {
  name: string;
  /** `dimensions` 기준. 엑셀 라이브러리의 `rowCount`가 아니다 (서식만 있는 패딩 행까지 센다) */
  rowCount: number;
  columnCount: number;
  /** `[row][col]`, 0-based. 빈 셀도 자리를 채우고 모든 행 길이가 `columnCount`다 */
  cells: SheetCell[][];
  merges: MergeRange[];
  hiddenRows: number[];
  hiddenColumns: number[];
}

/** 파싱 중 발생한 경고. 셀 값을 담지 않는다 — 코드와 위치만 남긴다 */
export interface ParseWarning {
  code: string;
  sheet: string;
  /** 1-based (사람이 읽는 좌표) */
  row?: number;
  /** 1-based (사람이 읽는 좌표) */
  column?: number;
}

export interface WorkbookGrid {
  sheets: SheetGrid[];
  warnings: ParseWarning[];
}

/**
 * 헤더로 보이는 행 묶음. **후보일 뿐 확정이 아니다** — 어느 밴드가 진짜인지는
 * 탭 판별(시그니처 매칭)이 정한다. 한 탭에 여러 개가 나오는 것이 정상이다
 * (마케팅 탭은 A·B 섹션에 헤더가 하나씩 있다).
 */
export interface HeaderBand {
  /** 0-based. 상위 그룹 행이 없으면 null */
  groupRow: number | null;
  /** 0-based */
  labelRow: number;
}

/** 그룹·하위 헤더를 결합한 컬럼 하나 */
export interface HeaderColumn {
  /** 0-based 컬럼 인덱스. 배열 위치가 아니라 **이 값**이 컬럼 좌표다 */
  index: number;
  /** 예: `['컨셉·레퍼런스 (+2일)', '예정일']`. 원문을 자르지 않는다 */
  path: string[];
  /** `path.join(' / ')` */
  label: string;
}
