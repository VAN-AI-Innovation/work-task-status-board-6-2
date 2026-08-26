/**
 * 두 층으로 나뉜다.
 *
 * 1. **매퍼 단위 테스트** — 연결 없이 돈다. row ↔ 도메인 변환은 순수 함수라 키가 없어도
 *    검증할 수 있고, 실제로 여기서 깨지는 것이 대부분이다 (날짜·`numeric`·`0`과 `null`).
 * 2. **계약 테스트** — 실제 Supabase에 붙어 돈다. `describeRepositoryContract`를 **호출만** 한다.
 *    스위트를 복사하면 두 벌이 갈라지고, 갈라진 계약은 계약이 아니다 (T4 완료 기준 8).
 *
 * 자격증명이 없으면 계약이 조용히 0건 통과하는 것처럼 보이면 안 되므로 `it.skip`으로
 * **흔적을 남긴다.**
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  CONTRACT_KEY_PREFIX,
  CONTRACT_UPLOAD_IDS,
  describeRepositoryContract,
  scopeToContractRows,
} from '@/lib/store/repository-contract';
import {
  createServiceRoleClient,
  createSupabaseTaskStore,
  escapeSearchTerm,
  toGoalMetric,
  toGoalMetricRow,
  toIsoTimestamp,
  toMember,
  toTask,
  toTaskPatchRow,
  toTaskRow,
  type GoalMetricRow,
  type TaskRow,
} from '@/lib/store/supabase-task-store';
import type { GoalMetricUpsertInput, TaskUpsertInput } from '@/lib/store/task-repository';
import type { GoalMetric } from '@/types/goal';

const TASK_ROW: TaskRow = {
  id: '33333333-3333-4333-8333-333333333333',
  team_id: 'edit',
  department_id: null,
  source_key: 'contract::card-a',
  title: '카드뉴스 A',
  owner_member_id: null,
  owner_name_raw: '김편집',
  co_owner_names: ['박부원'],
  status: '진행 중',
  approval_status: null,
  priority: null,
  risk_status: null,
  progress: 0,
  assigned_at: '2026-07-20',
  due_at: '2026-07-27',
  next_action: null,
  next_action_owner: null,
  next_action_due: null,
  delay_reason: null,
  note: null,
  extras: { 채널: '인스타' },
  raw: { A: 1 },
  last_progress_at: '2026-07-20T09:00:00+00:00',
  source_upload_id: CONTRACT_UPLOAD_IDS[0],
  source_sheet_tab: '01_편집팀',
  source_row_index: 5,
  updated_at: '2026-07-20T09:00:00+00:00',
};

function taskInput(overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'contract::card-a',
    title: '카드뉴스 A',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 0,
    assignedAt: '2026-07-20',
    dueAt: null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    stages: [],
    ...overrides,
  };
}

describe('toIsoTimestamp', () => {
  it('PostgREST의 +00:00 표기를 ISO Z로 정규화한다', () => {
    expect(toIsoTimestamp('2026-07-20T09:00:00+00:00')).toBe('2026-07-20T09:00:00.000Z');
  });

  it('이미 ISO Z인 값은 그대로 돌려준다', () => {
    expect(toIsoTimestamp('2026-07-20T09:00:00.000Z')).toBe('2026-07-20T09:00:00.000Z');
  });

  it('null은 null이다', () => {
    expect(toIsoTimestamp(null)).toBeNull();
  });
});

describe('toTask', () => {
  it('snake_case 컬럼을 camelCase 필드로 옮긴다', () => {
    const task = toTask(TASK_ROW);

    expect(task.id).toBe(TASK_ROW.id);
    expect(task.teamId).toBe('edit');
    expect(task.sourceKey).toBe('contract::card-a');
    expect(task.ownerNameRaw).toBe('김편집');
    expect(task.coOwnerNames).toEqual(['박부원']);
    expect(task.sourceSheetTab).toBe('01_편집팀');
    expect(task.sourceRowIndex).toBe(5);
    expect(task.extras).toEqual({ 채널: '인스타' });
    expect(task.raw).toEqual({ A: 1 });
  });

  it('date 컬럼은 YYYY-MM-DD 문자열 그대로 둔다 (Date로 되돌리지 않는다)', () => {
    const task = toTask(TASK_ROW);

    expect(task.assignedAt).toBe('2026-07-20');
    expect(task.dueAt).toBe('2026-07-27');
    expect(typeof task.dueAt).toBe('string');
  });

  it('timestamptz는 ISO Z로 정규화한다', () => {
    expect(toTask(TASK_ROW).lastProgressAt).toBe('2026-07-20T09:00:00.000Z');
  });

  it('progress의 0은 0으로 남는다 (null로 접히지 않는다)', () => {
    expect(toTask(TASK_ROW).progress).toBe(0);
    expect(toTask({ ...TASK_ROW, progress: null }).progress).toBeNull();
  });

  it('null 컬럼과 비어 있는 jsonb·배열을 안전하게 옮긴다', () => {
    const task = toTask({
      ...TASK_ROW,
      title: null,
      owner_name_raw: null,
      co_owner_names: null,
      extras: null,
      raw: null,
      last_progress_at: null,
      due_at: null,
    });

    expect(task.title).toBeNull();
    expect(task.ownerNameRaw).toBeNull();
    expect(task.coOwnerNames).toEqual([]);
    expect(task.extras).toEqual({});
    expect(task.raw).toEqual({});
    expect(task.lastProgressAt).toBeNull();
    expect(task.dueAt).toBeNull();
  });
});

describe('toTaskRow', () => {
  const options = { lastProgressAt: '2026-07-20T09:00:00.000Z', updatedAt: '2026-07-27T09:00:00.000Z' };

  it('camelCase 필드를 snake_case 컬럼으로 옮기고 stages·id는 싣지 않는다', () => {
    const row = toTaskRow(taskInput(), options);

    expect(row.team_id).toBe('edit');
    expect(row.source_key).toBe('contract::card-a');
    expect(row.owner_name_raw).toBe('김편집');
    expect(row.source_row_index).toBe(5);
    expect(row.last_progress_at).toBe(options.lastProgressAt);
    expect(row.updated_at).toBe(options.updatedAt);
    expect(row).not.toHaveProperty('stages');
    // id를 싣지 않아야 신규·기존 행을 **같은 모양**으로 한 번에 upsert할 수 있다.
    expect(row).not.toHaveProperty('id');
  });

  it('progress 0과 null을 구분해 싣는다', () => {
    expect(toTaskRow(taskInput({ progress: 0 }), options).progress).toBe(0);
    expect(toTaskRow(taskInput({ progress: null }), options).progress).toBeNull();
  });

  it('왕복(row → 도메인 → row)에서 값이 보존된다', () => {
    const task = toTask(TASK_ROW);
    const row = toTaskRow({ ...task, stages: [] }, options);

    expect(row.source_key).toBe(TASK_ROW.source_key);
    expect(row.extras).toEqual(TASK_ROW.extras);
    expect(row.co_owner_names).toEqual(TASK_ROW.co_owner_names);
    expect(row.due_at).toBe(TASK_ROW.due_at);
    expect(row.progress).toBe(TASK_ROW.progress);
  });
});

describe('toGoalMetric', () => {
  const GOAL_ROW: GoalMetricRow = {
    id: '44444444-4444-4444-8444-444444444444',
    team_id: 'marketing',
    period_label: 'contract::2026-07 4주차',
    title: '인스타 팔로워 증대',
    goal_text: null,
    kpi_name: '팔로워 증가 수',
    target_value: '100.00',
    actual_value: '120.5',
    achievement_rate: null,
    prev_period_delta: null,
    channel: '인스타그램',
    owner_member_id: null,
    owner_name_raw: '최마케팅',
    exec_status: null,
    analysis: null,
    went_well: null,
    needs_improvement: null,
    started_at: '2026-07-20',
    due_at: null,
    extras: {},
    source_upload_id: null,
    source_sheet_tab: '03_마케팅·관리팀',
    source_row_index: 25,
  };

  it('numeric이 문자열로 와도 숫자로 바꾸고 null은 null로 둔다', () => {
    const metric = toGoalMetric(GOAL_ROW);

    expect(metric.targetValue).toBe(100);
    expect(metric.actualValue).toBe(120.5);
    expect(metric.achievementRate).toBeNull();
  });

  it('numeric이 숫자로 와도 그대로 숫자다', () => {
    expect(toGoalMetric({ ...GOAL_ROW, target_value: 40 }).targetValue).toBe(40);
  });

  it('0은 0으로 남는다 (null로 접히지 않는다)', () => {
    expect(toGoalMetric({ ...GOAL_ROW, actual_value: '0' }).actualValue).toBe(0);
  });

  it('date 컬럼은 문자열 그대로다', () => {
    expect(toGoalMetric(GOAL_ROW).startedAt).toBe('2026-07-20');
    expect(toGoalMetric(GOAL_ROW).dueAt).toBeNull();
  });

  it('toGoalMetricRow는 id를 싣지 않고 snake_case로 옮긴다', () => {
    // `GoalMetricUpsertInput`은 `id`가 없는 모양이다. 왕복을 확인하려면 그것만 떼면 된다.
    const withoutId: Partial<GoalMetric> = { ...toGoalMetric(GOAL_ROW) };
    delete withoutId.id;
    const row = toGoalMetricRow(withoutId as GoalMetricUpsertInput, {
      updatedAt: '2026-07-27T09:00:00.000Z',
    });

    expect(row.team_id).toBe('marketing');
    expect(row.period_label).toBe('contract::2026-07 4주차');
    expect(row.target_value).toBe(100);
    expect(row.needs_improvement).toBeNull();
    expect(row).not.toHaveProperty('id');
  });
});

describe('escapeSearchTerm', () => {
  it('평범한 문자열은 그대로 통과한다', () => {
    expect(escapeSearchTerm('카드뉴스')).toBe('카드뉴스');
  });

  it('LIKE 와일드카드를 무력화한다 (부분 일치는 문자 그대로여야 한다)', () => {
    expect(escapeSearchTerm('100%')).toBe('100\\\\%');
    expect(escapeSearchTerm('a_b')).toBe('a\\\\_b');
  });

  it('PostgREST 필터 문자열을 깨뜨리는 문자를 흘려보내지 않는다', () => {
    // `,`·`)`는 인용 부호 안에서 안전하고, `"`는 이스케이프돼야 한다.
    const escaped = escapeSearchTerm('a,b)c"d');

    expect(escaped).toContain('\\"');
    expect(escaped.startsWith('a,b)c')).toBe(true);
  });

  it('역슬래시를 두 층 모두 통과시킨다', () => {
    expect(escapeSearchTerm('a\\b')).toBe('a\\\\\\\\b');
  });
});

describe('createServiceRoleClient', () => {
  it('환경변수가 하나라도 없으면 예외를 던지지 않고 null을 돌려준다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    expect(createServiceRoleClient()).toBeNull();

    vi.unstubAllEnvs();
  });

  it('URL만 있고 service_role 키가 없으면 null이다', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    expect(createServiceRoleClient()).toBeNull();

    vi.unstubAllEnvs();
  });
});

describe('toTaskPatchRow', () => {
  it('준 키만 담는다 — 주지 않은 컬럼은 행에 없다 (null로 덮이지 않는다)', () => {
    const row = toTaskPatchRow({ progress: 65 }, { updatedAt: '2026-07-27T09:00:00.000Z' });

    expect(row).toEqual({ progress: 65, updated_at: '2026-07-27T09:00:00.000Z' });
    expect('status' in row).toBe(false);
    // `toTaskRow`가 만드는 전체 행과 달리 신원·감사 컬럼이 없다. 있으면 부분 갱신이 아니다.
    expect('source_key' in row).toBe(false);
    expect('title' in row).toBe(false);
    expect('last_progress_at' in row).toBe(false);
  });

  it('progress: null은 담고(값을 지운다) 미지정은 담지 않는다', () => {
    expect('progress' in toTaskPatchRow({ progress: null }, { updatedAt: 'T' })).toBe(true);
    expect(toTaskPatchRow({ progress: null }, { updatedAt: 'T' }).progress).toBeNull();
    expect('progress' in toTaskPatchRow({ status: '완료' }, { updatedAt: 'T' })).toBe(false);
  });

  it('빈 patch는 updated_at만 담는다', () => {
    expect(toTaskPatchRow({}, { updatedAt: 'T' })).toEqual({ updated_at: 'T' });
  });
});

describe('toMember', () => {
  it('snake_case 컬럼을 camelCase 필드로 옮긴다', () => {
    expect(
      toMember({
        id: '44444444-4444-4444-8444-444444444444',
        team_id: 'edit',
        name: '김편집',
        auth_user_id: null,
      }),
    ).toEqual({
      id: '44444444-4444-4444-8444-444444444444',
      teamId: 'edit',
      name: '김편집',
      authUserId: null,
    });
  });

  it('auth_user_id가 있으면 그대로 싣는다 (T8에서 채워진다)', () => {
    expect(
      toMember({ id: 'm1', team_id: 'shoot', name: '박촬영', auth_user_id: 'auth-1' }).authUserId,
    ).toBe('auth-1');
  });
});

/**
 * 여기부터는 실제 Supabase가 필요하다. 계약 항목은 memory와 **같은 목록**이며,
 * `--reporter=verbose`에서 두 이름으로 나란히 찍히는 것이 T4 완료 기준 8의 증거다.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const canRun = Boolean(supabaseUrl && serviceRoleKey);

if (canRun) {
  const client = createServiceRoleClient();
  if (!client) throw new Error('자격증명이 있는데 클라이언트가 만들어지지 않았다');

  // 정리 검증용 씨앗. 계약 스위트의 씨앗과 **자연키가 겹치지 않게** 두되 접두사는 같이
  // 붙여서, 이 테스트가 만든 행도 `reset`이 지우는 범위 안에 들어오게 한다.
  // `toTask`의 결과를 그대로 펼친다. 남는 `id`·`lastProgressAt`은 `toTaskRow`가 컬럼을
  // 명시적으로 골라 담으므로 실려 나가지 않는다 (매퍼 단위 테스트가 그것을 고정한다).
  const CONTRACT_SEED_TASK: TaskUpsertInput = {
    ...toTask(TASK_ROW),
    sourceKey: `${CONTRACT_KEY_PREFIX}reset-probe`,
    sourceUploadId: CONTRACT_UPLOAD_IDS[0],
    stages: [],
  };
  const CONTRACT_SEED_STAGE = (seq: number) => ({
    seq,
    stageKey: `stage-${seq}`,
    stageLabel: `${seq}단계`,
    plannedDate: null,
    actualDate: null,
    content: null,
    confirmStatus: null,
    slaDays: null,
  });
  const CONTRACT_SEED_GOAL: GoalMetricUpsertInput = {
    teamId: 'marketing',
    periodLabel: `${CONTRACT_KEY_PREFIX}reset-probe 주차`,
    title: '정리 검증용 지표',
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
    sourceUploadId: CONTRACT_UPLOAD_IDS[0],
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 25,
  };

  /** 자식 테이블을 **부모 id로** 센다. 전체 건수를 세면 실업무 행이 있을 때 오탐한다 */
  const countRows = async (table: 'task_stages' | 'task_events', column: string, ids: string[]) => {
    if (ids.length === 0) return 0;
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, ids);
    if (error) throw new Error(`정리 검증 조회 실패 (${table}, code=${error.code ?? 'UNKNOWN'})`);
    return count ?? 0;
  };

  /**
   * **`contract::` 접두사가 붙은 행만** 지운다. 필터 없는 `delete()`는 실업무 데이터를
   * 통째로 날린다. 단계·이벤트는 `on delete cascade`로 따라 지워진다 — 그 전제가 실제로
   * 성립하는지는 아래 「계약 정리(reset)」가 직접 세어서 확인한다.
   */
  const resetContractRows = async () => {
      // 외래키 대상인 `uploads` 행을 먼저 마련한다. 계약이 업로드 id를 실어 보내기 때문이다.
      const uploads = await client.from('uploads').upsert(
        CONTRACT_UPLOAD_IDS.map((id) => ({
          id,
          kind: 'sheet',
          status: 'done',
          filename: 'contract-fixture.xlsx',
        })),
        { onConflict: 'id' },
      );
      const tasks = await client.from('tasks').delete().like('source_key', `${CONTRACT_KEY_PREFIX}%`);
      const goals = await client
        .from('goal_metrics')
        .delete()
        .like('period_label', `${CONTRACT_KEY_PREFIX}%`);

      // 정리에 실패하면 **그 자리에서 멈춘다.** 조용히 넘어가면 이전 케이스의 행이 남아
      // 다음 케이스가 엉뚱한 이유로 깨지고, 원인이 계약 위반처럼 보인다.
      for (const [label, result] of [
        ['uploads', uploads],
        ['tasks', tasks],
        ['goal_metrics', goals],
      ] as const) {
        if (result.error) {
          throw new Error(`계약 정리 실패 (${label}, code=${result.error.code ?? 'UNKNOWN'})`);
        }
      }
  };

  describeRepositoryContract('supabase', {
    async create() {
      return createSupabaseTaskStore(client);
    },
    reset: resetContractRows,
  });

  // 정리는 케이스 **앞**에서 도므로 마지막 케이스의 행이 DB에 남는다. 그 행은 화면의 업무
  // 목록과 「마지막 반영」에 그대로 섞여 보인다 (`updated_at`이 계약 시간대라 더 눈에 띈다).
  afterAll(resetContractRows);

  /**
   * 1차 시도에서 계약 10건이 깨진 원인이 여기였다 — `reset`이 `tasks`만 지워서 앞 케이스가
   * 넣은 `goal_metrics`가 다음 케이스에 보였다. 정리가 실제로 0건을 만드는지를 **세어서**
   * 확인한다. 특히 단계·이벤트는 `on delete cascade`에 기대고 있어, 그 전제가 조용히
   * 무너지면 다시 같은 방식으로 계약이 산발적으로 깨진다.
   */
  /**
   * 계약 10번의 `limit` 단언은 `scopeToContractRows`가 가져갔다 — 남의 행이 앞자리를 채우지
   * 않게 하려고 `limit`을 떼어 받은 뒤 자르기 때문이다(`ADR-023`). 그래서 **서버 측
   * `.limit()`이 실제로 걸리는지**는 여기서 따로 본다. `sourceKeys`로 좁혀 놓으면 실업무
   * 행이 몇 건이든 결과가 정해진다.
   */
  /**
   * 계약에 넣지 않은 이유: 계약이 이것을 재려면 **구성원을 만드는 쓰기 메서드**가 있어야
   * 하는데, 그 메서드를 제품 코드 어디도 부르지 않는다 (구성원은 시드 스크립트가 만든다).
   * 쓰지 않을 쓰기를 계약을 위해 만드는 것은 계약이 코드를 늘리는 것이다.
   *
   * **원격을 더럽히지 않는다** — `contract::` 이름의 행을 직접 넣고 `finally`에서 그 행만
   * 지운다. 실업무 구성원 행이 몇이든 단언이 정해지도록 「그 행을 포함하는가」만 본다.
   */
  describe('listMembers', () => {
    it('members 행을 MemberRecord로 옮겨 담는다', async () => {
      const repo = createSupabaseTaskStore(client);
      const name = `${CONTRACT_KEY_PREFIX}구성원-probe`;

      const inserted = await client
        .from('members')
        .upsert({ team_id: 'edit', name, auth_user_id: null }, { onConflict: 'team_id,name' })
        .select('id')
        .maybeSingle();
      if (inserted.error) {
        throw new Error(`구성원 준비 실패 (code=${inserted.error.code ?? 'UNKNOWN'})`);
      }

      try {
        const members = await repo.listMembers();
        const found = members.find((member) => member.name === name);

        expect(found).toBeDefined();
        expect(found?.teamId).toBe('edit');
        expect(found?.authUserId).toBeNull();
        expect(found?.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      } finally {
        // 넣은 행 하나만 지운다. 실업무 구성원은 건드리지 않는다.
        await client.from('members').delete().eq('team_id', 'edit').eq('name', name);
      }
    });
  });

  describe('서버 측 limit', () => {
    it('listTasks({ limit })가 PostgREST 쪽에서 잘려 온다', async () => {
      const repo = createSupabaseTaskStore(client);
      await resetContractRows();

      const sourceKeys = [1, 2, 3].map((n) => `${CONTRACT_KEY_PREFIX}limit-${n}`);
      await repo.upsertTasks(
        sourceKeys.map((sourceKey) => ({ ...CONTRACT_SEED_TASK, sourceKey })),
        { occurredAt: '2099-07-20T09:00:00.000Z', uploadId: CONTRACT_UPLOAD_IDS[0] },
      );

      expect(await repo.listTasks({ sourceKeys })).toHaveLength(3);
      expect(await repo.listTasks({ sourceKeys, limit: 2 })).toHaveLength(2);
    });
  });

  describe('계약 정리(reset)', () => {
    it('태스크·단계·이벤트·목표 지표를 남김없이 지운다 (cascade 전제 검증)', async () => {
      const repo = createSupabaseTaskStore(client);
      await resetContractRows();

      const seeded = await repo.upsertTasks(
        [
          {
            ...CONTRACT_SEED_TASK,
            stages: [CONTRACT_SEED_STAGE(0), CONTRACT_SEED_STAGE(1)],
          },
        ],
        { occurredAt: '2026-07-20T09:00:00.000Z', uploadId: CONTRACT_UPLOAD_IDS[0] },
      );
      expect(seeded.created).toBe(1);

      // 이벤트도 한 건 만든다 — progress를 바꾸면 `task_events`에 행이 생긴다.
      await repo.upsertTasks(
        [{ ...CONTRACT_SEED_TASK, progress: 90, stages: [CONTRACT_SEED_STAGE(0)] }],
        { occurredAt: '2026-07-27T09:00:00.000Z', uploadId: CONTRACT_UPLOAD_IDS[1] },
      );
      await repo.upsertGoalMetrics([CONTRACT_SEED_GOAL], { occurredAt: '2026-07-27T09:00:00.000Z' });

      // 계약 행만 센다. 전체를 세면 실업무 행이 있을 때 오탐한다 (이슈 #20).
      const scoped = scopeToContractRows(repo);
      const taskIds = (await scoped.listTasks()).map((task) => task.id);
      expect(taskIds).toHaveLength(1);

      // 지우기 전에는 네 테이블 모두 행이 있다 (없으면 아래 0건이 의미가 없다).
      expect(await countRows('task_stages', 'task_id', taskIds)).toBeGreaterThan(0);
      expect(await countRows('task_events', 'task_id', taskIds)).toBeGreaterThan(0);

      await resetContractRows();

      expect(await scoped.listTasks()).toHaveLength(0);
      expect(await scoped.listGoalMetrics()).toHaveLength(0);
      // 자식 테이블은 방금 지운 태스크 id로 직접 센다. 전체 건수를 세면 실업무 행이 있을 때
      // 엉뚱하게 실패한다.
      expect(await countRows('task_stages', 'task_id', taskIds)).toBe(0);
      expect(await countRows('task_events', 'task_id', taskIds)).toBe(0);
    });
  });
} else {
  describe('저장소 계약: supabase', () => {
    it.skip('Supabase 자격증명이 없어 건너뜀 — .env.local에 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요하다', () => {});
  });
}
