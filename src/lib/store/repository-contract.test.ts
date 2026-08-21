/**
 * 계약 스위트 자체가 쓸모 있는지 본다. 계약이 **틀린 구현을 실제로 잡아야** 의미가 있다 —
 * 통과만 하는 계약은 있으나 마나다. 그래서 일부러 어긋난 가짜 리포지토리를 만들어
 * `assertRepositoryContract`가 거부하는지 확인한다.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import {
  REPOSITORY_CONTRACT_CASES,
  assertRepositoryContract,
  type RepositoryFixture,
} from '@/lib/store/repository-contract';
import type { TaskRepository } from '@/lib/store/task-repository';

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
