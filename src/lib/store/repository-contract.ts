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
  TASK_DIFF_FIELDS,
  MANUAL_ROW_INDEX,
  MANUAL_SHEET_TAB,
  matchesTaskFilter,
  type GoalMetricUpsertInput,
  type TaskEventFilter,
  type TaskFilter,
  type TaskCreateInput,
  type TaskRepository,
  type TaskUpsertInput,
} from '@/lib/store/task-repository';
import type { TaskPatch } from '@/types/auth';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskStage } from '@/types/task';

export interface RepositoryFixture {
  create(): Promise<TaskRepository>;
  /** 각 테스트 전에 저장소를 비운다 */
  reset(repo: TaskRepository): Promise<void>;
}

export interface RepositoryContractCase {
  name: string;
  run(repo: TaskRepository): Promise<void>;
}

/**
 * **계약이 점유하는 시간대의 시작.** 계약 17번(`getLastSyncedAt`)만 이 값을 쓴다.
 *
 * 왜 미래인가: `getLastSyncedAt`은 「저장소에서 가장 최근에 업로드가 돌아간 시각」이라
 * **전역**이다. 접두사로 좁힐 수 있는 조회와 달리, 남의 행이 하나라도 계약 행보다 최근이면
 * 계약이 무엇을 넣든 그 값이 나온다 — 실업무 업로드는 늘 「지금」이라 2026년 날짜로는 항상
 * 진다. 그래서 계약은 아무도 쓰지 않는 시간대를 점유하고, `scopeToContractRows`가 이보다
 * 이른 시각을 「남의 것」으로 보아 `null`로 돌린다.
 */
export const CONTRACT_EPOCH = '2099-01-01T00:00:00.000Z';

/** 업로드 시각. 저장소는 시간을 읽지 않고 이 값을 주입받는다. 전부 `CONTRACT_EPOCH` 뒤다 */
const FIRST_UPLOAD_AT = '2099-07-20T09:00:00.000Z';
const SECOND_UPLOAD_AT = '2099-07-27T09:00:00.000Z';
/**
 * 계약 17번 전용. `getLastSyncedAt`의 의미가 "마지막 업로드 시각"이라는 것을 보이려면
 * 서로 다른 시각이 넷 필요하다. **뒤로 가는 시각은 계약이 정의하지 않는다** — 업로드
 * 시각은 단조로우므로(실제로 과거로 올릴 방법이 없다) 그 갈래를 규정하지 않고 둔다.
 */
const THIRD_UPLOAD_AT = '2099-08-03T09:00:00.000Z';
const FOURTH_UPLOAD_AT = '2099-08-10T09:00:00.000Z';
/**
 * 계약 25번 전용. `until`이 **제외 경계**라, 마지막 이벤트까지 담는 구간을 만들려면
 * 어떤 이벤트보다도 뒤인 시각이 하나 필요하다.
 */
const CONTRACT_TAIL = '2099-08-17T09:00:00.000Z';

/**
 * 자연키·기간 라벨에 붙이는 접두사. 계약 테스트는 **실제 저장소에도** 붙어 도는데(supabase),
 * 접두사가 없으면 정리(`reset`)가 실업무 행까지 지울 근거를 갖게 된다. 접두사 덕분에
 * `reset`은 `source_key like 'contract::%'`인 행만 지우면 된다.
 *
 * 조회 쪽도 같은 접두사로 좁힌다 (`scopeToContractRows`). 그래야 「2건 넣었으니 2건이다」류의
 * 단언이 성립한다 — 원격 Supabase는 실업무 행과 **같이 쓰는** 저장소라, 전체를 세면 남의 행
 * 하나에 계약이 통째로 무너진다 (이슈 #20).
 *
 * ⚠ **같은 저장소에 계약 테스트를 두 벌 동시에 돌리지 마라.** 두 실행이 같은 접두사를 쓰므로
 * 서로의 행을 보고 서로의 `reset`에 지워진다. 그러면 **저장소 오류 없이 행만 사라져** 구현이
 * 멀쩡한데도 계약이 산발적으로 깨진다 (실측으로 재현했다 — 실행마다 다른 접두사를 줘도
 * 접두사가 갈리는 것은 조회뿐이고 `reset`이 여전히 남의 실행 행을 지운다).
 */
export const CONTRACT_KEY_PREFIX = 'contract::';

const KEY_A = `${CONTRACT_KEY_PREFIX}card-a`;
const KEY_B = `${CONTRACT_KEY_PREFIX}vlog-b`;
const KEY_C = `${CONTRACT_KEY_PREFIX}inquiry-c`;
const PERIOD_1 = `${CONTRACT_KEY_PREFIX}2026-07 4주차`;
const PERIOD_2 = `${CONTRACT_KEY_PREFIX}2026-08 1주차`;

/**
 * 업로드 id는 **uuid**여야 한다. supabase 스키마에서 `tasks.source_upload_id`·
 * `task_events.upload_id`가 `uuid references uploads(id)`이기 때문이다 (step 8).
 * 임의 문자열(`UPLOAD_1`)을 쓰면 supabase 구현만 타입 오류로 죽어 계약이 한쪽에서만 돈다.
 * 값 자체에는 의미가 없고, 두 구현 모두 불투명한 식별자로만 다룬다.
 */
const UPLOAD_1 = '11111111-1111-4111-8111-111111111111';
const UPLOAD_2 = '22222222-2222-4222-8222-222222222222';

/**
 * 계약 22번 전용. **모양이 유효한 uuid인데 존재하지 않는** id다 — 모양이 깨진 문자열이면
 * supabase 구현이 uuid 형식 검사에서 먼저 걸러 DB 경로를 밟지 않고, 그러면 "없는 행에
 * 무엇을 하는가"를 재지 못한다.
 */
const MISSING_TASK_ID = '99999999-9999-4999-8999-999999999999';

/**
 * supabase 픽스처가 미리 만들어 둬야 하는 `uploads` 행의 id (외래키 대상).
 * 실행마다 같아도 된다 — 계약은 이 행을 **지우지 않고** 참조만 한다.
 */
export const CONTRACT_UPLOAD_IDS: readonly string[] = [UPLOAD_1, UPLOAD_2];

/** 계약이 만든 행인가. 태스크는 `sourceKey`, 목표 지표는 `periodLabel`에 접두사가 붙는다 */
const isContractTask = (task: Task): boolean => task.sourceKey.startsWith(CONTRACT_KEY_PREFIX);
// `periodLabel`은 null일 수 있다 (시트에 기간 칸이 비면 그렇게 들어온다). 계약이 만든 행은
// 항상 접두사를 붙이므로, null은 남의 행이다.
const isContractGoal = (metric: GoalMetric): boolean =>
  metric.periodLabel?.startsWith(CONTRACT_KEY_PREFIX) ?? false;

/**
 * **계약이 자기 행만 보게 하는 껍데기** (이슈 #20).
 *
 * 계약은 「2건 넣었으니 `listTasks()`가 2건이다」처럼 전체 건수로 단언한다. memory 구현은
 * 매번 새 저장소라 그것이 성립하지만, supabase 구현은 **실업무 데이터와 같은 원격 DB를
 * 나눠 쓴다.** 남의 행이 한 줄만 있어도 그 단언이 영구히 깨지고, 저장소와 무관한 작업까지
 * 게이트에서 막힌다. 그렇다고 `reset`이 남의 행을 지우게 만들 수는 없다.
 *
 * 그래서 **지울 때와 마찬가지로 셀 때도 접두사로 좁힌다.** 계약이 확인하려던 것("내가 넣은
 * 것이 들어갔나")은 그대로 확인되고, 남의 행은 있든 없든 결과가 같다.
 *
 * 쓰기는 손대지 않는다 — 계약이 넣는 것은 어차피 전부 계약 행이다.
 */
export function scopeToContractRows(repo: TaskRepository): TaskRepository {
  const scoped: TaskRepository = {
    async listTasks(filter?: TaskFilter): Promise<Task[]> {
      // `limit`만 떼어 여기서 자른다. 저장소에 그대로 넘기면 남의 행이 앞자리를 채워
      // 계약 행이 잘려 나온다 — 「2건 중 2건」이 「2건 중 0건」이 된다.
      const { limit, ...rest } = filter ?? {};
      const tasks = (await repo.listTasks(filter === undefined ? undefined : rest)).filter(
        isContractTask,
      );
      return limit === undefined ? tasks : tasks.slice(0, Math.max(limit, 0));
    },

    async getTask(id: string): Promise<Task | null> {
      const task = await repo.getTask(id);
      return task !== null && isContractTask(task) ? task : null;
    },

    async listGoalMetrics(filter?: Parameters<TaskRepository['listGoalMetrics']>[0]) {
      return (await repo.listGoalMetrics(filter)).filter(isContractGoal);
    },

    async getLastSyncedAt(): Promise<string | null> {
      // 전역 값이라 접두사로 좁힐 수 없다. 대신 계약이 `CONTRACT_EPOCH` 뒤의 시간대를
      // 점유하므로, 그보다 이른 값은 남의 업로드가 만든 것이다 = 계약에게는 "없음"이다.
      const at = await repo.getLastSyncedAt();
      return at !== null && at >= CONTRACT_EPOCH ? at : null;
    },

    async updateTask(id: string, patch: TaskPatch, updatedAt: string): Promise<Task | null> {
      // `getTask`와 같은 결이다 — 계약 행이 아니면 계약에게는 없는 행이다.
      const task = await repo.updateTask(id, patch, updatedAt);
      return task !== null && isContractTask(task) ? task : null;
    },

    async listEvents(filter?: TaskEventFilter): Promise<TaskEvent[]> {
      // 이벤트에는 접두사를 붙일 칸이 없다 — 붙일 수 있는 것은 **부모 태스크의 자연키**뿐이다.
      // 그래서 계약 행의 id를 먼저 모으고 그것으로 좁힌다. 부모가 지워지면 이벤트도 함께
      // 사라지므로(`task_events.task_id ... on delete cascade`) `reset`은 그대로 둔다.
      const contractTaskIds = new Set(
        (await repo.listTasks()).filter(isContractTask).map((task) => task.id),
      );
      return (await repo.listEvents(filter)).filter((event) => contractTaskIds.has(event.taskId));
    },

    /**
     * **계약 행만 지운다.** 껍데기가 이 자리를 비워 두면 계약이 남의 실업무 행을 id 하나로
     * 지울 수 있게 된다 — `reset`이 접두사로 좁히는 것과 같은 이유다.
     */
    async deleteTask(id: string): Promise<boolean> {
      const task = await repo.getTask(id);
      if (task === null || !isContractTask(task)) return false;
      return repo.deleteTask(id);
    },

    /** 쓰기는 손대지 않는다 — 계약이 넣는 `sourceKey`에 이미 접두사가 붙어 있다 */
    createTask: (input, createdAt) => repo.createTask(input, createdAt),
    upsertTasks: (tasks, options) => repo.upsertTasks(tasks, options),
    listStages: (taskIds) => repo.listStages(taskIds),
    // 계약이 재지 않는다(구성원을 만드는 쓰기 메서드가 없다 — 두 구현의 각자 테스트가 잰다).
    // 그래도 위임은 해 둔다: 껍데기가 `TaskRepository`를 만족하지 못하면 타입이 깨진다.
    listMembers: () => repo.listMembers(),
    // enum 목록도 같은 이유로 위임만 한다 — 계약 행이라는 개념이 없는 전역 표다
    listEnumOptions: () => repo.listEnumOptions(),
    upsertEnumOptions: (entries) => repo.upsertEnumOptions(entries),
    upsertGoalMetrics: (metrics, options) => repo.upsertGoalMetrics(metrics, options),
    recordEvents: (events) => repo.recordEvents(events),
  };

  // 선택 메서드다. 없는 구현에 빈 껍데기를 씌우면 계약 20번이 엉뚱하게 돈다.
  if (repo.runAtomically) {
    scoped.runAtomically = (fn) => repo.runAtomically!(fn);
  }
  return scoped;
}

function taskInput(overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: KEY_A,
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
    sourceUploadId: UPLOAD_1,
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
    periodLabel: PERIOD_1,
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
    sourceUploadId: UPLOAD_1,
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 25,
    ...overrides,
  };
}

/** 두 건짜리 기본 시드. 팀도 자연키도 다르다 */
const SEED_A = taskInput({ sourceKey: KEY_A, title: '카드뉴스 A' });
const SEED_B = taskInput({
  sourceKey: KEY_B,
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
      const a = findBySourceKey(tasks, KEY_A);
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
        { occurredAt: SECOND_UPLOAD_AT, uploadId: UPLOAD_2 },
      );

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 1,
        unchanged: 1,
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].changedFields).toEqual(['progress']);
      expect(result.events[0].occurredAt).toBe(SECOND_UPLOAD_AT);
      expect(result.events[0].uploadId).toBe(UPLOAD_2);

      const tasks = await repo.listTasks();
      const changed = findBySourceKey(tasks, KEY_A);
      const untouched = findBySourceKey(tasks, KEY_B);
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
        [{ ...SEED_A, sourceRowIndex: 99, sourceUploadId: UPLOAD_2 }],
        { occurredAt: SECOND_UPLOAD_AT, uploadId: UPLOAD_2 },
      );

      expect({ created: result.created, updated: result.updated, unchanged: result.unchanged }).toEqual({
        created: 0,
        updated: 0,
        unchanged: 1,
      });
      expect(result.events).toHaveLength(0);
      expect(findBySourceKey(await repo.listTasks(), KEY_A).lastProgressAt).toBe(FIRST_UPLOAD_AT);
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
      expect(findBySourceKey(await repo.listTasks(), KEY_A).progress).toBeNull();
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
            sourceKey: KEY_C,
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
        { sourceKeys: [KEY_A, KEY_B] as const },
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
      const a = findBySourceKey(tasks, KEY_A);
      const b = findBySourceKey(tasks, KEY_B);

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
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;
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

      const otherPeriod = await repo.upsertGoalMetrics([goalInput({ periodLabel: PERIOD_2 })], {
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
          goalInput({ title: '유튜브 조회수', periodLabel: PERIOD_2 }),
          goalInput({ teamId: 'edit', title: '편집 목표' }),
        ],
        { occurredAt: FIRST_UPLOAD_AT },
      );

      expect(await repo.listGoalMetrics({ teamKeys: ['marketing'] })).toHaveLength(2);
      expect(await repo.listGoalMetrics({ teamKeys: ['edit'] })).toHaveLength(1);
      expect(await repo.listGoalMetrics({ teamKeys: [] })).toHaveLength(0);
      expect(await repo.listGoalMetrics({ periodLabel: PERIOD_2 })).toHaveLength(1);
      expect(
        await repo.listGoalMetrics({ teamKeys: ['marketing'], periodLabel: PERIOD_1 }),
      ).toHaveLength(1);
    },
  },
  {
    name: '16. recordEvents는 예외 없이 끝난다',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;

      await expect(
        repo.recordEvents([
          {
            taskId,
            uploadId: UPLOAD_2,
            changedFields: ['progress'],
            occurredAt: SECOND_UPLOAD_AT,
          },
        ]),
      ).resolves.toBeUndefined();
      await expect(repo.recordEvents([])).resolves.toBeUndefined();
    },
  },
  {
    name: '17. getLastSyncedAt은 마지막으로 업로드가 돌아간 시각이다 (무변경·목표 지표만인 업로드 포함)',
    async run(repo) {
      // 의미: **"마지막으로 시트를 반영한 시각"**이다 (`ADR-001`의 "마지막 반영: N일 전").
      // 무엇이 바뀌었는지가 아니라 **업로드가 돌았는지**가 기준이다 — 아무것도 안 바뀐
      // 업로드도 반영은 반영이고, 사용자는 "오늘 올렸는데 왜 5일 전이지?"를 이해하지 못한다.
      expect(await repo.getLastSyncedAt()).toBeNull();

      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      expect(await repo.getLastSyncedAt()).toBe(FIRST_UPLOAD_AT);

      // 같은 파일 재업로드라 전건 unchanged다. 그래도 **반영 시각은 움직인다.**
      const again = await repo.upsertTasks([SEED_A], { occurredAt: SECOND_UPLOAD_AT });
      expect(again.unchanged).toBe(1);
      expect(again.updated).toBe(0);
      expect(await repo.getLastSyncedAt()).toBe(SECOND_UPLOAD_AT);

      // 업무는 한 건도 없고 **목표 지표만** 담긴 업로드(마케팅 탭 B섹션만 올린 경우, UC-04)도
      // 반영이다. 이 갈래가 계약에 없어서 두 구현이 갈라져 있었다 — memory는 갱신하고
      // supabase는 `tasks`만 보느라 갱신하지 않았다.
      await repo.upsertGoalMetrics([goalInput()], { occurredAt: THIRD_UPLOAD_AT });
      expect(await repo.getLastSyncedAt()).toBe(THIRD_UPLOAD_AT);

      // 빈 배열은 반영이 아니다 — 올린 것이 없으므로 시각을 앞당기지 않는다 (계약 18과 짝).
      await repo.upsertTasks([], { occurredAt: FOURTH_UPLOAD_AT });
      await repo.upsertGoalMetrics([], { occurredAt: FOURTH_UPLOAD_AT });
      expect(await repo.getLastSyncedAt()).toBe(THIRD_UPLOAD_AT);
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

      const task = findBySourceKey(await repo.listTasks(), KEY_A);
      task.title = '망가뜨린 제목';
      task.extras.채널 = '망가뜨린 값';
      task.coOwnerNames.push('없는 사람');

      const stages = await repo.listStages([task.id]);
      stages[0].stageLabel = '망가뜨린 라벨';

      const metric = findGoal(await repo.listGoalMetrics(), '인스타 팔로워 증대');
      metric.actualValue = -1;

      const reread = findBySourceKey(await repo.listTasks(), KEY_A);
      expect(reread.title).toBe('카드뉴스 A');
      expect(reread.extras.채널).toBe('인스타');
      expect(reread.coOwnerNames).toEqual([]);
      expect((await repo.listStages([task.id]))[0].stageLabel).toBe('단계 0');
      expect(findGoal(await repo.listGoalMetrics(), '인스타 팔로워 증대').actualValue).toBe(120);
    },
  },
  {
    /**
     * **선택 메서드라 없으면 건너뛴다.** supabase에는 대응물이 없다 — `supabase-js`에
     * 트랜잭션 API가 없어서 구현하면 「트랜잭션인 척하는 함수」가 된다 (`X4`).
     * 그쪽의 부분 반영은 **멱등 재시도**로 수렴시킨다.
     */
    name: '20. (구현이 지원하면) runAtomically는 도중에 실패하면 호출 전 상태로 되돌린다',
    async run(repo) {
      if (!repo.runAtomically) return;

      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const before = (await repo.listTasks()).map((task) => task.sourceKey);

      await expect(
        repo.runAtomically(async () => {
          await repo.upsertTasks([SEED_B], { occurredAt: SECOND_UPLOAD_AT });
          throw new Error('의도적 실패');
        }),
      ).rejects.toThrow('의도적 실패');

      expect((await repo.listTasks()).map((task) => task.sourceKey)).toEqual(before);
      expect(await repo.getLastSyncedAt()).toBe(FIRST_UPLOAD_AT);
    },
  },
  {
    /**
     * `upsertTasks`와의 차이가 이 케이스의 전부다. 그쪽은 「시트 한 벌을 통째로 맞춘다」라
     * 주지 않은 필드가 `null`로 덮이고, 이쪽은 **준 필드만** 바꾼다 (`UC-16`).
     */
    name: '21. updateTask는 준 필드만 바꾸고 나머지를 보존한다',
    async run(repo) {
      await repo.upsertTasks([{ ...SEED_A, extras: { 채널: '인스타' }, note: '원본 비고' }], {
        occurredAt: FIRST_UPLOAD_AT,
      });
      const before = findBySourceKey(await repo.listTasks(), KEY_A);

      const patched = await repo.updateTask(
        before.id,
        { status: '검토 요청', progress: 65 },
        SECOND_UPLOAD_AT,
      );
      expect(patched).not.toBeNull();
      expect(patched?.status).toBe('검토 요청');
      expect(patched?.progress).toBe(65);

      // 준 것 말고는 한 칸도 움직이지 않는다.
      expect(patched?.title).toBe(before.title);
      expect(patched?.dueAt).toBe(before.dueAt);
      expect(patched?.sourceKey).toBe(before.sourceKey);
      expect(patched?.note).toBe('원본 비고');
      expect(patched?.extras).toEqual({ 채널: '인스타' });
      expect(patched?.raw).toEqual(before.raw);
      // 사람이 화면에서 고친 것은 「업로드가 값을 바꿨다」가 아니다 — 「장기 미갱신」 판정이
      // 클릭 한 번으로 리셋되면 그 알림이 무의미해진다.
      expect(patched?.lastProgressAt).toBe(before.lastProgressAt);

      // 돌려준 객체만 바뀐 것이 아니라 실제로 저장됐다.
      expect(await repo.getTask(before.id)).toEqual(patched);

      // `progress: null`은 「값을 지운다」이고 `progress` 미지정은 「안 건드린다」이다.
      // 빈 셀과 0을 구분한다는 약속(`0001_init.sql`)이 여기서도 성립해야 한다.
      const cleared = await repo.updateTask(before.id, { progress: null }, SECOND_UPLOAD_AT);
      expect(cleared?.progress).toBeNull();
      expect(cleared?.status).toBe('검토 요청');

      // 빈 patch는 아무것도 바꾸지 않고 그 행을 그대로 돌려준다.
      expect(await repo.updateTask(before.id, {}, SECOND_UPLOAD_AT)).toEqual(cleared);
    },
  },
  {
    name: '22. updateTask는 없는 id에 null을 돌려주고 저장소를 바꾸지 않는다',
    async run(repo) {
      await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: FIRST_UPLOAD_AT });
      const before = await repo.listTasks();

      expect(await repo.updateTask(MISSING_TASK_ID, { status: '완료' }, SECOND_UPLOAD_AT)).toBeNull();

      expect(await repo.listTasks()).toEqual(before);
    },
  },
  {
    /**
     * `recordEvents`만 있고 읽는 길이 없어서 주간 보고의 「이번 주 변경 건수」가 항상 0으로
     * 나갔다 (T9 `listEvents`). **두 경로로 들어온 이벤트가 같은 창구로 나온다** —
     * `upsertTasks`가 diff로 만든 것과 `recordEvents`로 직접 넣은 것.
     */
    name: '23. listEvents는 recordEvents·upsertTasks 양쪽이 남긴 이벤트를 돌려주고 id가 채워져 있다',
    async run(repo) {
      expect(await repo.listEvents()).toEqual([]);

      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;

      await repo.recordEvents([
        { taskId, uploadId: UPLOAD_2, changedFields: ['progress'], occurredAt: SECOND_UPLOAD_AT },
      ]);

      const recorded = await repo.listEvents();
      expect(recorded).toHaveLength(1);
      expect(recorded[0].id).toBeTruthy();
      expect(recorded[0].taskId).toBe(taskId);
      expect(recorded[0].uploadId).toBe(UPLOAD_2);
      expect(recorded[0].changedFields).toEqual(['progress']);
      expect(recorded[0].occurredAt).toBe(SECOND_UPLOAD_AT);

      // 업로드가 diff로 만든 이벤트도 같은 창구로 나온다. 실제 「변경 건수」의 출처가 이쪽이다.
      const upserted = await repo.upsertTasks([{ ...SEED_A, progress: 90 }], {
        uploadId: UPLOAD_1,
        occurredAt: THIRD_UPLOAD_AT,
      });
      expect(upserted.events).toHaveLength(1);

      const all = await repo.listEvents();
      expect(all).toHaveLength(2);
      expect(all.map((event) => event.id)).toContain(upserted.events[0].id);
    },
  },
  {
    name: '24. listEvents는 occurredAt 내림차순이다 (최신이 먼저)',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;

      // 넣는 순서를 일부러 뒤섞는다 — 정렬이 입력 순서를 따라가면 여기서 걸린다.
      await repo.recordEvents([
        { taskId, uploadId: null, changedFields: ['status'], occurredAt: SECOND_UPLOAD_AT },
        { taskId, uploadId: null, changedFields: ['progress'], occurredAt: FOURTH_UPLOAD_AT },
        { taskId, uploadId: null, changedFields: ['note'], occurredAt: THIRD_UPLOAD_AT },
      ]);

      expect((await repo.listEvents()).map((event) => event.occurredAt)).toEqual([
        FOURTH_UPLOAD_AT,
        THIRD_UPLOAD_AT,
        SECOND_UPLOAD_AT,
      ]);
    },
  },
  {
    /**
     * 경계를 한쪽으로 몰아 두는 이유: 주 단위 보고서가 기간을 **이어 붙여** 조회한다.
     * 양끝을 다 포함하면 경계에 놓인 이벤트가 앞 주와 뒤 주에서 **두 번 세인다.**
     */
    name: '25. listEvents의 since는 포함(>=)이고 until은 제외(<)다 — 이어붙인 기간에서 두 번 세이지 않는다',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;
      await repo.recordEvents(
        [SECOND_UPLOAD_AT, THIRD_UPLOAD_AT, FOURTH_UPLOAD_AT].map((occurredAt) => ({
          taskId,
          uploadId: null,
          changedFields: ['progress'],
          occurredAt,
        })),
      );

      expect((await repo.listEvents({ since: THIRD_UPLOAD_AT })).map((e) => e.occurredAt)).toEqual([
        FOURTH_UPLOAD_AT,
        THIRD_UPLOAD_AT,
      ]);
      expect((await repo.listEvents({ until: THIRD_UPLOAD_AT })).map((e) => e.occurredAt)).toEqual([
        SECOND_UPLOAD_AT,
      ]);
      expect(
        (await repo.listEvents({ since: THIRD_UPLOAD_AT, until: FOURTH_UPLOAD_AT })).map(
          (e) => e.occurredAt,
        ),
      ).toEqual([THIRD_UPLOAD_AT]);

      // 이어 붙인 두 구간이 셋을 정확히 한 번씩 덮는다.
      const early = await repo.listEvents({ since: SECOND_UPLOAD_AT, until: THIRD_UPLOAD_AT });
      const late = await repo.listEvents({ since: THIRD_UPLOAD_AT, until: CONTRACT_TAIL });
      expect(early.length + late.length).toBe(3);
      expect(new Set([...early, ...late].map((event) => event.id)).size).toBe(3);
    },
  },
  {
    name: '26. listEvents의 taskIds는 그 태스크의 것만 돌려주고, 빈 배열은 「아무것도 아님」이다',
    async run(repo) {
      await repo.upsertTasks([SEED_A, SEED_B], { occurredAt: FIRST_UPLOAD_AT });
      const tasks = await repo.listTasks();
      const idA = findBySourceKey(tasks, KEY_A).id;
      const idB = findBySourceKey(tasks, KEY_B).id;

      await repo.recordEvents([
        { taskId: idA, uploadId: null, changedFields: ['progress'], occurredAt: SECOND_UPLOAD_AT },
        { taskId: idB, uploadId: null, changedFields: ['status'], occurredAt: THIRD_UPLOAD_AT },
      ]);

      expect((await repo.listEvents({ taskIds: [idA] })).map((e) => e.taskId)).toEqual([idA]);
      expect((await repo.listEvents({ taskIds: [idA, idB] }))).toHaveLength(2);
      // 「필터 없음」과 「빈 필터」는 다른 뜻이다 (계약 13번의 `listStages([])`와 같은 규칙).
      expect(await repo.listEvents({ taskIds: [] })).toEqual([]);
      expect(await repo.listEvents()).toHaveLength(2);
    },
  },
  {
    /**
     * 계약 19번과 같은 규칙이고, 뒤쪽 절반은 `S6`이다 — `changedFields`는 **바뀐 필드
     * 이름만** 담는다. 저장·조회를 왕복해도 셀 값이 섞여 나오면 이력 테이블이 개인정보
     * 사본이 된다.
     */
    name: '27. listEvents가 돌려준 객체를 고쳐도 저장소가 오염되지 않고, changedFields는 이름만 담는다',
    async run(repo) {
      await repo.upsertTasks([SEED_A], { occurredAt: FIRST_UPLOAD_AT });
      const taskId = findBySourceKey(await repo.listTasks(), KEY_A).id;
      await repo.recordEvents([
        { taskId, uploadId: null, changedFields: ['progress'], occurredAt: SECOND_UPLOAD_AT },
      ]);

      const [event] = await repo.listEvents();
      event.changedFields.push('망가뜨린 필드');
      event.taskId = '망가뜨린 id';

      const [reread] = await repo.listEvents();
      expect(reread.changedFields).toEqual(['progress']);
      expect(reread.taskId).toBe(taskId);

      // 값이 아니라 이름이다. `TASK_DIFF_FIELDS`에 있는 낱말만 나온다.
      expect(reread.changedFields.every((field) => TASK_DIFF_FIELDS.includes(field as never))).toBe(
        true,
      );
    },
  },
  {
    /**
     * **업로드가 아니라 사람이 만드는 경로다** (`POST /api/tasks`). `upsertTasks`와 갈라 두는
     * 이유가 이 케이스에 다 있다 — 감사 칸을 저장소가 채우고, 이벤트를 남기지 않는다.
     */
    name: '28. createTask는 준 값 그대로 한 건을 만들고 감사 칸을 저장소가 채운다',
    async run(repo) {
      const input: TaskCreateInput = {
        sourceKey: `${CONTRACT_KEY_PREFIX}manual-a`,
        teamId: 'edit',
        title: '손으로 만든 업무',
        status: '진행 중',
        progress: 10,
        priority: '높음',
        assignedAt: '2099-07-20',
        dueAt: '2099-07-31',
        nextAction: '레퍼런스 수집',
        nextActionOwner: '담당자1',
        riskStatus: null,
        approvalStatus: null,
        extras: {},
        nextActionDue: '2099-07-25',
        note: '비고',
        ownerMemberId: null,
        ownerNameRaw: '담당자1',
        coOwnerNames: ['담당자2'],
      };

      const created = await repo.createTask(input, SECOND_UPLOAD_AT);

      expect(created.id).toBeTruthy();
      expect(created.teamId).toBe('edit');
      expect(created.title).toBe('손으로 만든 업무');
      expect(created.progress).toBe(10);
      expect(created.dueAt).toBe('2099-07-31');
      expect(created.ownerNameRaw).toBe('담당자1');
      expect(created.coOwnerNames).toEqual(['담당자2']);

      // 감사 칸은 요청이 정하지 않는다 — 시트에서 온 행인 척할 수 없어야 한다
      expect(created.sourceSheetTab).toBe(MANUAL_SHEET_TAB);
      expect(created.sourceRowIndex).toBe(MANUAL_ROW_INDEX);
      expect(created.sourceUploadId).toBeNull();
      expect(created.extras).toEqual({});
      expect(created.raw).toEqual({});

      // 실제로 저장됐고 목록에도 선다
      expect(await repo.getTask(created.id)).toEqual(created);
      expect(
        (await repo.listTasks()).map((task) => task.sourceKey),
      ).toContain(`${CONTRACT_KEY_PREFIX}manual-a`);

      // **이벤트를 남기지 않는다** — 이력은 업로드 diff의 산물이다
      expect(await repo.listEvents({ taskIds: [created.id] })).toEqual([]);
    },
  },
  {
    /**
     * 삭제는 되돌릴 수 없고 **단계·이력까지 함께** 사라진다. supabase는 FK의 cascade가,
     * memory는 같은 자리의 배열 필터가 그 일을 한다 — 두 구현이 같은 결과여야 한다.
     */
    name: '29. deleteTask는 단계·이력과 함께 지우고, 없는 id에는 false다',
    async run(repo) {
      await repo.upsertTasks(
        [
          {
            ...SEED_A,
            stages: [
              {
                seq: 0,
                stageKey: 'concept',
                stageLabel: '컨셉·레퍼런스',
                plannedDate: '2099-07-21',
                actualDate: null,
                content: null,
                confirmStatus: null,
                slaDays: 2,
              },
            ],
          },
        ],
        { occurredAt: FIRST_UPLOAD_AT },
      );
      const task = findBySourceKey(await repo.listTasks(), KEY_A);
      await repo.recordEvents([
        { taskId: task.id, uploadId: null, changedFields: ['progress'], occurredAt: SECOND_UPLOAD_AT },
      ]);

      expect((await repo.listStages([task.id])).length).toBeGreaterThan(0);
      expect((await repo.listEvents({ taskIds: [task.id] })).length).toBeGreaterThan(0);

      expect(await repo.deleteTask(task.id)).toBe(true);

      expect(await repo.getTask(task.id)).toBeNull();
      expect((await repo.listTasks()).map((row) => row.id)).not.toContain(task.id);
      expect(await repo.listStages([task.id])).toEqual([]);
      expect(await repo.listEvents({ taskIds: [task.id] })).toEqual([]);

      // 없는 id는 오류가 아니라 `false`다. 두 번 눌러도 「지웠다」가 두 번 나오지 않는다
      expect(await repo.deleteTask(task.id)).toBe(false);
      expect(await repo.deleteTask(MISSING_TASK_ID)).toBe(false);
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
    // `reset`은 **원본**이 받는다 — 구현별 정리 수단(memory의 `clear()`)이 껍데기에 없다.
    await fixture.reset(repo);
    try {
      await contractCase.run(scopeToContractRows(repo));
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
        await contractCase.run(scopeToContractRows(repo));
      });
    }
  });
}
