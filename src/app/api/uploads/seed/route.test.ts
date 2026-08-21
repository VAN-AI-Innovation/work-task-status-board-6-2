/**
 * 이 라우트의 계약은 셋이다.
 *
 * 1. **빈 저장소가 채워진다** — 심사자가 클론 직후 보는 첫 화면이 백지가 아니게 만드는 경로다.
 * 2. **두 번 눌러도 안전하다** — 실제 확정 경로를 그대로 타므로 멱등이다(`X4`). 데이터가
 *    두 배가 되면 버튼 하나로 시연이 망가진다.
 * 3. **읽기 전용에서는 서버가 거부한다** — 버튼 비활성은 방어가 아니다 (`ADR-005`).
 *
 * 메모리 드라이버에는 시드가 이미 들어 있어(`store-factory.ts`) `getStorage()`로는 "빈 저장소"를
 * 만들 수 없다. **빈 상태가 실제로 뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때**이므로,
 * 그 상황을 시드 없는 메모리 핸들로 재현한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';

let handle: StorageHandle;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

const { POST } = await import('./route');

function emptyHandle(readOnly = false): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: readOnly ? 'fallback' : 'live',
    readOnly,
  };
}

beforeEach(() => {
  handle = emptyHandle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/uploads/seed — 샘플 데이터 불러오기', () => {
  it('빈 저장소에서 호출하면 200이고 태스크·목표 지표가 늘어난다', async () => {
    expect(await handle.repo.listTasks()).toHaveLength(0);

    const response = await POST();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.summary.created).toBeGreaterThan(0);

    const tasks = await handle.repo.listTasks();
    expect(tasks).toHaveLength(body.summary.created);
    expect(await handle.repo.listGoalMetrics()).toHaveLength(body.summary.goalMetricsCreated);
  });

  it('단계도 함께 들어간다 — 시드가 태스크만 있는 껍데기가 아니다', async () => {
    await POST();

    const tasks = await handle.repo.listTasks();
    const stages = await handle.repo.listStages(tasks.map((task) => task.id));
    expect(stages.length).toBeGreaterThan(0);
  });

  it('두 번 호출해도 두 번째는 전건 unchanged다 (멱등)', async () => {
    const first = await (await POST()).json();
    const second = await (await POST()).json();

    expect(second.summary.created).toBe(0);
    expect(second.summary.updated).toBe(0);
    expect(second.summary.unchanged).toBe(first.summary.created);

    // 데이터가 두 배가 되지 않는다
    expect(await handle.repo.listTasks()).toHaveLength(first.summary.created);
  });

  it('실제 확정 경로를 탄다 — 업로드 이력이 done으로 남고 parse_result가 비워진다', async () => {
    const body = await (await POST()).json();

    const record = await handle.uploads.get(body.upload.id);
    expect(record?.status).toBe('done');
    // 확정 후 `parse_result`를 비우는 것은 `markCommitted`만 한다 (`A8`·`S6`)
    expect(record?.parseResult).toBeNull();
    expect(record?.kind).toBe('sheet');
  });

  it('읽기 전용이면 503 STORAGE_READONLY이고 저장소가 그대로다', async () => {
    handle = emptyHandle(true);

    const response = await POST();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.error.code).toBe('STORAGE_READONLY');
    expect(await handle.repo.listTasks()).toHaveLength(0);
  });

  it('응답에 감사 원본·셀 값이 실리지 않는다', async () => {
    const raw = await (await POST()).text();

    expect(raw).not.toContain('"raw"');
    expect(raw).not.toContain('parseResult');
  });
});
