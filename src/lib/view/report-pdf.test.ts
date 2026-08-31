import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { toReportBlocks, type ReportBlock } from '@/lib/view/report-blocks';
import { buildReportPdf, PDF_FONT_URL } from '@/lib/view/report-pdf';

/** 화면이 `fetch`로 받는 것과 **같은 파일**이다 — 경로가 어긋나면 여기서 먼저 터진다 */
const FONT = readFileSync(`public${PDF_FONT_URL}`).toString('base64');

async function head(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString('latin1');
}

async function pageCount(blob: Blob): Promise<number> {
  const text = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

describe('buildReportPdf', () => {
  it('PDF 한 덩어리를 낸다', async () => {
    const blob = await buildReportPdf(toReportBlocks('# 편집팀 주간 업무 보고 — 2026-08-31'), FONT);

    expect(blob.type).toBe('application/pdf');
    expect(await head(blob)).toBe('%PDF-');
  });

  it('블록이 하나도 없어도 던지지 않는다', async () => {
    expect(await head(await buildReportPdf([], FONT))).toBe('%PDF-');
  });

  it('한 장에 안 들어가는 표는 페이지를 넘긴다', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => [
      `업무 ${index}`,
      '진행 중',
      '2026-09-06',
    ]);
    const table: ReportBlock = {
      kind: 'table',
      header: ['업무', '상태', '마감'],
      align: ['left', 'left', 'left'],
      rows,
    };

    expect(await pageCount(await buildReportPdf([table], FONT))).toBeGreaterThan(1);
  });

  it('긴 셀 값이 칸을 넘지 않고 접힌다 — 접힌 만큼 문서가 길어진다', async () => {
    const long = '아주 긴 업무명입니다 '.repeat(20);
    const one: ReportBlock = {
      kind: 'table',
      header: ['업무'],
      align: ['left'],
      rows: [['짧다']],
    };
    const many: ReportBlock = { ...one, rows: [[long]] };

    expect((await buildReportPdf([many], FONT)).size).toBeGreaterThan(
      (await buildReportPdf([one], FONT)).size
    );
  });
});
