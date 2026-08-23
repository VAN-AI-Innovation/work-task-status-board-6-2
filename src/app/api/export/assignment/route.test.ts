/**
 * 이 라우트가 지는 계약은 하나다 — **행은 우리가 만든 것이 아니다.** `/extract`가 아무것도
 * 저장하지 않아서(`ADR-022`) 행 JSON이 브라우저를 한 번 왕복하고, 돌아온 것으로
 * **조직 사람들에게 배포될 xlsx**를 만든다(`S1`).
 *
 * 방어는 둘로 갈라져 있고 이 테스트는 **둘 다 실제로 걸리는지**를 잰다:
 * 모양·규모는 `assignment-schema`가 문 앞에서, 내용(`=`로 시작하는 셀)은
 * `assignment-writer`가 쓰기 한 곳에서 (`ADR-012`). 라우트가 새로 지는 것은 **헤더**뿐이라
 * 파일명이 헤더를 넘어 다른 줄로 새지 않는지도 여기서 본다.
 *
 * 되읽기는 시트 파서로 한다 — `ADR-003`이 ExcelJS import를 두 파일로 묶어 뒀고
 * `src/app` 아래에서 그것을 풀지 않는다.
 */

import { describe, expect, it, vi } from 'vitest';

import { ASSIGNMENT_MAX_ROWS } from '@/lib/api/assignment-schema';
import { toText } from '@/lib/sheet/cell-normalizer';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { AssignmentRow } from '@/types/doc';

const getStorage = vi.fn(() => {
  throw new Error('이 라우트는 저장소를 부르지 않는다 (ADR-022)');
});

vi.mock('@/lib/store/store-factory', () => ({ getStorage }));

const { POST } = await import('./route');

const ROW: AssignmentRow = {
  category: '콘텐츠 기획',
  taskNo: '1-1',
  title: '주간 콘텐츠 캘린더 정리',
  difficulty: '中上',
  deadlineRaw: '9/1까지',
  deadlineDate: '2026-09-01',
  priority: '긴급',
  priorityRaw: 'P0',
  details: '- 채널별 발행 주기 정리',
};

const SECOND_ROW: AssignmentRow = { ...ROW, taskNo: '1-2', title: '레퍼런스 정리', priority: null };

const exportRequest = (body: unknown): Request =>
  new Request('http://localhost/api/export/assignment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** 시트 파서로 되읽어 행 하나를 문자열 배열로 만든다. 헤더가 1행이므로 데이터는 2행부터다 */
async function cellsOfRow(bytes: ArrayBuffer, rowIndex: number): Promise<string[]> {
  const { sheets } = await readWorkbook(Buffer.from(bytes));
  return sheets[0].cells[rowIndex].map((cell) => toText(cell.value).value ?? '');
}

describe('POST /api/export/assignment — 파일을 만든다', () => {
  it('행 2건으로 xlsx 바이트를 돌려준다', async () => {
    const response = await POST(exportRequest({ rows: [ROW, SECOND_ROW] }));
    const bytes = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // ZIP 매직넘버. 「xlsx라고 말했는데 실은 JSON」을 잡는다
    expect([...new Uint8Array(bytes).slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('보낸 행이 그대로 파일 안에 있다', async () => {
    const bytes = await (await POST(exportRequest({ rows: [ROW] }))).arrayBuffer();
    const cells = await cellsOfRow(bytes, 1);

    expect(cells).toContain('1-1');
    expect(cells).toContain('주간 콘텐츠 캘린더 정리');
    expect(cells).toContain('中上');
  });

  it('rows가 비어도 200이다 — 「과제 0건」의 판정은 doc-pipeline의 몫이다', async () => {
    const response = await POST(exportRequest({ rows: [] }));

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('캐시하지 않는다 — 사람 이름이 든 파일이 중간 캐시에 남으면 안 된다 (S6)', async () => {
    const response = await POST(exportRequest({ rows: [ROW] }));

    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('저장소를 부르지 않는다 (ADR-022)', async () => {
    getStorage.mockClear();
    await POST(exportRequest({ rows: [ROW] }));

    expect(getStorage).not.toHaveBeenCalled();
  });
});

describe('POST /api/export/assignment — 수식 주입 (S1)', () => {
  it.each([
    ['=', "=cmd|'/c calc'!A1"],
    ['+', '+1+1'],
    ['-', '-2+3'],
    ['@', '@SUM(A1)'],
  ])('%s로 시작하는 제목에 프리픽스가 붙는다', async (_label, payload) => {
    const bytes = await (
      await POST(exportRequest({ rows: [{ ...ROW, title: payload }] }))
    ).arrayBuffer();
    const cells = await cellsOfRow(bytes, 1);

    expect(cells).toContain(`'${payload}`);
    expect(cells).not.toContain(payload);
  });
});

describe('POST /api/export/assignment — 거부', () => {
  it('모르는 키가 든 행은 400이다', async () => {
    const response = await POST(exportRequest({ rows: [{ ...ROW, owner: '홍길동' }] }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('행 수 상한을 넘으면 400이다', async () => {
    const rows = Array.from({ length: ASSIGNMENT_MAX_ROWS + 1 }, () => ROW);
    const response = await POST(exportRequest({ rows }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('본문이 JSON이 아니면 400이다', async () => {
    const response = await POST(
      new Request('http://localhost/api/export/assignment', { method: 'POST', body: '{' }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('거부 응답에 행 값·스택이 없다 (X1)', async () => {
    const text = await (
      await POST(exportRequest({ rows: [{ ...ROW, title: '홍길동 개인정보', owner: 'x' }] }))
    ).text();

    expect(text).not.toContain('홍길동');
    expect(text).not.toMatch(/\bat\s|Error:/);
  });
});

describe('POST /api/export/assignment — Content-Disposition', () => {
  it('기본 파일명은 assignment.xlsx다', async () => {
    const disposition = (await POST(exportRequest({ rows: [ROW] }))).headers.get(
      'content-disposition',
    );

    expect(disposition).toContain('attachment');
    expect(disposition).toContain('filename="assignment.xlsx"');
  });

  it('한글 파일명은 filename*에 퍼센트 인코딩으로 실린다', async () => {
    const disposition =
      (await POST(exportRequest({ rows: [ROW], filename: '배정표.xlsx' }))).headers.get(
        'content-disposition',
      ) ?? '';

    // ASCII 자리에 한글을 그대로 넣으면 헤더가 깨진다. 둘 다 준다
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent('배정표.xlsx'));
    expect(disposition).not.toContain('배정표');
  });

  it('경로가 헤더에 들어가지 않는다', async () => {
    const disposition =
      (await POST(exportRequest({ rows: [ROW], filename: '../../etc/passwd' }))).headers.get(
        'content-disposition',
      ) ?? '';

    expect(disposition).not.toContain('..');
    expect(disposition).not.toContain('/etc');
    expect(disposition).toContain('.xlsx');
  });

  it('개행·따옴표가 든 파일명이 헤더를 가르지 않는다', async () => {
    const disposition =
      (
        await POST(exportRequest({ rows: [ROW], filename: 'a"\r\nSet-Cookie: x=1.xlsx' }))
      ).headers.get('content-disposition') ?? '';

    // CR·LF가 남아 있으면 그 뒤가 다른 헤더 줄이 된다. 따옴표는 `filename="…"`의 인용을
    // 그 자리에서 끝내므로 정확히 두 개(여는 것과 닫는 것)여야 한다
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition.split('"').length - 1).toBe(2);
  });
});
