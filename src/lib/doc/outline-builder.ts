/**
 * `OutlineNode[]`에서 **과제만** 골라낸다. 이 파일이 존재하는 이유는 실측 한 줄이다 —
 * 실제 문서의 `h3` 50건 중 과제는 20건이고 30건은 절 제목이다
 * (`scripts/smoke/RESULT.md`「H8」). 깊이로 고르면 배정표에 유령 과제 30줄이 생긴다.
 *
 * - **판별은 번호 접두사로 한다. `level`을 보지 않는다.** 실측에서 `h2`·`h3` 어느 쪽에도
 *   번호가 붙었고, 문서 스타일이 바뀌면 깊이는 흔들린다. 접두사가 진실이다.
 * - **번호 없는 절을 버리지 않는다.** 그 아래에 세부 불릿이 달려 있어서, 버리면 배정표의
 *   세부항목이 비고 사람이 문서를 다시 열어야 한다. 직전 과제의 `details`로 흡수한다.
 * - **난이도·마감·우선순위를 여기서 읽지 않는다.** 그 셋은 `assignment-mapper`가 한 곳에서
 *   다룬다 — 「긴 것부터 정렬」 같은 규칙이 흩어지면 안 된다. 여기서는 `headingRaw`를 원문
 *   그대로 넘기는 것까지다.
 * - **던지지 않는다.** 과제 0건의 판정(`NO_OUTLINE_TASK`)은 `doc-pipeline`의 몫이다.
 * - 시간을 읽지 않는다. 이 계층에 `now`는 필요 없다.
 */

import type { OutlineNode, OutlineTask } from '@/types/doc';

export interface OutlineBuildResult {
  tasks: OutlineTask[];
  /** 코드만 담는다. 원문·사람 이름을 담지 않는다 */
  warnings: string[];
}

/** 대분류 없이 나온 과제. 뒤에 과제 번호를 붙인다 */
const NO_CATEGORY = 'NO_CATEGORY';
/** 붙을 과제가 없어 버려진 절. 붙일 번호가 없으므로 코드만 남는다 */
const ORPHAN_SECTION = 'ORPHAN_SECTION';
/** 같은 과제 번호가 두 번 이상. 뒤에 그 번호를 붙인다 */
const DUPLICATE_TASK_NO = 'DUPLICATE_TASK_NO';

/** `3. 데이터` → 이름 `데이터`. 구분자(`.`·`)`)와 이름이 **둘 다** 있어야 대분류다 */
const CATEGORY = /^(\d+)[.)]\s*(.+)$/;

/**
 * `3-1. 파서` → `3-1`. 번호 뒤에 **구분자가 반드시 온다** — `.`·`)`이거나 공백이거나
 * 줄 끝이다. 이 경계가 없으면 `3-1-1. 하위`가 `3-1` + `-1. 하위`로 쪼개져 과제로
 * 둔갑한다. 구분자 뒤 공백은 선택이라 `3-1.과제`도 잡힌다.
 */
const TASK_NO = /^(\d+-\d+)(?:[.)]|(?=\s|$))\s*/;

/**
 * 「워크로드 공유」 절의 제목. 이 절은 우선순위 블록이라 과제를 담지 않는다 —
 * `workload-parser`가 따로 읽는다. **상수는 여기 하나뿐이고 그쪽이 import한다.**
 * 두 곳에 적으면 한쪽만 고쳐지는 날이 온다.
 */
export const WORKLOAD_SECTION_PATTERN = /워크로드\s*공유/;

/**
 * 제목 노드 하나가 거느리는 본문 노드들. 범위는 **그 제목 다음부터 같거나 더 얕은
 * 다음 제목 직전까지**이고 제목 노드 자신은 포함하지 않는다.
 *
 * 이 규칙이 두 파일에 필요하다 — 여기서는 「워크로드 공유」 절을 **건너뛰려고**,
 * `workload-parser`에서는 같은 절만 **읽으려고** 쓴다. 규칙이 두 벌이 되면 절이 두
 * 파서 모두에서 사라지거나 두 번 읽힌다. 그래서 여기 하나만 두고 그쪽이 import한다.
 */
export function sectionBody(nodes: readonly OutlineNode[], headingIndex: number): OutlineNode[] {
  const level = nodes[headingIndex].level;
  const body: OutlineNode[] = [];

  for (let i = headingIndex + 1; i < nodes.length; i += 1) {
    if (nodes[i].level <= level) break;
    body.push(nodes[i]);
  }

  return body;
}

export function buildOutline(nodes: readonly OutlineNode[]): OutlineBuildResult {
  const tasks: OutlineTask[] = [];
  const warnings: string[] = [];
  const seenTaskNo = new Set<string>();

  let category: string | null = null;
  let current: OutlineTask | null = null;

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    // 워크로드 절 판별이 대분류·과제보다 먼저다 — 「5. 워크로드 공유」처럼 번호가 붙어
    // 있으면 대분류로도 읽히기 때문이다. 절 전체를 통째로 건너뛴다.
    if (node.level > 0 && WORKLOAD_SECTION_PATTERN.test(node.text)) {
      i += sectionBody(nodes, i).length;
      current = null;
      continue;
    }

    // 과제를 대분류보다 먼저 시험한다. 번호의 모양이 둘을 가르므로 순서가 안전판이다.
    const taskNo = TASK_NO.exec(node.text)?.[1];
    if (node.level > 0 && taskNo) {
      if (seenTaskNo.has(taskNo)) warnings.push(`${DUPLICATE_TASK_NO}:${taskNo}`);
      seenTaskNo.add(taskNo);
      if (category === null) warnings.push(`${NO_CATEGORY}:${taskNo}`);

      current = {
        category,
        taskNo,
        headingRaw: node.text,
        orderIndex: tasks.length,
        details: [...node.lines],
      };
      tasks.push(current);
      continue;
    }

    const categoryName = node.level > 0 ? CATEGORY.exec(node.text)?.[2] : undefined;
    if (categoryName) {
      category = categoryName.trim();
      // 대분류가 바뀌면 과제 컨텍스트도 끝난다. 여기서 끊지 않으면 다음 대분류의 절이
      // 이전 대분류 과제의 세부항목으로 들어간다.
      current = null;
      continue;
    }

    // 번호 없는 절(과 서두 본문). 직전 과제가 있으면 흡수하고, 없으면 버린다.
    if (!current) {
      warnings.push(ORPHAN_SECTION);
      continue;
    }
    if (node.text !== '') current.details.push(node.text);
    current.details.push(...node.lines);
  }

  return { tasks, warnings };
}
