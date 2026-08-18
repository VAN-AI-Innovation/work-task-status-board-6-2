/**
 * `03_마케팅·관리팀` **B섹션**(주간 마케팅 실행·성과 관리) → `ParsedGoalMetric[]`.
 *
 * 과제 요구 4번("부서별 목표와 실제 성과 비교")의 데이터는 새로 만드는 게 아니라
 * **시트에 이미 있다** (PLAN.md 「데이터 모델」). 여기서 하는 일은 그 컬럼들을 옮기는 것뿐이다.
 *
 * 두 가지를 **하지 않는다** —
 * - **달성률을 `actual/target`으로 재계산하지 않는다.** 시트 수식이 어긋난 행이 실제로 있는데
 *   파서가 고쳐 버리면 T4 `summarizeGoals`의 불일치 경고(T4 완료 기준 7)가 볼 증거가 사라진다.
 * - **달성률에 `toProgress`를 쓰지 않는다.** 진행률은 100 초과가 이상하지만 달성률 120%는
 *   정상이라 `PROGRESS_OUT_OF_RANGE`가 잡음이 된다 (아래 `toRate`).
 *
 * - 섹션을 스스로 찾지 않는다. `splitSections`의 결과를 인자로 받는다.
 * - `mapRows`를 쓰지 않는다 — `ParsedGoalMetric`은 `ParsedTask`와 필드가 달라, 한 함수가
 *   두 산출물을 만들면 양쪽이 뒤엉킨다. 대신 같은 규칙(신원 판정·숨김 행·extras·경고 좌표)을
 *   따르고, 그 규칙을 담은 헬퍼는 `row-mapper`에서 가져다 쓴다.
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import {
  toDateString,
  toNumber,
  toText,
  type NormalizeResult,
} from '@/lib/sheet/cell-normalizer';
import { resolveHeaders } from '@/lib/sheet/header-resolver';
import { isFormulaCell, lastSegment, toExtraValue, warn } from '@/lib/sheet/row-mapper';
import type { SheetSection } from '@/lib/sheet/section-splitter';
import { validateParsedGoalMetric } from '@/lib/sheet/task-schema';
import type { ParsedGoalMetric } from '@/types/goal';
import type { HeaderColumn, ParseWarning, SheetCell, SheetGrid } from '@/types/sheet';
import type { ExtraValue, TeamKey } from '@/types/task';

/** 이 중 하나 이상에 값이 있어야 데이터 행이다. 수식 셀은 근거로 쓰지 않는다 (E1) */
const IDENTITY_HEADERS = ['마케팅 과제명', '실행 담당자'];

type GoalScalarField =
  | 'periodLabel'
  | 'title'
  | 'ownerNameRaw'
  | 'goalText'
  | 'channel'
  | 'execStatus'
  | 'startedAt'
  | 'dueAt'
  | 'kpiName'
  | 'targetValue'
  | 'actualValue'
  | 'achievementRate'
  | 'prevPeriodDelta'
  | 'analysis'
  | 'wentWell'
  | 'needsImprovement';

interface GoalFieldEntry {
  /** 헤더 결합 경로의 **마지막 조각**과 정확히 일치해야 한다 */
  header: string;
  field: GoalScalarField;
  kind: 'text' | 'number' | 'date' | 'percent';
}

/**
 * `목표`·`목표 KPI`·`목표 수치`가 **마지막 조각 정확 일치**로 갈린다.
 * 접두 일치를 쓰면 `목표` 하나가 셋을 다 잡아 값이 뒤섞인다.
 *
 * 테스트가 `extras` 개수를 이 배열 길이로 계산하므로 export한다 — 상수를 박아 두면
 * 필드가 늘 때 검증식이 따라 움직이지 않는다.
 */
export const GOAL_FIELD_MAP: GoalFieldEntry[] = [
  { header: '기준 주차', field: 'periodLabel', kind: 'text' },
  { header: '마케팅 과제명', field: 'title', kind: 'text' },
  { header: '실행 담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '목표', field: 'goalText', kind: 'text' },
  { header: '실행 채널', field: 'channel', kind: 'text' },
  { header: '실행 상태', field: 'execStatus', kind: 'text' },
  { header: '실행 시작일', field: 'startedAt', kind: 'date' },
  { header: '실행 기한', field: 'dueAt', kind: 'date' },
  { header: '목표 KPI', field: 'kpiName', kind: 'text' },
  { header: '목표 수치', field: 'targetValue', kind: 'number' },
  { header: '실제 성과', field: 'actualValue', kind: 'number' },
  { header: '달성률', field: 'achievementRate', kind: 'percent' },
  { header: '직전 주 대비 변화', field: 'prevPeriodDelta', kind: 'text' },
  { header: '성과 분석', field: 'analysis', kind: 'text' },
  { header: '잘된 점', field: 'wentWell', kind: 'text' },
  { header: '개선 필요사항', field: 'needsImprovement', kind: 'text' },
];

/**
 * 달성률 전용 변환. 엑셀에서 `120%`는 셀 값이 `1.2`다 (E3).
 * `toProgress`와 다른 점은 **범위 경고를 내지 않는다**는 것 하나다 — 달성률은 100 초과가 정상이다.
 * 값을 퍼센트 수치로 옮기기만 하고 목표·실적으로 다시 계산하지 않는다.
 */
function toRate(cell: SheetCell | undefined): NormalizeResult<number> {
  const { value, warning } = toNumber(cell?.value);
  if (value === null) return { value: null, warning };
  const percent = cell?.numFmt?.includes('%') ? value * 100 : value;
  // 1.2 * 100이 120.00000000000001이 되는 부동소수 문제를 여기서 끝낸다.
  return { value: Math.round(percent), warning };
}

type ScalarValue = string | number | null;

function normalizeField(
  entry: GoalFieldEntry,
  cell: SheetCell | undefined,
  baseYear: number
): NormalizeResult<ScalarValue> {
  switch (entry.kind) {
    case 'number':
      return toNumber(cell?.value);
    case 'date':
      return toDateString(cell?.value, { baseYear });
    case 'percent':
      return toRate(cell);
    default:
      return toText(cell?.value);
  }
}

/** 헤더 매칭은 섹션당 한 번이다. 행마다 다시 풀면 모호 경고가 행 수만큼 불어난다 */
function resolveFieldColumns(
  columns: HeaderColumn[],
  sheetName: string,
  labelRow: number
): { bindings: { entry: GoalFieldEntry; column: HeaderColumn }[]; warnings: ParseWarning[] } {
  const bindings: { entry: GoalFieldEntry; column: HeaderColumn }[] = [];
  const warnings: ParseWarning[] = [];

  for (const entry of GOAL_FIELD_MAP) {
    const matched = columns.filter((column) => lastSegment(column) === entry.header);
    if (matched.length === 0) continue;

    // 첫 컬럼을 조용히 채택하지 않는다. 어느 쪽이 맞는지는 사람이 안다 (row-mapper와 같은 규칙).
    if (matched.length > 1) {
      warnings.push(warn('AMBIGUOUS_FIELD_HEADER', sheetName, labelRow, matched[0].index));
    }

    bindings.push({ entry, column: matched[0] });
  }

  return { bindings, warnings };
}

export function parseGoalMetrics(
  sheet: SheetGrid,
  section: SheetSection,
  ctx: { teamKey: TeamKey; baseYear: number }
): { goalMetrics: ParsedGoalMetric[]; warnings: ParseWarning[] } {
  const band = section.band;
  // 자유 텍스트 섹션이 넘어와도 예외를 던지지 않는다 (CLAUDE.md 하드 실패 금지).
  if (band === null) return { goalMetrics: [], warnings: [] };

  const columns = resolveHeaders(sheet, band);
  const { bindings, warnings } = resolveFieldColumns(columns, sheet.name, band.labelRow);

  const identityColumns = columns.filter((column) =>
    IDENTITY_HEADERS.includes(lastSegment(column))
  );
  const excluded = new Set(bindings.map((binding) => binding.column.label));

  const hidden = new Set(sheet.hiddenRows);
  const endRow = Math.min(section.endRow, sheet.rowCount - 1);

  const goalMetrics: ParsedGoalMetric[] = [];

  for (let row = band.labelRow + 1; row <= endRow; row += 1) {
    if (hidden.has(row)) continue; // 작업용 임시 행이라는 것이 시트 작성자의 의도다 (E6)

    const cells = sheet.cells[row];
    if (!cells) continue;

    const isDataRow = identityColumns.some((column) => {
      const cell = cells[column.index];
      if (isFormulaCell(cell?.value)) return false;
      return toText(cell?.value).value !== null;
    });
    // 수식만 남은 행은 조용히 건너뛴다. 경고를 내면 진짜 경고가 묻힌다 (E1).
    if (!isDataRow) continue;

    const values: Partial<Record<GoalScalarField, ScalarValue>> = {};
    for (const { entry, column } of bindings) {
      const result = normalizeField(entry, cells[column.index], ctx.baseYear);
      values[entry.field] = result.value;
      if (result.warning) warnings.push(warn(result.warning, sheet.name, row, column.index));
    }

    const raw: Record<string, ExtraValue> = {};
    const extras: Record<string, ExtraValue> = {};
    for (const column of columns) {
      const value = toExtraValue(cells[column.index], ctx.baseYear);
      raw[column.label] = value;
      // 값이 null인 컬럼도 키를 남긴다 — "컬럼이 있는데 비었다"와 "컬럼이 없다"의 구분이다.
      if (!excluded.has(column.label)) extras[column.label] = value;
    }

    const text = (field: GoalScalarField): string | null => {
      const value = values[field];
      if (value === null || value === undefined) return null;
      return typeof value === 'number' ? String(value) : value;
    };
    const num = (field: GoalScalarField): number | null => {
      const value = values[field];
      return typeof value === 'number' ? value : null;
    };

    const metric: ParsedGoalMetric = {
      teamKey: ctx.teamKey,
      periodLabel: text('periodLabel'),
      title: text('title'),
      goalText: text('goalText'),
      kpiName: text('kpiName'),
      targetValue: num('targetValue'),
      actualValue: num('actualValue'),
      achievementRate: num('achievementRate'),
      prevPeriodDelta: text('prevPeriodDelta'),
      channel: text('channel'),
      ownerNameRaw: text('ownerNameRaw'),
      execStatus: text('execStatus'),
      analysis: text('analysis'),
      wentWell: text('wentWell'),
      needsImprovement: text('needsImprovement'),
      startedAt: text('startedAt'),
      dueAt: text('dueAt'),
      extras,
      raw,
      sourceSheetTab: sheet.name,
      sourceRowIndex: row + 1,
    };

    // 검증 실패로 지표를 버리지 않는다 (CLAUDE.md 파서 하드 실패 금지).
    warnings.push(...validateParsedGoalMetric(metric));

    goalMetrics.push(metric);
  }

  return { goalMetrics, warnings };
}
