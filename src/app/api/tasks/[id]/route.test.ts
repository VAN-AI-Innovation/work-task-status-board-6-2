/**
 * 상세 조회의 계약은 둘이다 — **단계 타임라인이 함께 온다**(`UC-15`)와
 * **없는 id는 404 `TASK_NOT_FOUND`**다. 뒤엣것을 `VALIDATION_FAILED`로 뭉개면 「낡은 링크」와
 * 「잘못된 요청」이 같은 응답이 되고, 화면이 무엇을 안내할지 정할 수 없다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getStorage, resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

function get(id: string, query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/tasks/${id}${query}`), {
    params: Promise.resolve({ id }),
  });
}

/** 시드에서 단계가 달린 업무 하나를 고른다 */
async function seededTaskWithStages(): Promise<string> {
  const storage = await getStorage();
  const tasks = await storage.repo.listTasks();
  for (const task of tasks) {
    const stages = await storage.repo.listStages([task.id]);
    if (stages.length > 0) return task.id;
  }
  throw new Error('시드에 단계가 달린 업무가 없다');
}

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/tasks/[id]', () => {
  it('200에 업무와 단계 타임라인이 함께 온다', async () => {
    const id = await seededTaskWithStages();
    const res = await get(id);
    const parsed = (await res.json()) as {
      task: { id: string; flags: unknown; displayStatus: string };
      stages: { taskId: string }[];
      meta: { today: string };
    };

    expect(res.status).toBe(200);
    expect(parsed.task.id).toBe(id);
    expect(parsed.task.flags).toBeDefined();
    expect(parsed.stages.length).toBeGreaterThan(0);
    expect(parsed.stages.every((stage) => stage.taskId === id)).toBe(true);
    expect(parsed.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('응답에 감사용 원본 행이 없다', async () => {
    const id = await seededTaskWithStages();

    expect(JSON.stringify(await (await get(id)).json())).not.toContain('"raw"');
  });

  it('없는 id는 404 TASK_NOT_FOUND다', async () => {
    const res = await get('00000000-0000-4000-8000-000000000000');
    const parsed = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(404);
    expect(parsed.error.code).toBe('TASK_NOT_FOUND');
    expect(parsed.error.message).toMatch(/[가-힣]/);
  });

  it('id 모양이 아니어도 404다 — 있는지 없는지가 답이지 형식이 답이 아니다', async () => {
    expect((await get('not-a-real-id')).status).toBe(404);
  });

  it('에러 본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get('not-a-real-id')).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});
