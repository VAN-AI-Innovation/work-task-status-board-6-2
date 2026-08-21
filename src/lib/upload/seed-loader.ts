/**
 * 시드 JSON → **확정 입력**(`CommitPayload`).
 *
 * 심사자가 클론 직후 `.env` 없이 여는 첫 화면이 백지가 되지 않게 하는 경로다
 * (`PLAN.md`「온보딩 여정 — 첫 5분」). 다만 이 파일이 저장소에 직접 쓰지는 않는다 —
 * 만들어 낸 payload는 `uploads.parse_result`에 담겨 **실제 확정 경로**(`commitUpload`)로
 * 흘러간다. 시드 전용 쓰기 경로를 따로 두면 "가짜 UI가 아니라 파싱 로직이 실제로 돈다"는
 * 시연 근거(`PLAN.md` 9-3)가 사라진다.
 *
 * ### `store-factory.ts`의 `createSeededMemoryStore`와 코드를 공유하지 않는다
 *
 * 같은 파일을 읽지만 **목적이 다르다.** 그쪽은 메모리 저장소의 **초기값**이라 `Task`
 * (id·`lastProgressAt`을 이미 가진 완성형)를 만들고, 이쪽은 실제 저장소에 **쓰는 입력**이라
 * `TaskUpsertInput`(신원을 저장소가 발급하는 미완성형)을 만든다. 억지로 한 함수로 묶으면
 * 두 타입 사이를 오가는 변환이 하나 더 생기고, 그 변환이 어느 쪽 규칙을 따르는지 아무도
 * 모르게 된다. **이 중복은 의도된 것이다.**
 *
 * 시드에는 `raw`가 없다 — 감사용 원본은 실제 업로드만 만들 수 있고, 시드가 그것을 흉내 내면
 * 거짓이 된다(`store-factory.ts`가 같은 이유로 같은 말을 한다). 여기서는 빈 객체로 채운다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { GoalMetricUpsertInput, TaskUpsertInput } from '@/lib/store/task-repository';
import type { CommitPayload } from '@/lib/upload/upload-preview';
import seedJson from '@/lib/fixtures/seed-tasks.json';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskStage, TeamKey } from '@/types/task';

interface SeedFile {
  generatedFrom: string;
  tasks: Omit<Task, 'raw'>[];
  stages: TaskStage[];
  goalMetrics: GoalMetric[];
}

const SEED = seedJson as unknown as SeedFile;

/**
 * 필드를 하나씩 옮겨 적는다. `Omit`으로 덜어내면 저장 모델에 새 필드가 생겼을 때 **자동으로**
 * 통과하는데, 다음에 늘어날 필드가 시드에 있으리라는 보장이 없다 (`task-response.ts`가 같은
 * 이유로 같은 선택을 했다).
 */
function toTaskInput(
  task: Omit<Task, 'raw'>,
  stages: readonly Omit<TaskStage, 'id' | 'taskId'>[],
): TaskUpsertInput {
  return {
    teamId: task.teamId,
    departmentId: task.departmentId,
    sourceKey: task.sourceKey,
    title: task.title,
    ownerMemberId: task.ownerMemberId,
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
    raw: {},
    // 시드는 어떤 업로드에서도 나오지 않았다. 업로드 id를 지어내면 없는 이력을 가리킨다
    sourceUploadId: null,
    sourceSheetTab: task.sourceSheetTab,
    sourceRowIndex: task.sourceRowIndex,
    stages,
  };
}

function toStageInput(stage: TaskStage): Omit<TaskStage, 'id' | 'taskId'> {
  return {
    seq: stage.seq,
    stageKey: stage.stageKey,
    stageLabel: stage.stageLabel,
    plannedDate: stage.plannedDate,
    actualDate: stage.actualDate,
    content: stage.content,
    confirmStatus: stage.confirmStatus,
    slaDays: stage.slaDays,
  };
}

function toGoalMetricInput(metric: GoalMetric): GoalMetricUpsertInput {
  return {
    teamId: metric.teamId,
    periodLabel: metric.periodLabel,
    title: metric.title,
    goalText: metric.goalText,
    kpiName: metric.kpiName,
    targetValue: metric.targetValue,
    actualValue: metric.actualValue,
    achievementRate: metric.achievementRate,
    prevPeriodDelta: metric.prevPeriodDelta,
    channel: metric.channel,
    ownerMemberId: metric.ownerMemberId,
    ownerNameRaw: metric.ownerNameRaw,
    execStatus: metric.execStatus,
    analysis: metric.analysis,
    wentWell: metric.wentWell,
    needsImprovement: metric.needsImprovement,
    startedAt: metric.startedAt,
    dueAt: metric.dueAt,
    extras: metric.extras,
    sourceUploadId: null,
    sourceSheetTab: metric.sourceSheetTab,
    sourceRowIndex: metric.sourceRowIndex,
  };
}

/**
 * 호출마다 **새 객체**를 만든다. 모듈 상수를 그대로 넘기면 한 번 확정한 payload를 저장소가
 * 손댔을 때 다음 호출이 오염된 값을 쓰게 된다 (`createSeededMemoryStore`가 같은 이유로
 * 호출마다 새 저장소를 만든다).
 */
export function buildSeedPayload(): CommitPayload {
  const seed = structuredClone(SEED);

  const stagesByTask = new Map<string, Omit<TaskStage, 'id' | 'taskId'>[]>();
  for (const stage of seed.stages) {
    const list = stagesByTask.get(stage.taskId) ?? [];
    list.push(toStageInput(stage));
    stagesByTask.set(stage.taskId, list);
  }

  const tasks = seed.tasks.map((task) => toTaskInput(task, stagesByTask.get(task.id) ?? []));
  const goalMetrics = seed.goalMetrics.map(toGoalMetricInput);

  const touched = new Set<TeamKey>([
    ...tasks.map((task) => task.teamId),
    ...goalMetrics.map((metric) => metric.teamId),
  ]);

  // `upload-preview.ts`와 **같은 방식**으로 만든다 — 순서가 `TEAM_KEYS`를 따라야 화면의
  // 팀 나열이 업로드 경로와 시드 경로에서 갈라지지 않는다
  return { tasks, goalMetrics, teamKeys: TEAM_KEYS.filter((key) => touched.has(key)) };
}
