/**
 * 확정의 계약은 셋이다.
 *
 * 1. **두 번째 확정은 409다.** 조용히 두 번 반영되면 `task_events` 이력이 두 벌이 된다.
 * 2. **확정 후 `parse_result`가 비워진다** (`S6`·완료 기준 13). 성능이 아니라 보안 조치다 —
 *    원본 행에 실명·연락처·문의자 계정이 있다.
 * 3. **워크북에 없는 팀은 손대지 않는다** (`UC-04`·완료 기준 4). 부분 업로드의 실체이며
 *    타협 대상이 아니다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getStorage, resetStorage } from '@/lib/store/store-factory';
import type { TabParseResult } from '@/types/task';

/** 이유는 `../../sheet/route.test.ts`의 같은 겹에 적어 두었다 */
let sliceTabs: ((tabs: TabParseResult[]) => TabParseResult[]) | null = null;

vi.mock('@/lib/upload/parse-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload/parse-runner')>();
  return {
    ...actual,
    async runWorkbookParse(
      ...args: Parameters<typeof actual.runWorkbookParse>
    ): ReturnType<typeof actual.runWorkbookParse> {
      const outcome = await actual.runWorkbookParse(...args);
      if (!outcome.ok || sliceTabs === null) return outcome;
      return { ok: true, result: { ...outcome.result, tabs: sliceTabs(outcome.result.tabs) } };
    },
  };
});

const { POST } = await import('./route');
const { POST: uploadSheet } = await import('../../sheet/route');

const SHEET_BYTES = readFileSync(
  fileURLToPath(new URL('../../../../../lib/fixtures/sample-workbook.xlsx', import.meta.url)),
);

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

/** 확정할 대상을 만든다. 미리보기 라우트를 그대로 쓴다 — 두 라우트가 이어지는 것이 실제 경로다 */
async function preview(): Promise<string> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(SHEET_BYTES)], 'sample-workbook.xlsx'));
  const response = await uploadSheet(
    new Request('http://localhost/api/uploads/sheet', { method: 'POST', body: form }),
  );

  expect(response.status).toBe(200);
  return (await response.json()).upload.id;
}

function commit(id: string): Promise<Response> {
  return POST(new Request(`http://localhost/api/uploads/${id}/commit`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  sliceTabs = null;
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  sliceTabs = null;
  resetStorage();
});

describe('POST /api/uploads/[id]/commit — 확정', () => {
  it('미리보기 → 확정이 200이고 요약을 돌려준다', async () => {
    const response = await commit(await preview());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.upload.status).toBe('done');
    expect(body.summary.unchanged).toBeGreaterThan(0);
    expect(body.summary.teamKeys.length).toBeGreaterThan(0);
  });

  it('새 업무가 든 워크북을 확정하면 저장소가 늘어난다', async () => {
    const storage = await getStorage();
    const before = (await storage.repo.listTasks()).length;

    // 시드는 이 픽스처 그대로라 재업로드는 unchanged다. 팀을 옮겨 「새 건」으로 만든다
    sliceTabs = (tabs) =>
      tabs.map((tab) =>
        tab.teamKey === 'edit'
          ? { ...tab, tasks: tab.tasks.map((task) => ({ ...task, sourceKey: `new::${task.sourceKey}` })) }
          : tab,
      );

    expect((await commit(await preview())).status).toBe(200);
    expect((await storage.repo.listTasks()).length).toBeGreaterThan(before);
  });

  it('같은 id로 두 번째 확정은 409 UPLOAD_ALREADY_COMMITTED', async () => {
    const id = await preview();
    expect((await commit(id)).status).toBe(200);

    const second = await commit(id);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('UPLOAD_ALREADY_COMMITTED');
  });

  it('없는 id는 404 UPLOAD_NOT_FOUND', async () => {
    const response = await commit('00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('확정 후 parse_result가 null이다 (S6·완료 기준 13)', async () => {
    const id = await preview();
    expect((await commit(id)).status).toBe(200);

    const record = await (await getStorage()).uploads.get(id);
    expect(record?.status).toBe('done');
    expect(record?.parseResult).toBeNull();
  });
});

describe('POST /api/uploads/[id]/commit — 부분 업로드 (UC-04·완료 기준 4)', () => {
  it('편집팀 탭만 든 워크북을 확정해도 다른 팀 태스크 수가 그대로다', async () => {
    const storage = await getStorage();
    const countOthers = async (): Promise<number> =>
      (await storage.repo.listTasks()).filter((task) => task.teamId !== 'edit').length;

    const before = await countOthers();
    expect(before).toBeGreaterThan(0);

    sliceTabs = (tabs) => tabs.filter((tab) => tab.teamKey === 'edit');
    expect((await commit(await preview())).status).toBe(200);

    expect(await countOthers()).toBe(before);
  });

  it('건드리지 않는 팀이 미리보기에 고지된다', async () => {
    sliceTabs = (tabs) => tabs.filter((tab) => tab.teamKey === 'edit');

    const form = new FormData();
    form.append('file', new File([new Uint8Array(SHEET_BYTES)], 'edit-only.xlsx'));
    const body = await (
      await uploadSheet(new Request('http://localhost/api/uploads/sheet', { method: 'POST', body: form }))
    ).json();

    expect(body.preview.untouchedTeams).toContain('shoot');
    expect(body.preview.untouchedTeams).not.toContain('edit');
  });
});

describe('POST /api/uploads/[id]/commit — 메시지 위생 (X1·완료 기준 10)', () => {
  it('에러 응답에 스택·내부 경로가 없다', async () => {
    const serialized = JSON.stringify(await (await commit('not-a-uuid')).json());

    expect(serialized).not.toContain('/src/');
    expect(serialized).not.toContain('Error:');
    expect(serialized).not.toMatch(/\n\s*at /);
  });
});
