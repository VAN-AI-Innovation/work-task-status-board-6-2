/**
 * 저장소 드라이버 선택과 **읽기 전용 폴백** (`ADR-004`·`ADR-005`).
 *
 * 이 파일이 지는 판단은 둘뿐이다.
 *
 * 1. **어느 구현을 쓸 것인가** — `STORAGE_DRIVER=memory`면 의도된 데모, 아니면 Supabase를
 *    먼저 시도하고 붙지 않으면 memory로 내려앉는다.
 * 2. **쓰기를 받아도 되는가** — 내려앉은 경우(`fallback`)에는 받지 않는다. 폴백 중 쓰기를
 *    메모리에 담으면 사용자는 저장됐다고 믿고 재시작 때 조용히 사라진다 (`A2`).
 *    **조용한 데이터 유실이 조회 불가보다 나쁘다.**
 *
 * `demo`와 `fallback`은 둘 다 memory를 쓰지만 **하나는 의도이고 하나는 사고**다.
 * 그래서 `driver`만으로는 구분되지 않게 두고 `mode`를 따로 낸다. 다만 **배너 문구는 여기 없다** —
 * 화면 문자열은 T6의 일이고, 이 파일은 모드만 알려준다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import seedJson from '@/lib/fixtures/seed-tasks.json';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createSupabaseTaskStore } from '@/lib/store/supabase-task-store';
import type { TaskRepository } from '@/lib/store/task-repository';
import {
  createMemoryUploadStore,
  createSupabaseUploadStore,
  type UploadRecordStore,
} from '@/lib/store/upload-record-store';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskStage } from '@/types/task';

export type StorageDriver = 'supabase' | 'memory';

/** `live`=실제 저장소 / `demo`=의도된 메모리 / `fallback`=연결 실패로 내려앉은 메모리 */
export type StorageMode = 'live' | 'demo' | 'fallback';

export interface StorageHandle {
  repo: TaskRepository;
  /**
   * 업로드 이력 (`ADR-008`). **`fallback`에서도 쓰기를 막지 않는다** — 읽기 전용 모드에서는
   * 라우트가 업로드 경로 **전체**를 `503 STORAGE_READONLY`로 거부한다(step 7). 여기서 또
   * 막으면 같은 규칙이 두 곳에 생기고, 한쪽만 고쳐졌을 때 어느 쪽이 진짜인지 알 수 없다.
   */
  uploads: UploadRecordStore;
  driver: StorageDriver;
  mode: StorageMode;
  readOnly: boolean;
}

/** 에러 코드 체계는 `ARCHITECTURE.md`「에러 처리」에 있다. T5가 이 코드를 503으로 옮긴다 */
export class StorageReadOnlyError extends Error {
  readonly code = 'STORAGE_READONLY';

  constructor() {
    super('읽기 전용 모드입니다. 저장소 연결이 복구되어야 저장할 수 있습니다.');
    this.name = 'StorageReadOnlyError';
  }
}

/**
 * 시드는 손으로 지은 가짜가 아니라 **픽스처를 파서로 돌려 만든 결과물**이다
 * (`scripts/fixtures/build-seed-tasks.ts`). `raw`는 빠져 있으므로 여기서 빈 객체로 채운다 —
 * 감사용 원본은 실제 업로드(T5)만 만들 수 있고, 시드가 그것을 흉내 내면 거짓이 된다.
 */
interface SeedPayload {
  generatedFrom: string;
  tasks: Omit<Task, 'raw'>[];
  stages: TaskStage[];
  goalMetrics: GoalMetric[];
}

const SEED = seedJson as unknown as SeedPayload;

/**
 * 호출마다 **새 저장소**를 만든다. 시드 배열을 공유하면 한 인스턴스의 쓰기가 다음 인스턴스에
 * 새고, 메모리 구현이 생성자에서 깊은 복사를 하므로 여기서 또 복사할 필요는 없다.
 */
function createSeededMemoryStore(): TaskRepository {
  return createMemoryTaskStore({
    tasks: SEED.tasks.map((task) => ({ ...task, raw: {} })),
    stages: SEED.stages,
    goalMetrics: SEED.goalMetrics,
  });
}

/**
 * 리포지토리를 감싸는 얇은 래퍼. **메모리 구현 자체는 고치지 않는다** — 같은 구현이
 * 데모 모드에서는 쓰기를 받아야 하기 때문이다.
 */
function toReadOnly(repo: TaskRepository): TaskRepository {
  return {
    listTasks: (filter) => repo.listTasks(filter),
    getTask: (id) => repo.getTask(id),
    listStages: (taskIds) => repo.listStages(taskIds),
    listGoalMetrics: (filter) => repo.listGoalMetrics(filter),
    getLastSyncedAt: () => repo.getLastSyncedAt(),

    async upsertTasks() {
      throw new StorageReadOnlyError();
    },
    async upsertGoalMetrics() {
      throw new StorageReadOnlyError();
    },
    async recordEvents() {
      throw new StorageReadOnlyError();
    },
  };
}

/**
 * `supabase-task-store`의 `createServiceRoleClient()`를 쓰지 않는 이유: 그쪽은 `process.env`를
 * 직접 읽는다. 이 파일은 환경을 **인자로** 받아야 테스트가 폴백 갈래를 재현할 수 있다.
 */
function createClientFrom(env: NodeJS.ProcessEnv): SupabaseClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  try {
    // 서버 프로세스다. 세션을 붙들거나 토큰을 갱신할 이유가 없다.
    return createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    // 형식이 깨진 URL은 여기서 던진다. 폴백 사유일 뿐 앱을 죽일 이유는 아니다.
    return null;
  }
}

/** 가벼운 조회 1회. 실패·예외가 전부 폴백 사유이며 **예외를 위로 던지지 않는다** */
async function isReachable(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.from('teams').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function createStorage(env: NodeJS.ProcessEnv): Promise<StorageHandle> {
  if (env.STORAGE_DRIVER === 'memory') {
    // 의도된 데모다. 심사자가 `.env` 없이 클론해 바로 쓰는 경로이므로 쓰기를 막지 않는다.
    return {
      repo: createSeededMemoryStore(),
      uploads: createMemoryUploadStore(),
      driver: 'memory',
      mode: 'demo',
      readOnly: false,
    };
  }

  const client = createClientFrom(env);
  if (client && (await isReachable(client))) {
    return {
      repo: createSupabaseTaskStore(client),
      uploads: createSupabaseUploadStore(client),
      driver: 'supabase',
      mode: 'live',
      readOnly: false,
    };
  }

  return {
    repo: toReadOnly(createSeededMemoryStore()),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'fallback',
    readOnly: true,
  };
}

/**
 * 캐시를 모듈 지역 변수가 아니라 **전역 심볼**에 건다. Next.js가 페이지(RSC)와 라우트
 * 핸들러를 서로 다른 서버 번들로 만들기 때문이다 — 모듈 지역 변수면 두 번들이 각자의
 * 저장소를 갖는다. 메모리 드라이버에서 이 증상이 실제로 났다: `/api/uploads/seed`로 확정한
 * 업로드를 화면이 못 봐서 「마지막 반영」이 확정 뒤에도 「기록 없음」에 머물렀다 (T6 완료
 * 기준 8). `Symbol.for`는 전역 심볼 레지스트리를 쓰므로 번들이 갈라져도 같은 키가 된다.
 */
const CACHE_KEY = Symbol.for('work-task-status-board.storage');

type CacheHost = Record<symbol, Promise<StorageHandle> | null | undefined>;

const cacheHost = globalThis as unknown as CacheHost;

/**
 * 앱이 쓰는 진입점. **연결 실패도 캐시된다** — 매 요청마다 죽은 DB에 붙으러 가면 화면 전체가
 * 그 왕복만큼 느려진다. 복구는 프로세스 재시작으로 한다.
 */
export function getStorage(): Promise<StorageHandle> {
  cacheHost[CACHE_KEY] ??= createStorage(process.env);
  return cacheHost[CACHE_KEY];
}

/** **테스트 전용 탈출구.** 제품 코드에서 부르지 마라 — 캐시가 있는 이유가 사라진다 */
export function resetStorage(): void {
  cacheHost[CACHE_KEY] = null;
}
