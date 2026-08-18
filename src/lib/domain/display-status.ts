/**
 * 시트의 진행 상태는 10단계인데 화면은 5색이다 (`UI_GUIDE.md`「상태 5색 구분」).
 * 그 접기를 하는 곳이 여기다.
 *
 * 두 가지를 지킨다.
 * - **「지연」은 semantic 10단계에 없다.** `dueAt`과 오늘을 비교해 나온 파생값이고
 *   다른 모든 칸을 덮어쓴다 (`ADR-009`). 진행 중이면서 마감이 지난 업무는 「진행」이 아니다.
 * - **색·클래스·아이콘을 모른다.** 도메인은 어느 칸인지만 말하고, 그 칸을 어떻게 그릴지는
 *   `UI_GUIDE.md`가 정하고 컴포넌트(T6)가 고른다.
 *
 * `if/else` 사슬 대신 표로 쓴다. semantic이 늘면 테스트보다 컴파일이 먼저 막힌다.
 */

import type { DisplayStatus, TaskSemantic } from '@/types/task';

const SEMANTIC_DISPLAY: Readonly<Record<TaskSemantic, DisplayStatus>> = {
  planned: 'planned',
  in_progress: 'in_progress',
  rework: 'in_progress',
  review: 'review',
  approval: 'review',
  done: 'done',
  pending_release: 'done',
  hold: 'muted',
  cancelled: 'muted',
};

/** 배지에 쓰는 한글 라벨. 배지는 색만으로 구분되지 않는다 — 라벨이 늘 함께 간다 */
export const DISPLAY_STATUS_LABELS: Readonly<Record<DisplayStatus, string>> = {
  planned: '예정',
  in_progress: '진행',
  review: '검토',
  done: '완료',
  overdue: '지연',
  muted: '기타',
};

/**
 * semantic과 파생 판정을 화면 한 칸으로 접는다.
 *
 * `semantic`이 `null`(미입력·미등록)이면 `muted`다. 모르는 상태를 「예정」이나 「진행」으로
 * 단정하면 그 업무가 정상인 것처럼 보인다 — 5색에서 물러나게 두고 미등록 경고가 따로 드러낸다.
 */
export function toDisplayStatus(
  semantic: TaskSemantic | null,
  flags: { isOverdue: boolean }
): DisplayStatus {
  if (flags.isOverdue) return 'overdue';
  if (semantic === null) return 'muted';

  return SEMANTIC_DISPLAY[semantic];
}
