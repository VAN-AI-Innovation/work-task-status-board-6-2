/**
 * src/lib/fixtures/seed-tasks.json 생성 스크립트.
 *
 *   npm run seed:build
 *   (= npx vite-node -c vitest.config.ts scripts/fixtures/build-seed-tasks.ts)
 *
 * 시드는 **손으로 지은 가짜가 아니라 픽스처를 파서로 돌려 만든 결과물**이다
 * (PLAN.md「9. 시연 리스크 완화」3번). 그래서 심사자가 `.env` 없이 클론해
 * `STORAGE_DRIVER=memory`로 보는 화면은 가짜 UI가 아니라 **파싱 로직이 실제로 돈 결과**다.
 *
 * `exceljs`를 직접 import하지 않는다. `scripts/`가 그 규칙의 예외이긴 해도(CLAUDE.md),
 * 여기서 워크북을 직접 읽으면 "파서가 실제로 돈다"는 주장이 거짓이 된다 — `parseWorkbook`
 * 하나만 부른다.
 *
 * `-c vitest.config.ts`가 필요한 이유: 이 저장소에 `vite.config.ts`가 없어 `@/` 별칭이
 * `vitest.config.ts`에만 있다. 넘기지 않으면 `sheet-pipeline`이 끌어오는 어댑터들의
 * `@/` import가 풀리지 않는다 (이 파일의 import 스타일과 무관하게 그렇다).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { GoalMetric, ParsedGoalMetric } from '@/types/goal';
import type { ParsedTask, Task, TaskStage, TeamKey } from '@/types/task';

const FIXTURE_NAME = 'sample-workbook.xlsx';
const FIXTURE_PATH = fileURLToPath(
  new URL(`../../src/lib/fixtures/${FIXTURE_NAME}`, import.meta.url)
);
const OUT_PATH = fileURLToPath(new URL('../../src/lib/fixtures/seed-tasks.json', import.meta.url));

/**
 * 픽스처의 연도 없는 날짜(`9/1`)에 붙일 기준 연도. 시드가 재현 가능해야 하므로
 * **오늘 연도를 읽지 않는다** — 해가 바뀌면 재생성 결과가 통째로 달라진다.
 */
const BASE_YEAR = 2026;

/**
 * id는 **결정적으로** 짓는다. `crypto.randomUUID()`를 쓰면 재생성할 때마다 diff가 통째로
 * 바뀌어 "손으로 고치지 않았다"를 리뷰로 확인할 수 없다. 팀별 일련번호면 충분하다 —
 * 시드는 memory 드라이버 전용이고, uuid 형식을 요구하는 것은 supabase 스키마뿐이다.
 */
function seedTaskId(teamKey: TeamKey, ordinal: number): string {
  return `seed-${teamKey}-${String(ordinal).padStart(4, '0')}`;
}

function seedGoalMetricId(teamKey: TeamKey, ordinal: number): string {
  return `seed-goal-${teamKey}-${String(ordinal).padStart(4, '0')}`;
}

/**
 * `ParsedTask` → 저장 모델. `raw`는 **싣지 않는다** — 크고, 화면이 쓰지 않으며,
 * `extras`와 내용이 겹친다.
 *
 * 반면 `extras`는 민감 키(`연락처`·`계정`)까지 값째로 남긴다. 마스킹은 응답 계층(T5·T6)의
 * 일이고 여기서 지우면 admin·lead도 못 본다 (`S6`). 픽스처는 이미 익명화돼 있다.
 *
 * `lastProgressAt`·`sourceUploadId`는 null이다. 시각을 박으면 시드가 시간이 지나며
 * 「장기 미갱신」으로 물들어, 심사자가 처음 여는 화면이 사고 화면이 된다.
 */
function toSeedTask(parsed: ParsedTask, id: string): Omit<Task, 'raw'> {
  return {
    id,
    teamId: parsed.teamKey,
    // 부서 연결은 T5 업로드 커밋의 일이다. 시드가 임의로 채우면 실제 커밋 결과와 갈라진다.
    departmentId: null,
    sourceKey: parsed.sourceKey,
    title: parsed.title,
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    coOwnerNames: parsed.coOwnerNames,
    status: parsed.status,
    approvalStatus: parsed.approvalStatus,
    priority: parsed.priority,
    riskStatus: parsed.riskStatus,
    progress: parsed.progress,
    assignedAt: parsed.assignedAt,
    dueAt: parsed.dueAt,
    nextAction: parsed.nextAction,
    nextActionOwner: parsed.nextActionOwner,
    nextActionDue: parsed.nextActionDue,
    delayReason: parsed.delayReason,
    note: parsed.note,
    extras: parsed.extras,
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: parsed.sourceSheetTab,
    sourceRowIndex: parsed.sourceRowIndex,
  };
}

/**
 * `ParsedGoalMetric` → 저장 모델. 태스크와 같은 이유로 `raw`를 싣지 않는다 (`GoalMetric`에는
 * 애초에 그 필드가 없다). 필드를 하나씩 옮기는 것은 장식이 아니라 **무엇이 빠졌는지**를
 * 코드가 말하게 하려는 것이다 — 나머지 연산자로 흘리면 `raw` 제외가 우연처럼 보인다.
 */
function toSeedGoalMetric(parsed: ParsedGoalMetric, id: string): GoalMetric {
  return {
    id,
    teamId: parsed.teamKey,
    periodLabel: parsed.periodLabel,
    title: parsed.title,
    goalText: parsed.goalText,
    kpiName: parsed.kpiName,
    targetValue: parsed.targetValue,
    actualValue: parsed.actualValue,
    achievementRate: parsed.achievementRate,
    prevPeriodDelta: parsed.prevPeriodDelta,
    channel: parsed.channel,
    // 태스크와 같다 — 이름→구성원 해석은 T5 커밋의 일이다.
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    execStatus: parsed.execStatus,
    analysis: parsed.analysis,
    wentWell: parsed.wentWell,
    needsImprovement: parsed.needsImprovement,
    startedAt: parsed.startedAt,
    dueAt: parsed.dueAt,
    extras: parsed.extras,
    sourceUploadId: null,
    sourceSheetTab: parsed.sourceSheetTab,
    sourceRowIndex: parsed.sourceRowIndex,
  };
}

async function main(): Promise<void> {
  const parsed = await parseWorkbook(readFileSync(FIXTURE_PATH), { baseYear: BASE_YEAR });

  const tasks: Omit<Task, 'raw'>[] = [];
  const stages: TaskStage[] = [];
  const goalMetrics: GoalMetric[] = [];
  const taskOrdinals = new Map<TeamKey, number>();
  const goalOrdinals = new Map<TeamKey, number>();

  const nextOrdinal = (counter: Map<TeamKey, number>, teamKey: TeamKey): number => {
    const next = (counter.get(teamKey) ?? 0) + 1;
    counter.set(teamKey, next);
    return next;
  };

  // 탭 순서 → 행 순서. 파서가 유지하는 순서를 그대로 따라가야 재생성이 재현된다.
  for (const tab of parsed.tabs) {
    for (const task of tab.tasks) {
      const id = seedTaskId(task.teamKey, nextOrdinal(taskOrdinals, task.teamKey));
      tasks.push(toSeedTask(task, id));

      for (const stage of task.stages) {
        stages.push({ ...stage, id: `${id}-stage-${stage.seq}`, taskId: id });
      }
    }

    for (const metric of tab.goalMetrics) {
      const id = seedGoalMetricId(metric.teamKey, nextOrdinal(goalOrdinals, metric.teamKey));
      goalMetrics.push(toSeedGoalMetric(metric, id));
    }
  }

  const payload = { generatedFrom: FIXTURE_NAME, tasks, stages, goalMetrics };
  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(
    `seed-tasks.json — tasks ${tasks.length} / stages ${stages.length} / goalMetrics ${goalMetrics.length}`
  );
}

await main();
