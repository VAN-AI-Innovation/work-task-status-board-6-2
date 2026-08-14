/**
 * 설정 탭을 enum·SLA 레지스트리로 옮긴다. **정규화의 근거가 여기서 나온다** —
 * 팀별 어댑터(T3)는 상태 문자열을 이 목록과 대조해 미등록 값을 경고로 올린다.
 *
 * 모양이 다른 탭이다. **컬럼 하나가 enum 그룹 하나**이고 값은 세로로 내려간다.
 *
 * 하지 않는 것 세 가지 — 여기서 하면 규칙이 두 곳에 생긴다.
 * - 진행 상태 원문을 `semantic` 코드로 바꾸는 매핑은 도메인 계층(`lib/domain/task-semantic.ts`, T4)의 일이다 (ADR-009).
 *   이 어댑터는 시트 문자열을 **있는 그대로** 실어 나른다.
 * - 팀·부서 레코드를 만들지 않는다 (T4).
 * - 미등록 값 검사를 하지 않는다 — 레지스트리를 **쓰는** 쪽(T3 어댑터)의 일이다.
 *
 * 탭을 스스로 찾지 않는다. 밴드는 판별기(`tab-detector`)가 준 것을 인자로 받는다.
 * 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { toNumber, toText } from '@/lib/sheet/cell-normalizer';
import { resolveHeaders } from '@/lib/sheet/header-resolver';
import type {
  EnumOptionEntry,
  HeaderBand,
  HeaderColumn,
  ParseWarning,
  SettingsRegistry,
  SheetGrid,
  SlaRuleEntry,
} from '@/types/sheet';

/** 이 두 컬럼은 enum이 아니라 SLA 표의 한 쌍이다 */
const SLA_ITEM_LABEL = '기본 SLA 설정_항목';
const SLA_DAYS_LABEL = '기본 SLA 설정_일수';

/** 값 하나를 읽는 위치. 실제 시트에는 수식·리치텍스트 셀도 섞여 있다 */
function cellText(sheet: SheetGrid, row: number, column: number): string | null {
  return toText(sheet.cells[row]?.[column]?.value).value;
}

/**
 * 값 수집이 끝나는 행. **컬럼을 시트 끝까지 긁으면 안 된다** —
 * 실제 설정 탭에는 빈 행 몇 개를 두고 아래쪽에 SLA 표가 한 번 더 있어서,
 * A컬럼을 끝까지 읽으면 SLA 항목명이 구성원 목록으로 들어간다.
 */
function findBlockEnd(sheet: SheetGrid, startRow: number, columns: number[]): number {
  for (let row = startRow; row < sheet.rowCount; row += 1) {
    if (columns.every((column) => cellText(sheet, row, column) === null)) return row;
  }
  return sheet.rowCount;
}

/**
 * 구성원 컬럼(`편집팀 구성원`)도 분기 없이 같은 루프로 담는다.
 * 구조가 동일하고, 팀·구성원으로 쓸지는 `groupKey`를 보고 T4가 정한다.
 */
function collectEnums(
  sheet: SheetGrid,
  columns: HeaderColumn[],
  startRow: number,
  endRow: number
): EnumOptionEntry[] {
  const entries: EnumOptionEntry[] = [];

  for (const column of columns) {
    if (column.label === SLA_ITEM_LABEL || column.label === SLA_DAYS_LABEL) continue;

    let sortOrder = 0;
    for (let row = startRow; row < endRow; row += 1) {
      const value = cellText(sheet, row, column.index);
      if (value === null) continue; // 건너뛴 빈 칸은 sortOrder에서도 세지 않는다
      entries.push({ groupKey: column.label, value, sortOrder });
      sortOrder += 1;
    }
  }

  return entries;
}

/** SLA 표 하나. 두 곳(밴드 안 컬럼 쌍 / 아래쪽 별도 블록)에서 같은 모양으로 나온다 */
interface SlaBlock {
  itemColumn: number;
  daysColumn: number;
  startRow: number;
  endRow: number;
}

function bandSlaBlock(
  columns: HeaderColumn[],
  startRow: number,
  endRow: number
): SlaBlock | null {
  const item = columns.find((c) => c.label === SLA_ITEM_LABEL);
  const days = columns.find((c) => c.label === SLA_DAYS_LABEL);
  if (!item || !days) return null;
  return { itemColumn: item.index, daysColumn: days.index, startRow, endRow };
}

/**
 * 밴드 밖의 SLA 블록을 직접 찾는다. 컬럼이 2개뿐이라 헤더 밴드 후보로 잡히지 않는다
 * (`header-resolver`는 서로 다른 값 3개 이상을 요구한다).
 */
function scanSlaBlocks(sheet: SheetGrid): SlaBlock[] {
  const blocks: SlaBlock[] = [];

  for (let row = 0; row < sheet.rowCount; row += 1) {
    for (let column = 0; column + 1 < sheet.columnCount; column += 1) {
      if (cellText(sheet, row, column) !== SLA_ITEM_LABEL) continue;
      if (cellText(sheet, row, column + 1) !== SLA_DAYS_LABEL) continue;

      const startRow = row + 1;
      blocks.push({
        itemColumn: column,
        daysColumn: column + 1,
        startRow,
        endRow: findBlockEnd(sheet, startRow, [column, column + 1]),
      });
    }
  }

  return blocks;
}

/** 밴드 블록과 스캔 결과는 같은 표를 두 번 가리킬 수 있다 — 시작 위치로 접는다 */
function dedupeBlocks(blocks: SlaBlock[]): SlaBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = `${block.itemColumn}:${block.startRow}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSlaRules(
  sheet: SheetGrid,
  blocks: SlaBlock[]
): { rules: SlaRuleEntry[]; warnings: ParseWarning[] } {
  const rules: SlaRuleEntry[] = [];
  const warnings: ParseWarning[] = [];
  const seen = new Map<string, number>();

  for (const block of blocks) {
    for (let row = block.startRow; row < block.endRow; row += 1) {
      const label = cellText(sheet, row, block.itemColumn);
      if (label === null) continue;

      const { value: days } = toNumber(sheet.cells[row]?.[block.daysColumn]?.value);
      if (days === null) {
        warnings.push({
          code: 'SLA_DAYS_INVALID',
          sheet: sheet.name,
          row: row + 1,
          column: block.daysColumn + 1,
        });
        continue;
      }

      const previous = seen.get(label);
      if (previous === undefined) {
        seen.set(label, days);
        rules.push({ label, days });
        continue;
      }
      if (previous === days) continue; // 같은 값이면 조용히 한 건으로 합친다

      // 다른 값이면 덮어쓰지 않고 사람에게 보여준다 (E5와 같은 부류의 사고다).
      warnings.push({
        code: 'SLA_CONFLICT',
        sheet: sheet.name,
        row: row + 1,
        column: block.itemColumn + 1,
      });
    }
  }

  return { rules, warnings };
}

export function parseSettingsTab(sheet: SheetGrid, band: HeaderBand): SettingsRegistry {
  const columns = resolveHeaders(sheet, band);
  const startRow = band.labelRow + 1;
  const endRow = findBlockEnd(
    sheet,
    startRow,
    columns.map((c) => c.index)
  );

  const bandBlock = bandSlaBlock(columns, startRow, endRow);
  const blocks = dedupeBlocks([...(bandBlock ? [bandBlock] : []), ...scanSlaBlocks(sheet)]);
  const sla = readSlaRules(sheet, blocks);

  return {
    enums: collectEnums(sheet, columns, startRow, endRow),
    slaRules: sla.rules,
    warnings: sla.warnings,
  };
}
