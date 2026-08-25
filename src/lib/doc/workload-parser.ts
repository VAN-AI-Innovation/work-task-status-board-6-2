/**
 * 문서 뒷부분의 「워크로드 공유」 절만 따로 읽어 `taskNo → 우선순위` 대응표를 만든다.
 * 이 절은 아웃라인과 **문법이 다르다** — 우선순위가 `P0`·`P1` 블록으로 묶이고 항목이
 * `①②③④`로 나열된다. 아웃라인 파서로 읽으면 과제 목록이 한 벌 더 생겨 배정표가 두 배가
 * 된다. 그래서 `outline-builder`는 이 절을 건너뛰고 여기가 따로 읽는다.
 *
 * - **여기서 나오는 것은 과제가 아니다.** 세부항목도 만들지 않는다. 조인은 상위 계층
 *   (`assignment-mapper`)의 일이고 이 파서는 `OutlineTask`를 모른다.
 * - **우선순위를 시트 enum 값(`긴급`…)으로 바꾸지 않는다.** 문서 원문(`P0`)만 담는다.
 *   매핑은 `ADR-021`에 따라 한 곳(`assignment-mapper`)에서 한다.
 * - **실패해도 된다.** 절 제목이 바뀌거나 형식이 흩어지면 배정표의 우선순위 칸이 빌 뿐
 *   파이프라인은 그대로 돈다. 던지지 않고 경고도 내지 않는다 — 이 절은 없어도 정상이다.
 * - 절 판별 정규식과 범위 규칙은 `outline-builder`에서 가져온다. 두 벌이 되면 절이 두
 *   파서 모두에서 사라지거나 두 번 읽힌다.
 */

import { sectionBody, WORKLOAD_SECTION_PATTERN } from '@/lib/doc/outline-builder';
import type { OutlineNode, WorkloadEntry } from '@/types/doc';

/**
 * `P0`·`p1`. 뒤에 숫자가 아닌 글자가 붙은 `PM`·`P0X`는 토큰이 아니다.
 * 줄에 토큰이 있으면 **현재 우선순위가 그것으로 바뀌고**, 다음 토큰까지 이어진다.
 */
const PRIORITY_TOKEN = /\bP([0-9])\b/i;

/** `1-1`. 문서에 적힌 대로 담고 실재 여부는 묻지 않는다 — 조인 실패는 무시가 원칙이다 */
const TASK_NO = /\b(\d+-\d+)\b/g;

export function parseWorkloadPriorities(nodes: readonly OutlineNode[]): WorkloadEntry[] {
  const entries: WorkloadEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < nodes.length; i += 1) {
    if (!(nodes[i].level > 0 && WORKLOAD_SECTION_PATTERN.test(nodes[i].text))) continue;

    const body = sectionBody(nodes, i);
    // 절 제목 자신의 본문 줄도 이 절 소속이다. 그 뒤로 본문 노드의 제목·줄을 문서 순서로 잇는다.
    const lines = [...nodes[i].lines, ...body.flatMap((node) => [node.text, ...node.lines])];

    let priorityRaw: string | null = null;

    for (const line of lines) {
      const digit = PRIORITY_TOKEN.exec(line)?.[1];
      // 소문자로 적혀 있어도 `P0`으로 담는다. 원문 표기를 그대로 넘기면 매핑에서
      // 조용히 조인 실패가 되고, 그 실패는 문서 작성자의 대소문자 탓으로 보이지 않는다.
      if (digit !== undefined) priorityRaw = `P${digit}`;
      if (priorityRaw === null) continue;

      // 토큰과 번호가 한 줄에 있으면(`P0: 1-1`) 그 줄의 번호도 담는다.
      for (const [, taskNo] of line.matchAll(TASK_NO)) {
        // 중복은 처음 것만 남긴다 — 문서 위쪽이 더 강한 우선순위다.
        if (seen.has(taskNo)) continue;
        seen.add(taskNo);
        entries.push({ taskNo, priorityRaw });
      }
    }

    i += body.length;
  }

  return entries;
}
