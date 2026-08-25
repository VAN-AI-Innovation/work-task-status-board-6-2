/**
 * 마크다운을 `OutlineNode[]`로 읽는다. **테스트 픽스처 전용 경로**이며 제품이 받는 입력은
 * `.docx` 하나다 (ADR-010). 그래도 아웃라인 로직 전체가 이 출력으로 검증되므로,
 * `docx-reader`는 "이 리더와 같은 것을 뱉는다"만 증명하면 된다.
 *
 * - 문자열만 안다. `mammoth`·`node-html-parser`·`exceljs`를 import하지 않는다.
 * - **의미를 모른다.** 난이도·마감·번호 접두사는 위 계층(`outline-builder`)이 읽는다.
 *   리더가 의미를 알기 시작하면 리더 둘이 두 벌로 갈라져 T7 완료 기준 2를 증명할 수 없다.
 * - 값을 버리지 않는다. 제목 앞에 나온 본문 줄도 `level: 0` 서두 노드가 받아 둔다.
 * - 던지지 않는다. 어떤 문자열을 넣어도 배열이 나온다.
 */

import type { OutlineNode } from '@/types/doc';

/** `#`~`######` + 공백. 공백이 없는 `#제목`은 제목이 아니다 */
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * 줄 맨 앞의 불릿 기호. **뒤에 공백이 있어야** 기호로 본다 —
 * 그러지 않으면 `-20% 축소안`이라는 본문이 `20% 축소안`으로 뭉개진다.
 * 기호만 있는 줄(`-`)을 위해 줄 끝(`$`)도 받는다.
 */
const BULLET = /^(?:[-*+•]|\d+[.)]|[①-⑳])(?:\s+|$)/;

export function readMarkdownOutline(markdown: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  let current: OutlineNode | null = null;

  for (const raw of markdown.split('\n')) {
    // CRLF의 캐리지 리턴은 trim이 함께 걷어낸다.
    const line = raw.trim();
    if (line === '') continue;

    const heading = HEADING.exec(line);
    if (heading) {
      current = { level: heading[1].length, text: heading[2].trim(), lines: [] };
      nodes.push(current);
      continue;
    }

    const text = line.replace(BULLET, '').trim();
    if (text === '') continue;

    if (!current) {
      // 제목 앞 본문. 버리지 않고 서두 노드에 담는다 — 상위 계층은 level 0을
      // 과제로도 대분류로도 보지 않으므로 안전하다.
      current = { level: 0, text: '', lines: [] };
      nodes.push(current);
    }
    current.lines.push(text);
  }

  return nodes;
}
