/**
 * `ADR-005`의 실체를 고정한다: **폴백은 읽기 전용이다.**
 *
 * 이 파일에서 가장 중요한 테스트는 "readOnly에서 쓰기가 던진다"와 "demo와 fallback의
 * `mode`가 다르다" 둘이다. 앞엣것이 없으면 장애 중 쓰기가 메모리에 담기고 재시작 때 조용히
 * 사라지며(`A2`), 뒤엣것이 없으면 T6가 "의도된 데모"와 "저장소 사고"를 같은 배너로 그린다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createStorage,
  getStorage,
  resetStorage,
  StorageReadOnlyError,
  type StorageHandle,
} from '@/lib/store/store-factory';
import type { TaskUpsertInput } from '@/lib/store/task-repository';
import type { UploadSummary } from '@/lib/store/upload-record-store';

const SEED_PATH = fileURLToPath(new URL('../fixtures/seed-tasks.json', import.meta.url));

const UPLOAD_AT = '2026-08-21T09:00:00.000Z';

/** 쓰기 경로를 두드리기 위한 최소 입력. 값 자체에는 의미가 없다 */
const TASK: TaskUpsertInput = {
  teamId: 'edit',
  departmentId: null,
  sourceKey: 'factory::probe',
  title: '[샘플] 쓰기 탐침',
  ownerMemberId: null,
  ownerNameRaw: null,
  coOwnerNames: [],
  status: null,
  approvalStatus: null,
  priority: null,
  riskStatus: null,
  progress: null,
  assignedAt: null,
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
  sourceRowIndex: 10,
  stages: [],
};

/** 키가 하나도 없는 환경. `.env.local`이 있는 개발 기계에서도 폴백 갈래를 재현하려면 필요하다 */
const NO_KEYS = {
  STORAGE_DRIVER: 'supabase',
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
} as unknown as NodeJS.ProcessEnv;

const MEMORY = { STORAGE_DRIVER: 'memory' } as unknown as NodeJS.ProcessEnv;

async function fallbackHandle(): Promise<StorageHandle> {
  return createStorage(NO_KEYS);
}

describe('createStorage — 드라이버 선택', () => {
  it('STORAGE_DRIVER=memory는 의도된 데모다 — driver memory / mode demo / 쓰기 가능', async () => {
    const handle = await createStorage(MEMORY);

    expect(handle.driver).toBe('memory');
    expect(handle.mode).toBe('demo');
    expect(handle.readOnly).toBe(false);
  });

  it('데모 모드에서는 upsertTasks가 성공한다 (읽기 전용이 아니다)', async () => {
    const { repo } = await createStorage(MEMORY);

    const result = await repo.upsertTasks([TASK], { occurredAt: UPLOAD_AT });

    expect(result.created).toBe(1);
    expect(await repo.listTasks({ sourceKeys: [TASK.sourceKey] })).toHaveLength(1);
  });

  it('Supabase 키가 없으면 사고다 — mode fallback / readOnly true', async () => {
    const handle = await fallbackHandle();

    expect(handle.driver).toBe('memory');
    expect(handle.mode).toBe('fallback');
    expect(handle.readOnly).toBe(true);
  });

  it('demo와 fallback은 서로 다른 mode다 — 배너 문구를 가르는 근거다', async () => {
    const demo = await createStorage(MEMORY);
    const fallback = await fallbackHandle();

    expect(demo.mode).not.toBe(fallback.mode);
    // 둘 다 memory를 쓰지만 하나는 의도이고 하나는 사고다. driver만으로는 구분되지 않는다.
    expect(demo.driver).toBe(fallback.driver);
    expect(demo.readOnly).not.toBe(fallback.readOnly);
  });

  it('연결 확인이 예외를 던져도 밖으로 내보내지 않고 폴백한다', async () => {
    // 형식이 깨진 URL은 `createClient` 단계에서 곧바로 던진다.
    const handle = await createStorage({
      STORAGE_DRIVER: 'supabase',
      NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      SUPABASE_SERVICE_ROLE_KEY: 'irrelevant',
    } as unknown as NodeJS.ProcessEnv);

    expect(handle.mode).toBe('fallback');
    expect(handle.readOnly).toBe(true);
  });

  it('URL이 형식만 맞고 붙지 않아도 폴백한다 (조회가 실패하는 갈래)', async () => {
    // 127.0.0.1:1은 DNS 없이 즉시 거절된다 — 테스트가 네트워크 지연에 매이지 않는다.
    const handle = await createStorage({
      STORAGE_DRIVER: 'supabase',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_SERVICE_ROLE_KEY: 'irrelevant',
    } as unknown as NodeJS.ProcessEnv);

    expect(handle.mode).toBe('fallback');
    expect(handle.readOnly).toBe(true);
  });
});

describe('읽기 전용 폴백 — 쓰기는 막고 읽기는 살린다 (ADR-005)', () => {
  it('upsertTasks가 StorageReadOnlyError를 던지고 code가 STORAGE_READONLY다', async () => {
    const { repo } = await fallbackHandle();

    await expect(repo.upsertTasks([TASK], { occurredAt: UPLOAD_AT })).rejects.toBeInstanceOf(
      StorageReadOnlyError
    );
    await expect(repo.upsertTasks([TASK], { occurredAt: UPLOAD_AT })).rejects.toMatchObject({
      code: 'STORAGE_READONLY',
    });
  });

  it('upsertGoalMetrics도 던진다', async () => {
    const { repo } = await fallbackHandle();

    await expect(repo.upsertGoalMetrics([], { occurredAt: UPLOAD_AT })).rejects.toBeInstanceOf(
      StorageReadOnlyError
    );
  });

  it('recordEvents도 던진다', async () => {
    const { repo } = await fallbackHandle();

    await expect(
      repo.recordEvents([
        { taskId: 'seed-edit-0001', uploadId: null, changedFields: ['status'], occurredAt: UPLOAD_AT },
      ])
    ).rejects.toBeInstanceOf(StorageReadOnlyError);
  });

  it('updateTask도 던진다 — 폴백 중 단건 수정이 메모리에 조용히 저장되면 안 된다', async () => {
    const { repo } = await fallbackHandle();
    const [first] = await repo.listTasks();

    await expect(repo.updateTask(first.id, { progress: 99 }, UPLOAD_AT)).rejects.toBeInstanceOf(
      StorageReadOnlyError
    );
    await expect(repo.updateTask(first.id, { progress: 99 }, UPLOAD_AT)).rejects.toMatchObject({
      code: 'STORAGE_READONLY',
    });
    // 막혔으니 값도 그대로다.
    expect((await repo.getTask(first.id))?.progress).toBe(first.progress);
  });

  it('listMembers는 막히지 않는다 — 읽기다', async () => {
    const { repo } = await fallbackHandle();

    await expect(repo.listMembers()).resolves.toEqual([]);
  });

  it('쓰기가 막혀도 저장소 내용은 바뀌지 않는다 — 부분 반영이 남지 않는다', async () => {
    const { repo } = await fallbackHandle();

    await expect(repo.upsertTasks([TASK], { occurredAt: UPLOAD_AT })).rejects.toThrow();

    expect(await repo.listTasks({ sourceKeys: [TASK.sourceKey] })).toEqual([]);
  });

  it('listTasks·getTask·listStages는 정상 동작한다 (조회 불가가 아니라 읽기 전용이다)', async () => {
    const { repo } = await fallbackHandle();

    const tasks = await repo.listTasks();
    expect(tasks.length).toBeGreaterThan(0);

    const first = await repo.getTask(tasks[0].id);
    expect(first?.id).toBe(tasks[0].id);

    const stages = await repo.listStages(tasks.map((task) => task.id));
    expect(stages.length).toBeGreaterThan(0);
  });

  it('listGoalMetrics·getLastSyncedAt도 막히지 않는다', async () => {
    const { repo } = await fallbackHandle();

    await expect(repo.listGoalMetrics()).resolves.toHaveLength(3);
    await expect(repo.getLastSyncedAt()).resolves.toBeNull();
  });
});

describe('시드 — 키 없이 데이터가 뜬다 (T4 완료 기준 9)', () => {
  it('STORAGE_DRIVER=memory에서 픽스처 태스크 9건이 로드된다', async () => {
    const { repo } = await createStorage(MEMORY);

    await expect(repo.listTasks()).resolves.toHaveLength(9);
  });

  it('goalMetrics 3건, stages는 편집팀 5건 × 3단계 = 15건이다', async () => {
    const { repo } = await createStorage(MEMORY);

    await expect(repo.listGoalMetrics()).resolves.toHaveLength(3);

    const tasks = await repo.listTasks();
    const stages = await repo.listStages(tasks.map((task) => task.id));
    expect(stages).toHaveLength(15);

    const editTasks = tasks.filter((task) => task.teamId === 'edit');
    expect(editTasks).toHaveLength(5);
    expect(stages.filter((stage) => stage.taskId.startsWith('seed-edit-'))).toHaveLength(15);
  });

  it('시드는 저장소마다 새로 만들어진다 — 한 인스턴스의 쓰기가 다음 인스턴스에 새지 않는다', async () => {
    const first = await createStorage(MEMORY);
    await first.repo.upsertTasks([TASK], { occurredAt: UPLOAD_AT });
    expect(await first.repo.listTasks()).toHaveLength(10);

    const second = await createStorage(MEMORY);
    expect(await second.repo.listTasks()).toHaveLength(9);
  });

  it('시드 JSON에 raw가 없고, 민감 키가 든 extras는 값째로 남아 있다', () => {
    const source = readFileSync(SEED_PATH, 'utf8');
    expect(source).not.toContain('"raw"');

    const seed = JSON.parse(source) as {
      generatedFrom: string;
      tasks: { extras: Record<string, unknown> }[];
    };
    expect(seed.generatedFrom).toBe('sample-workbook.xlsx');

    // 마스킹은 응답 계층(T5·T6)의 일이다. 여기서 지우면 admin·lead도 못 본다 (`S6`).
    const sensitive = seed.tasks.flatMap((task) =>
      Object.entries(task.extras).filter(([key]) => /연락처|계정|이메일|전화/.test(key))
    );
    expect(sensitive.length).toBeGreaterThan(0);
    expect(sensitive.every(([, value]) => value !== null && value !== '')).toBe(true);
  });
});

/**
 * 업로드 레코드 저장소는 `TaskRepository`와 **다른 축**이다 (`ADR-008`). 모드마다 올바른
 * 구현이 실렸는지, 그리고 `fallback`에서 여기가 쓰기를 **따로 막지 않는지**를 고정한다 —
 * 읽기 전용 방어는 라우트 한 곳(step 7)에만 둔다.
 */
describe('uploads — 모드별 구현 (ADR-008)', () => {
  /** 메모리 구현만 `clear()`를 갖는다. 구현을 가리는 데 이보다 싼 표식이 없다 */
  const isMemoryUploads = (handle: StorageHandle) => 'clear' in handle.uploads;

  const UPLOAD_SUMMARY: UploadSummary = {
    created: 1,
    updated: 0,
    unchanged: 0,
    goalMetricsCreated: 0,
    goalMetricsUpdated: 0,
    warningCount: 0,
    teamKeys: ['edit'],
  };

  const PAYLOAD = { tasks: [TASK], goalMetrics: [], teamKeys: ['edit' as const] };

  it('demo는 메모리 업로드 저장소를 쓴다', async () => {
    expect(isMemoryUploads(await createStorage(MEMORY))).toBe(true);
  });

  it('fallback도 메모리 업로드 저장소를 쓴다', async () => {
    expect(isMemoryUploads(await fallbackHandle())).toBe(true);
  });

  it('fallback에서 업로드 레코드 쓰기를 따로 막지 않는다 — 방어는 라우트 한 곳뿐이다', async () => {
    const { uploads } = await fallbackHandle();

    const record = await uploads.create({
      kind: 'sheet',
      filename: 'factory-probe.xlsx',
      parseResult: PAYLOAD,
      createdAt: UPLOAD_AT,
    });

    expect(record.status).toBe('previewing');
    expect((await uploads.markCommitted(record.id, UPLOAD_SUMMARY))?.parseResult).toBeNull();
  });

  it('업로드 저장소도 인스턴스마다 새로 만들어진다', async () => {
    const first = await createStorage(MEMORY);
    const created = await first.uploads.create({
      kind: 'sheet',
      filename: null,
      parseResult: PAYLOAD,
      createdAt: UPLOAD_AT,
    });

    const second = await createStorage(MEMORY);
    expect(await second.uploads.get(created.id)).toBeNull();
  });
});

describe('getStorage — 한 번만 만들고 재사용한다', () => {
  it('두 번 불러도 같은 인스턴스다', async () => {
    resetStorage();

    const first = await getStorage();
    const second = await getStorage();

    expect(second).toBe(first);
    expect(second.repo).toBe(first.repo);

    resetStorage();
  });

  it('resetStorage 후에는 새 인스턴스다 (테스트 전용 탈출구)', async () => {
    resetStorage();
    const first = await getStorage();

    resetStorage();
    const second = await getStorage();

    expect(second).not.toBe(first);

    resetStorage();
  });

  /**
   * Next.js는 페이지(RSC)와 라우트 핸들러를 **서로 다른 서버 번들로** 만든다. 캐시를 모듈
   * 지역 변수에만 두면 두 번들이 각자의 저장소를 갖고, 메모리 드라이버에서 API로 확정한
   * 업로드를 화면이 못 본다 — 실제로 「마지막 반영」이 확정 뒤에도 「기록 없음」에 머물렀다.
   * `Symbol.for`는 전역 심볼 레지스트리를 쓰므로 번들이 갈라져도 같은 키가 된다.
   */
  it('캐시가 globalThis의 전역 심볼에 걸린다 — 번들이 갈라져도 같은 인스턴스다', async () => {
    resetStorage();
    const handle = await getStorage();

    const key = Symbol.for('work-task-status-board.storage');
    const host = globalThis as unknown as Record<symbol, Promise<unknown> | null | undefined>;

    expect(host[key]).toBeTruthy();
    await expect(host[key]).resolves.toBe(handle);

    resetStorage();
    expect(host[key]).toBeFalsy();
  });
});

/**
 * 판정표의 세 번째 줄(`supabase` + 연결 성공 → `live`)은 실제 저장소가 있어야 증명된다.
 * 키가 없으면 스스로 흔적을 남기며 건너뛴다 (step 9와 같은 방식).
 *
 * `STORAGE_DRIVER=memory`로 돌릴 때도 건너뛴다 — 그 환경에서 memory가 나오는 것은 고장이
 * 아니라 판정표의 **첫 줄**이고, 위 데모 스위트가 이미 증명한다.
 */
const canRunLive = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.STORAGE_DRIVER !== 'memory'
);

describe.skipIf(!canRunLive)('createStorage — 실제 Supabase', () => {
  it('연결에 성공하면 driver supabase / mode live / 쓰기 가능이다', async () => {
    const handle = await createStorage(process.env);

    expect(handle.driver).toBe('supabase');
    expect(handle.mode).toBe('live');
    expect(handle.readOnly).toBe(false);
  });

  it('live에서는 업로드 저장소도 supabase 구현이다 (메모리 표식인 clear가 없다)', async () => {
    const handle = await createStorage(process.env);

    expect('clear' in handle.uploads).toBe(false);
  });
});
