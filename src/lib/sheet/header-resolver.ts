/**
 * 헤더 행 후보를 찾고, 2단 헤더를 컬럼 경로로 결합한다.
 *
 * 실제 시트의 헤더는 1행이 아니라 8·9행이고 위에 장식 행이 7줄 깔려 있다.
 * `03_마케팅·관리팀`은 한 탭 안에 헤더 행이 둘이다 — "첫 행이 헤더"는 전부 틀린다.
 *
 * **후보를 확정하지 않는다.** 어느 밴드가 진짜인지는 탭 판별의 시그니처 매칭이 정한다.
 * 여기서 하나로 좁히면 마케팅 탭의 B섹션이 통째로 사라진다.
 *
 * 결합이 필요한 이유는 미관이 아니다. `01_편집팀`은 `예정일`·`실제`·`내용`·`확인`이
 * 단계마다 반복돼, 하위 라벨만 보면 컬럼 12개가 4개로 뭉개진다.
 *
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 * - 헤더 문자열을 정규화해 저장하지 않는다. 매칭 시점의 정규화는 어댑터(T3)가 자기 규칙으로 한다
 *   — 저장값이 원문이어야 `extras` 키가 사람에게 읽힌다.
 */

import { toText } from '@/lib/sheet/cell-normalizer';
import type { HeaderBand, HeaderColumn, SheetCellValue, SheetGrid } from '@/types/sheet';

/** 헤더로 보려면 값이 이만큼은 있어야 한다 */
const MIN_FILLED_CELLS = 3;
/** 전체 폭 배너는 모든 셀이 같은 문자열이다 — 배너를 거르는 장치가 이 조건이다 */
const MIN_DISTINCT_VALUES = 3;
/** 안내 문구·본문 행을 거른다 */
const MAX_LABEL_LENGTH = 40;

/** `{formula}`·`{sharedFormula}` — 수식에서 온 값이면 헤더가 아니라 KPI 행이다 */
function isFormulaCell(value: SheetCellValue): boolean {
  if (value === null || typeof value !== 'object' || value instanceof Date) return false;
  return 'formula' in value || 'sharedFormula' in value;
}

function isLabelRow(sheet: SheetGrid, row: number): boolean {
  const texts: string[] = [];

  for (const cell of sheet.cells[row]) {
    if (isFormulaCell(cell.value)) return false;
    const { value } = toText(cell.value);
    if (value === null) continue;
    if (value.length > MAX_LABEL_LENGTH) return false;
    texts.push(value);
  }

  if (texts.length < MIN_FILLED_CELLS) return false;
  return new Set(texts).size >= MIN_DISTINCT_VALUES;
}

/**
 * 그룹 행 판정. 2컬럼 이상을 덮는 가로 병합이 있어야 하고,
 * 시트 전체 폭을 통째로 덮는 것은 그룹이 아니라 배너다.
 */
function hasGroupMerge(sheet: SheetGrid, row: number): boolean {
  return sheet.merges.some((m) => {
    if (m.top > row || row > m.bottom) return false;
    if (m.right <= m.left) return false;
    return !(m.left === 0 && m.right >= sheet.columnCount - 1);
  });
}

/** 헤더로 보이는 행 후보를 위에서 아래 순서로 **전부** 돌려준다 */
export function findHeaderBands(sheet: SheetGrid): HeaderBand[] {
  const bands: HeaderBand[] = [];

  // 마지막 행은 후보가 아니다 — 아래에 데이터 행이 하나도 없다.
  for (let row = 0; row < sheet.rowCount - 1; row += 1) {
    if (!isLabelRow(sheet, row)) continue;
    const groupRow = row > 0 && hasGroupMerge(sheet, row - 1) ? row - 1 : null;
    bands.push({ groupRow, labelRow: row });
  }

  return bands;
}

/**
 * 비어 있는 그룹 셀을 **병합 범위 안에서만** 채운다.
 * 범위 밖으로 무조건 forward-fill 하면 `기본 업무정보`가 오른쪽 끝까지 번져
 * 컬럼 키가 전부 오염된다. (리더가 이미 병합 값을 채워 주면 이 분기는 실행되지 않는다.
 * 그래도 방어로 남긴다 — 근거가 `merges`라서 틀릴 여지가 없다.)
 */
function groupFromMerge(sheet: SheetGrid, row: number, column: number): string | null {
  const merge = sheet.merges.find(
    (m) => m.top <= row && row <= m.bottom && m.left <= column && column <= m.right && m.right > m.left
  );
  if (!merge) return null;
  return toText(sheet.cells[row]?.[merge.left]?.value).value;
}

/** 밴드를 컬럼 경로로 결합한다. 그룹·라벨이 둘 다 빈 컬럼은 결과에서 빠진다 */
export function resolveHeaders(sheet: SheetGrid, band: HeaderBand): HeaderColumn[] {
  const labelCells = sheet.cells[band.labelRow] ?? [];
  const groupCells = band.groupRow === null ? null : (sheet.cells[band.groupRow] ?? []);
  const columns: HeaderColumn[] = [];

  for (let column = 0; column < sheet.columnCount; column += 1) {
    const label = toText(labelCells[column]?.value).value;

    let group: string | null = null;
    if (groupCells && band.groupRow !== null) {
      group = toText(groupCells[column]?.value).value ?? groupFromMerge(sheet, band.groupRow, column);
    }

    const path: string[] = [];
    if (group !== null) path.push(group);
    // 그룹과 라벨이 같은 문자열이면 하나로 접는다 (P8=비고 / P9=비고).
    if (label !== null && label !== group) path.push(label);
    if (path.length === 0) continue;

    columns.push({ index: column, path, label: path.join(' / ') });
  }

  return columns;
}
