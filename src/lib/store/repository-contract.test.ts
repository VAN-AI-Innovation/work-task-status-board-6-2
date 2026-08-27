/**
 * 계약 스위트 자체가 쓸모 있는지 본다. 계약이 **틀린 구현을 실제로 잡아야** 의미가 있다 —
 * 통과만 하는 계약은 있으나 마나다. 그래서 일부러 어긋난 가짜 리포지토리를 만들어
 * `assertRepositoryContract`가 거부하는지 확인한다.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import {
  CONTRACT_EPOCH,
  CONTRACT_KEY_PREFIX,
  REPOSITORY_CONTRACT_CASES,
  assertRepositoryContract,
  scopeToContractRows,
  type RepositoryFixture,
} from '@/lib/store/repository-contract';
import type {
  GoalMetricUpsertInput,
  TaskRepository,
  TaskUpsertInput,
} from '@/lib/store/task-repository';

const memoryFixture: RepositoryFixture = {
  create: async () => createMemoryTaskStore(),
  reset: async () => {},
};

/** 옳은 구현 위에 딱 한 군데만 어긋난 껍데기를 씌운다 */
function brokenFixture(override: (base: TaskRepository) => Partial<TaskRepository>): RepositoryFixture {
  return {
    create: async () => {
      const base = createMemoryTaskStore();
      return { ...base, ...override(base) };
    },
    reset: async () => {},
  };
}

describe('REPOSITORY_CONTRACT_CASES', () => {
  it('계약 항목이 19개 이상이고 이름이 겹치지 않는다', () => {
    expect(REPOSITORY_CONTRACT_CASES.length).toBeGreaterThanOrEqual(19);
    const names = REPOSITORY_CONTRACT_CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('assertRepositoryContract', () => {
  it('옳은 구현(메모리 드라이버)은 통과시킨다', async () => {
    await expect(assertRepositoryContract(memoryFixture)).resolves.toBeUndefined();
  });

  it('무변경을 변경으로 세는 구현을 잡는다 (재업로드가 전건 변경이 되는 사고)', async () => {
    const fixture = brokenFixture((base) => ({
      upsertTasks: async (tasks, options) => {
        const result = await base.upsertTasks(tasks, options);
        return { ...result, updated: result.updated + result.unchanged, unchanged: 0 };
      },
    }));
    await expect(assertRepositoryContract(fixture)).rejects.toThrow();
  });

  it('변경 이벤트를 만들지 않는 구현을 잡는다 (장기 미갱신 판정의 근거가 사라진다)', async () => {
    const fixture = brokenFixture((base) => ({
      upsertTasks: async (tasks, options) => {
        const result = await base.upsertTasks(tasks, options);
        return { ...result, events: [] };
      },
    }));
    await expect(assertRepositoryContract(fixture)).rejects.toThrow();
  });

  it('필터를 무시하는 구현을 잡는다', async () => {
    const fixture = brokenFixture((base) => ({
      listTasks: async () => base.listTasks(),
    }));
    await expect(assertRepositoryContract(fixture)).rejects.toThrow();
  });

  it('listEvents가 필터·정렬을 무시하는 구현을 잡는다 (주간 보고의 기간이 무의미해진다)', async () => {
    const fixture = brokenFixture((base) => ({
      listEvents: async () => base.listEvents(),
    }));
    await expect(assertRepositoryContract(fixture)).rejects.toThrow();
  });

  it('단계를 통째로 교체하지 않고 쌓기만 하는 구현을 잡는다', async () => {
    const fixture = brokenFixture((base) => {
      const seen: Awaited<ReturnType<TaskRepository['listStages']>> = [];
      return {
        listStages: async (taskIds) => {
          const current = await base.listStages(taskIds);
          for (const stage of current) {
            if (!seen.some((entry) => entry.id === stage.id)) seen.push(stage);
          }
          return seen.filter((stage) => taskIds.includes(stage.taskId));
        },
      };
    });
    await expect(assertRepositoryContract(fixture)).rejects.toThrow();
  });
});

/**
 * 이슈 #20. 원격 Supabase는 **계약 테스트 혼자 쓰는 저장소가 아니다** — 실업무 행이 같이 산다.
 * 그 상황을 메모리 드라이버로 재현한다: `reset`이 계약 행만 지우고 남의 행은 남긴다
 * (supabase 픽스처의 `source_key like 'contract::%'` 삭제와 같은 모양이다).
 *
 * 라이브 DB 없이 도는 것이 요점이다. 이슈 #20은 원격 DB에 실업무 행이 생겨야만 재현됐고,
 * 그래서 T4 시점의 게이트가 초록인 채로 결함이 들어왔다.
 */
const FOREIGN_TASK: TaskUpsertInput = {
  teamId: 'edit',
  departmentId: null,
  sourceKey: '[남의업무] 계약 접두사가 없는 실업무 행',
  title: '남의 업무',
  ownerMemberId: null,
  ownerNameRaw: '남의담당자',
  coOwnerNames: [],
  status: '진행 중',
  approvalStatus: null,
  priority: null,
  riskStatus: null,
  progress: 50,
  assignedAt: '2026-08-20',
  dueAt: '2026-08-30',
  nextAction: null,
  nextActionOwner: null,
  nextActionDue: null,
  delayReason: null,
  note: null,
  extras: {},
  raw: {},
  sourceUploadId: null,
  sourceSheetTab: '01_편집팀',
  sourceRowIndex: 3,
  stages: [],
};

const FOREIGN_GOAL: GoalMetricUpsertInput = {
  teamId: 'marketing',
  periodLabel: '2026-08 4주차',
  title: '남의 목표 지표',
  goalText: null,
  kpiName: null,
  targetValue: null,
  actualValue: null,
  achievementRate: null,
  prevPeriodDelta: null,
  channel: null,
  ownerMemberId: null,
  ownerNameRaw: null,
  execStatus: null,
  analysis: null,
  wentWell: null,
  needsImprovement: null,
  startedAt: null,
  dueAt: null,
  extras: {},
  sourceUploadId: null,
  sourceSheetTab: '03_마케팅·관리팀',
  sourceRowIndex: 9,
};

/** 남의 행이 계약 시각(2099)보다 **뒤**라고 우기는 시각. 실업무 업로드는 늘 「지금」이다 */
const FOREIGN_UPLOAD_AT = '2026-08-24T14:16:04.742Z';

/** 계약 행만 지우고 남의 행은 남기는 픽스처. 원격 DB를 나눠 쓰는 상황 그대로다 */
const sharedFixture: RepositoryFixture = {
  create: async () => createMemoryTaskStore(),
  reset: async (repo) => {
    (repo as ReturnType<typeof createMemoryTaskStore>).clear();
    await repo.upsertTasks([FOREIGN_TASK], { occurredAt: FOREIGN_UPLOAD_AT });
    await repo.upsertGoalMetrics([FOREIGN_GOAL], { occurredAt: FOREIGN_UPLOAD_AT });
  },
};

describe('계약 행 격리 (이슈 #20)', () => {
  it('남의 행이 이미 들어 있는 저장소에서도 계약 전체가 통과한다', async () => {
    await expect(assertRepositoryContract(sharedFixture)).resolves.toBeUndefined();
  });

  it('남의 행은 조회에서 보이지 않는다 (전체 건수 단언의 근거)', async () => {
    const store = createMemoryTaskStore();
    await sharedFixture.reset(store);
    const scoped = scopeToContractRows(store);

    expect(await store.listTasks()).toHaveLength(1);
    expect(await scoped.listTasks()).toHaveLength(0);
    expect(await store.listGoalMetrics()).toHaveLength(1);
    expect(await scoped.listGoalMetrics()).toHaveLength(0);
  });

  it('limit은 계약 행 기준으로 센다 (남의 행이 자리를 먼저 채우지 않는다)', async () => {
    const store = createMemoryTaskStore();
    await sharedFixture.reset(store);
    const scoped = scopeToContractRows(store);
    await scoped.upsertTasks(
      [
        { ...FOREIGN_TASK, sourceKey: `${CONTRACT_KEY_PREFIX}a`, title: '계약 A' },
        { ...FOREIGN_TASK, sourceKey: `${CONTRACT_KEY_PREFIX}b`, title: '계약 B' },
      ],
      { occurredAt: CONTRACT_EPOCH },
    );

    expect(await scoped.listTasks({ limit: 2 })).toHaveLength(2);
    expect(await scoped.listTasks({ limit: 0 })).toHaveLength(0);
  });

  it('남의 행의 id로는 getTask가 null이다', async () => {
    const store = createMemoryTaskStore();
    await sharedFixture.reset(store);
    const foreignId = (await store.listTasks())[0].id;

    expect(await store.getTask(foreignId)).not.toBeNull();
    expect(await scopeToContractRows(store).getTask(foreignId)).toBeNull();
  });

  it('남의 행에 달린 이벤트는 계약에게 보이지 않는다 (이벤트에는 붙일 접두사가 없다)', async () => {
    const store = createMemoryTaskStore();
    await sharedFixture.reset(store);
    const foreignId = (await store.listTasks())[0].id;
    await store.recordEvents([
      {
        taskId: foreignId,
        uploadId: null,
        changedFields: ['progress'],
        occurredAt: FOREIGN_UPLOAD_AT,
      },
    ]);

    expect(await store.listEvents()).toHaveLength(1);
    expect(await scopeToContractRows(store).listEvents()).toHaveLength(0);
  });

  it('남의 업로드가 만든 반영 시각은 계약에게 null이다 (계약 17번의 「빈 저장소」)', async () => {
    const store = createMemoryTaskStore();
    await sharedFixture.reset(store);
    const scoped = scopeToContractRows(store);

    expect(await store.getLastSyncedAt()).toBe(FOREIGN_UPLOAD_AT);
    expect(await scoped.getLastSyncedAt()).toBeNull();

    await scoped.upsertTasks([{ ...FOREIGN_TASK, sourceKey: `${CONTRACT_KEY_PREFIX}a` }], {
      occurredAt: CONTRACT_EPOCH,
    });
    expect(await scoped.getLastSyncedAt()).toBe(CONTRACT_EPOCH);
  });
});
