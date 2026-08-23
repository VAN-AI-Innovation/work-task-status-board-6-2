/**
 * 이 라우트의 계약은 둘이다.
 *
 * 1. **`.docx`만 받는다** (T7 완료 기준 1). 확장자만으로는 안 된다 — `.xlsx`와 `.docx`는
 *    둘 다 `PK\x03\x04`로 시작한다(`S3`). 판정은 `checkUpload`가 이미 지므로 여기서는
 *    **그 판정이 실제로 걸리는지**만 확인한다. 새 검사를 만들면 한도가 두 벌이 된다.
 * 2. **저장소를 건드리지 않는다** (`ADR-022`·결정 C). `uploads` 행을 만들면 그
 *    `parse_result`에 문서 본문이 통째로 남고, 워크로드 문서에는 사람 이름이 있다(`S6`).
 *    확정이 없어서 비울 시점도 없다 — 애초에 부르지 않는 것이 가장 짧은 방어다.
 *
 * 그래서 `getStorage`를 **부르는지 자체를 잰다.** 「행이 안 생겼다」로 재면 저장소를 열어
 * 읽기만 하는 코드가 통과해 버리는데, 이 라우트는 읽기도 하지 않기로 한 것이다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStorage = vi.fn(() => {
  throw new Error('이 라우트는 저장소를 부르지 않는다 (ADR-022)');
});

vi.mock('@/lib/store/store-factory', () => ({ getStorage }));

const { POST } = await import('./route');

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../../../../lib/fixtures/${name}`, import.meta.url)));

const DOC_BYTES = fixture('sample-workload.docx');
const SHEET_BYTES = fixture('sample-workbook.xlsx');

function docRequest(
  bytes: Uint8Array | Buffer | null = DOC_BYTES,
  filename = 'sample-workload.docx',
  fields: Record<string, string> = {},
): Request {
  const form = new FormData();
  if (bytes !== null) form.append('file', new File([new Uint8Array(bytes)], filename));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request('http://localhost/api/uploads/doc', { method: 'POST', body: form });
}

beforeEach(() => {
  getStorage.mockClear();
});

describe('POST /api/uploads/doc — 통과', () => {
  it('실제 .docx에서 배정표 행을 만든다', async () => {
    const response = await POST(docRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  it('난이도가 中上인 행이 中으로 잘리지 않는다 (완료 기준 3이 라우트까지 살아 있다)', async () => {
    const body = await (await POST(docRequest())).json();

    expect(body.rows.some((row: { difficulty: string | null }) => row.difficulty === '中上')).toBe(
      true,
    );
  });

  it('baseYear를 응답에 함께 실어 무엇으로 추론했는지 밝힌다', async () => {
    const body = await (await POST(docRequest())).json();

    expect(body.baseYear).toBeGreaterThanOrEqual(1900);
    expect(body.baseYear).toBeLessThanOrEqual(2200);
  });

  it('폼의 baseYear를 쓴다 — 연도 없는 마감(9/1)이 그 해로 붙는다', async () => {
    const body = await (await POST(docRequest(DOC_BYTES, 'w.docx', { baseYear: '2030' }))).json();

    expect(body.baseYear).toBe(2030);
    expect(
      body.rows.some((row: { deadlineDate: string | null }) => row.deadlineDate?.startsWith('2030')),
    ).toBe(true);
  });

  it.each([
    ['범위 밖', '1899'],
    ['숫자가 아님', '올해'],
    ['빈 값', ''],
  ])('baseYear가 %s이면 무시하고 오늘 연도를 쓴다', async (_label, value) => {
    const body = await (await POST(docRequest(DOC_BYTES, 'w.docx', { baseYear: value }))).json();

    expect(body.baseYear).toBe(new Date().getFullYear());
  });
});

describe('POST /api/uploads/doc — 거부', () => {
  it('.xlsx를 올리면 415로 거부한다 — 완료 기준 1', async () => {
    const response = await POST(docRequest(SHEET_BYTES, 'sample-workbook.xlsx'));

    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe('FILE_TYPE_MISMATCH');
  });

  it('내용이 .xlsx인데 이름만 .docx면 415다 — 확장자는 1차 필터일 뿐이다 (S3)', async () => {
    const response = await POST(docRequest(SHEET_BYTES, '위장.docx'));

    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe('FILE_TYPE_MISMATCH');
  });

  it('ZIP이 아닌 텍스트에 .docx 이름을 붙여도 415다', async () => {
    const response = await POST(docRequest(Buffer.from('그냥 텍스트입니다'), 'fake.docx'));

    expect(response.status).toBe(415);
    expect((await response.json()).error.code).toBe('FILE_TYPE_MISMATCH');
  });

  it('file이 없으면 400이다', async () => {
    const response = await POST(docRequest(null));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('4MB를 넘으면 413이다 — 검사는 checkUpload가 한다', async () => {
    const { MAX_UPLOAD_BYTES } = await import('@/lib/upload/upload-limits');
    const response = await POST(docRequest(Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x50), 'big.docx'));

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('FILE_TOO_LARGE');
  });

  it('과제가 없는 문서는 422 NO_OUTLINE_TASK다 — 빈 배정표를 성공으로 내려보내지 않는다', async () => {
    // 「과제 0건」짜리 `.docx` 픽스처를 하나 더 만드는 대신 파이프라인의 판정을 갈아 끼운다.
    // 이 갈래에서 라우트가 지는 몫은 **코드와 상태를 그대로 옮기는 것**뿐이다.
    vi.resetModules();
    vi.doMock('@/lib/doc/doc-pipeline', () => ({
      runDocExtract: async () => ({
        ok: false,
        code: 'NO_OUTLINE_TASK',
        message: '문서에서 과제를 찾지 못했습니다.',
      }),
    }));

    const { POST: freshPost } = await import('./route');
    const response = await freshPost(docRequest());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('NO_OUTLINE_TASK');

    vi.doUnmock('@/lib/doc/doc-pipeline');
    vi.resetModules();
  });
});

describe('POST /api/uploads/doc — 새지 않는다', () => {
  it('저장소를 부르지 않는다 (ADR-022)', async () => {
    await POST(docRequest());
    await POST(docRequest(SHEET_BYTES, 'sample-workbook.xlsx'));
    await POST(docRequest(null));

    expect(getStorage).not.toHaveBeenCalled();
  });

  it('에러 본문에 파일명·경로·스택이 없다 (X1·S6)', async () => {
    const response = await POST(docRequest(SHEET_BYTES, '실명이_든_파일.docx'));
    const text = await response.text();

    expect(text).not.toContain('실명이_든_파일');
    expect(text).not.toContain('/src/');
    expect(text).not.toMatch(/\bat\s|Error:/);
  });

  it('성공 응답에 파일명을 되돌려주지 않는다 — 반사형 노출 자리다', async () => {
    const text = await (await POST(docRequest(DOC_BYTES, '홍길동_워크로드.docx'))).text();

    expect(text).not.toContain('홍길동');
  });
});
