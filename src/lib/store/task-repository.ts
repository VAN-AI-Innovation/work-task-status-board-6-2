/**
 * 저장소 계약. **저장·조회만 한다.**
 *
 * 완료율·지연·알림·목표 달성률은 전부 `lib/domain/`의 순수 함수이고, 리포지토리는 그
 * 입력을 꺼내 줄 뿐이다 (`ADR-006`). 판정을 여기서 하면 memory·supabase 두 구현의 결과가
 * 갈라지고 "같은 계약 테스트를 통과한다"(T4 완료 기준 8)가 깨진다. 그래서 이 파일에는
 * 상태 해석도, 집계도, 날짜 판정도 없다 — 필터는 값 비교뿐이다.
 *
 * 이 파일이 짊어지는 판단은 딱 하나, **"무엇이 바뀐 것인가"**다 (`TASK_DIFF_FIELDS`).
 * 그 판단이 `lastProgressAt`을 움직이고, 그것이 「장기 미갱신」 알림의 근거가 된다.
 */

import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskStage, TeamKey } from '@/types/task';

export interface TaskFilter {
  /** 빈 배열은 "해당 없음"으로 본다 (전체가 아니다) */
  teamKeys?: readonly TeamKey[];
  /** `source_key` 지정 조회 (업로드 확정 시 기존 건 대조) */
  sourceKeys?: readonly string[];
  /** **정확 일치.** 부분 일치는 `search`가 맡는다 */
  ownerNameRaw?: string;
  /** `YYYY-MM-DD`. 양끝 포함. 마감 없는 건은 범위 조회에서 빠진다 */
  dueFrom?: string;
  dueTo?: string;
  /** 시트 원문 상태. semantic 필터는 도메인이 걸러낸다 (리포지토리는 판정하지 않는다) */
  statuses?: readonly string[];
  /** 업무명·담당자 부분 일치 (대소문자 무시). 빈 문자열은 필터가 없는 것으로 본다 */
  search?: string;
  limit?: number;
}

/**
 * `upsertTasks`가 받는 입력. `id`·`lastProgressAt`은 저장소가 정한다.
 *
 * 단계를 태스크에 딸린 필드로 두는 이유: 단계는 태스크와 **같은 트랜잭션에서 통째로 교체**돼야
 * 한다 (`X4`). 별도 인자로 받으면 태스크만 반영되고 단계가 빠진 중간 상태가 생길 수 있다.
 */
export type TaskUpsertInput = Omit<Task, 'id' | 'lastProgressAt'> & {
  stages: readonly Omit<TaskStage, 'id' | 'taskId'>[];
};

export type GoalMetricUpsertInput = Omit<GoalMetric, 'id'>;

export interface UpsertResult {
  created: number;
  updated: number;
  unchanged: number;
  /**
   * 실제로 값이 바뀐 건에 대해서만 만들어진 이벤트. **이미 저장돼 있다** — 태스크와 같은
   * 트랜잭션에 묶이기 때문이다. 호출자가 `recordEvents`로 다시 넣으면 이력이 두 벌이 된다.
   */
  events: TaskEvent[];
}

export interface UpsertOptions {
  uploadId?: string | null;
  /** 이벤트·`lastProgressAt`의 타임스탬프. **주입받는다** (저장소가 시간을 읽지 않는다) */
  occurredAt: string;
}

export interface GoalMetricUpsertResult {
  created: number;
  updated: number;
  unchanged: number;
}

export interface TaskRepository {
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  upsertTasks(tasks: readonly TaskUpsertInput[], options: UpsertOptions): Promise<UpsertResult>;
  listStages(taskIds: readonly string[]): Promise<TaskStage[]>;
  listGoalMetrics(filter?: {
    teamKeys?: readonly TeamKey[];
    periodLabel?: string;
  }): Promise<GoalMetric[]>;
  upsertGoalMetrics(
    metrics: readonly GoalMetricUpsertInput[],
    options: UpsertOptions,
  ): Promise<GoalMetricUpsertResult>;
  recordEvents(events: readonly Omit<TaskEvent, 'id'>[]): Promise<void>;
  getLastSyncedAt(): Promise<string | null>;
}

/** 변경 감지 대상. `keyof Task`의 부분집합이고 `TaskUpsertInput`에도 전부 있다 */
export type TaskDiffField =
  | 'title'
  | 'ownerNameRaw'
  | 'coOwnerNames'
  | 'status'
  | 'approvalStatus'
  | 'priority'
  | 'riskStatus'
  | 'progress'
  | 'assignedAt'
  | 'dueAt'
  | 'nextAction'
  | 'nextActionOwner'
  | 'nextActionDue'
  | 'delayReason'
  | 'note'
  | 'extras';

/**
 * 변경 감지 대상 필드. **여기 없는 필드가 바뀌어도 "변경"이 아니다.**
 *
 * 제외한 것과 그 이유:
 * - `sourceUploadId`·`sourceRowIndex`·`sourceSheetTab` — 같은 내용이라도 업로드마다 바뀐다.
 *   포함하면 재업로드가 전건 "변경"이 되어 `UC-03`("변경 M건만 표시")과 「장기 미갱신」 판정이
 *   동시에 무너진다. 행이 한 줄 밀린 것은 업무가 바뀐 것이 아니다.
 * - `raw` — `extras`와 내용이 겹치고 크다. `extras`만 보면 충분하다.
 * - `id`·`teamId`·`sourceKey` — 신원이다. 바뀌면 그건 다른 업무다.
 * - `ownerMemberId` — 시트가 아니라 이름 해석(T5)이 채운다. 사람이 고친 값이 아니다.
 * - `lastProgressAt` — 이 판정의 **결과**다. 입력에 넣으면 순환이다.
 */
export const TASK_DIFF_FIELDS: readonly TaskDiffField[] = [
  'title',
  'ownerNameRaw',
  'coOwnerNames',
  'status',
  'approvalStatus',
  'priority',
  'riskStatus',
  'progress',
  'assignedAt',
  'dueAt',
  'nextAction',
  'nextActionOwner',
  'nextActionDue',
  'delayReason',
  'note',
  'extras',
];

/**
 * 목표 지표의 변경 감지 대상. 키 `(teamId, periodLabel, title)`과 업로드 감사 필드는 뺀다 —
 * 태스크와 같은 이유다.
 */
export type GoalMetricDiffField =
  | 'goalText'
  | 'kpiName'
  | 'targetValue'
  | 'actualValue'
  | 'achievementRate'
  | 'prevPeriodDelta'
  | 'channel'
  | 'ownerNameRaw'
  | 'execStatus'
  | 'analysis'
  | 'wentWell'
  | 'needsImprovement'
  | 'startedAt'
  | 'dueAt'
  | 'extras';

export const GOAL_METRIC_DIFF_FIELDS: readonly GoalMetricDiffField[] = [
  'goalText',
  'kpiName',
  'targetValue',
  'actualValue',
  'achievementRate',
  'prevPeriodDelta',
  'channel',
  'ownerNameRaw',
  'execStatus',
  'analysis',
  'wentWell',
  'needsImprovement',
  'startedAt',
  'dueAt',
  'extras',
];

/**
 * 키 순서에 흔들리지 않는 직렬화. 배열·객체를 `!==`로 비교하면 매번 다르다고 나오고,
 * 그대로 두면 재업로드가 전건 "변경"이 된다.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/**
 * `progress`의 `0`과 `null`은 **다른 값**이다 (빈 셀과 0을 구분한다는 데이터 모델의 약속).
 * `==`·falsy 비교를 쓰면 그 구분이 사라지므로 `Object.is`로 시작한다.
 */
function isSameFieldValue(prev: unknown, next: unknown): boolean {
  if (Object.is(prev, next)) return true;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    return false;
  }
  return stableStringify(prev) === stableStringify(next);
}

/** 바뀐 필드 **이름만** 돌려준다. 값은 담지 않는다 — 이력이 개인정보 사본이 되면 안 된다 */
export function diffTaskFields(prev: Task, next: TaskUpsertInput): string[] {
  return TASK_DIFF_FIELDS.filter((field) => !isSameFieldValue(prev[field], next[field]));
}

export function diffGoalMetricFields(prev: GoalMetric, next: GoalMetricUpsertInput): string[] {
  return GOAL_METRIC_DIFF_FIELDS.filter((field) => !isSameFieldValue(prev[field], next[field]));
}

/** 업무의 자연키. `(teamId, sourceKey)` — 팀이 다르면 같은 `sourceKey`도 다른 업무다 */
export function taskUpsertKey(task: { teamId: TeamKey; sourceKey: string }): string {
  return JSON.stringify([task.teamId, task.sourceKey]);
}

/** 목표 지표의 자연키. `(teamId, periodLabel, title)` */
export function goalMetricUpsertKey(metric: {
  teamId: TeamKey;
  periodLabel: string | null;
  title: string | null;
}): string {
  return JSON.stringify([metric.teamId, metric.periodLabel, metric.title]);
}

/**
 * 두 구현이 **같은 필터 의미**를 갖도록 하는 기준 구현. 계약 테스트가 이것으로 기대값을 만든다.
 * `limit`은 행 판정이 아니라 목록 자르기라서 여기서 보지 않는다.
 */
export function matchesTaskFilter(task: Task, filter?: TaskFilter): boolean {
  if (!filter) return true;

  if (filter.teamKeys && !filter.teamKeys.includes(task.teamId)) return false;
  if (filter.sourceKeys && !filter.sourceKeys.includes(task.sourceKey)) return false;
  if (filter.ownerNameRaw !== undefined && task.ownerNameRaw !== filter.ownerNameRaw) return false;

  if (filter.dueFrom !== undefined && (task.dueAt === null || task.dueAt < filter.dueFrom)) {
    return false;
  }
  if (filter.dueTo !== undefined && (task.dueAt === null || task.dueAt > filter.dueTo)) {
    return false;
  }

  if (filter.statuses && (task.status === null || !filter.statuses.includes(task.status))) {
    return false;
  }

  if (filter.search !== undefined && filter.search !== '') {
    const needle = filter.search.toLowerCase();
    const haystack = [task.title, task.ownerNameRaw]
      .filter((value): value is string => value !== null)
      .map((value) => value.toLowerCase());
    if (!haystack.some((value) => value.includes(needle))) return false;
  }

  return true;
}
