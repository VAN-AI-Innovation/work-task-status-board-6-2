/**
 * 단계 컬럼 그룹을 `ParsedStage` 행으로 펴는 **언피벗 엔진**.
 *
 * 시트에서 단계는 옆으로 펼쳐진 wide 포맷이고 `예정일`·`실제` 같은 하위 라벨이
 * 그룹마다 반복된다. **하위 라벨만으로는 컬럼을 구분할 수 없다** — T2의 헤더 결합이
 * 이걸 위해 있었고, 여기서 그 경로를 두 축(그룹 헤더 + 마지막 조각)으로 쓴다.
 *
 * - 팀 이름·단계 이름을 이 파일에 두지 않는다. 선언적 표는 어댑터가 갖는다.
 * - 라벨 문자열을 통째로 비교하지 않는다. 구분자 규칙이 바뀌면 전부 깨진다.
 * - 값에 해석을 붙이지 않는다. 불리언 `확인`은 `'true'`/`'false'` 그대로 싣고
 *   상태 해석은 T4의 `task-semantic`이 설정 탭 레지스트리를 근거로 한다 (ADR-009).
 * - SLA는 `spec.slaDays`를 복사만 한다. 설정 탭 레지스트리와 잇는 일은 T4다.
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { toDateString, toText, type NormalizeResult } from '@/lib/sheet/cell-normalizer';
import type { RowRecord } from '@/lib/sheet/row-mapper';
import type { HeaderColumn, ParseWarning, SheetCellValue } from '@/types/sheet';
import type { ParsedStage } from '@/types/task';

export interface StageGroupSpec {
  /** 안정 키. 시트 문자열이 바뀌어도 유지된다 */
  key: string;
  /** 화면에 보일 짧은 이름 */
  label: string;
  /** 헤더 결합 경로의 **첫 조각**과 정확히 일치해야 한다 */
  groupHeader: string;
  /** 시트 그룹 헤더의 `(+N일)`에서 읽은 값. 없으면 null */
  slaDays: number | null;
  /** 값은 경로의 **마지막 조각**과 정확히 일치해야 한다 */
  cols: {
    planned?: string;
    actual?: string;
    content?: string;
    confirm?: string;
  };
}

export interface UnpivotResult {
  stages: ParsedStage[];
  warnings: ParseWarning[];
}

const lastSegment = (column: HeaderColumn): string => column.path[column.path.length - 1];

/** 두 축을 모두 만족하는 컬럼. 같은 자리에 둘이면 첫 컬럼을 쓴다 (`row-mapper`와 같은 규칙) */
function findColumn(
  groupColumns: HeaderColumn[],
  header: string | undefined
): HeaderColumn | null {
  if (header === undefined) return null;
  return groupColumns.find((column) => lastSegment(column) === header) ?? null;
}

export function unpivotStages(
  record: RowRecord,
  groups: StageGroupSpec[],
  ctx: { sheet: string; baseYear: number }
): UnpivotResult {
  const stages: ParsedStage[] = [];
  const warnings: ParseWarning[] = [];

  groups.forEach((spec, seq) => {
    const groupColumns = record.columns.filter((column) => column.path[0] === spec.groupHeader);

    if (groupColumns.length === 0) {
      // 예외를 던지지 않는다. 시트에서 그룹이 통째로 빠져도 나머지 단계는 살아야 한다.
      warnings.push({ code: 'STAGE_GROUP_NOT_FOUND', sheet: ctx.sheet, row: record.row + 1 });
    }

    const read = (
      header: string | undefined,
      convert: (value: SheetCellValue | undefined) => NormalizeResult<string>
    ): string | null => {
      const column = findColumn(groupColumns, header);
      if (column === null) return null;

      const { value, warning } = convert(record.cells.get(column.label)?.value);
      if (warning) {
        warnings.push({
          code: warning,
          sheet: ctx.sheet,
          row: record.row + 1,
          column: column.index + 1,
        });
      }
      return value;
    };

    const date = (value: SheetCellValue | undefined) =>
      toDateString(value, { baseYear: ctx.baseYear });

    stages.push({
      seq, // groups 배열 순서 그대로
      stageKey: spec.key,
      // 시트 원문을 싣는다. 화면에 시트와 같은 글자가 떠야 사용자가 대조할 수 있다.
      stageLabel: spec.groupHeader,
      plannedDate: read(spec.cols.planned, date),
      actualDate: read(spec.cols.actual, date),
      content: read(spec.cols.content, toText),
      confirmStatus: read(spec.cols.confirm, toText),
      slaDays: spec.slaDays,
    });
  });

  return { stages, warnings };
}

/**
 * 어댑터가 `RowMapSpec.excludeFromExtras`에 넘길 컬럼 라벨.
 *
 * **`cols`가 실제로 가리키는 컬럼만** 돌려준다. 그룹에 속했지만 어느 단계 필드에도
 * 실리지 않는 컬럼까지 빼면 `extras`에도 단계에도 없어 통째로 사라지고,
 * "매핑되지 않은 컬럼은 누락 없이 `extras`"(T3 완료 기준 3)가 깨진다.
 */
export function stageColumnLabels(columns: HeaderColumn[], groups: StageGroupSpec[]): string[] {
  const labels = new Set<string>();

  for (const spec of groups) {
    const groupColumns = columns.filter((column) => column.path[0] === spec.groupHeader);
    for (const header of [spec.cols.planned, spec.cols.actual, spec.cols.content, spec.cols.confirm]) {
      const column = findColumn(groupColumns, header);
      if (column) labels.add(column.label);
    }
  }

  return [...labels];
}
