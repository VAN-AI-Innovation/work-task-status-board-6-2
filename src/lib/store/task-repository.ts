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

import type { MemberRecord, TaskPatch } from '@/types/auth';
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
 * 이벤트 조회 축. **`TaskFilter`를 재사용하지 않는다** — 이벤트에는 팀·담당자·상태 축이
 * 없고 `taskId` 하나뿐이라, 겸하게 만들면 동작하지 않는 필터 필드가 인터페이스에 남는다
 * (`PLAN.md`「T9 착수 시 확정」 결정 L).
 *
 * `limit`도 두지 않는다. 이 조회의 쓰임은 「기간 안에서 몇 건이 바뀌었나」라 **자르면 건수가
 * 틀린다.**
 */
export interface TaskEventFilter {
  /** **포함**(`>=`). ISO 8601 */
  since?: string;
  /** **제외**(`<`). ISO 8601 — 이어 붙인 두 기간이 경계의 이벤트를 두 번 세지 않게 한다 */
  until?: string;
  /** 빈 배열은 "해당 없음"이다 (전체가 아니다 — `listStages([])`와 같은 규칙) */
  taskIds?: readonly string[];
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

  /**
   * 변경 이력 조회 (T9). `recordEvents`만 있고 읽는 길이 없어서 주간 보고의
   * 「이번 주 변경 건수」가 항상 0으로 나갔다.
   *
   * **`occurredAt` 내림차순**(최신이 먼저)이다. 같은 시각의 순서는 정하지 않는다 —
   * 정할 근거가 없고, 이 조회의 쓰임(기간 안의 건수·목록)이 그 순서에 기대지 않는다.
   *
   * **건수를 세지 않는다.** 「이번 주 몇 건」은 도메인 함수가 목록을 받아 센다 (`ADR-006`) —
   * SQL `count`로 세면 memory 구현과 결과가 갈라진다.
   */
  listEvents(filter?: TaskEventFilter): Promise<TaskEvent[]>;

  getLastSyncedAt(): Promise<string | null>;

  /**
   * 단건 수정 (`UC-16`, T8 step 9의 `PATCH /api/tasks/[id]`). `upsertTasks`와 달리
   * **준 필드만** 바꾸고 나머지는 손대지 않는다 — 그쪽은 「시트 한 벌을 통째로 맞춘다」는
   * 뜻이라, 한 사람이 자기 진행률만 고치는 경로로 쓰면 나머지 필드를 전부 실어 보내야 하고
   * 그 값들이 시트 원문을 덮는다.
   *
   * 없는 id면 `null`이다 (권한 밖 행도 마찬가지 — RLS가 걸린 클라이언트에서는 후자가
   * 실제로 일어난다). **`updatedAt`을 주입받는다** — 저장소는 시간을 읽지 않는다.
   *
   * 하지 않는 것 둘:
   * - `lastProgressAt`을 **건드리지 않는다.** 그 값은 「업로드가 실제로 값을 바꿨다」는
   *   뜻이라(`0001_init.sql` 주석), 사람이 화면에서 고친 것을 섞으면 「장기 미갱신」 판정이
   *   사람의 클릭 한 번으로 리셋된다.
   * - `task_events`를 남기지 않는다. 이벤트는 **업로드 diff의 산물**이고 그래서
   *   `TASK_DIFF_FIELDS`도 고치지 않는다 (그 목록은 업로드 변경 감지용이다).
   *
   * **권한 판정을 하지 않는다.** 「본인 건인가」는 `lib/domain/viewer-scope.ts`가 지고
   * DB 쪽은 RLS가 진다. 저장소까지 세 곳이 되면 하나만 고쳐지는 날이 온다.
   */
  updateTask(id: string, patch: TaskPatch, updatedAt: string): Promise<Task | null>;

  /**
   * 구성원 전량. 시트의 담당자 이름을 계정에 잇는 해석이 볼 표다.
   * 수백 행 규모이고 조회는 업로드 확정 때 한 번이라 필터를 두지 않는다.
   */
  listMembers(): Promise<MemberRecord[]>;

  /**
   * 실패하면 호출 전 상태로 되돌린다. **메모리 드라이버의 원자성이 이것이다** (`X4`).
   *
   * **선택 메서드다.** 필수로 만들면 supabase 구현이 "트랜잭션인 척하는 함수"를 갖게 되는데,
   * `supabase-js`에는 트랜잭션 API가 없으므로 그것은 이름으로 하는 거짓말이다. 없으면 호출자가
   * 그냥 `fn()`을 부르고, 부분 반영은 **멱등 재시도**로 수렴시킨다 (`PLAN.md` `X4` 후속 문단).
   */
  runAtomically?<T>(fn: () => Promise<T>): Promise<T>;
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

/**
 * 이벤트 필터의 기준 구현. `matchesTaskFilter`와 같은 자리에 두는 이유도 같다 —
 * 계약 테스트가 이것으로 기대값을 만들어 두 구현이 같은 의미를 갖게 한다.
 *
 * 문자열 비교가 아니라 **시각 비교**다. 저장소마다 표기가 다를 수 있는데
 * (`2099-08-03T09:00:00.000Z` 대 `2099-08-03T18:00:00+09:00`) 같은 순간이면 같게 봐야 하고,
 * supabase 쪽은 `timestamptz` 비교라 이미 그렇게 동작한다.
 */
export function matchesTaskEventFilter(event: TaskEvent, filter?: TaskEventFilter): boolean {
  if (!filter) return true;

  if (filter.taskIds && !filter.taskIds.includes(event.taskId)) return false;

  const at = Date.parse(event.occurredAt);
  if (filter.since !== undefined && at < Date.parse(filter.since)) return false;
  if (filter.until !== undefined && at >= Date.parse(filter.until)) return false;

  return true;
}

/** 최신이 먼저. `listEvents`의 정렬을 두 구현이 같은 규칙으로 쓰게 한다 */
export function compareTaskEventsDesc(left: TaskEvent, right: TaskEvent): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
}
