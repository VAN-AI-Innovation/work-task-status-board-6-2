/**
 * `TaskRepository` 구현이 **함께 통과해야 하는** 계약. memory(step 7)와 supabase(step 9)가
 * 이 파일 하나를 각자 호출한다 (T4 완료 기준 8).
 *
 * 테스트를 구현별로 복사하지 않는 이유: 복사한 순간 두 벌이 조금씩 갈라지고, 갈라진 계약은
 * 계약이 아니다. 그래서 검증 로직은 `REPOSITORY_CONTRACT_CASES`라는 **평범한 함수 목록**으로
 * 두고, `describeRepositoryContract`는 그것을 `it`로 감싸기만 한다. 덕분에
 * `assertRepositoryContract`로 "계약이 틀린 구현을 실제로 잡는지"까지 검사할 수 있다.
 *
 * **계약 테스트 전용 파일이다.** `vitest`를 import하므로 제품 코드에서 import하지 마라.
 * `src/lib/store/`에 두는 이유는 두 구현의 테스트가 나란히 쓰기 때문이다.
 */

import { describe, expect, it } from 'vitest';

import {
  matchesTaskFilter,
  type GoalMetricUpsertInput,
  type TaskFilter,
  type TaskRepository,
  type TaskUpsertInput,
} from '@/lib/store/task-repository';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskStage } from '@/types/task';

export interface RepositoryFixture {
  create(): Promise<TaskRepository>;
  /** 각 테스트 전에 저장소를 비운다 */
  reset(repo: TaskRepository): Promise<void>;
}

export interface RepositoryContractCase {
  name: string;
  run(repo: TaskRepository): Promise<void>;
}

/** 업로드 시각. 저장소는 시간을 읽지 않고 이 값을 주입받는다 */
const FIRST_UPLOAD_AT = '2026-07-20T09:00:00.000Z';
const SECOND_UPLOAD_AT = '2026-07-27T09:00:00.000Z';

function taskInput(overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'card-a',
    title: '카드뉴스 A',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-07-20',
    dueAt: '2026-07-27',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    sourceUploadId: 'upload-1',
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    stages: [],
    ...overrides,
  };
}

function stageInput(seq: number, overrides: Partial<Omit<TaskStage, 'id' | 'taskId'>> = {}) {
  return {
    seq,
    stageKey: `stage-${seq}`,
    stageLabel: `단계 ${seq}`,
    plannedDate: null,
    actualDate: null,
    content: null,
    confirmStatus: null,
    slaDays: null,
    ...overrides,
  };
}

function goalInput(overrides: Partial<GoalMetricUpsertInput> = {}): GoalMetricUpsertInput {
  return {
    teamId: 'marketing',
    periodLabel: '2026-07 4주차',
    title: '인스타 팔로워 증대',
    goalText: null,
    kpiName: '팔로워 증가 수',
    targetValue: 100,
    actualValue: 120,
    achievementRate: 120,
    prevPeriodDelta: null,
    channel: '인스타그램',
    ownerMemberId: null,
    ownerNameRaw: '최마케팅',
    execStatus: null,
    analysis: null,
    wentWell: null,
    needsImprovement: null,
    startedAt: null,
    dueAt: null,
    extras: {},
    sourceUploadId: 'upload-1',
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 25,
    ...overrides,
  };
}

/** 두 건짜리 기본 시드. 팀도 자연키도 다르다 */
const SEED_A = taskInput({ sourceKey: 'card-a', title: '카드뉴스 A' });
const SEED_B = taskInput({
  sourceKey: 'vlog-b',
  teamId: 'shoot',
  title: '브이로그 촬영',
  ownerNameRaw: '박촬영',
  status: '완료',
  progress: 100,
  dueAt: '2026-08-05',
  sourceSheetTab: '02_촬영·기획팀',
  sourceRowIndex: 7,
});

function findBySourceKey(tasks: readonly Task[], sourceKey: string): Task {
  const found = tasks.find((task) => task.sourceKey === sourceKey);
  if (!found) throw new Error(`계약 위반: sourceKey ${sourceKey} 건이 조회되지 않았다`);
  return found;
}

function findGoal(metrics: readonly GoalMetric[], title: string): GoalMetric {
  const found = metrics.find((metric) => metric.title === title);
  if (!found) throw new Error(`계약 위반: 목표 지표 ${title} 건이 조회되지 않았다`);
  return found;
}

/** 필터 결과가 `matchesTaskFilter` 기준 구현과 같은지 본다 */
async function expectFilterMatchesReference(repo: TaskRepository, filter: TaskFilter): Promise<void> {
  const all = await repo.listTasks();
  const expected = all
    .filter((task) => matchesTaskFilter(task, filter))
    .map((task) => task.sourceKey)
    .sort();
  const actual = (await repo.listTasks(filter)).map((task) => task.sourceKey).sort();
  expect(actual, `필터 ${JSON.stringify(filter)}`).toEqual(expected);
}

export const REPOSITORY_CONTRACT_CASES: readonly RepositoryContractCase[] = [
  {
    name: '1. 빈 저장소는 빈 목록과 null을 돌려준다',
    async run(repo) {
      expect(await repo.listTasks()).toEqual([]);
      expect(await repo.getTask('없는id')).toBeNull();
    },
  },
  {
    name: '2. 신규 2건을 넣으면 created 2건이고 조회된다',
    async run(repo) {
      const result = await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: FIRST_UPLOAD_AT });
      expect({ ...result, events: result.events.length }).toEqual({
        created: 2,
        updated: 0,
        unchanged: 0,
        events: 0,
      });

      const tasks = await repo.listTasks();
      expect(tasks).toHaveLength(2);
      const a = findBySourceKey(tasks, 'card-a');
      expect(a.id).toBeTruthy();
      expect(a.title).toBe('카드뉴스 A');
      expect(a.lastProgressAt).toBe(FIRST_UPLOAD_AT);
      expect(await repo.getTask(a.id)).not.toBeNull();
    },
  },
  {
    name: '3. 같은 파일 재업로드는 unchanged이고 lastProgressAt이 그대로다 (UC-03)',
    async run(repo) {
      await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: FIRST_UPLOAD_AT });
      const result = await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: SECOND_UPLOAD_AT });

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 0,
        unchanged: 2,
      });
      expect(result.events).toHaveLength(0);

      for (const task of await repo.listTasks()) {
        expect(task.lastProgressAt).toBe(FIRST_UPLOAD_AT);
      }
    },
  },
  {
    name: '4. 한 건의 progress만 바꾸면 그 건만 updated이고 이벤트가 1건이다',
    async run(repo) {
      await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: FIRST_UPLOAD_AT });
      const result = await repo.upsertTasks(
        [{ ...SEED_A, progress: 60 }, SEED_B],
        { occurredAt: SECOND_UPLOAD_AT, uploadId: 'upload-2' },
      );

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 1,
        unchanged: 1,
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].changedFields).toEqual(['progress']);
      expect(result.events[0].occurredAt).toBe(SECOND_UPLOAD_AT);
      expect(result.events[0].uploadId).toBe('upload-2');

      const tasks = await repo.listTasks();
      const changed = findBySourceKey(tasks, 'card-a');
      const untouched = findBySourceKey(tasks, 'vlog-b');
      expect(result.events[0].taskId).toBe(changed.id);
      expect(changed.progress).toBe(60);
      expect(changed.lastProgressAt).toBe(SECOND_UPLOAD_AT);
      expect(untouched.lastProgressAt).toBe(FIRST_UPLOAD_AT);
    },
  },
  {
    name: '5. 행이 밀리거나 업로드 id만 바뀐 것은 변경이 아니다',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const result = await repo.upsertTasks(
        [{ ...SEED_A, sourceRowIndex: 99, sourceUploadId: 'upload-2' }],
        { occurredAt: SECOND_UPLOAD_AT, uploadId: 'upload-2' },
      );

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
      });
      expect(result.events).toHaveLength(0);
      expect(findBySourceKey(await repo.listTasks(), 'card-a').lastProgressAt).toBe(FIRST_UPLOAD_AT);
    },
  },
  {
    name: '6. progress의 0과 null은 다른 값이다',
    async run(repo) {
      await repo.upsertTasks([{ ...SEED_A, progress: 0 }], { occurredAt: FIRST_UPLOAD_AT });
      const result = await repo.upsertTasks([{ ...SEED_A, progress: null }], {
        occurredAt: SECOND_UPLOAD_AT,
      });

      expect(result.updated).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(result.events[0]?.changedFields).toEqual(['progress']);
      expect(findBySourceKey(await repo.listTasks(), 'card-a').progress).toBeNull();
    },
  },
  {
    name: '7. extras는 값이 바뀌면 변경, 키 순서만 다르면 무변경이다',
    async run(repo) {
      const seeded = { ...SEED_A, extras: { 채널: '인스타', 비고: null } };
      await repo.upsertTasks([seeded], { occurredAt: FIRST_UPLOAD_AT });

      const sameOtherOrder = await repo.upsertTasks(
        [{ ...seeded, extras: { 비고: null, 채널: '인스타' } }],
        { occurredAt: SECOND_UPLOAD_AT },
      );
      expect(sameOtherOrder.unchanged).toBe(1);
      expect(sameOtherOrder.updated).toBe(0);

      const changed = await repo.upsertTasks(
        [{ ...seeded, extras: { 채널: '유튜브', 비고: null } }],
        { occurredAt: SECOND_UPLOAD_AT },
      );
      expect(changed.updated).toBe(1);
      expect(changed.events[0]?.changedFields).toEqual(['extras']);
    },
  },
  {
    name: '8. 같은 자연키가 배열에 두 번 오면 뒤엣것이 이긴다',
    async run(repo) {
      const result = await repo.upsertTasks(
        [SEED_A, { ...SEED_A, title: '카드뉴스 A (수정)', progress: 90 }],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      const tasks = await repo.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('카드뉴스 A (수정)');
      expect(tasks[0].progress).toBe(90);
      expect(result.created + result.updated + result.unchanged).toBe(1);
    },
  },
  {
    name: '9. 팀이 다르면 같은 sourceKey도 별개 업무다',
    async run(repo) {
      await repo.upsertTasks(
        [SEED_A, { ...SEED_A, teamId: 'marketing', title: '같은 키 다른 팀' }],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      const tasks = await repo.listTasks();
      expect(tasks).toHaveLength(2);
      expect(new Set(tasks.map((task) => task.teamId))).toEqual(new Set(['edit', 'marketing']));
    },
  },
  {
    name: '10. listTasks 필터가 matchesTaskFilter 기준 구현과 같다',
    async run(repo) {
      await repo.upsertTasks(
        [
          SEED_A,
          SEED_B,
          taskInput({
            sourceKey: 'inquiry-c',
            teamId: 'marketing',
            title: 'SNS Inquiry',
            ownerNameRaw: '최마케팅',
            status: '보류',
            dueAt: null,
            sourceSheetTab: '03_마케팅·관리팀',
          }),
        ],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      for (const filter of [
        { teamKeys: ['edit'] as const },
        { teamKeys: ['edit', 'marketing'] as const },
        { sourceKeys: ['card-a', 'vlog-b'] as const },
        { ownerNameRaw: '박촬영' },
        { dueFrom: '2026-07-27', dueTo: '2026-08-05' },
        { dueFrom: '2026-08-05' },
        { dueTo: '2026-07-27' },
        { statuses: ['진행 중', '완료'] as const },
        { search: 'sns' },
        { search: '김편집' },
        { teamKeys: ['marketing'] as const, statuses: ['보류'] as const },
      ]) {
        await expectFilterMatchesReference(repo, filter);
      }

      expect(await repo.listTasks({ limit: 2 })).toHaveLength(2);
      expect(await repo.listTasks({ limit: 0 })).toHaveLength(0);
    },
  },
  {
    name: '11. listStages는 요청한 태스크의 단계만 seq 오름차순으로 돌려준다',
    async run(repo) {
      await repo.upsertTasks(
        [
          { ...SEED_A, stages: [stageInput(1), stageInput(0), stageInput(2)] },
          { ...SEED_B, stages: [stageInput(0)] },
        ],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      const tasks = await repo.listTasks();
      const a = findBySourceKey(tasks, 'card-a');
      const b = findBySourceKey(tasks, 'vlog-b');

      const stagesOfA = await repo.listStages([a.id]);
      expect(stagesOfA.map((stage) => stage.seq)).toEqual([0, 1, 2]);
      expect(stagesOfA.every((stage) => stage.taskId === a.id)).toBe(true);
      expect(stagesOfA[0].id).toBeTruthy();

      const both = await repo.listStages([a.id, b.id]);
      expect(both).toHaveLength(4);
      expect(both.filter((stage) => stage.taskId === b.id).map((stage) => stage.seq)).toEqual([0]);
    },
  },
  {
    name: '12. 단계는 태스크마다 통째로 교체된다',
    async run(repo) {
      await repo.upsertTasks([{ ...SEED_A, stages: [stageInput(0), stageInput(1), stageInput(2)] }], {
        occurredAt: FIRST_UPLOAD_AT,
      });
      const taskId = findBySourceKey(await repo.listTasks(), 'card-a').id;
      expect(await repo.listStages([taskId])).toHaveLength(3);

      await repo.upsertTasks([{ ...SEED_A, stages: [stageInput(0), stageInput(1)] }], {
        occurredAt: SECOND_UPLOAD_AT,
      });
      const after = await repo.listStages([taskId]);
      expect(after).toHaveLength(2);
      expect(after.map((stage) => stage.seq)).toEqual([0, 1]);
    },
  },
  {
    name: '13. listStages([])는 빈 배열이다',
    async run(repo) {
      await repo.upsertTasks([{ ...SEED_A, stages: [stageInput(0)] }], { occurredAt: FIRST_UPLOAD_AT });
      expect(await repo.listStages([])).toEqual([]);
    },
  },
  {
    name: '14. 목표 지표는 (팀·기간·과제명) 기준으로 신규·변경·무변경이 갈린다',
    async run(repo) {
      const first = await repo.upsertGoalMetrics(
        [goalInput(), goalInput({ title: '유튜브 조회수' })],
        { occurredAt: FIRST_UPLOAD_AT },
      );
      expect(first).toEqual({ created: 2, updated: 0, unchanged: 0 });

      const second = await repo.upsertGoalMetrics(
        [goalInput(), goalInput({ title: '유튜브 조회수', actualValue: 300 })],
        { occurredAt: SECOND_UPLOAD_AT },
      );
      expect(second).toEqual({ created: 0, updated: 1, unchanged: 1 });

      const metrics = await repo.listGoalMetrics();
      expect(metrics).toHaveLength(2);
      expect(findGoal(metrics, '유튜브 조회수').actualValue).toBe(300);

      const otherPeriod = await repo.upsertGoalMetrics([goalInput({ periodLabel: '2026-08 1주차' })], {
        occurredAt: SECOND_UPLOAD_AT,
      });
      expect(otherPeriod).toEqual({ created: 1, updated: 0, unchanged: 0 });
    },
  },
  {
    name: '15. listGoalMetrics 필터가 동작한다',
    async run(repo) {
      await repo.upsertGoalMetrics(
        [
          goalInput(),
          goalInput({ title: '유튜브 조회수', periodLabel: '2026-08 1주차' }),
          goalInput({ teamId: 'edit', title: '편집 목표' }),
        ],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      expect(await repo.listGoalMetrics({ teamKeys: ['marketing'] })).toHaveLength(2);
      expect(await repo.listGoalMetrics({ teamKeys: ['edit'] })).toHaveLength(1);
      expect(await repo.listGoalMetrics({ teamKeys: [] })).toHaveLength(0);
      expect(await repo.listGoalMetrics({ periodLabel: '2026-08 1주차' })).toHaveLength(1);
      expect(
        await repo.listGoalMetrics({ teamKeys: ['marketing'], periodLabel: '2026-07 4주차' }),
      ).toHaveLength(1);
    },
  },
  {
    name: '16. recordEvents는 예외 없이 끝난다',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), 'card-a').id;

      await expect(
        repo.recordEvents([
          {
            taskId,
            uploadId: 'upload-2',
            changedFields: ['progress'],
            occurredAt: SECOND_UPLOAD_AT,
          },
        ]),
      ).resolves.toBeUndefined();
      await expect(repo.recordEvents([])).resolves.toBeUndefined();
    },
  },
  {
    name: '17. getLastSyncedAt은 빈 저장소에서 null, 업로드 후 주입된 시각이다',
    async run(repo) {
      expect(await repo.getLastSyncedAt()).toBeNull();
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      expect(await repo.getLastSyncedAt()).toBe(FIRST_UPLOAD_AT);
      await repo.upsertTasks([SEED_A], { occurredAt: SECOND_UPLOAD_AT });
      expect(await repo.getLastSyncedAt()).toBe(SECOND_UPLOAD_AT);
    },
  },
  {
    name: '18. 빈 배열 upsert가 예외 없이 0건을 돌려준다 (UC-04 부분 업로드)',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const result = await repo.upsertTasks([], { occurredAt: SECOND_UPLOAD_AT });

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
      });
      expect(result.events).toHaveLength(0);
      expect(await repo.listTasks()).toHaveLength(1);
      expect(await repo.upsertGoalMetrics([], { occurredAt: SECOND_UPLOAD_AT })).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
      });
    },
  },
  {
    name: '19. 돌려준 객체를 호출자가 고쳐도 저장소가 오염되지 않는다',
    async run(repo) {
      await repo.upsertTasks(
        [{ ...SEED_A, extras: { 채널: '인스타' }, stages: [stageInput(0)] }],
        { occurredAt: FIRST_UPLOAD_AT },
      );
      await repo.upsertGoalMetrics([goalInput()], { occurredAt: FIRST_UPLOAD_AT });

      const task = findBySourceKey(await repo.listTasks(), 'card-a');
      task.title = '망가뜨린 제목';
      task.extras.채널 = '망가뜨린 값';
      task.coOwnerNames.push('없는 사람');

      const stages = await repo.listStages([task.id]);
      stages[0].stageLabel = '망가뜨린 라벨';

      const metric = findGoal(await repo.listGoalMetrics(), '인스타 팔로워 증대');
      metric.actualValue = -1;

      const reread = findBySourceKey(await repo.listTasks(), 'card-a');
      expect(reread.title).toBe('카드뉴스 A');
      expect(reread.extras.채널).toBe('인스타');
      expect(reread.coOwnerNames).toEqual([]);
      expect((await repo.listStages([task.id]))[0].stageLabel).toBe('단계 0');
      expect(findGoal(await repo.listGoalMetrics(), '인스타 팔로워 증대').actualValue).toBe(120);
    },
  },
];

/**
 * `describe` 없이 계약 전체를 돌린다. 실패하면 그 자리에서 던진다 —
 * 계약 스위트 자체를 검사하는 테스트(`repository-contract.test.ts`)가 이걸 쓴다.
 */
export async function assertRepositoryContract(fixture: RepositoryFixture): Promise<void> {
  for (const contractCase of REPOSITORY_CONTRACT_CASES) {
    const repo = await fixture.create();
    await fixture.reset(repo);
    try {
      await contractCase.run(repo);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`계약 위반 [${contractCase.name}]: ${reason}`);
    }
  }
}

/** vitest `describe` 블록을 만든다. 두 구현이 이 함수 하나를 각자 호출한다 */
export function describeRepositoryContract(label: string, fixture: RepositoryFixture): void {
  describe(`저장소 계약: ${label}`, () => {
    for (const contractCase of REPOSITORY_CONTRACT_CASES) {
      it(contractCase.name, async () => {
        const repo = await fixture.create();
        await fixture.reset(repo);
        await contractCase.run(repo);
      });
    }
  });
}
