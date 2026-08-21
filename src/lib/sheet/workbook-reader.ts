/**
 * 워크북을 좌표 붙은 격자로 옮긴다.
 *
 * **저장소 전체에서 제품 코드가 `exceljs`를 읽기 위해 import하는 유일한 파일이다** (ADR-003).
 * 경계가 새면 나중에 라이브러리를 바꿀 때 손댈 곳이 파서 전역이 된다.
 *
 * 이 파일의 일은 해석이 아니라 채록이다. 어떤 탭인지·어디가 헤더인지·무엇이 데이터 행인지는
 * 뒤 단계가 판단한다. 값도 정규화하지 않는다 — 그건 `cell-normalizer`의 몫이다.
 */

import ExcelJS from 'exceljs';

import type { WorkbookLimits } from '@/lib/upload/upload-limits';
import type {
  MergeRange,
  ParseWarning,
  SheetCell,
  SheetCellValue,
  SheetGrid,
  WorkbookGrid,
} from '@/types/sheet';

/**
 * 이 모듈에서 유일하게 허용되는 하드 실패 (ARCHITECTURE.md 실패 강도 표의 「중단」).
 * 메시지에 파일 내용·셀 값·내부 경로를 담지 않는다.
 */
export class WorkbookReadError extends Error {
  readonly code = 'WORKBOOK_CORRUPT';

  constructor() {
    super('워크북을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.');
    this.name = 'WorkbookReadError';
  }
}

/**
 * 한도 초과. 「중단」 강도다 (ARCHITECTURE.md 실패 강도 표).
 *
 * 세 갈래(시트 수·시트당 셀·워크북 합계)를 메시지로 구분하지 않는다 —
 * 사용자가 할 수 있는 일이 같다(파일을 줄여서 다시 올린다).
 */
export class ArchiveLimitError extends Error {
  readonly code = 'ARCHIVE_LIMIT_EXCEEDED';

  constructor() {
    super('파일이 처리 한도를 넘습니다. 시트나 행·열을 줄여 다시 올려 주세요.');
    this.name = 'ArchiveLimitError';
  }
}

/** `A` → 0, `BS` → 70 */
function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** `A8:D8` 같은 A1 표기를 0-based 양끝 포함 범위로 바꾼다 */
function toMergeRange(address: string): MergeRange | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address);
  if (!match) return null;
  return {
    top: Number(match[2]) - 1,
    left: columnIndex(match[1]),
    bottom: Number(match[4]) - 1,
    right: columnIndex(match[3]),
  };
}

function readSheet(
  worksheet: ExcelJS.Worksheet,
  warnings: ParseWarning[],
  limits?: WorkbookLimits
): SheetGrid {
  // exceljs의 `rowCount`는 서식만 있는 행까지 세서 부풀어 오른다 — 실측에서 1001까지 갔다.
  // 범위는 반드시 `dimensions`로 잡는다 (A7).
  const dimensions = worksheet.dimensions;
  const rowCount = dimensions?.bottom ?? 0;
  const columnCount = dimensions?.right ?? 0;

  // `dimensions`는 워크북 XML 안의 속성이라 위조할 수 있다. 수백만 셀짜리 사각형을 신고하는 `<dimension>` 한 줄은
  // 40바이트도 안 되는데 그 사각형을 믿고 배열을 할당하면 프로세스가 죽는다 — 그래서 검사는
  // 반드시 `cells`를 만들기 **전**이다. 뒤에 두면 그때는 이미 메모리를 다 썼다 (S2).
  if (limits && rowCount * columnCount > limits.maxCellsPerSheet) throw new ArchiveLimitError();

  const cells: SheetCell[][] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const line: SheetCell[] = [];
    for (let c = 1; c <= columnCount; c += 1) {
      const cell = row.getCell(c);
      // 값이 없는 셀도 자리를 만든다 — 뒤 단계가 `cells[r][c]`를 무방비로 읽는다.
      if (cell.value === null || cell.value === undefined) {
        line.push({ value: null, numFmt: null });
        continue;
      }
      line.push({
        value: cell.value as SheetCellValue,
        numFmt: cell.numFmt ?? null,
      });
    }
    cells.push(line);
  }

  const merges: MergeRange[] = [];
  for (const address of worksheet.model.merges ?? []) {
    const range = toMergeRange(address);
    if (range) merges.push(range);
  }

  // 행을 지우지 않는다. 건너뛸지 말지는 T3의 판단이고, 리더는 사실만 싣는다.
  // 숨김 행에는 경고를 남기지 않는다 — 정상적인 작업 행이라 잡음이 된다 (E6~E8).
  const hiddenRows: number[] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    if (worksheet.getRow(r).hidden) hiddenRows.push(r - 1);
  }

  const hiddenColumns: number[] = [];
  for (let c = 1; c <= columnCount; c += 1) {
    if (worksheet.getColumn(c).hidden) {
      hiddenColumns.push(c - 1);
      warnings.push({ code: 'HIDDEN_COLUMN', sheet: worksheet.name, column: c });
    }
  }

  return { name: worksheet.name, rowCount, columnCount, cells, merges, hiddenRows, hiddenColumns };
}

/**
 * 워크북 바이트를 시트별 격자로 옮긴다. 시트는 파일에 있는 순서 그대로다.
 *
 * `limits`는 **정책이 아니라 인자**다. 숫자는 `upload-limits.ts` 한 곳에 있고 리더는 받은 값을
 * 지킬 뿐이다 — 리더가 숫자를 알면 정책이 두 곳에 생겨 하나만 고쳐진다.
 * 넘기지 않으면 검사를 전부 건너뛴다.
 */
export async function readWorkbook(
  input: Buffer | ArrayBuffer,
  limits?: WorkbookLimits
): Promise<WorkbookGrid> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs의 타입 선언이 전역 `Buffer`를 `interface Buffer extends ArrayBuffer {}`로 병합해 둬서
    // Node의 Buffer가 그대로는 들어가지 않는다. 런타임은 둘 다 받는다.
    await workbook.xlsx.load(input as unknown as ArrayBuffer);
  } catch {
    // 원본 에러를 그대로 흘리면 내부 경로·라이브러리 URL이 사용자에게 노출된다.
    throw new WorkbookReadError();
  }

  if (limits && workbook.worksheets.length > limits.maxSheets) throw new ArchiveLimitError();

  const warnings: ParseWarning[] = [];
  const sheets: SheetGrid[] = [];
  let cellTotal = 0;
  for (const worksheet of workbook.worksheets) {
    const grid = readSheet(worksheet, warnings, limits);
    // 시트당 상한만으로는 20 × 100,000이 통과한다. 합계는 시트를 하나 끝낼 때마다 조인다.
    cellTotal += grid.rowCount * grid.columnCount;
    if (limits && cellTotal > limits.maxCellsPerWorkbook) throw new ArchiveLimitError();
    sheets.push(grid);
  }
  return { sheets, warnings };
}
