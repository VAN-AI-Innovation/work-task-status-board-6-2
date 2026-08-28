/**
 * Supabase 드라이버. memory 드라이버(step 7)와 **같은 계약 테스트**를 통과해야 한다
 * (T4 완료 기준 8) — 그래서 이 파일은 판정도 집계도 하지 않는다 (`ADR-006`).
 * 완료율·지연·달성률은 전부 `lib/domain/`의 순수 함수이고, 여기는 행을 옮겨 담을 뿐이다.
 * RPC 호출·SQL 함수·집계 쿼리를 쓰지 않는 이유도 같다: SQL로 계산하는 순간 두 구현의
 * 결과가 갈라지고 계약이 무의미해진다.
 *
 * **서버 전용이다.** `createServiceRoleClient`는 `service_role` 키를 읽으므로 클라이언트
 * 컴포넌트에서 import하면 키가 번들에 실린다 (`S5`, `CLAUDE.md` CRITICAL). 키 이름에
 * `NEXT_PUBLIC_` 접두사를 붙이지 않는 것과 같은 이유이며, `npm run guard:env`가 감시한다.
 *
 * 컬럼 이름은 **매퍼 함수 안에만** 둔다 — `toTask`/`toTaskRow`/`toTaskPatchRow`,
 * 목표 지표 쌍, `toMember`. 쿼리마다 흩뿌리면 스키마와 어긋났을 때 고칠 곳이 흩어진다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  diffGoalMetricFields,
  diffTaskFields,
  goalMetricUpsertKey,
  taskUpsertKey,
  type GoalMetricUpsertInput,
  type GoalMetricUpsertResult,
  type TaskEventFilter,
  type TaskFilter,
  type TaskRepository,
  type TaskUpsertInput,
  type UpsertOptions,
  type UpsertResult,
} from '@/lib/store/task-repository';
import type { MemberRecord, TaskPatch } from '@/types/auth';
import type { GoalMetric } from '@/types/goal';
import type { ExtraValue, Task, TaskEvent, TaskStage, TeamKey } from '@/types/task';

/** PostgREST가 돌려주는 `tasks` 행. 컬럼 이름은 `supabase/migrations/0001_init.sql`과 1:1이다 */
export interface TaskRow {
  id: string;
  team_id: string;
  department_id: string | null;
  source_key: string;
  title: string | null;
  owner_member_id: string | null;
  owner_name_raw: string | null;
  co_owner_names: string[] | null;
  status: string | null;
  approval_status: string | null;
  priority: string | null;
  risk_status: string | null;
  progress: number | null;
  assigned_at: string | null;
  due_at: string | null;
  next_action: string | null;
  next_action_owner: string | null;
  next_action_due: string | null;
  delay_reason: string | null;
  note: string | null;
  extras: Record<string, ExtraValue> | null;
  raw: Record<string, ExtraValue> | null;
  last_progress_at: string | null;
  source_upload_id: string | null;
  source_sheet_tab: string;
  source_row_index: number;
  updated_at?: string | null;
}

/** `id`·`created_at`을 뺀 쓰기용 행. 신규·기존이 **같은 모양**이어야 한 번에 upsert된다 */
export type TaskWriteRow = Omit<TaskRow, 'id' | 'updated_at'> & { updated_at: string };

export interface GoalMetricRow {
  id: string;
  team_id: string;
  period_label: string | null;
  title: string | null;
  goal_text: string | null;
  kpi_name: string | null;
  /** `numeric`은 자릿수에 따라 문자열로 올 수 있다 */
  target_value: number | string | null;
  actual_value: number | string | null;
  achievement_rate: number | string | null;
  prev_period_delta: string | null;
  channel: string | null;
  owner_member_id: string | null;
  owner_name_raw: string | null;
  exec_status: string | null;
  analysis: string | null;
  went_well: string | null;
  needs_improvement: string | null;
  started_at: string | null;
  due_at: string | null;
  extras: Record<string, ExtraValue> | null;
  source_upload_id: string | null;
  source_sheet_tab: string;
  source_row_index: number;
}

export type GoalMetricWriteRow = Omit<
  GoalMetricRow,
  'id' | 'target_value' | 'actual_value' | 'achievement_rate'
> & {
  target_value: number | null;
  actual_value: number | null;
  achievement_rate: number | null;
  updated_at: string;
};

interface StageRow {
  id: string;
  task_id: string;
  seq: number;
  stage_key: string;
  stage_label: string;
  planned_date: string | null;
  actual_date: string | null;
  content: string | null;
  confirm_status: string | null;
  sla_days: number | null;
}

interface EventRow {
  id: string;
  task_id: string;
  upload_id: string | null;
  changed_fields: string[];
  occurred_at: string;
}

interface MemberRow {
  id: string;
  team_id: string;
  name: string;
  auth_user_id: string | null;
}

const TASK_COLUMNS =
  'id,team_id,department_id,source_key,title,owner_member_id,owner_name_raw,co_owner_names,' +
  'status,approval_status,priority,risk_status,progress,assigned_at,due_at,next_action,' +
  'next_action_owner,next_action_due,delay_reason,note,extras,raw,last_progress_at,' +
  'source_upload_id,source_sheet_tab,source_row_index';

const GOAL_COLUMNS =
  'id,team_id,period_label,title,goal_text,kpi_name,target_value,actual_value,achievement_rate,' +
  'prev_period_delta,channel,owner_member_id,owner_name_raw,exec_status,analysis,went_well,' +
  'needs_improvement,started_at,due_at,extras,source_upload_id,source_sheet_tab,source_row_index';

const STAGE_COLUMNS =
  'id,task_id,seq,stage_key,stage_label,planned_date,actual_date,content,confirm_status,sla_days';

const EVENT_COLUMNS = 'id,task_id,upload_id,changed_fields,occurred_at';

const MEMBER_COLUMNS = 'id,team_id,name,auth_user_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST 에러를 밖으로 낼 때 **행 내용·셀 값을 담지 않는다** (`CLAUDE.md` 보안 규칙).
 * 남기는 것은 어느 테이블에서 무슨 코드가 났는지까지다.
 */
function fail(table: string, operation: string, error: { code?: string } | null): never {
  const code = error?.code ?? 'UNKNOWN';
  throw new Error(`Supabase ${operation} 실패 (${table}, code=${code})`);
}

/**
 * `timestamptz`는 `2026-07-20T09:00:00+00:00` 모양으로 온다. 계약은 주입한 ISO 문자열이
 * 그대로 돌아오길 기대하므로 표기를 통일한다. **`date` 컬럼에는 쓰지 않는다** —
 * `YYYY-MM-DD`를 `Date`로 만들면 시간대가 끼어들어 하루가 어긋난다 (`E4`).
 */
export function toIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** `numeric`은 문자열로 올 수 있다. `0`은 `0`으로 남아야 하므로 falsy 검사를 쓰지 않는다 */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    teamId: row.team_id as TeamKey,
    departmentId: row.department_id,
    sourceKey: row.source_key,
    title: row.title,
    ownerMemberId: row.owner_member_id,
    ownerNameRaw: row.owner_name_raw,
    coOwnerNames: row.co_owner_names ?? [],
    status: row.status,
    approvalStatus: row.approval_status,
    priority: row.priority,
    riskStatus: row.risk_status,
    progress: row.progress,
    assignedAt: row.assigned_at,
    dueAt: row.due_at,
    nextAction: row.next_action,
    nextActionOwner: row.next_action_owner,
    nextActionDue: row.next_action_due,
    delayReason: row.delay_reason,
    note: row.note,
    extras: row.extras ?? {},
    raw: row.raw ?? {},
    lastProgressAt: toIsoTimestamp(row.last_progress_at),
    sourceUploadId: row.source_upload_id,
    sourceSheetTab: row.source_sheet_tab,
    sourceRowIndex: row.source_row_index,
  };
}

export function toTaskRow(
  input: TaskUpsertInput,
  options: { lastProgressAt: string | null; updatedAt: string },
): TaskWriteRow {
  return {
    team_id: input.teamId,
    department_id: input.departmentId,
    source_key: input.sourceKey,
    title: input.title,
    owner_member_id: input.ownerMemberId,
    owner_name_raw: input.ownerNameRaw,
    co_owner_names: input.coOwnerNames,
    status: input.status,
    approval_status: input.approvalStatus,
    priority: input.priority,
    risk_status: input.riskStatus,
    progress: input.progress,
    assigned_at: input.assignedAt,
    due_at: input.dueAt,
    next_action: input.nextAction,
    next_action_owner: input.nextActionOwner,
    next_action_due: input.nextActionDue,
    delay_reason: input.delayReason,
    note: input.note,
    extras: input.extras,
    raw: input.raw,
    last_progress_at: options.lastProgressAt,
    source_upload_id: input.sourceUploadId,
    source_sheet_tab: input.sourceSheetTab,
    source_row_index: input.sourceRowIndex,
    updated_at: options.updatedAt,
  };
}

/**
 * **부분 갱신용 행.** `toTaskRow`를 쓰지 않는 이유가 여기 전부다 — 그 함수는 *전체* 행을
 * 만들므로 `update()`에 넘기면 주지 않은 컬럼이 통째로 `null`로 덮인다. 준 키만 담는다.
 *
 * `patch.progress`의 `null`(값을 지운다)과 미지정(안 건드린다)이 갈리므로 `!== undefined`로
 * 본다. falsy 검사를 쓰면 `progress: 0`이 사라진다.
 *
 * `last_progress_at`은 담지 않는다 — 사람의 수정은 업로드가 아니다 (`TaskRepository` 주석).
 */
export function toTaskPatchRow(
  patch: TaskPatch,
  options: { updatedAt: string },
): Partial<TaskWriteRow> & { updated_at: string } {
  const row: Partial<TaskWriteRow> & { updated_at: string } = { updated_at: options.updatedAt };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.progress !== undefined) row.progress = patch.progress;
  // 두 칸은 `0008`이 authenticated에게 연 것이다. 정책(`tasks_update_scope`)은 그대로다
  if (patch.ownerMemberId !== undefined) row.owner_member_id = patch.ownerMemberId;
  if (patch.ownerNameRaw !== undefined) row.owner_name_raw = patch.ownerNameRaw;
  if (patch.coOwnerNames !== undefined) row.co_owner_names = [...patch.coOwnerNames];
  return row;
}

export function toMember(row: MemberRow): MemberRecord {
  return {
    id: row.id,
    // `teams.id`가 곧 `TeamKey`다 (`0001_init.sql` 주석) — 매핑표를 따로 두지 않는다.
    teamId: row.team_id as TeamKey,
    name: row.name,
    authUserId: row.auth_user_id,
  };
}

export function toGoalMetric(row: GoalMetricRow): GoalMetric {
  return {
    id: row.id,
    teamId: row.team_id as TeamKey,
    periodLabel: row.period_label,
    title: row.title,
    goalText: row.goal_text,
    kpiName: row.kpi_name,
    targetValue: toNumber(row.target_value),
    actualValue: toNumber(row.actual_value),
    achievementRate: toNumber(row.achievement_rate),
    prevPeriodDelta: row.prev_period_delta,
    channel: row.channel,
    ownerMemberId: row.owner_member_id,
    ownerNameRaw: row.owner_name_raw,
    execStatus: row.exec_status,
    analysis: row.analysis,
    wentWell: row.went_well,
    needsImprovement: row.needs_improvement,
    startedAt: row.started_at,
    dueAt: row.due_at,
    extras: row.extras ?? {},
    sourceUploadId: row.source_upload_id,
    sourceSheetTab: row.source_sheet_tab,
    sourceRowIndex: row.source_row_index,
  };
}

export function toGoalMetricRow(
  input: GoalMetricUpsertInput,
  options: { updatedAt: string },
): GoalMetricWriteRow {
  return {
    team_id: input.teamId,
    period_label: input.periodLabel,
    title: input.title,
    goal_text: input.goalText,
    kpi_name: input.kpiName,
    target_value: input.targetValue,
    actual_value: input.actualValue,
    achievement_rate: input.achievementRate,
    prev_period_delta: input.prevPeriodDelta,
    channel: input.channel,
    owner_member_id: input.ownerMemberId,
    owner_name_raw: input.ownerNameRaw,
    exec_status: input.execStatus,
    analysis: input.analysis,
    went_well: input.wentWell,
    needs_improvement: input.needsImprovement,
    started_at: input.startedAt,
    due_at: input.dueAt,
    extras: input.extras,
    source_upload_id: input.sourceUploadId,
    source_sheet_tab: input.sourceSheetTab,
    source_row_index: input.sourceRowIndex,
    updated_at: options.updatedAt,
  };
}

function toStage(row: StageRow): TaskStage {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    stageKey: row.stage_key,
    stageLabel: row.stage_label,
    plannedDate: row.planned_date,
    actualDate: row.actual_date,
    content: row.content,
    confirmStatus: row.confirm_status,
    slaDays: row.sla_days,
  };
}

function toEvent(row: EventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    uploadId: row.upload_id,
    // `changed_fields`는 jsonb라 무엇이든 올 수 있다. **바뀐 필드 이름 배열**이 아니면
    // 이력으로서 뜻이 없으므로 빈 배열로 떨어뜨린다 (값을 문자열로 뭉개지 않는다).
    changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    occurredAt: toIsoTimestamp(row.occurred_at) ?? row.occurred_at,
  };
}

/**
 * `search` 값이 필터 문자열을 깨뜨리지 않게 두 층을 통과시킨다.
 *
 * 1. **LIKE 와일드카드** — 메모리 구현은 `String.includes`라 `%`·`_`가 글자 그대로다.
 *    이스케이프하지 않으면 supabase만 다른 결과를 내고 계약 10번이 깨진다.
 * 2. **PostgREST 인용** — 값을 `"..."`로 감싸면 `,`·`)`가 안전해지고, 그 안의 `"`와 `\`만
 *    이스케이프하면 된다. 감싸지 않으면 `,` 하나로 `or(...)` 필터가 통째로 어긋난다.
 */
export function escapeSearchTerm(value: string): string {
  const likeSafe = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return likeSafe.replace(/["\\]/g, (char) => `\\${char}`);
}

/**
 * 자연키가 배열 안에서 겹치면 **뒤엣것만 남긴다** (마지막 쓰기 승리).
 * `ON CONFLICT`는 한 문장 안의 중복 키를 거부하므로 upsert 전에 반드시 접어야 하고,
 * 메모리 구현도 같은 규칙을 쓴다 (step 7) — 계약이 같으려면 이 접기도 같아야 한다.
 */
function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    byKey.set(keyOf(item), item);
  }
  return [...byKey.values()];
}

/**
 * 서버 전용 클라이언트. 환경변수가 하나라도 없으면 **예외 대신 `null`**이다 —
 * 폴백 여부는 `store-factory`(step 10)가 정한다 (`ADR-005`).
 */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  // 서버 프로세스다. 세션을 붙들거나 토큰을 갱신할 이유가 없다.
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseTaskStore(client: SupabaseClient): TaskRepository {
  /** 태스크 단계를 통째로 교체한다 (step 7과 같은 의미 — 누적이 아니라 교체) */
  async function replaceStages(
    taskIds: readonly string[],
    stagesByTaskId: ReadonlyMap<string, readonly Omit<TaskStage, 'id' | 'taskId'>[]>,
  ): Promise<void> {
    if (taskIds.length === 0) return;

    // 반드시 `task_id`로 좁혀서 지운다. 필터 없는 delete는 남의 단계까지 날린다.
    const { error: deleteError } = await client
      .from('task_stages')
      .delete().in('task_id', [...taskIds]);
    if (deleteError) fail('task_stages', 'delete', deleteError);

    const rows = taskIds.flatMap((taskId) =>
      (stagesByTaskId.get(taskId) ?? []).map((stage) => ({
        task_id: taskId,
        seq: stage.seq,
        stage_key: stage.stageKey,
        stage_label: stage.stageLabel,
        planned_date: stage.plannedDate,
        actual_date: stage.actualDate,
        content: stage.content,
        confirm_status: stage.confirmStatus,
        sla_days: stage.slaDays,
      })),
    );
    if (rows.length === 0) return;

    const { error: insertError } = await client.from('task_stages').insert(rows);
    if (insertError) fail('task_stages', 'insert', insertError);
  }

  return {
    async listTasks(filter?: TaskFilter): Promise<Task[]> {
      // 빈 배열은 "해당 없음"이다 (`matchesTaskFilter`와 같은 의미). `limit: 0`도 마찬가지로
      // 결과가 없다 — 둘 다 왕복할 이유가 없어 여기서 끝낸다.
      if (filter?.teamKeys?.length === 0) return [];
      if (filter?.sourceKeys?.length === 0) return [];
      if (filter?.statuses?.length === 0) return [];
      if (filter?.limit !== undefined && filter.limit <= 0) return [];

      // 필터는 **서버 측 쿼리로** 건다. 전건을 받아 JS로 거르면 `limit`의 의미가 달라진다.
      let query = client.from('tasks').select(TASK_COLUMNS);

      if (filter?.teamKeys) query = query.in('team_id', [...filter.teamKeys]);
      if (filter?.sourceKeys) query = query.in('source_key', [...filter.sourceKeys]);
      if (filter?.ownerNameRaw !== undefined) {
        query = query.eq('owner_name_raw', filter.ownerNameRaw);
      }
      // `due_at`이 null인 행은 SQL 비교에서 자연히 빠진다 — 기한 미설정은 범위 조회 밖이다.
      if (filter?.dueFrom !== undefined) query = query.gte('due_at', filter.dueFrom);
      if (filter?.dueTo !== undefined) query = query.lte('due_at', filter.dueTo);
      if (filter?.statuses) query = query.in('status', [...filter.statuses]);
      if (filter?.search !== undefined && filter.search !== '') {
        const term = escapeSearchTerm(filter.search);
        query = query.or(`title.ilike."%${term}%",owner_name_raw.ilike."%${term}%"`);
      }

      // 정렬은 결정적으로: 팀 → 자연키. 메모리 구현과 같은 순서다.
      query = query.order('team_id').order('source_key');
      if (filter?.limit !== undefined) query = query.limit(filter.limit);

      const { data, error } = await query;
      if (error) fail('tasks', 'select', error);
      return (data as unknown as TaskRow[]).map(toTask);
    },

    async getTask(id: string): Promise<Task | null> {
      // uuid가 아닌 값을 그대로 보내면 Postgres가 타입 오류를 낸다. 없는 id는 오류가 아니라
      // `null`이므로 모양부터 거른다.
      if (!UUID_PATTERN.test(id)) return null;

      const { data, error } = await client
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) fail('tasks', 'select', error);
      return data ? toTask(data as unknown as TaskRow) : null;
    },

    async upsertTasks(
      inputs: readonly TaskUpsertInput[],
      options: UpsertOptions,
    ): Promise<UpsertResult> {
      const deduped = dedupeByKey(inputs, taskUpsertKey);
      if (deduped.length === 0) return { created: 0, updated: 0, unchanged: 0, events: [] };

      // 기존 행을 **한 번에** 가져온다. 건별 왕복은 수백 행에서 그대로 수백 왕복이 된다.
      const { data: existingData, error: selectError } = await client
        .from('tasks')
        .select(TASK_COLUMNS)
        .in('team_id', [...new Set(deduped.map((input) => input.teamId))])
        .in('source_key', [...new Set(deduped.map((input) => input.sourceKey))]);
      if (selectError) fail('tasks', 'select', selectError);

      const existingByKey = new Map<string, Task>();
      for (const row of existingData as unknown as TaskRow[]) {
        const task = toTask(row);
        existingByKey.set(taskUpsertKey(task), task);
      }

      const result: UpsertResult = { created: 0, updated: 0, unchanged: 0, events: [] };
      const changedFieldsByKey = new Map<string, string[]>();
      const stagesByKey = new Map<string, readonly Omit<TaskStage, 'id' | 'taskId'>[]>();
      const rows: TaskWriteRow[] = [];

      for (const input of deduped) {
        const key = taskUpsertKey(input);
        const existing = existingByKey.get(key);
        stagesByKey.set(key, input.stages);

        if (!existing) {
          result.created += 1;
          rows.push(toTaskRow(input, { lastProgressAt: options.occurredAt, updatedAt: options.occurredAt }));
          continue;
        }

        // 분류는 `diffTaskFields` 하나로 한다. 여기서 다시 쓰면 두 구현이 갈라지는 지점이 된다.
        const changedFields = diffTaskFields(existing, input);

        // `lastProgressAt`은 **실제로 값이 바뀐 건에만** 움직인다. 같은 파일 재업로드로
        // 갱신되면 「장기 미갱신」 판정이 영원히 뜨지 않는다 (`UC-03`).
        rows.push(
          toTaskRow(input, {
            lastProgressAt: changedFields.length > 0 ? options.occurredAt : existing.lastProgressAt,
            updatedAt: options.occurredAt,
          }),
        );

        if (changedFields.length === 0) {
          result.unchanged += 1;
          continue;
        }
        result.updated += 1;
        changedFieldsByKey.set(key, changedFields);
      }

      // 무변경 건도 함께 쓴다. 이유는 **감사 필드**다 — 업로드 id·행 번호·시트 탭은 내용이
      // 그대로여도 최신 업로드를 가리켜야 한다 (step 7의 메모리 구현과 같은 동작).
      // `lastProgressAt`은 위에서 기존 값을 그대로 실어 보내므로 이 쓰기에 밀리지 않는다
      // (계약 3·5번). `updated_at`이 함께 움직이는 것은 그 부수 효과이고,
      // `getLastSyncedAt`은 그 위에 얹혀 있는 것이 아니라 두 테이블을 따로 본다.
      const { data: upserted, error: upsertError } = await client
        .from('tasks')
        .upsert(rows, { onConflict: 'team_id,source_key' })
        .select(TASK_COLUMNS);
      if (upsertError) fail('tasks', 'upsert', upsertError);

      const idByKey = new Map<string, string>();
      for (const row of upserted as unknown as TaskRow[]) {
        idByKey.set(taskUpsertKey({ teamId: row.team_id as TeamKey, sourceKey: row.source_key }), row.id);
      }

      const taskIds = deduped
        .map((input) => idByKey.get(taskUpsertKey(input)))
        .filter((id): id is string => id !== undefined);
      const stagesByTaskId = new Map<string, readonly Omit<TaskStage, 'id' | 'taskId'>[]>();
      for (const input of deduped) {
        const id = idByKey.get(taskUpsertKey(input));
        if (id) stagesByTaskId.set(id, stagesByKey.get(taskUpsertKey(input)) ?? []);
      }
      await replaceStages(taskIds, stagesByTaskId);

      const eventRows = [...changedFieldsByKey.entries()]
        .map(([key, changedFields]) => ({
          task_id: idByKey.get(key),
          upload_id: options.uploadId ?? null,
          changed_fields: changedFields,
          occurred_at: options.occurredAt,
        }))
        .filter((row): row is EventRow & { id?: never } => row.task_id !== undefined);

      if (eventRows.length > 0) {
        const { data: insertedEvents, error: eventError } = await client
          .from('task_events')
          .insert(eventRows)
          .select(EVENT_COLUMNS);
        if (eventError) fail('task_events', 'insert', eventError);

        result.events = (insertedEvents as unknown as EventRow[]).map((row) => ({
          id: row.id,
          taskId: row.task_id,
          uploadId: row.upload_id,
          changedFields: row.changed_fields,
          occurredAt: toIsoTimestamp(row.occurred_at) ?? options.occurredAt,
        }));
      }

      return result;
    },

    async listStages(taskIds: readonly string[]): Promise<TaskStage[]> {
      if (taskIds.length === 0) return [];

      const { data, error } = await client
        .from('task_stages')
        .select(STAGE_COLUMNS)
        .in('task_id', [...taskIds])
        .order('task_id')
        .order('seq');
      if (error) fail('task_stages', 'select', error);
      return (data as unknown as StageRow[]).map(toStage);
    },

    async listGoalMetrics(filter?: {
      teamKeys?: readonly TeamKey[];
      periodLabel?: string;
    }): Promise<GoalMetric[]> {
      if (filter?.teamKeys?.length === 0) return [];

      let query = client.from('goal_metrics').select(GOAL_COLUMNS);
      if (filter?.teamKeys) query = query.in('team_id', [...filter.teamKeys]);
      if (filter?.periodLabel !== undefined) query = query.eq('period_label', filter.periodLabel);

      const { data, error } = await query.order('team_id').order('period_label').order('title');
      if (error) fail('goal_metrics', 'select', error);
      return (data as unknown as GoalMetricRow[]).map(toGoalMetric);
    },

    async upsertGoalMetrics(
      inputs: readonly GoalMetricUpsertInput[],
      options: UpsertOptions,
    ): Promise<GoalMetricUpsertResult> {
      const deduped = dedupeByKey(inputs, goalMetricUpsertKey);
      if (deduped.length === 0) return { created: 0, updated: 0, unchanged: 0 };

      const { data: existingData, error: selectError } = await client
        .from('goal_metrics')
        .select(GOAL_COLUMNS)
        .in('team_id', [...new Set(deduped.map((input) => input.teamId))]);
      if (selectError) fail('goal_metrics', 'select', selectError);

      const existingByKey = new Map<string, GoalMetric>();
      for (const row of existingData as unknown as GoalMetricRow[]) {
        const metric = toGoalMetric(row);
        existingByKey.set(goalMetricUpsertKey(metric), metric);
      }

      const result: GoalMetricUpsertResult = { created: 0, updated: 0, unchanged: 0 };
      for (const input of deduped) {
        const existing = existingByKey.get(goalMetricUpsertKey(input));
        if (!existing) {
          result.created += 1;
        } else if (diffGoalMetricFields(existing, input).length > 0) {
          result.updated += 1;
        } else {
          result.unchanged += 1;
        }
      }

      // ⚠ `unique (team_id, period_label, title)`은 Postgres 기본 `nulls distinct`라
      // 기간·과제명이 null인 행은 `ON CONFLICT`가 접지 못한다 (step 8 주석). 한 배열 안의
      // 중복은 위 `dedupeByKey`가 접지만, 서로 다른 업로드 사이의 중복은 남을 수 있다.
      const { error: upsertError } = await client
        .from('goal_metrics')
        .upsert(
          deduped.map((input) => toGoalMetricRow(input, { updatedAt: options.occurredAt })),
          { onConflict: 'team_id,period_label,title' },
        );
      if (upsertError) fail('goal_metrics', 'upsert', upsertError);

      return result;
    },

    async recordEvents(incoming: readonly Omit<TaskEvent, 'id'>[]): Promise<void> {
      if (incoming.length === 0) return;

      const { error } = await client.from('task_events').insert(
        incoming.map((event) => ({
          task_id: event.taskId,
          upload_id: event.uploadId,
          changed_fields: event.changedFields,
          occurred_at: event.occurredAt,
        })),
      );
      if (error) fail('task_events', 'insert', error);
    },

    async listEvents(filter?: TaskEventFilter): Promise<TaskEvent[]> {
      // 빈 배열은 「해당 없음」이다. `.in('task_id', [])`도 0행이지만 왕복을 아낀다
      // (`listGoalMetrics`의 `teamKeys` 처리와 같은 결).
      if (filter?.taskIds?.length === 0) return [];

      let query = client.from('task_events').select(EVENT_COLUMNS);
      if (filter?.taskIds) query = query.in('task_id', [...filter.taskIds]);
      // 경계는 계약이 정한다 — `since`는 포함(`gte`), `until`은 제외(`lt`).
      if (filter?.since !== undefined) query = query.gte('occurred_at', filter.since);
      if (filter?.until !== undefined) query = query.lt('occurred_at', filter.until);

      // 자르지 않는다(`limit` 없음). 건수를 세는 것은 도메인의 일이고, 여기서 자르면
      // 「이번 주 N건」이 조용히 틀린다.
      const { data, error } = await query.order('occurred_at', { ascending: false });
      if (error) fail('task_events', 'select', error);
      return (data as unknown as EventRow[]).map(toEvent);
    },

    async updateTask(id: string, patch: TaskPatch, updatedAt: string): Promise<Task | null> {
      // `getTask`와 같은 이유로 모양부터 거른다 — uuid가 아닌 값을 그대로 보내면 Postgres가
      // 타입 오류를 내고, 없는 id는 오류가 아니라 `null`이다. step 9의 `PATCH /api/tasks/[id]`는
      // URL 경로에서 임의 문자열을 받는다.
      if (!UUID_PATTERN.test(id)) return null;

      const { data, error } = await client
        .from('tasks')
        .update(toTaskPatchRow(patch, { updatedAt }))
        .eq('id', id)
        .select(TASK_COLUMNS)
        .maybeSingle();
      // 0행은 「없는 id」이지 오류가 아니다. RLS가 걸린 클라이언트에서는 「권한 밖」도 여기다.
      if (error) fail('tasks', 'update', error);
      return data ? toTask(data as unknown as TaskRow) : null;
    },

    async listMembers(): Promise<MemberRecord[]> {
      const { data, error } = await client
        .from('members')
        .select(MEMBER_COLUMNS)
        .order('team_id')
        .order('name');
      if (error) fail('members', 'select', error);
      return (data as unknown as MemberRow[]).map(toMember);
    },

    async getLastSyncedAt(): Promise<string | null> {
      // 의미는 **"마지막으로 시트를 반영한 시각"**이다 (계약 17번). 무엇이 바뀌었는지가
      // 아니라 업로드가 돌았는지가 기준이므로, 업로드가 건드리는 **두 테이블을 모두** 본다.
      //
      // ⚠ `tasks`만 보면 목표 지표만 담긴 업로드(마케팅 탭 B섹션만, UC-04)에서 시각이
      // 멈춘다 — memory 구현은 갱신하는데 여기만 멈춰서 두 구현이 갈라져 있었다.
      // 계약 17번에 그 갈래를 넣어 재현한 뒤 고쳤다.
      //
      // 집계 SQL(`max()`)이 아니라 정렬 1행 조회 둘이다. 단조로운 "가장 최근 시각"이라
      // 이걸로 충분하고, 집계를 SQL에 두지 않는다는 경계(`ADR-006`)도 지킨다.
      const latestOf = async (table: 'tasks' | 'goal_metrics'): Promise<string | null> => {
        const { data, error } = await client
          .from(table)
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) fail(table, 'select', error);
        return data ? toIsoTimestamp((data as { updated_at: string | null }).updated_at) : null;
      };

      const [fromTasks, fromGoals] = await Promise.all([latestOf('tasks'), latestOf('goal_metrics')]);
      if (fromTasks === null) return fromGoals;
      if (fromGoals === null) return fromTasks;
      // 둘 다 `YYYY-MM-DDTHH:mm:ss.sssZ`(같은 길이·같은 UTC)라 문자열 비교가 곧 시각 비교다.
      return fromTasks >= fromGoals ? fromTasks : fromGoals;
    },
  };
}
