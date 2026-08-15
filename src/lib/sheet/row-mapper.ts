/**
 * 어댑터 3종이 공유하는 **행 → 레코드 변환 엔진**. 어댑터는 선언적 표(`FIELD_MAP`·신원 컬럼)만
 * 넘기고 절차적 분기를 갖지 않는다. 70컬럼을 if문으로 처리하면 유지가 불가능하다.
 *
 * 여기서 막는 사고 셋 —
 * - **유령 행** (E1): 행 판정은 신원 컬럼으로만 하고, 수식 셀은 신원 근거로 쓰지 않는다.
 * - **컬럼 누락** (완료 기준 3): 매핑되지 않은 컬럼은 전부 `extras`로 흘러간다.
 * - **`source_key` 충돌** (E5): 자동 병합하지 않고 경고로 사람에게 보여준다.
 *
 * - 팀 이름·팀별 컬럼 이름을 이 파일에 두지 않는다. 선언적 표는 어댑터가 갖는다.
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 * - 단계 언피벗은 하지 않는다. `records`를 돌려주고 어댑터가 이어서 한다.
 * - 경고에 셀 값·이름을 담지 않는다. 코드와 좌표만이다 (CLAUDE.md 보안 규칙).
 */

import {
  toDateString,
  toNumber,
  toProgress,
  toText,
  unwrapCellValue,
} from '@/lib/sheet/cell-normalizer';
import { resolveHeaders } from '@/lib/sheet/header-resolver';
import { validateParsedTask } from '@/lib/sheet/task-schema';
import type {
  HeaderBand,
  HeaderColumn,
  NormalizeWarning,
  ParseWarning,
  SheetCell,
  SheetCellValue,
  SheetGrid,
} from '@/types/sheet';
import type { ExtraValue, ParsedTask, TeamKey } from '@/types/task';

/** `ParsedTask`에서 이 엔진이 채울 수 있는 스칼라 필드 */
export type TaskScalarField =
  | 'title'
  | 'ownerNameRaw'
  | 'status'
  | 'approvalStatus'
  | 'priority'
  | 'riskStatus'
  | 'progress'
  | 'assignedAt'
  | 'dueAt'
  | 'nextAction'
  | 'nextActionOwner'
  | 'nextActionDue'
  | 'delayReason'
  | 'note';

export interface FieldMapEntry {
  /** 헤더 결합 경로의 **마지막 조각**과 정확히 일치해야 한다 */
  header: string;
  field: TaskScalarField;
  kind: 'text' | 'number' | 'date' | 'progress';
}

export interface RowMapSpec {
  teamKey: TeamKey;
  /**
   * 이 값들 중 **하나 이상**에 실제 값이 있어야 데이터 행이다 (E1).
   * `FieldMapEntry.header`와 같은 규칙으로 경로 마지막 조각에 맞춘다.
   */
  identityHeaders: string[];
  /** 있으면 이 컬럼 값이 곧 `sourceKey`다. 예: `업무ID`·`문의 ID` */
  idHeader?: string;
  fieldMap: FieldMapEntry[];
  /** 값이 여럿일 수 있는 컬럼. `coOwnerNames`로 들어간다 */
  coOwnerHeader?: string;
  /**
   * `extras`에서 제외할 컬럼(단계 컬럼 등). 어댑터가 넘긴다.
   * **`raw`에서는 빼지 않는다** — `raw`는 감사·복원용이라 손실이 없어야 한다.
   * 여기만 마지막 조각이 아니라 **결합 라벨 전체**로 맞춘다. 단계 컬럼은 마지막 조각
   * (`예정일`)이 그룹마다 반복돼, 조각으로 지우면 다른 그룹까지 함께 사라진다.
   */
  excludeFromExtras?: string[];
  /** 날짜 문자열의 연도 추론 기준. `9/1` 같은 값에 쓴다 */
  baseYear: number;
}

/** 한 행을 헤더 라벨로 색인한 것. 키는 `HeaderColumn.label`(결합 라벨 원문) */
export interface RowRecord {
  /** 0-based 행 좌표 */
  row: number;
  cells: Map<string, SheetCell>;
  /** 라벨 → 컬럼. 어댑터가 단계 컬럼을 찾을 때 쓴다 */
  columns: HeaderColumn[];
}

export interface RowMapResult {
  tasks: ParsedTask[];
  warnings: ParseWarning[];
  /** 어댑터가 단계 언피벗에 쓴다. `tasks[i]`와 같은 순서다 */
  records: RowRecord[];
}

/** 공동 담당자 구분자. 시트에 실제로 섞여 쓰인다 */
const CO_OWNER_SEPARATOR = /[,/·\n]/;

const lastSegment = (column: HeaderColumn): string => column.path[column.path.length - 1];

/** `{formula}`·`{sharedFormula}` — 수식에서 온 값은 신원 근거가 아니다 (E1) */
function isFormulaCell(value: SheetCellValue | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' || value instanceof Date) return false;
  return 'formula' in value || 'sharedFormula' in value;
}

/** 앞뒤 공백 제거 · 연속 공백을 `-` 하나로 · 소문자화. 한글을 지우거나 음차하지 않는다 */
function slug(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, '-').toLowerCase();
}

function warn(
  code: string,
  sheet: string,
  row: number,
  column?: number
): ParseWarning {
  // 안에서 좌표를 1-based로 올린다 — 변환이 일어나는 곳은 경고를 만드는 이 지점뿐이다.
  return column === undefined
    ? { code, sheet, row: row + 1 }
    : { code, sheet, row: row + 1, column: column + 1 };
}

/** `raw`·`extras`에 담을 값. 하이퍼링크는 텍스트와 URL을 둘 다 보존한다 */
function toExtraValue(cell: SheetCell | undefined, baseYear: number): ExtraValue {
  const unwrapped = unwrapCellValue(cell?.value);

  if (unwrapped.hyperlink !== null) {
    return {
      text: typeof unwrapped.value === 'string' ? unwrapped.value : null,
      hyperlink: unwrapped.hyperlink,
    };
  }

  const value = unwrapped.value;
  if (value === null) return null;
  if (value instanceof Date) return toDateString(cell?.value, { baseYear }).value;
  return value;
}

type ScalarValue = string | number | null;

function normalizeField(
  entry: FieldMapEntry,
  cell: SheetCell | undefined,
  baseYear: number
): { value: ScalarValue; warning: NormalizeWarning | null } {
  switch (entry.kind) {
    case 'number':
      return toNumber(cell?.value);
    case 'date':
      return toDateString(cell?.value, { baseYear });
    case 'progress':
      return toProgress(cell?.value, cell?.numFmt ?? undefined);
    default:
      return toText(cell?.value);
  }
}

/** 헤더 매칭은 시트당 한 번이다. 행마다 다시 풀면 모호 경고가 행 수만큼 불어난다 */
function resolveFieldColumns(
  columns: HeaderColumn[],
  spec: RowMapSpec,
  sheetName: string,
  labelRow: number
): { bindings: { entry: FieldMapEntry; column: HeaderColumn }[]; warnings: ParseWarning[] } {
  const bindings: { entry: FieldMapEntry; column: HeaderColumn }[] = [];
  const warnings: ParseWarning[] = [];
  const reported = new Set<string>();

  for (const entry of spec.fieldMap) {
    const matched = columns.filter((column) => lastSegment(column) === entry.header);
    if (matched.length === 0) continue;

    if (matched.length > 1 && !reported.has(entry.header)) {
      reported.add(entry.header);
      warnings.push(warn('AMBIGUOUS_FIELD_HEADER', sheetName, labelRow, matched[0].index));
    }

    bindings.push({ entry, column: matched[0] });
  }

  return { bindings, warnings };
}

function findColumn(columns: HeaderColumn[], header: string | undefined): HeaderColumn | null {
  if (header === undefined) return null;
  return columns.find((column) => lastSegment(column) === header) ?? null;
}

export function mapRows(
  sheet: SheetGrid,
  band: HeaderBand,
  spec: RowMapSpec,
  range?: { startRow: number; endRow: number }
): RowMapResult {
  const columns = resolveHeaders(sheet, band);
  const { bindings, warnings } = resolveFieldColumns(columns, spec, sheet.name, band.labelRow);

  const identityColumns = columns.filter((column) =>
    spec.identityHeaders.includes(lastSegment(column))
  );
  const idColumn = findColumn(columns, spec.idHeader);
  const coOwnerColumn = findColumn(columns, spec.coOwnerHeader);

  // extras에서 뺄 라벨. 신원 컬럼은 여기 넣지 않는다 — 판정에 썼다는 이유로 지우면
  // 어느 필드에도 매핑되지 않은 신원 컬럼이 통째로 사라져 완료 기준 3(누락 없음)이 깨진다.
  const excluded = new Set<string>(spec.excludeFromExtras ?? []);
  for (const binding of bindings) excluded.add(binding.column.label);
  if (idColumn) excluded.add(idColumn.label);
  if (coOwnerColumn) excluded.add(coOwnerColumn.label);

  const hidden = new Set(sheet.hiddenRows);
  const startRow = range?.startRow ?? band.labelRow + 1;
  const endRow = Math.min(range?.endRow ?? sheet.rowCount - 1, sheet.rowCount - 1);

  const tasks: ParsedTask[] = [];
  const records: RowRecord[] = [];
  const seenKeys = new Set<string>();

  for (let row = startRow; row <= endRow; row += 1) {
    if (hidden.has(row)) continue; // 작업용 임시 행이라는 것이 시트 작성자의 의도다 (E6)

    const cells = sheet.cells[row];
    if (!cells) continue;

    const isDataRow = identityColumns.some((column) => {
      const cell = cells[column.index];
      if (isFormulaCell(cell?.value)) return false;
      return toText(cell?.value).value !== null;
    });
    // 유령 행은 조용히 건너뛴다. 25건이 25개의 경고가 되면 진짜 경고가 묻힌다 (E1).
    if (!isDataRow) continue;

    const values: Partial<Record<TaskScalarField, ScalarValue>> = {};
    for (const { entry, column } of bindings) {
      const result = normalizeField(entry, cells[column.index], spec.baseYear);
      values[entry.field] = result.value;
      if (result.warning) warnings.push(warn(result.warning, sheet.name, row, column.index));
    }

    const raw: Record<string, ExtraValue> = {};
    const extras: Record<string, ExtraValue> = {};
    for (const column of columns) {
      const value = toExtraValue(cells[column.index], spec.baseYear);
      raw[column.label] = value;
      // 값이 null인 컬럼도 키를 남긴다 — "컬럼이 있는데 비었다"와 "컬럼이 없다"의 구분이다.
      if (!excluded.has(column.label)) extras[column.label] = value;
    }

    const text = (field: TaskScalarField): string | null => {
      const value = values[field];
      if (value === null || value === undefined) return null;
      return typeof value === 'number' ? String(value) : value;
    };
    const progress = typeof values.progress === 'number' ? values.progress : null;

    const idValue = idColumn ? toText(cells[idColumn.index]?.value).value : null;
    const title = text('title');
    const ownerNameRaw = text('ownerNameRaw');
    const sourceKey = idValue ?? `${slug(title)}::${slug(ownerNameRaw)}`;

    if (seenKeys.has(sourceKey)) {
      // 뒤 건을 버리거나 앞 건을 덮어쓰지 않는다. 판단은 사람이 한다 (E5).
      warnings.push(warn('DUPLICATE_SOURCE_KEY', sheet.name, row));
    }
    seenKeys.add(sourceKey);

    const coOwnerText = coOwnerColumn ? toText(cells[coOwnerColumn.index]?.value).value : null;
    const coOwnerNames = (coOwnerText ?? '')
      .split(CO_OWNER_SEPARATOR)
      .map((name) => name.trim())
      .filter((name) => name !== '');

    const task: ParsedTask = {
      teamKey: spec.teamKey,
      sourceKey,
      title,
      ownerNameRaw,
      coOwnerNames,
      status: text('status'),
      approvalStatus: text('approvalStatus'),
      priority: text('priority'),
      riskStatus: text('riskStatus'),
      progress,
      assignedAt: text('assignedAt'),
      dueAt: text('dueAt'),
      nextAction: text('nextAction'),
      nextActionOwner: text('nextActionOwner'),
      nextActionDue: text('nextActionDue'),
      delayReason: text('delayReason'),
      note: text('note'),
      extras,
      raw,
      sourceSheetTab: sheet.name,
      sourceRowIndex: row + 1,
      stages: [], // 언피벗은 어댑터가 `records`로 이어서 한다
    };

    // 검증 실패로 태스크를 버리지 않는다 (CLAUDE.md 파서 하드 실패 금지).
    warnings.push(...validateParsedTask(task));

    tasks.push(task);
    records.push({
      row,
      cells: new Map(columns.map((column) => [column.label, cells[column.index]])),
      columns,
    });
  }

  return { tasks, warnings, records };
}
