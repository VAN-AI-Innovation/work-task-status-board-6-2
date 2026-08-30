/**
 * 파싱 산출물(`ParsedTask`)과 저장 입력(`TaskUpsertInput`) 사이의 **옮겨 담기**만 한다.
 *
 * 두 타입은 필드 이름이 거의 같지만 계층이 다르다 — 파서는 시트만 알고, 저장 입력은 소속
 * (`teamId`·`departmentId`)과 업로드 출처(`sourceUploadId`)를 안다. 그 차이를 메우는 것이
 * 이 파일의 전부이고, **판정은 하나도 하지 않는다** (신규·변경 분류는 `upload-preview.ts`,
 * 집계는 `lib/domain/`).
 *
 * 여기서 **마스킹하지 않는다.** `extras`의 민감 키와 `raw`는 저장소에 원본으로 들어가고,
 * 가리는 일은 API 응답 계층(step 5·6)이 한다 — 저장 시점에 지우면 감사 경로가 사라진다
 * (`S6`은 "응답에 싣지 마라"이지 "보관하지 마라"가 아니다).
 */

import { taskUpsertKey, type GoalMetricUpsertInput, type TaskUpsertInput } from '@/lib/store/task-repository';
import type { ParseWarning } from '@/types/sheet';
import type { TabParseResult, TeamKey } from '@/types/task';

/**
 * 팀 → 부서. `supabase/migrations/0002_seed_reference.sql`의 `teams.department_id`와 **같아야 한다**
 * (다르면 `tasks.department_id` 외래키가 거부한다). 지금은 세 팀 모두 한 부서라 표가 한 줄이면
 * 충분하다. 부서가 늘면 DB가 진실이 되므로 그때 조회로 바꾼다 — T8·T11에서는 바뀌지 않았다.
 */
export const TEAM_DEPARTMENT: Readonly<Record<TeamKey, string>> = {
  edit: 'contents-marketing',
  shoot: 'contents-marketing',
  marketing: 'contents-marketing',
};

/**
 * 팀 탭이 아닌 탭(설정·대시보드·미판별)은 **빈 배열**이다. 예외를 던지지 않는다 —
 * 워크북에 그런 탭이 섞여 있는 것이 정상이고, 여기서 던지면 파이프라인이 통째로 죽는다.
 */
export function toTaskUpsertInputs(
  tab: TabParseResult,
  uploadId: string | null,
): TaskUpsertInput[] {
  const teamKey = tab.teamKey;
  if (teamKey === null) return [];

  return tab.tasks.map((task) => ({
    teamId: teamKey,
    departmentId: TEAM_DEPARTMENT[teamKey],
    sourceKey: task.sourceKey,
    title: task.title,
    // 시트의 담당자는 자유 입력 문자열이다. `members`와 잇는 해석은 T8의 일이고,
    // 그때까지 이 값은 항상 null이다 — 추측으로 채우면 틀린 사람에게 업무가 붙는다.
    ownerMemberId: null,
    ownerNameRaw: task.ownerNameRaw,
    coOwnerNames: task.coOwnerNames,
    status: task.status,
    approvalStatus: task.approvalStatus,
    priority: task.priority,
    riskStatus: task.riskStatus,
    progress: task.progress,
    assignedAt: task.assignedAt,
    dueAt: task.dueAt,
    nextAction: task.nextAction,
    nextActionOwner: task.nextActionOwner,
    nextActionDue: task.nextActionDue,
    delayReason: task.delayReason,
    note: task.note,
    extras: task.extras,
    raw: task.raw,
    sourceUploadId: uploadId,
    sourceSheetTab: tab.sheet,
    // 파서가 이미 1-based로 준다 (사람이 읽는 좌표). 여기서 더하면 두 번 더해진다
    sourceRowIndex: task.sourceRowIndex,
    stages: task.stages,
  }));
}

/** `GoalMetric`에는 `raw`가 없다 — 지표는 `extras`만으로 복원된다 (`types/goal.ts`) */
export function toGoalMetricUpsertInputs(
  tab: TabParseResult,
  uploadId: string | null,
): GoalMetricUpsertInput[] {
  const teamKey = tab.teamKey;
  if (teamKey === null) return [];

  return tab.goalMetrics.map((metric) => ({
    teamId: teamKey,
    periodLabel: metric.periodLabel,
    title: metric.title,
    goalText: metric.goalText,
    kpiName: metric.kpiName,
    targetValue: metric.targetValue,
    actualValue: metric.actualValue,
    achievementRate: metric.achievementRate,
    prevPeriodDelta: metric.prevPeriodDelta,
    channel: metric.channel,
    ownerMemberId: null,
    ownerNameRaw: metric.ownerNameRaw,
    execStatus: metric.execStatus,
    analysis: metric.analysis,
    wentWell: metric.wentWell,
    needsImprovement: metric.needsImprovement,
    startedAt: metric.startedAt,
    dueAt: metric.dueAt,
    extras: metric.extras,
    sourceUploadId: uploadId,
    sourceSheetTab: tab.sheet,
    sourceRowIndex: metric.sourceRowIndex,
  }));
}

/**
 * 같은 `(teamId, sourceKey)`가 한 업로드 안에 두 번 이상 나온 사실 (`E5`).
 *
 * 자동으로 병합하지 않는다 — 업무ID 없는 탭의 자연키는 `slug(업무명)+담당자`라 오타 하나로
 * 두 업무가 한 키가 되고, 저장소는 뒤엣것으로 덮는다. 그 사고는 미리보기 숫자가 *줄어서*
 * 나타나므로 사람이 눈치채기 어렵다. 그래서 **세어서 보여 준다.**
 *
 * 경고에 `sourceKey`를 담지 않는다 — 키 안에 업무명과 담당자 이름이 들어 있다
 * (CLAUDE.md 보안 규칙). 위치(시트·행)와 코드면 사람이 시트를 열어 찾을 수 있다.
 */
export function collectDuplicateKeyWarnings(
  inputs: readonly TaskUpsertInput[],
): ParseWarning[] {
  const seen = new Set<string>();
  const warnings: ParseWarning[] = [];

  for (const input of inputs) {
    const key = taskUpsertKey(input);
    // 첫 번째 등장은 정상이다. 두 번째부터가 사고다
    if (seen.has(key)) {
      warnings.push({
        code: 'DUPLICATE_SOURCE_KEY',
        sheet: input.sourceSheetTab,
        row: input.sourceRowIndex,
      });
      continue;
    }
    seen.add(key);
  }

  return warnings;
}
