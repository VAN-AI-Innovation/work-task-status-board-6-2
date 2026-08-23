/**
 * 문서의 산문 표기를 배정표 한 줄로 옮긴다. 판단 셋이 **전부 여기 모여 있다** —
 * 난이도·마감·우선순위. 흩어지면 「긴 것부터 정렬」 같은 규칙이 한쪽에서만 지켜진다.
 *
 * - **난이도는 긴 것부터 매칭한다** (`DIFFICULTY_MATCH_ORDER`). `中|中下` 순서면 `中下`가
 *   `中`으로 떨어진다 — `TICKETS.md` T7 완료 기준 3이 이 한 줄을 잰다.
 * - **연도를 하드코딩하지 않는다.** `9/1`에는 연도가 없어 `baseYear`를 인자로 받는다.
 *   `new Date()`·`Date.now()`를 부르지 않는다 (`CLAUDE.md` CRITICAL).
 * - **추론에 실패해도 원문은 남긴다.** `deadlineDate`가 null이어도 `deadlineRaw`는 살아
 *   있어야 사람이 배정표에서 그 칸을 채운다. 값을 버리는 것이 가장 나쁜 실패다.
 * - **날짜 파서를 새로 쓰지 않는다.** 월/일 채우기·달력 검증·1900 컷은 시트 쪽
 *   `toDateString`이 이미 한다. 두 벌이 되면 시트와 문서가 다른 날짜를 낸다.
 * - **우선순위는 시트 enum 값으로 옮긴다** (`ADR-021`). 배정표의 `우선순위` 칸에는
 *   `공통_우선순위` 드롭다운이 붙어 나가므로 `P0`은 목록 밖 값이다. 조인 실패·표에 없는
 *   값은 **조용히 빈칸**이고 경고를 내지 않는다.
 * - **없는 것을 만들지 않는다.** 담당자·상태·진행률은 사람이 채우는 칸이라 여기서 다루지
 *   않고, 문서에 난이도가 없으면 빈칸으로 둔다 — 기계가 그럴듯하게 메우면 받는 사람이 믿는다.
 * - 던지지 않는다. 어떤 입력에도 행 배열을 돌려준다.
 */

import { toDateString } from '@/lib/sheet/cell-normalizer';
import type { AssignmentRow, OutlineTask, WorkloadEntry } from '@/types/doc';

/**
 * **매칭 순서다.** 두 글자짜리가 먼저 온다 — 이 배열을 `|`로 이어 정규식을 만들기 때문에
 * 순서가 곧 우선순위이고, `中`이 앞에 오면 `中上`·`中下`가 `中`으로 떨어진다.
 * 정렬을 코드에서 다시 하지 않는다. 배열 자체가 규칙이다.
 */
export const DIFFICULTY_MATCH_ORDER: readonly string[] = ['中上', '中下', '上', '中', '下'];

/** **표시 순서다.** 드롭다운 목록(step 5)은 사람이 읽는 순서 — `上`에서 `下`로 내려간다 */
export const DIFFICULTY_LEVELS: readonly string[] = ['上', '中上', '中', '中下', '下'];

/** 시트 `공통_우선순위` 실측값. 배정표 드롭다운 목록의 단일 출처다 */
export const PRIORITY_LEVELS: readonly string[] = ['긴급', '높음', '보통', '낮음'];

/** 결정 A (`PLAN.md`「T7 착수 시 확정」·`ADR-021`). 여기 없는 원문은 빈칸이다 */
export const WORKLOAD_PRIORITY_MAP: Readonly<Record<string, string>> = {
  P0: '긴급',
  P1: '높음',
  P2: '보통',
  P3: '낮음',
};

const DIFFICULTY = new RegExp(DIFFICULTY_MATCH_ORDER.join('|'));

/**
 * 제목 끝에 이어 붙은 괄호 덩어리들. **끝에 있는 것만** 본다 — 제목 한가운데의 괄호는
 * 문서 관습상 메타가 아니라 제목의 일부다. 중첩 괄호는 잡지 않고 제목에 남긴다.
 */
const TRAILING_GROUPS = /(?:\s*\([^()]*\))+\s*$/;
const GROUP = /\(([^()]*)\)/g;

/** `YYYY-MM-DD`·`YYYY.MM.DD` */
const FULL_DATE = /(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/;
/** `9/1`·`9.1` */
const MONTH_DAY = /(\d{1,2})\s*[-./]\s*(\d{1,2})/;
/** `9월 1일` */
const KOREAN_MONTH_DAY = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/;

/** 자유 표기에서 날짜 토큰만 떼어 `toDateString`이 아는 모양으로 만든다 */
function dateToken(text: string): string | null {
  const full = FULL_DATE.exec(text);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;

  const short = MONTH_DAY.exec(text);
  if (short) return `${short[1]}/${short[2]}`;

  const korean = KOREAN_MONTH_DAY.exec(text);
  if (korean) return `${korean[1]}/${korean[2]}`;

  return null;
}

interface HeadingParts {
  title: string;
  difficulty: string | null;
  deadlineRaw: string | null;
  deadlineDate: string | null;
}

function parseHeading(task: OutlineTask, baseYear: number): HeadingParts {
  // 번호는 빌더가 이미 확정했다. 그 값으로 접두사를 떼면 번호 정규식이 두 벌이 되지 않는다.
  const escaped = task.taskNo.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const withoutNo = task.headingRaw.replace(new RegExp(`^\\s*${escaped}\\s*(?:[.)]\\s*)?`), '');

  const trailing = TRAILING_GROUPS.exec(withoutNo);
  if (!trailing) {
    return { title: withoutNo.trim(), difficulty: null, deadlineRaw: null, deadlineDate: null };
  }

  const segments = [...trailing[0].matchAll(GROUP)]
    .flatMap(([, inner]) => inner.split(/[,，]/))
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  let difficulty: string | null = null;
  let deadlineRaw: string | null = null;

  for (const segment of segments) {
    const level = DIFFICULTY.exec(segment)?.[0];
    if (level && difficulty === null) {
      difficulty = level;
      continue;
    }
    if (deadlineRaw === null) deadlineRaw = segment;
  }

  const hasDate = deadlineRaw !== null && dateToken(deadlineRaw) !== null;
  // 난이도도 날짜도 없는 덩어리는 메타가 아니라 제목의 일부다 (`(2부)`). 떼지 않는다.
  if (difficulty === null && !hasDate) {
    return { title: withoutNo.trim(), difficulty: null, deadlineRaw: null, deadlineDate: null };
  }

  const token = deadlineRaw === null ? null : dateToken(deadlineRaw);

  return {
    title: withoutNo.slice(0, trailing.index).trim(),
    difficulty,
    deadlineRaw,
    deadlineDate: token === null ? null : toDateString(token, { baseYear }).value,
  };
}

export function buildAssignmentRows(
  tasks: readonly OutlineTask[],
  workload: readonly WorkloadEntry[],
  ctx: { baseYear: number }
): AssignmentRow[] {
  const priorityByTaskNo = new Map<string, string>();
  // 처음 것이 이긴다 — 파서가 이미 그 규칙으로 담지만, 이 함수는 그 보장에 기대지 않는다.
  for (const entry of workload) {
    if (!priorityByTaskNo.has(entry.taskNo)) priorityByTaskNo.set(entry.taskNo, entry.priorityRaw);
  }

  return tasks.map((task) => {
    const parts = parseHeading(task, ctx.baseYear);
    const priorityRaw = priorityByTaskNo.get(task.taskNo) ?? null;

    return {
      category: task.category,
      taskNo: task.taskNo,
      title: parts.title,
      difficulty: parts.difficulty,
      deadlineRaw: parts.deadlineRaw,
      deadlineDate: parts.deadlineDate,
      priority: priorityRaw === null ? null : (WORKLOAD_PRIORITY_MAP[priorityRaw] ?? null),
      priorityRaw,
      details: task.details.join('\n'),
    };
  });
}
