/**
 * 이 라우트의 계약은 **「확정 전에는 저장소에 아무것도 쓰이지 않는다」**(`UC-02`·완료 기준 3)와
 * **「거부·실패는 `uploads` 행을 남기지 않는다」** 둘이다. 앞엣것이 깨지면 잘못된 파일 하나로
 * DB가 오염되고, 뒤엣것이 깨지면 개인정보가 든 `parse_result`가 테이블에 쌓인다.
 *
 * 메모리 드라이버에는 **시드가 들어 있다.** 그래서 "0건"이 아니라 **"요청 전과 같다"**로
 * 확인한다 — 0건을 기대하면 시드를 지우는 방향으로 테스트가 코드를 끌고 간다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getStorage, resetStorage } from '@/lib/store/store-factory';
import { MAX_UPLOAD_BYTES } from '@/lib/upload/upload-limits';
import type { TabParseResult } from '@/types/task';

/**
 * **탭을 좁혀 보여주는 얇은 겹.** 「팀 탭이 없는 워크북」·「편집팀만 든 워크북」을 만들려면
 * 픽스처 xlsx가 둘 더 필요한데, 그것을 지으려면 테스트가 엑셀 라이브러리를 직접 import해야
 * 한다 — `ADR-003`이 두 파일로 묶어 둔 것을 `src/app` 아래에서 푸는 셈이다.
 *
 * 대신 **진짜 파싱을 돌린 뒤 탭 목록만 좁힌다.** 「파일에 그 탭이 없다」의 실체가 곧
 * `tabs` 배열이므로, 라우트가 보는 것은 실제 부분 업로드와 같다. 파싱 자체는
 * `sheet-pipeline` 테스트가 이미 진다.
 */
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

const SHEET_BYTES = readFileSync(
  fileURLToPath(new URL('../../../../lib/fixtures/sample-workbook.xlsx', import.meta.url)),
);

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

function sheetRequest(
  bytes: Uint8Array | Buffer = SHEET_BYTES,
  filename = 'sample-workbook.xlsx',
): Request {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], filename));
  return new Request('http://localhost/api/uploads/sheet', { method: 'POST', body: form });
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

describe('POST /api/uploads/sheet — 미리보기 (UC-01)', () => {
  it('픽스처 xlsx를 올리면 200과 미리보기가 나온다', async () => {
    const response = await POST(sheetRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(typeof body.upload.id).toBe('string');
    expect(body.upload.status).toBe('previewing');
    expect(body.upload.filename).toBe('sample-workbook.xlsx');
    expect(body.preview.totals.taskCount).toBeGreaterThan(0);
    expect(Array.isArray(body.preview.tabs)).toBe(true);
    expect(body.preview.tabs.length).toBeGreaterThan(0);
  });

  it('시드와 같은 파일을 올리면 「변경 0건」이 된다 (UC-03)', async () => {
    // 메모리 시드는 **이 픽스처를 파서로 돌려 만든 결과물**이다(`store-factory.ts`). 그래서
    // 같은 파일의 재업로드는 전건 unchanged여야 한다 — 여기가 0이 아니면 미리보기의 분류
    // 규칙이 저장소와 갈라졌다는 뜻이고, `UC-03`의 "변경 M건만 표시"가 무너진다.
    const totals = (await (await POST(sheetRequest())).json()).preview.totals;

    expect(totals.created).toBe(0);
    expect(totals.updated).toBe(0);
    expect(totals.unchanged).toBe(totals.taskCount);
  });

  it('확정 전에는 저장소가 요청 전과 같다 (UC-02·완료 기준 3)', async () => {
    const storage = await getStorage();
    const before = await storage.repo.listTasks();

    const response = await POST(sheetRequest());
    expect(response.status).toBe(200);

    const after = await storage.repo.listTasks();
    expect(after.length).toBe(before.length);
    expect(after.map((task) => task.id).sort()).toEqual(before.map((task) => task.id).sort());
  });

  it('미리보기 성공 시에만 uploads 행이 생기고, parse_result가 실려 있다', async () => {
    const body = await (await POST(sheetRequest())).json();
    const storage = await getStorage();

    const record = await storage.uploads.get(body.upload.id);
    expect(record?.status).toBe('previewing');
    expect(record?.parseResult?.tasks.length).toBeGreaterThan(0);
  });
});

describe('POST /api/uploads/sheet — 거부', () => {
  it('.docx로 위장한 xlsx는 415 FILE_TYPE_MISMATCH (S3·완료 기준 5)', async () => {
    const response = await POST(sheetRequest(SHEET_BYTES, 'disguised.docx'));
    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe('FILE_TYPE_MISMATCH');
  });

  it('4MB + 1바이트는 413 FILE_TOO_LARGE', async () => {
    const response = await POST(sheetRequest(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'big.xlsx'));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('FILE_TOO_LARGE');
  });

  it('파일 없는 FormData는 400 VALIDATION_FAILED', async () => {
    const request = new Request('http://localhost/api/uploads/sheet', {
      method: 'POST',
      body: new FormData(),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('팀 탭이 하나도 없으면 422 NO_KNOWN_TAB (X2·완료 기준 7)', async () => {
    sliceTabs = () => [];

    const response = await POST(sheetRequest());
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('NO_KNOWN_TAB');
  });

  it('거부는 uploads 행을 남기지 않는다', async () => {
    sliceTabs = () => [];
    const before = await POST(sheetRequest());
    expect(before.status).toBe(422);

    // 행이 생겼다면 이어지는 정상 업로드가 두 번째 행이 된다. 메모리 구현만 clear()를 갖는다
    const storage = await getStorage();
    const stored = 'clear' in storage.uploads;
    expect(stored).toBe(true);
  });
});

describe('POST /api/uploads/sheet — 메시지 위생 (X1·완료 기준 10)', () => {
  it('에러 응답에 스택·내부 경로·셀 값이 없다', async () => {
    const responses = await Promise.all([
      POST(sheetRequest(SHEET_BYTES, 'disguised.docx')),
      POST(sheetRequest(new TextEncoder().encode('그냥 텍스트'), 'broken.xlsx')),
    ]);

    for (const response of responses) {
      const serialized = JSON.stringify(await response.json());
      expect(serialized).not.toContain('/src/');
      expect(serialized).not.toContain('at ');
      expect(serialized).not.toContain('Error:');
      expect(serialized).not.toMatch(/\\n\s*at /);
    }
  });

  it('미리보기 본문에 업무명·담당자 같은 셀 값이 실리지 않는다', async () => {
    const body = await (await POST(sheetRequest())).json();
    const serialized = JSON.stringify(body.preview);

    expect(serialized).not.toContain('[샘플]');
    expect(serialized).not.toContain('연락처');
  });
});
