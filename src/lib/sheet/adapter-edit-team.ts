/**
 * `01_편집팀`(16컬럼) 어댑터.
 *
 * 이 파일에 있는 것은 **선언적 표 셋과 조립 코드뿐**이다. 값을 읽고 펴는 일은
 * `row-mapper`·`stage-unpivot`이 이미 한다 — 어댑터가 절차적 분기를 갖기 시작하면
 * 촬영팀 70컬럼에서 유지가 불가능해진다 (TICKETS.md T3「리스크·미결」).
 *
 * - 밴드를 스스로 찾지 않는다. 판별은 T2의 `tab-detector`가 끝냈고 호출자가 결과를 넘긴다.
 * - 상태 문자열을 `semantic`으로 바꾸지 않는다 (ADR-009, T4 범위).
 * - 설정 탭 SLA 표와 잇지 않는다. `slaDays`의 근거는 그룹 헤더의 `(+N일)`이다 (T4 범위).
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { resolveHeaders } from '@/lib/sheet/header-resolver';
import { mapRows, type FieldMapEntry, type RowMapSpec } from '@/lib/sheet/row-mapper';
import { stageTemplateFor } from '@/lib/domain/team-stage-template';
import { stageColumnLabels, unpivotStages, type StageGroupSpec } from '@/lib/sheet/stage-unpivot';
import type { HeaderBand, ParseWarning, SheetGrid } from '@/types/sheet';
import type { ParsedTask, TabParseResult } from '@/types/task';

/** 이 중 하나라도 값이 있어야 데이터 행이다. 수식 결과 컬럼은 쓰지 않는다 (E1) */
const IDENTITY_HEADERS = ['업무명', '담당자'];

const FIELD_MAP: FieldMapEntry[] = [
  { header: '업무명', field: 'title', kind: 'text' },
  { header: '담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '%', field: 'progress', kind: 'progress' },
  { header: '배정일', field: 'assignedAt', kind: 'date' },
  { header: '비고', field: 'note', kind: 'text' },
];

/**
 * 시트에만 있는 것 — 그룹 헤더 원문과 하위 컬럼 이름. **키·이름·SLA는 짓지 않고
 * `stageTemplateFor('edit')`에서 읽는다** — 웹에서 업무를 만들 때 세우는 단계 뼈대와 같은
 * 표여야 하기 때문이다 (`team-stage-template.ts` 머리말 · 그쪽 테스트가 어긋남을 잰다).
 *
 * `slaDays`는 그룹 헤더의 `(+N일)`을 읽은 값이다 — T2가 헤더 원문을 자르지 않고
 * 보존한 이유가 이것이다. `최종본·업로드`에 `content`가 없는 것은 오타가 아니라
 * 시트의 M~O가 3컬럼이기 때문이다.
 *
 * **export하는 이유는 테스트 하나 때문이다.** 두 표가 갈리는 것을 잡을 자리가 달리 없다.
 */
const STAGE_COLUMNS: Readonly<Record<string, { groupHeader: string; cols: StageGroupSpec['cols'] }>> =
  {
    concept: {
      groupHeader: '컨셉·레퍼런스 (+2일)',
      cols: { planned: '예정일', actual: '실제', content: '내용', confirm: '확인' },
    },
    production: {
      groupHeader: '제작 진행 (+5일)',
      cols: { planned: '예정일', actual: '실제', content: '내용', confirm: '확인' },
    },
    final: {
      groupHeader: '최종본·업로드 (+7일)',
      cols: { planned: '예정일', actual: '실제', confirm: '확인' },
    },
  };

export const EDIT_TEAM_STAGE_GROUPS: StageGroupSpec[] = stageTemplateFor('edit').map((stage) => ({
  key: stage.key,
  label: stage.label,
  slaDays: stage.slaDays,
  ...STAGE_COLUMNS[stage.key]!,
}));

const STAGE_GROUPS = EDIT_TEAM_STAGE_GROUPS;

export function parseEditTeamTab(
  sheet: SheetGrid,
  band: HeaderBand,
  ctx: { baseYear: number }
): TabParseResult {
  const columns = resolveHeaders(sheet, band);

  const spec: RowMapSpec = {
    teamKey: 'edit',
    identityHeaders: IDENTITY_HEADERS,
    fieldMap: FIELD_MAP,
    // 단계 컬럼이 extras에도 남으면 사이드 패널에 같은 값이 두 번 뜬다.
    excludeFromExtras: stageColumnLabels(columns, STAGE_GROUPS),
    baseYear: ctx.baseYear,
  };

  const { tasks, warnings, records } = mapRows(sheet, band, spec);
  const stageWarnings: ParseWarning[] = [];

  // `records[i]`는 `tasks[i]`와 같은 순서다 (row-mapper의 계약).
  const withStages: ParsedTask[] = tasks.map((task, index) => {
    const unpivoted = unpivotStages(records[index], STAGE_GROUPS, {
      sheet: sheet.name,
      baseYear: ctx.baseYear,
    });
    stageWarnings.push(...unpivoted.warnings);
    return { ...task, stages: unpivoted.stages };
  });

  return {
    sheet: sheet.name,
    teamKey: 'edit',
    tasks: withStages,
    goalMetrics: [],
    teamPeriodGoals: [],
    briefingLines: [],
    warnings: [...warnings, ...stageWarnings],
  };
}
