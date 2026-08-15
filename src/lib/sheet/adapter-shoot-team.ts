/**
 * `02_촬영·기획팀`(71컬럼) 어댑터.
 *
 * 컬럼이 71개여도 이 파일에 절차적 분기를 두지 않는다 — 선언적 표와 조립 코드뿐이다.
 * 값을 읽는 일은 `row-mapper`가 이미 한다 (TICKETS.md T3「리스크·미결」).
 *
 * 이 탭의 급소는 **유령 행 25건**이다 (PLAN.md E1). 신원 컬럼 4개는 전부 비어 있고
 * 수식이 만든 `1900-01-01`·`0%`·`false`만 차 있는 행이라, "셀에 값이 있으면 데이터 행"으로
 * 판정하면 1900년 기한의 지연 업무 25건이 대시보드를 덮는다. 판정은 `row-mapper`가
 * `identityHeaders`로 하고, 이 어댑터는 그 목록을 정확히 넘기는 책임만 진다.
 *
 * - 밴드를 스스로 찾지 않는다. 판별은 T2의 `tab-detector`가 끝냈다.
 * - 상태 문자열을 `semantic`으로 바꾸지 않는다 (ADR-009, T4 범위).
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { toText } from '@/lib/sheet/cell-normalizer';
import { mapRows, type FieldMapEntry, type RowMapSpec } from '@/lib/sheet/row-mapper';
import type { StageGroupSpec } from '@/lib/sheet/stage-unpivot';
import type { HeaderBand, SheetGrid } from '@/types/sheet';
import type { ParsedTeamPeriodGoal } from '@/types/goal';
import type { TabParseResult } from '@/types/task';

/**
 * 이 중 하나라도 값이 있어야 데이터 행이다. **수식 결과 컬럼은 쓰지 않는다** (E1).
 * `촬영 담당자`까지 넣는 이유는 기획 담당자만 비어 있는 실제 행이 있기 때문이다.
 */
const IDENTITY_HEADERS = ['업무ID', '프로젝트명', '기획 담당자', '촬영 담당자'];
const ID_HEADER = '업무ID';
const CO_OWNER_HEADER = '공동 담당자';

/**
 * `촬영 담당자`는 어느 필드에도 매핑하지 않는다 — `ownerNameRaw`는 하나뿐이고
 * 담당자가 둘인 구조는 `extras`가 받는다. 신원 판정에 썼다는 이유로 지우지 않는다.
 *
 * 테스트가 `extras` 개수를 이 배열 길이로 계산하므로 export한다 — 상수를 박아 두면
 * 필드가 늘 때 검증식이 따라 움직이지 않는다.
 */
export const FIELD_MAP: FieldMapEntry[] = [
  { header: '프로젝트명', field: 'title', kind: 'text' },
  { header: '기획 담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '우선순위', field: 'priority', kind: 'text' },
  { header: '업무 배정일', field: 'assignedAt', kind: 'date' },
  { header: '최종 결과물 기한', field: 'dueAt', kind: 'date' },
  { header: '현재 업무 단계', field: 'status', kind: 'text' },
  { header: '전체 진행률', field: 'progress', kind: 'progress' },
  { header: '리스크 상태', field: 'riskStatus', kind: 'text' },
  { header: '지연 사유', field: 'delayReason', kind: 'text' },
  { header: '임원진 최종 확인', field: 'approvalStatus', kind: 'text' },
  { header: '다음 조치', field: 'nextAction', kind: 'text' },
  { header: '다음 조치 담당자', field: 'nextActionOwner', kind: 'text' },
  { header: '다음 조치 기한', field: 'nextActionDue', kind: 'date' },
  { header: '비고', field: 'note', kind: 'text' },
];

/**
 * **비워 둔다.** 티켓 T3「리스크·미결」의 완화안 — 촬영팀은 1차에 공통 필드 +
 * `extras` 전량 보존만 하고 단계 언피벗은 편집팀만 먼저 한다. 완료 기준 4는 편집팀만
 * 요구한다. 나중에 이 배열만 채우면 `unpivotStages`가 그대로 붙는 구조로 남겨 두는 것이
 * 이 상수의 존재 이유다 (그룹마다 하위 컬럼 이름이 불규칙해 매핑 규칙이 커진다).
 *
 * export하는 것은 "비어 있다"가 실수가 아니라 결정임을 테스트가 확인하기 위해서다.
 */
export const STAGE_GROUPS: StageGroupSpec[] = [];

/** 헤더 밴드 위쪽 라벨-값 가로 쌍. 라벨 오른쪽 셀이 값이다 */
const GOAL_LABELS = {
  periodLabel: '기준 주차',
  goalText: '이번 주 핵심 목표',
  riskText: '주요 리스크',
} as const;

type GoalField = keyof typeof GOAL_LABELS;

/**
 * 헤더 밴드 **위쪽 행들만** 훑어 라벨과 정확히 일치하는 셀의 오른쪽 값을 읽는다.
 * 행 번호를 하드코딩하지 않는 이유는 장식 행 개수가 팀마다 다르고 사람이 늘리기 때문이다
 * (같은 기법을 `adapter-settings-tab`이 아래쪽 SLA 블록에 쓴다).
 */
function scanTeamPeriodGoal(sheet: SheetGrid, band: HeaderBand): ParsedTeamPeriodGoal[] {
  const found: Partial<Record<GoalField, string>> = {};

  for (let row = 0; row < band.labelRow; row += 1) {
    const cells = sheet.cells[row];
    if (!cells) continue;

    for (let column = 0; column + 1 < sheet.columnCount; column += 1) {
      const label = toText(cells[column]?.value).value;
      if (label === null) continue;

      for (const [field, expected] of Object.entries(GOAL_LABELS) as [GoalField, string][]) {
        if (label !== expected || found[field] !== undefined) continue;
        const value = toText(cells[column + 1]?.value).value;
        if (value !== null) found[field] = value;
      }
    }
  }

  // 셋 다 없으면 빈 배열이다. 경고를 남기지 않는다 — 없는 것이 정상인 탭이 있다.
  if (Object.keys(found).length === 0) return [];

  return [
    {
      teamKey: 'shoot',
      periodLabel: found.periodLabel ?? null,
      goalText: found.goalText ?? null,
      riskText: found.riskText ?? null,
    },
  ];
}

export function parseShootTeamTab(
  sheet: SheetGrid,
  band: HeaderBand,
  ctx: { baseYear: number }
): TabParseResult {
  const spec: RowMapSpec = {
    teamKey: 'shoot',
    identityHeaders: IDENTITY_HEADERS,
    idHeader: ID_HEADER,
    fieldMap: FIELD_MAP,
    coOwnerHeader: CO_OWNER_HEADER,
    // 단계 컬럼이 없으므로 extras에서 뺄 라벨도 없다 (STAGE_GROUPS가 비어 있다).
    baseYear: ctx.baseYear,
  };

  const { tasks, warnings } = mapRows(sheet, band, spec);

  return {
    sheet: sheet.name,
    teamKey: 'shoot',
    tasks,
    goalMetrics: [],
    teamPeriodGoals: scanTeamPeriodGoal(sheet, band),
    briefingLines: [],
    warnings,
  };
}
