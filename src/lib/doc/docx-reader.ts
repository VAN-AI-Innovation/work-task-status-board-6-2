/**
 * `.docx`를 `OutlineNode[]`로 읽는다. **제품이 받는 유일한 입력 형식**이다 (ADR-010).
 *
 * - mammoth를 **옵션 없이** 부른다. 실측(H8)에서 기본 styleMap이 heading을 `h1`~`h3`으로
 *   전부 인식했으므로 styleMap을 손대지 않는다 — 근거는 `scripts/smoke/RESULT.md`「H8」.
 *   `messages`는 읽지 않는다. 경고에 스타일 이름이 담기고 그것은 사용자에게 보일 것이 아니다.
 * - **`markdown-reader`와 같은 것을 뱉는다** (T7 완료 기준 2). 규칙 셋을 그쪽과 맞춘다:
 *   빈 줄은 넣지 않고, 텍스트는 `trim()`만 하며, 제목 앞 본문은 `level: 0` 서두 노드가 받는다.
 *   규칙이 갈리면 그 아래 세 계층이 입력 형식을 알게 된다.
 * - **의미를 모른다.** 난이도·마감·번호 접두사는 위 계층(`outline-builder`)이 읽는다.
 * - HTML → 아웃라인은 `outlineFromHtml`로 떼어 뒀다. `.docx`는 바이너리라 픽스처로 최악인데,
 *   변환 규칙이 순수 함수면 문자열만으로 전부 검증된다.
 * - 아는 라이브러리는 `mammoth`와 `node-html-parser` 둘뿐이다. `exceljs`를 import하지 않는다.
 * - **던진다.** 손상된 파일은 여기서 예외가 되고, 에러 코드로 옮기는 것은 `doc-pipeline`이다.
 */

import mammoth from 'mammoth';
import { parse, type HTMLElement, type Node } from 'node-html-parser';

import type { OutlineNode } from '@/types/doc';

/** `h1`~`h6`. 그 숫자가 곧 level이다 */
const HEADING_TAG = /^h([1-6])$/;

const LIST_TAGS = new Set(['ul', 'ol']);

function tagOf(node: Node): string {
  return ((node as HTMLElement).rawTagName ?? '').toLowerCase();
}

/**
 * 자기 자신의 텍스트만 모은다 — 중첩 목록(`<li>가<ul><li>나</li></ul></li>`)에서
 * 바깥 항목이 안쪽 텍스트까지 삼키지 않게 한다. `.text`를 그냥 쓰면 `가나`가 된다.
 * 엔티티 디코드는 라이브러리에 맡긴다.
 */
function ownText(element: HTMLElement): string {
  return element.childNodes
    .filter((child) => !LIST_TAGS.has(tagOf(child)))
    .map((child) => child.text)
    .join('');
}

/** 중첩을 평평하게 편다. `querySelectorAll`이 문서 순서를 지키므로 순서는 그대로다 */
function listLines(list: HTMLElement): string[] {
  return list.querySelectorAll('li').map(ownText);
}

export function outlineFromHtml(html: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  let current: OutlineNode | null = null;

  const addLine = (raw: string) => {
    const text = raw.trim();
    if (text === '') return;
    if (!current) {
      // 제목 앞 본문. 버리지 않고 서두 노드에 담는다 — 상위 계층은 level 0을
      // 과제로도 대분류로도 보지 않으므로 안전하다. `markdown-reader`와 같은 규칙이다.
      current = { level: 0, text: '', lines: [] };
      nodes.push(current);
    }
    current.lines.push(text);
  };

  for (const child of parse(html).childNodes) {
    const tag = tagOf(child);
    if (tag === '') continue;

    const element = child as HTMLElement;
    const heading = HEADING_TAG.exec(tag);
    if (heading) {
      current = { level: Number(heading[1]), text: element.text.trim(), lines: [] };
      nodes.push(current);
      continue;
    }

    if (LIST_TAGS.has(tag)) {
      for (const line of listLines(element)) addLine(line);
      continue;
    }

    if (tag === 'p') {
      addLine(element.text);
      continue;
    }

    // 그 밖(`table` 등)은 무시한다. 실측에서 `table`은 0건이었고, 무엇이 오든 던지지 않는다.
  }

  return nodes;
}

export async function readDocxOutline(buffer: Buffer | Uint8Array): Promise<OutlineNode[]> {
  const { value } = await mammoth.convertToHtml({
    buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
  });
  return outlineFromHtml(value);
}
