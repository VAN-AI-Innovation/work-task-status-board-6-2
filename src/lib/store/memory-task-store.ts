/**
 * 메모리 드라이버. **마이그레이션 경로가 아니라 시연 안전망이다** (`ADR-004`) —
 * Supabase 무료 티어의 일시중지 대비, 심사자가 `.env` 없이 클론 즉시 실행,
 * 그리고 도메인 검증을 저장소와 분리하는 계약 테스트의 한쪽 축.
 *
 * 배열 몇 개면 충분하다. 인덱스·캐시를 만들지 않는다 — 조직 전체 업무가 수백~수천 행
 * 규모라서 최적화의 이득보다 supabase 구현과 갈라질 위험이 크다 (`ADR-006`).
 *
 * 읽기·쓰기 양쪽에서 **깊은 복사**한다. 참조를 그대로 넘기면 호출자가 화면에서 만진 객체가
 * 저장소 내부를 조용히 바꾸고, 그 사고는 supabase 구현에서 재현되지 않아 계약이 깨진다.
 */

import {
  diffGoalMetricFields,
  diffTaskFields,
  goalMetricUpsertKey,
  matchesTaskFilter,
  taskUpsertKey,
  type GoalMetricUpsertInput,
  type GoalMetricUpsertResult,
  type TaskFilter,
  type TaskRepository,
  type TaskUpsertInput,
  type UpsertOptions,
  type UpsertResult,
} from '@/lib/store/task-repository';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskStage, TeamKey } from '@/types/task';

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * 자연키가 배열 안에서 겹치면 **뒤엣것만 남긴다** (마지막 쓰기 승리).
 * 먼저 접어두는 이유: `ON CONFLICT` upsert는 한 문장 안의 중복 키를 거부하므로,
 * supabase 구현도 같은 접기를 먼저 해야 한다. 계약을 두 구현이 같게 만들려면 여기서 정한다.
 */
function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    byKey.set(keyOf(item), item);
  }
  return [...byKey.values()];
}

export function createMemoryTaskStore(seed?: {
  tasks?: readonly Task[];
  stages?: readonly TaskStage[];
  goalMetrics?: readonly GoalMetric[];
}): TaskRepository & { clear(): void } {
  let tasks: Task[] = clone([...(seed?.tasks ?? [])]);
  let stages: TaskStage[] = clone([...(seed?.stages ?? [])]);
  let goalMetrics: GoalMetric[] = clone([...(seed?.goalMetrics ?? [])]);
  let events: TaskEvent[] = [];
  let lastSyncedAt: string | null = null;

  /** 정렬은 결정적으로: 팀 → 자연키. 입력 순서에 화면이 흔들리면 안 된다 */
  function sortTasks(): void {
    tasks.sort((left, right) =>
      left.teamId === right.teamId
        ? left.sourceKey.localeCompare(right.sourceKey)
        : left.teamId.localeCompare(right.teamId),
    );
  }

  function replaceStages(taskId: string, next: readonly Omit<TaskStage, 'id' | 'taskId'>[]): void {
    stages = stages.filter((stage) => stage.taskId !== taskId);
    for (const stage of next) {
      stages.push({ ...clone(stage), id: crypto.randomUUID(), taskId });
    }
  }

  return {
    async listTasks(filter?: TaskFilter): Promise<Task[]> {
      const matched = tasks.filter((task) => matchesTaskFilter(task, filter));
      const limited =
        filter?.limit === undefined ? matched : matched.slice(0, Math.max(0, filter.limit));
      return clone(limited);
    },

    async getTask(id: string): Promise<Task | null> {
      const found = tasks.find((task) => task.id === id);
      return found ? clone(found) : null;
    },

    async upsertTasks(inputs: readonly TaskUpsertInput[], options: UpsertOptions): Promise<UpsertResult> {
      const result: UpsertResult = { created: 0, updated: 0, unchanged: 0, events: [] };

      for (const input of dedupeByKey(inputs, taskUpsertKey)) {
        const { stages: inputStages, ...fields } = input;
        const existing = tasks.find((task) => taskUpsertKey(task) === taskUpsertKey(input));

        if (!existing) {
          const created: Task = {
            ...clone(fields),
            id: crypto.randomUUID(),
            lastProgressAt: options.occurredAt,
          };
          tasks.push(created);
          replaceStages(created.id, inputStages);
          result.created += 1;
          continue;
        }

        const changedFields = diffTaskFields(existing, input);

        // 감사 필드(업로드 id·행 번호·시트 탭·원본 행)는 변경 여부와 무관하게 최신 업로드를
        // 가리켜야 한다. 반면 `lastProgressAt`은 **실제로 값이 바뀐 건에만** 움직인다 —
        // 같은 파일 재업로드로 갱신되면 「장기 미갱신」 판정이 영원히 뜨지 않는다.
        const merged: Task = {
          ...clone(fields),
          id: existing.id,
          lastProgressAt: changedFields.length > 0 ? options.occurredAt : existing.lastProgressAt,
        };
        tasks[tasks.indexOf(existing)] = merged;
        replaceStages(merged.id, inputStages);

        if (changedFields.length === 0) {
          result.unchanged += 1;
          continue;
        }

        result.updated += 1;
        const event: TaskEvent = {
          id: crypto.randomUUID(),
          taskId: merged.id,
          uploadId: options.uploadId ?? null,
          changedFields,
          occurredAt: options.occurredAt,
        };
        events.push(event);
        result.events.push(clone(event));
      }

      if (inputs.length > 0) {
        lastSyncedAt = options.occurredAt;
      }
      sortTasks();
      return result;
    },

    async listStages(taskIds: readonly string[]): Promise<TaskStage[]> {
      if (taskIds.length === 0) return [];
      const wanted = new Set(taskIds);
      const matched = stages
        .filter((stage) => wanted.has(stage.taskId))
        .sort((left, right) =>
          left.taskId === right.taskId
            ? left.seq - right.seq
            : left.taskId.localeCompare(right.taskId),
        );
      return clone(matched);
    },

    async listGoalMetrics(filter?: {
      teamKeys?: readonly TeamKey[];
      periodLabel?: string;
    }): Promise<GoalMetric[]> {
      const matched = goalMetrics.filter((metric) => {
        if (filter?.teamKeys && !filter.teamKeys.includes(metric.teamId)) return false;
        if (filter?.periodLabel !== undefined && metric.periodLabel !== filter.periodLabel) {
          return false;
        }
        return true;
      });
      return clone(matched);
    },

    async upsertGoalMetrics(
      inputs: readonly GoalMetricUpsertInput[],
      options: UpsertOptions,
    ): Promise<GoalMetricUpsertResult> {
      const result: GoalMetricUpsertResult = { created: 0, updated: 0, unchanged: 0 };

      for (const input of dedupeByKey(inputs, goalMetricUpsertKey)) {
        const existing = goalMetrics.find(
          (metric) => goalMetricUpsertKey(metric) === goalMetricUpsertKey(input),
        );

        if (!existing) {
          goalMetrics.push({ ...clone(input), id: crypto.randomUUID() });
          result.created += 1;
          continue;
        }

        const changed = diffGoalMetricFields(existing, input).length > 0;
        goalMetrics[goalMetrics.indexOf(existing)] = { ...clone(input), id: existing.id };
        if (changed) {
          result.updated += 1;
        } else {
          result.unchanged += 1;
        }
      }

      if (inputs.length > 0) {
        lastSyncedAt = options.occurredAt;
      }
      return result;
    },

    async recordEvents(incoming: readonly Omit<TaskEvent, 'id'>[]): Promise<void> {
      for (const event of incoming) {
        events.push({ ...clone(event), id: crypto.randomUUID() });
      }
    },

    async getLastSyncedAt(): Promise<string | null> {
      return lastSyncedAt;
    },

    clear(): void {
      tasks = [];
      stages = [];
      goalMetrics = [];
      events = [];
      lastSyncedAt = null;
    },
  };
}
