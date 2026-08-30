/**
 * 주간 보고 마크다운을 **문서 블록**으로 옮긴다. `/report` 화면이 표를 표로, 목록을 목록으로
 * 그리기 위한 것이고, 그것이 곧 「PDF로 저장」이 뽑아내는 문서다.
 *
 * ## 범용 마크다운 파서가 아니다
 *
 * 상대하는 것은 **우리가 만든 문자열 하나**뿐이다 (`buildWeeklyReport`). 그 생산자가 내는
 * 모양이 다섯 가지라 다섯 가지만 안다.
 *
 * ```
 * # 제목                      → heading(1)
 * ## 섹션                     → heading(2)
 * - 한 줄                     → list (연속한 줄이 한 블록)
 * | a | b |  · | --- | ---: | → table (구분선이 정렬을 준다)
 * 해당 없음                    → paragraph
 * ```
 *
 * 모르는 모양은 **문단으로 남긴다.** 버리지 않는 것이 이 파일의 유일한 불변식이다 —
 * 화면이 마크다운 원문과 다른 것을 말하기 시작하면 그때부터 둘 다 못 믿는다. 테스트가 손으로
 * 지은 문자열이 아니라 **실제 보고서**를 넣어 보는 이유도 그것이다.
 *
 * ## 마크다운 라이브러리를 쓰지 않는 이유는 그대로다
 *
 * T9 결정 O가 막은 것은 **HTML로 바꾸는 것**이다 — 그 순간 sanitize가 필요해지고 시트 셀에서
 * 온 문자열이 그대로 DOM이 된다 (`S7`). 여기서 나오는 것은 HTML이 아니라 **문자열이 담긴
 * 자료구조**이고, 화면은 그것을 React 엘리먼트로 그린다. React가 텍스트를 이스케이프하므로
 * 셀 값이 마크업이 될 길이 없다 — `dangerouslySetInnerHTML`이 이 경로에 한 번도 없다.
 *
 * 그리고 이 파일은 **세지 않는다.** 숫자는 전부 `buildWeeklyReport`가 이미 낸 것이고 여기서는
 * 줄을 나눌 뿐이라, 화면과 API가 같은 보고서를 말한다는 성질이 그대로 남는다 (`ADR-006`).
 */

/** 표 칸의 정렬. 구분선의 `---:`가 오른쪽이다 — 숫자 칸이 그것이다 */
export type ReportAlign = 'left' | 'right';

export type ReportBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; align: ReportAlign[]; rows: string[][] }
  | { kind: 'paragraph'; text: string };

const TABLE_DIVIDER = /^:?-{3,}:?$/;

function isTableLine(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|');
}

/**
 * `| a | b |` → `['a', 'b']`.
 *
 * **이스케이프된 파이프에서는 자르지 않는다.** `cell()`이 셀 값의 `|`를 `\|`로 바꿔 넣으므로
 * (`weekly-report.ts`), 그냥 `split('|')`하면 업무명에 파이프가 있는 줄에서 칸 수가 늘어나
 * 표가 통째로 어긋난다. 자른 뒤에 이스케이프를 되돌린다.
 */
function splitRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((part) => part.trim().replace(/\\\|/g, '|'));
}

function isDividerRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((value) => TABLE_DIVIDER.test(value));
}

export function toReportBlocks(markdown: string): ReportBlock[] {
  const lines = markdown.split('\n').map((line) => line.trimEnd());
  const blocks: ReportBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push({ kind: 'heading', level: 2, text: line.slice(3).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push({ kind: 'heading', level: 1, text: line.slice(2).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith('- ')) {
      const items: string[] = [];
      // **연속한 줄만** 한 목록이다. 사이에 다른 줄이 오면 목록이 둘로 갈린다
      while (index < lines.length && (lines[index] ?? '').startsWith('- ')) {
        items.push((lines[index] ?? '').slice(2).trim());
        index += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }

    if (isTableLine(line)) {
      const header = splitRow(line);
      const next = lines[index + 1] ?? '';

      /*
       * 구분선이 없으면 표가 아니다. 우리 생산자는 머리글과 구분선을 늘 함께 내므로
       * (`teamSection`), 그 짝이 깨진 문자열을 표로 우겨넣지 않고 문단으로 남긴다.
       */
      if (isTableLine(next) && isDividerRow(splitRow(next))) {
        const align: ReportAlign[] = splitRow(next).map((value) =>
          value.endsWith(':') ? 'right' : 'left'
        );
        const rows: string[][] = [];
        index += 2;

        while (index < lines.length && isTableLine(lines[index] ?? '')) {
          rows.push(splitRow(lines[index] ?? ''));
          index += 1;
        }

        blocks.push({ kind: 'table', header, align, rows });
        continue;
      }
    }

    // 아는 모양이 아니면 **버리지 않고** 문단으로 남긴다 (머리말)
    blocks.push({ kind: 'paragraph', text: line.trim() });
    index += 1;
  }

  return blocks;
}
