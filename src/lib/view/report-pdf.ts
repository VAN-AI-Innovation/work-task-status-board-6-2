/**
 * 주간 보고를 **PDF 한 덩어리**로 그린다 (`report-document.tsx`의 「PDF로 저장」).
 *
 * ## 왜 인쇄 대화상자를 그만뒀나
 *
 * 예전에는 `window.print()` 하나였다. 「PDF로 저장」을 눌렀는데 인쇄 대화상자가 뜨고,
 * 거기서 대상을 다시 골라야 파일이 나왔다 — 버튼 이름과 실제로 일어나는 일이 달랐다.
 * 이제 진짜 PDF를 만들어 새 탭에 띄운다.
 *
 * ## 문서 구조는 화면과 **같은 것**을 쓴다
 *
 * 받는 것은 `toReportBlocks`가 낸 **바로 그 블록 배열**이다. 마크다운을 여기서 다시 읽지
 * 않는다 — 그러면 화면이 보는 문서와 파일이 된 문서가 갈라지고, 그 차이는 회의 자리에서야
 * 드러난다 (`report-document.tsx` 머리말의 같은 규칙). 이 파일이 정하는 것은 **칠하는
 * 방법**뿐이다: 좌표 · 글자 크기 · 줄바꿈 · 쪽 넘김.
 *
 * ## 폰트는 번들이 아니라 `public/`에서 받는다
 *
 * jsPDF의 기본 폰트에는 한글이 없어서 자소가 통째로 빈칸이 된다. 그래서 Noto Sans KR을
 * 실어야 하는데, 2.4MB를 자바스크립트 번들에 넣으면 **보고서를 안 뽑는 사람까지** 그 값을
 * 치른다. `PDF_FONT_URL`에 두고 버튼을 누른 그때 받는다 (브라우저가 캐시한다).
 *
 * 굵은 글씨가 없는 것이 그 대가다. 한 벌 더 실으면 파일이 두 배가 되므로, 제목은 **크기와
 * 여백과 밑줄**로 구분한다.
 *
 * ⚠ 자간 계산을 하지 않는다 — 줄바꿈은 jsPDF의 `splitTextToSize`가 폰트 메트릭으로 잰다.
 *   손으로 「한 줄 몇 자」를 세면 이름이 긴 줄에서 칸을 넘는다.
 */

import { jsPDF } from 'jspdf';

import type { ReportBlock } from '@/lib/view/report-blocks';

/** `public/` 아래 경로이자 테스트가 읽는 경로다. 둘이 갈라지지 않게 한 곳에서 낸다 */
export const PDF_FONT_URL = '/fonts/NotoSansKR-Regular.ttf';

const FONT = 'NotoSansKR';

/** A4 세로, 단위는 mm */
const PAGE = { width: 210, height: 297, margin: 18 } as const;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/** pt. 굵기를 못 쓰므로 크기 차이가 제목의 유일한 신호다 */
const SIZE = { h1: 16, h2: 11.5, body: 9.5, table: 8.5 } as const;

const INK = { text: 20, muted: 110, rule: 205, fill: 242 } as const;

/** 줄 높이 = 글자 크기 × 이것. mm로 환산해서 쓴다 */
const LINE = 1.45;
const PT_TO_MM = 25.4 / 72;

function lineHeight(sizePt: number): number {
  return sizePt * LINE * PT_TO_MM;
}

/**
 * 커서 하나로 문서를 위에서 아래로 칠한다. 쪽 넘김이 필요한 자리마다 `need`를 먼저 묻는다 —
 * 「그리고 나서 넘쳤는지 본다」로 하면 마지막 줄이 종이 밖에 그려진 채 남는다.
 */
class Cursor {
  y = PAGE.margin;

  constructor(private readonly doc: jsPDF) {}

  need(height: number): void {
    if (this.y + height <= PAGE.height - PAGE.margin) return;
    this.doc.addPage();
    this.y = PAGE.margin;
  }

  rule(): void {
    this.doc.setDrawColor(INK.rule);
    this.doc.setLineWidth(0.2);
    this.doc.line(PAGE.margin, this.y, PAGE.width - PAGE.margin, this.y);
  }
}

/** 접힌 줄을 그리고 커서를 내린다 */
function drawLines(doc: jsPDF, cursor: Cursor, lines: string[], x: number, sizePt: number): void {
  const step = lineHeight(sizePt);
  for (const line of lines) {
    cursor.need(step);
    doc.text(line, x, cursor.y + step * 0.75);
    cursor.y += step;
  }
}

function drawHeading(doc: jsPDF, cursor: Cursor, block: ReportBlock & { kind: 'heading' }): void {
  const sizePt = block.level === 1 ? SIZE.h1 : SIZE.h2;
  cursor.y += block.level === 1 ? 0 : 4;

  doc.setFontSize(sizePt);
  doc.setTextColor(INK.text);
  drawLines(doc, cursor, doc.splitTextToSize(block.text, CONTENT_WIDTH), PAGE.margin, sizePt);

  cursor.y += 1.2;
  cursor.rule();
  cursor.y += 2.5;
}

function drawList(doc: jsPDF, cursor: Cursor, items: readonly string[]): void {
  doc.setFontSize(SIZE.body);
  doc.setTextColor(INK.text);

  const indent = 4;
  for (const item of items) {
    // 첫 줄에만 점이 붙고 이어지는 줄은 들여쓴 자리에서 시작한다 (내어쓰기)
    const lines = doc.splitTextToSize(item, CONTENT_WIDTH - indent) as string[];
    const step = lineHeight(SIZE.body);

    cursor.need(step);
    doc.text('·', PAGE.margin, cursor.y + step * 0.75);
    drawLines(doc, cursor, lines, PAGE.margin + indent, SIZE.body);
  }
  cursor.y += 1.5;
}

/**
 * 칸 너비는 **내용의 길이 비례**다. 균등분할이면 「팀」 칸이 「가장 가까운 마감」과 같은
 * 너비를 갖고, 그 결과 짧은 칸은 텅 비고 긴 칸은 세 줄로 접힌다.
 */
function columnWidths(doc: jsPDF, header: readonly string[], rows: readonly string[][]): number[] {
  const widths = header.map((text, index) =>
    Math.max(doc.getTextWidth(text), ...rows.map((row) => doc.getTextWidth(row[index] ?? '')))
  );
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total === 0) return header.map(() => CONTENT_WIDTH / Math.max(header.length, 1));

  // 여백(칸당 4mm)을 먼저 떼고 남은 폭을 비례 배분한다
  const padding = 4;
  const free = CONTENT_WIDTH - padding * header.length;
  return widths.map((width) => padding + (free * width) / total);
}

function drawRow(
  doc: jsPDF,
  cursor: Cursor,
  cells: readonly string[],
  widths: readonly number[],
  isHeader: boolean
): void {
  const step = lineHeight(SIZE.table);
  const wrapped = cells.map((text, index) =>
    doc.splitTextToSize(text, (widths[index] ?? 0) - 2)
  ) as string[][];
  const height = Math.max(...wrapped.map((lines) => lines.length), 1) * step + 1.5;

  cursor.need(height);

  if (isHeader) {
    doc.setFillColor(INK.fill, INK.fill, INK.fill);
    doc.rect(PAGE.margin, cursor.y, CONTENT_WIDTH, height, 'F');
  }

  let x = PAGE.margin + 1;
  wrapped.forEach((lines, index) => {
    doc.setTextColor(isHeader ? INK.muted : INK.text);
    lines.forEach((line, row) => doc.text(line, x, cursor.y + step * (row + 0.85)));
    x += widths[index] ?? 0;
  });

  cursor.y += height;
  cursor.rule();
}

function drawTable(doc: jsPDF, cursor: Cursor, block: ReportBlock & { kind: 'table' }): void {
  doc.setFontSize(SIZE.table);
  const widths = columnWidths(doc, block.header, block.rows);

  cursor.rule();
  drawRow(doc, cursor, block.header, widths, true);
  for (const row of block.rows) drawRow(doc, cursor, row, widths, false);

  cursor.y += 3;
}

function drawBlock(doc: jsPDF, cursor: Cursor, block: ReportBlock): void {
  switch (block.kind) {
    case 'heading':
      return drawHeading(doc, cursor, block);
    case 'list':
      return drawList(doc, cursor, block.items);
    case 'table':
      return drawTable(doc, cursor, block);
    case 'paragraph':
      doc.setFontSize(SIZE.body);
      doc.setTextColor(INK.text);
      drawLines(
        doc,
        cursor,
        doc.splitTextToSize(block.text, CONTENT_WIDTH),
        PAGE.margin,
        SIZE.body
      );
      cursor.y += 2;
      return;
  }
}

/**
 * @param blocks 화면이 그리는 것과 같은 블록 (`toReportBlocks`)
 * @param fontBase64 `PDF_FONT_URL`에서 받은 TTF. 이것 없이는 한글이 빈칸이 된다
 */
export async function buildReportPdf(
  blocks: readonly ReportBlock[],
  fontBase64: string
): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.addFileToVFS(`${FONT}.ttf`, fontBase64);
  doc.addFont(`${FONT}.ttf`, FONT, 'normal');
  doc.setFont(FONT, 'normal');

  /*
   * 첫 1단 제목을 문서 제목으로 단다. 새 탭의 이름이 `blob:…`가 아니라 「편집팀 주간 업무
   * 보고 — …」가 된다 — 탭 여럿을 열어 두고 비교할 때 어느 것이 어느 팀인지 보인다.
   * 따로 받지 않는 이유는 화면과 갈라질 자리를 하나 더 만들지 않기 위해서다.
   */
  const title = blocks.find((block) => block.kind === 'heading' && block.level === 1);
  if (title !== undefined && title.kind === 'heading') doc.setProperties({ title: title.text });

  const cursor = new Cursor(doc);
  for (const block of blocks) drawBlock(doc, cursor, block);

  return doc.output('blob');
}
