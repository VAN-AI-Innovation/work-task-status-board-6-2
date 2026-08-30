/**
 * 확정은 **저장소에 처음으로 쓰는 지점**이라, 여기서 지켜야 할 것이 넷이다.
 *
 * 1. **멱등** — 같은 payload를 다시 확정하면 전건 유지이고 이벤트가 0건이다 (`UC-03`).
 *    Supabase에 트랜잭션이 없는 대신 이 성질이 부분 반영을 수렴시킨다 (T5 완료 기준 14).
 * 2. **부분 업로드** — 워크북에 없는 팀은 건드리지 않는다 (`UC-04`, 타협 대상이 아니다).
 * 3. **개인정보** — 확정 후 `parseResult`가 비고, 실패 후에는 남는다 (`S6`·`X4`).
 * 4. **읽기 전용** — 저장소를 건드리기 전에 막힌다 (`ADR-005`).
 */

import { describe, expect, it } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type {
  GoalMetricUpsertInput,
  TaskRepository,
  TaskUpsertInput,
} from '@/lib/store/task-repository';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import { commitUpload } from '@/lib/upload/upload-commit';
import type { CommitPayload } from '@/lib/upload/upload-preview';

const CREATED_AT = '2026-08-21T00:00:00.000Z';
const OCCURRED_AT = '2026-08-21T09:00:00.000Z';
const LATER_AT = '2026-08-28T09:00:00.000Z';

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
    assignedAt: '2026-08-17',
    dueAt: '2026-08-24',
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

function goalInput(overrides: Partial<GoalMetricUpsertInput> = {}): GoalMetricUpsertInput {
  return {
    teamId: 'marketing',
    periodLabel: '2026-08 3주차',
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
    sourceUploadId: null,
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 25,
    ...overrides,
  };
}

function payloadOf(overrides: Partial<CommitPayload> = {}): CommitPayload {
  return {
    tasks: [taskInput(), taskInput({ sourceKey: 'card-b', title: '카드뉴스 B' })],
    goalMetrics: [goalInput()],
    teamKeys: ['edit', 'marketing'],
    enums: [],
    ...overrides,
  };
}

/** 저장소 + 업로드 레코드 + `previewing` 상태의 행 하나를 한 번에 조립한다 */
async function setup(payload: CommitPayload = payloadOf()) {
  const repo = createMemoryTaskStore();
  const uploads = createMemoryUploadStore();
  const record = await uploads.create({
    kind: 'sheet',
    filename: '업무시트.xlsx',
    parseResult: payload,
    createdAt: CREATED_AT,
  });
  return { repo, uploads, uploadId: record.id };
}

/** 실패 갈래를 좁혀 준다 — 테스트마다 분기를 쓰면 읽히지 않는다 */
function expectOk(outcome: Awaited<ReturnType<typeof commitUpload>>) {
  if (!outcome.ok) throw new Error(`확정이 실패했다: ${outcome.code}`);
  return outcome;
}

describe('commitUpload', () => {
  it('확정하면 payload가 저장되고 parseResult가 비워진다', async () => {
    const payload = payloadOf();
    const { repo, uploads, uploadId } = await setup(payload);

    const outcome = expectOk(await commitUpload({ repo, uploads, readOnly: false }, uploadId, OCCURRED_AT));

    expect(outcome.summary.created).toBe(payload.tasks.length);
    expect(outcome.summary.updated).toBe(0);
    expect(outcome.summary.unchanged).toBe(0);
    expect(outcome.summary.goalMetricsCreated).toBe(payload.goalMetrics.length);
    expect(outcome.summary.teamKeys).toEqual(['edit', 'marketing']);
    expect(await repo.listTasks()).toHaveLength(payload.tasks.length);
    expect(await repo.listGoalMetrics()).toHaveLength(payload.goalMetrics.length);

    const record = await uploads.get(uploadId);
    expect(record?.status).toBe('done');
    // 원본 행에는 실명·연락처가 있다. 확정 즉시 버린다 (`S6`)
    expect(record?.parseResult).toBeNull();
    expect(record?.summary).toEqual(outcome.summary);
  });

  it('같은 업로드를 두 번 확정하면 두 번째는 거부되고 저장소가 늘지 않는다', async () => {
    const { repo, uploads, uploadId } = await setup();
    const deps = { repo, uploads, readOnly: false };

    expectOk(await commitUpload(deps, uploadId, OCCURRED_AT));
    const countAfterFirst = (await repo.listTasks()).length;

    const second = await commitUpload(deps, uploadId, LATER_AT);

    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('UPLOAD_ALREADY_COMMITTED');
    expect(await repo.listTasks()).toHaveLength(countAfterFirst);
  });

  it('같은 payload를 새 업로드로 다시 확정하면 전건 유지이고 이벤트가 0건이다 (UC-03 · 멱등)', async () => {
    const payload = payloadOf();
    const { repo, uploads, uploadId } = await setup(payload);
    const deps = { repo, uploads, readOnly: false };

    expectOk(await commitUpload(deps, uploadId, OCCURRED_AT));
    const first = await repo.listTasks();

    const retry = await uploads.create({
      kind: 'sheet',
      filename: '업무시트.xlsx',
      parseResult: payload,
      createdAt: CREATED_AT,
    });
    const second = expectOk(await commitUpload(deps, retry.id, LATER_AT));

    expect(second.summary.created).toBe(0);
    expect(second.summary.updated).toBe(0);
    expect(second.summary.unchanged).toBe(payload.tasks.length);
    expect(second.summary.goalMetricsUpdated).toBe(0);
    // 같은 파일 재확정으로 「장기 미갱신」 판정이 움직이면 안 된다
    expect((await repo.listTasks()).map((task) => task.lastProgressAt)).toEqual(
      first.map((task) => task.lastProgressAt),
    );
  });

  it('읽기 전용이면 저장소를 건드리기 전에 막힌다', async () => {
    const { repo, uploads, uploadId } = await setup();

    const outcome = await commitUpload({ repo, uploads, readOnly: true }, uploadId, OCCURRED_AT);

    expect(outcome.ok === false && outcome.code).toBe('STORAGE_READONLY');
    expect(await repo.listTasks()).toEqual([]);
    expect((await uploads.get(uploadId))?.status).toBe('previewing');
  });

  it('없는 업로드 id는 UPLOAD_NOT_FOUND다', async () => {
    const { repo, uploads } = await setup();

    const outcome = await commitUpload(
      { repo, uploads, readOnly: false },
      '00000000-0000-4000-8000-000000000000',
      OCCURRED_AT,
    );

    expect(outcome.ok === false && outcome.code).toBe('UPLOAD_NOT_FOUND');
    expect(await repo.listTasks()).toEqual([]);
  });

  it('저장이 실패하면 failed로 남고 parseResult가 살아 있다 (재시도 경로)', async () => {
    const { repo, uploads, uploadId } = await setup();
    const broken: TaskRepository = {
      ...repo,
      async upsertTasks() {
        throw new Error('연결이 끊겼다');
      },
    };

    const outcome = await commitUpload(
      { repo: broken, uploads, readOnly: false },
      uploadId,
      OCCURRED_AT,
    );

    expect(outcome.ok === false && outcome.code).toBe('STORAGE_UNAVAILABLE');
    const record = await uploads.get(uploadId);
    expect(record?.status).toBe('failed');
    expect(record?.parseResult).not.toBeNull();
  });

  it('runAtomically가 있으면 목표 지표 실패가 태스크 반영까지 되돌린다', async () => {
    const { repo, uploads, uploadId } = await setup();
    // 스프레드로 넘어온 `runAtomically`는 원본 저장소의 상태를 그대로 스냅샷한다
    const broken: TaskRepository = {
      ...repo,
      async upsertGoalMetrics() {
        throw new Error('연결이 끊겼다');
      },
    };
    expect(broken.runAtomically).toBeDefined();

    const outcome = await commitUpload(
      { repo: broken, uploads, readOnly: false },
      uploadId,
      OCCURRED_AT,
    );

    expect(outcome.ok === false && outcome.code).toBe('STORAGE_UNAVAILABLE');
    // 스냅샷-교체가 태스크 upsert까지 되돌렸다 (`X4`)
    expect(await repo.listTasks()).toEqual([]);
  });

  it('편집팀만 든 payload를 확정해도 촬영팀 기존 태스크가 남는다 (UC-04)', async () => {
    const shootTask = taskInput({
      teamId: 'shoot',
      sourceKey: 'vlog-a',
      title: '브이로그 촬영',
      sourceSheetTab: '02_촬영·기획팀',
    });
    const { repo, uploads, uploadId } = await setup(
      payloadOf({ tasks: [shootTask], goalMetrics: [], teamKeys: ['shoot'] }),
    );
    const deps = { repo, uploads, readOnly: false };
    expectOk(await commitUpload(deps, uploadId, OCCURRED_AT));

    const editOnly = await uploads.create({
      kind: 'sheet',
      filename: '편집팀만.xlsx',
      parseResult: payloadOf({ tasks: [taskInput()], goalMetrics: [], teamKeys: ['edit'] }),
      createdAt: CREATED_AT,
    });
    expectOk(await commitUpload(deps, editOnly.id, LATER_AT));

    const keys = (await repo.listTasks()).map((task) => task.sourceKey).sort();
    expect(keys).toEqual(['card-a', 'vlog-a']);
  });

  it('구성원이 있으면 upsertTasks가 id가 붙은 태스크를 받는다', async () => {
    const { repo, uploads, uploadId } = await setup(
      payloadOf({ tasks: [taskInput()], goalMetrics: [], teamKeys: ['edit'] }),
    );
    let received: readonly TaskUpsertInput[] = [];
    // 「결과가 그렇더라」가 아니라 **「그 인자로 불렀다」**를 잰다 — 저장소가 조용히 무시해도 잡힌다
    const spy: TaskRepository = {
      ...repo,
      async listMembers() {
        return [{ id: 'm-1', teamId: 'edit' as const, name: '김편집', authUserId: null }];
      },
      async upsertTasks(tasks, options) {
        received = tasks;
        return repo.upsertTasks(tasks, options);
      },
    };

    expectOk(await commitUpload({ repo: spy, uploads, readOnly: false }, uploadId, OCCURRED_AT));

    expect(received.map((task) => task.ownerMemberId)).toEqual(['m-1']);
    // 원문은 남는다 — 이름은 지우지도 바꾸지도 않는다
    expect(received.map((task) => task.ownerNameRaw)).toEqual(['김편집']);
  });

  it('listMembers가 던지면 STORAGE_UNAVAILABLE이고 failed로 남는다', async () => {
    const { repo, uploads, uploadId } = await setup();
    const broken: TaskRepository = {
      ...repo,
      async listMembers() {
        throw new Error('연결이 끊겼다');
      },
    };

    const outcome = await commitUpload(
      { repo: broken, uploads, readOnly: false },
      uploadId,
      OCCURRED_AT,
    );

    expect(outcome.ok === false && outcome.code).toBe('STORAGE_UNAVAILABLE');
    const record = await uploads.get(uploadId);
    expect(record?.status).toBe('failed');
    expect(record?.parseResult).not.toBeNull();
    // 담당자 연결만 조용히 건너뛰고 반영해 버리면 그 업무는 영영 `unknown_owner`다
    expect(await repo.listTasks()).toEqual([]);
  });

  it('summary에 업무명·담당자가 담기지 않는다', async () => {
    const { repo, uploads, uploadId } = await setup();

    const outcome = expectOk(
      await commitUpload({ repo, uploads, readOnly: false }, uploadId, OCCURRED_AT),
    );

    const serialized = JSON.stringify(outcome.summary);
    for (const secret of ['카드뉴스', '김편집', '최마케팅', 'card-a', '업무시트.xlsx']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('실패 메시지에 원인 문자열을 이어 붙이지 않는다 (X1)', async () => {
    const { repo, uploads, uploadId } = await setup();
    const broken: TaskRepository = {
      ...repo,
      async upsertTasks() {
        throw new Error('connection to db.example.internal refused — 카드뉴스 A');
      },
    };

    const outcome = await commitUpload(
      { repo: broken, uploads, readOnly: false },
      uploadId,
      OCCURRED_AT,
    );

    expect(outcome.ok).toBe(false);
    const message = outcome.ok === false ? outcome.message : '';
    expect(message).not.toContain('db.example.internal');
    expect(message).not.toContain('카드뉴스');
    expect(message.length).toBeGreaterThan(0);
  });
});
