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
  compareTaskEventsDesc,
  diffGoalMetricFields,
  diffTaskFields,
  goalMetricUpsertKey,
  matchesTaskEventFilter,
  matchesTaskFilter,
  taskUpsertKey,
  MANUAL_ROW_INDEX,
  MANUAL_SHEET_TAB,
  type GoalMetricUpsertInput,
  type GoalMetricUpsertResult,
  type TaskEventFilter,
  type TaskFilter,
  type TaskCreateInput,
  type TaskRepository,
  type TaskUpsertInput,
  type UpsertOptions,
  type UpsertResult,
} from '@/lib/store/task-repository';
import type { MemberRecord, TaskPatch } from '@/types/auth';
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
  members?: readonly MemberRecord[];
}): TaskRepository & { clear(): void } {
  let tasks: Task[] = clone([...(seed?.tasks ?? [])]);
  let stages: TaskStage[] = clone([...(seed?.stages ?? [])]);
  let goalMetrics: GoalMetric[] = clone([...(seed?.goalMetrics ?? [])]);
  // 구성원은 시드로만 들어온다 — 만드는 메서드가 계약에 없다 (시드 스크립트가 채운다).
  let members: MemberRecord[] = clone([...(seed?.members ?? [])]);
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

    async listEvents(filter?: TaskEventFilter): Promise<TaskEvent[]> {
      // `sort`는 제자리 정렬이지만 `filter`가 이미 새 배열을 만들었으므로 내부 순서는
      // 그대로다. 돌려줄 때는 복사한다 — 호출자가 고쳐도 저장소가 오염되지 않아야 한다.
      const matched = events
        .filter((event) => matchesTaskEventFilter(event, filter))
        .sort(compareTaskEventsDesc);
      return clone(matched);
    },

    async getLastSyncedAt(): Promise<string | null> {
      return lastSyncedAt;
    },

    // 인자가 둘뿐인 것은 오타가 아니다 — 계약의 셋째 인자(`updatedAt`)를 이 구현이
    // 일부러 받지 않는다. 이유는 아래 주석에 있다.
    async updateTask(id: string, patch: TaskPatch): Promise<Task | null> {
      const existing = tasks.find((task) => task.id === id);
      if (!existing) return null;

      // `patch`에 **있는 키만** 옮긴다. `undefined`까지 대입하면 「안 줬다」가 「지워라」가
      // 되어, `progress: null`(빈 셀)과 `progress` 미지정의 구분이 사라진다.
      const merged: Task = clone(existing);
      if (patch.title !== undefined) merged.title = patch.title;
      if (patch.status !== undefined) merged.status = patch.status;
      if (patch.progress !== undefined) merged.progress = patch.progress;
      // 아래 아홉은 `0013`이 컬럼 GRANT로 연 칸들이다. 전부 `null`이 「비운다」다
      if (patch.priority !== undefined) merged.priority = patch.priority;
      if (patch.riskStatus !== undefined) merged.riskStatus = patch.riskStatus;
      if (patch.approvalStatus !== undefined) merged.approvalStatus = patch.approvalStatus;
      if (patch.assignedAt !== undefined) merged.assignedAt = patch.assignedAt;
      if (patch.dueAt !== undefined) merged.dueAt = patch.dueAt;
      if (patch.nextAction !== undefined) merged.nextAction = patch.nextAction;
      if (patch.nextActionOwner !== undefined) merged.nextActionOwner = patch.nextActionOwner;
      if (patch.nextActionDue !== undefined) merged.nextActionDue = patch.nextActionDue;
      if (patch.delayReason !== undefined) merged.delayReason = patch.delayReason;
      if (patch.note !== undefined) merged.note = patch.note;
      // 담당자 둘은 라우트가 **짝으로** 넘긴다. 여기서 이름을 지어내지 않는다
      if (patch.ownerMemberId !== undefined) merged.ownerMemberId = patch.ownerMemberId;
      if (patch.ownerNameRaw !== undefined) merged.ownerNameRaw = patch.ownerNameRaw;
      // 배열은 **사본으로** 넣는다. 호출자가 들고 있는 배열을 저장소가 참조하면 밖에서 바뀐다
      if (patch.coOwnerNames !== undefined) merged.coOwnerNames = [...patch.coOwnerNames];

      // `lastProgressAt`은 손대지 않는다 — 사람이 화면에서 고친 것은 업로드가 아니다.
      //
      // 계약의 `updatedAt`은 여기서 쓸 곳이 없다. `Task`에 행 단위 수정 시각 필드가 없고,
      // 유일한 후보인 `lastSyncedAt`은 「마지막으로 **업로드가** 돌아간 시각」이라(계약 17번)
      // 사람의 수정으로 앞당기면 「마지막 반영: N일 전」이 데이터가 낡은 사실을 감춘다
      // (`ADR-001`이 드러내기로 한 바로 그 약점이다).
      //
      // ⚠ supabase 구현은 같은 값을 `tasks.updated_at`에 쓴다(행 감사 컬럼이 `not null`이라
      // 실제 변경을 반영해야 한다). 그쪽의 `getLastSyncedAt`이 `max(updated_at)`을 쓰므로
      // **PATCH가 「마지막 반영」을 앞당기는 갈래가 supabase에만 생긴다.** 계약이 재지 않는
      // 자리다 — 「PATCH가 반영인가」는 제품 결정이고, 그것을 처음 밟는 step 9가 정한다.

      tasks[tasks.indexOf(existing)] = merged;
      return clone(merged);
    },

    /**
     * 사람이 화면에서 만드는 업무 한 건. **`upsertTasks`를 부르지 않는다** — 그쪽은 자연키가
     * 겹치면 덮고 이벤트를 남긴다 (`TaskRepository` 주석).
     *
     * 감사 칸은 여기서 채운다: 시트에서 오지 않았으므로 탭 이름과 행 번호가 상수이고
     * (`MANUAL_SHEET_TAB`·`MANUAL_ROW_INDEX`), `extras`·`raw`는 비어 있다 — 원본 행이라는
     * 것이 존재하지 않는다.
     */
    async createTask(input: TaskCreateInput, createdAt: string): Promise<Task> {
      const created: Task = {
        id: crypto.randomUUID(),
        teamId: input.teamId,
        departmentId: null,
        sourceKey: input.sourceKey,
        title: input.title,
        ownerMemberId: input.ownerMemberId,
        ownerNameRaw: input.ownerNameRaw,
        coOwnerNames: [...input.coOwnerNames],
        status: input.status,
        approvalStatus: null,
        priority: input.priority,
        riskStatus: null,
        progress: input.progress,
        assignedAt: input.assignedAt,
        dueAt: input.dueAt,
        nextAction: input.nextAction,
        nextActionOwner: input.nextActionOwner,
        nextActionDue: input.nextActionDue,
        delayReason: null,
        note: input.note,
        extras: {},
        raw: {},
        // 만든 시각이 이 행의 값이 마지막으로 정해진 시각이다 — null로 두면 만들자마자
        // 「장기 미갱신」으로 잡힌다
        lastProgressAt: createdAt,
        sourceUploadId: null,
        sourceSheetTab: MANUAL_SHEET_TAB,
        sourceRowIndex: MANUAL_ROW_INDEX,
      };

      tasks.push(created);
      sortTasks();
      return clone(created);
    },

    /**
     * 단계도 이력도 **함께** 지운다. supabase 쪽은 FK의 `on delete cascade`가 같은 일을
     * 하므로 두 구현의 결과가 같다 — 계약이 그것을 잰다.
     */
    async deleteTask(id: string): Promise<boolean> {
      const index = tasks.findIndex((task) => task.id === id);
      if (index < 0) return false;

      tasks.splice(index, 1);
      stages = stages.filter((stage) => stage.taskId !== id);
      events = events.filter((event) => event.taskId !== id);
      return true;
    },

    async listMembers(): Promise<MemberRecord[]> {
      return clone(members);
    },

    /**
     * 스냅샷 → 실행 → 실패하면 교체. **메모리 드라이버의 원자성이 이것이다** (`X4`).
     *
     * 배열 넷과 시각 하나를 깊은 복사해 두는 것이 전부다 — 수백~수천 행 규모라 비용이 없고,
     * `let`으로 들고 있으므로 되돌리기가 참조 교체 한 번이다. supabase 구현에는 대응물이
     * 없고(트랜잭션 API가 없다) 그래서 계약에서도 **선택 메서드**다.
     */
    async runAtomically<T>(fn: () => Promise<T>): Promise<T> {
      const snapshot = {
        tasks: clone(tasks),
        stages: clone(stages),
        goalMetrics: clone(goalMetrics),
        members: clone(members),
        events: clone(events),
        lastSyncedAt,
      };
      try {
        return await fn();
      } catch (error) {
        tasks = snapshot.tasks;
        stages = snapshot.stages;
        goalMetrics = snapshot.goalMetrics;
        members = snapshot.members;
        events = snapshot.events;
        lastSyncedAt = snapshot.lastSyncedAt;
        throw error;
      }
    },

    clear(): void {
      tasks = [];
      stages = [];
      goalMetrics = [];
      members = [];
      events = [];
      lastSyncedAt = null;
    },
  };
}
