/**
 * 패널을 **열지 말지 정하는 한 곳**. 대시보드와 부서별 탭이 같은 판단을 하므로, 두 페이지에
 * 같은 열 줄을 복사하면 언젠가 한쪽만 고쳐진다.
 *
 * 판단은 셋뿐이다.
 *
 * - `?task=`가 없다 → 아무것도 그리지 않는다.
 * - id가 **보이는 목록에 있다** → 패널을 연다. 목록(`tasks`)은 이미 조회 응답을 거친
 *   모양이라 감사용 원본 행(`raw`)이 화면으로 새지 않는다 (`S6`).
 * - 목록에 없다 → **패널을 열지 않고 한 줄로 알린다.** 오래된 링크를 연 것뿐이라 에러
 *   화면을 띄우지 않는다. 그렇다고 아무 반응이 없으면 사용자는 링크가 고장 났다고 본다.
 *
 * 마지막 갈래에서 원인을 둘로 나눈다 — **걸린 필터가 있으면** 그것 때문에 빠졌을 수 있으므로
 * 초기화 링크를 함께 준다. 필터가 하나도 없는데 없는 id면 초기화해도 달라지지 않으므로
 * 누를 것 없는 버튼을 만들지 않는다.
 *
 * 패널 자체가 `fixed` 오버레이라 이 컴포넌트를 표 위에 두어도 화면에서는 오른쪽에 뜬다.
 * 안내 한 줄이 표 위에 붙는 자리와 같으므로 둘을 한 컴포넌트가 진다.
 */

import Link from 'next/link';

import { TaskPanel } from '@/components/tasks/task-panel';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import {
  buildHref,
  countActiveFilters,
  FILTER_RESET_PATCH,
  type DashboardQuery,
} from '@/lib/view/dashboard-query';
import { toExtraCells } from '@/lib/view/extras-render';
import type { TaskResponse } from '@/types/api';
import type { TaskStage } from '@/types/task';

export function TaskPanelSlot({
  tasks,
  stages,
  role,
  query,
  pathname,
}: {
  /** **화면에 실제로 보이는 목록.** 칩으로 가린 업무의 패널이 열리면 표와 어긋난다 */
  tasks: TaskResponse[];
  stages: TaskStage[];
  role: ViewerRole;
  query: DashboardQuery;
  pathname: string;
}) {
  const openId = query.task;
  if (openId === null) return null;

  const task = tasks.find((item) => item.id === openId) ?? null;
  const closeHref = buildHref(pathname, query, { task: null });

  if (task === null) {
    const hasFilters = countActiveFilters(query) > 0;

    return (
      <p className="border-line bg-raise text-ink-muted mb-3 flex flex-wrap items-center gap-3 rounded border px-3 py-2 text-xs">
        {hasFilters ? '이 업무는 현재 필터 밖에 있습니다' : '이 업무를 찾을 수 없습니다'}
        {hasFilters && (
          <Link
            href={buildHref(pathname, query, { ...FILTER_RESET_PATCH, task: openId })}
            className="text-ink underline-offset-4 hover:underline"
          >
            필터 초기화
          </Link>
        )}
        <Link href={closeHref} className="text-ink underline-offset-4 hover:underline">
          닫기
        </Link>
      </p>
    );
  }

  return (
    <TaskPanel
      task={task}
      /*
       * 이미 조회된 목록에서 고른다 — 여기서 다시 저장소를 읽지 않는다. `seq` 순서를 여기서
       * 한 번 더 못박는 이유는 두 저장소 구현이 같은 정렬을 보장한다고 화면이 믿을 근거가
       * 없기 때문이다. 단계가 뒤섞이면 타임라인이 아니라 목록이 된다.
       */
      stages={stages
        .filter((stage) => stage.taskId === openId)
        .sort((left, right) => left.seq - right.seq)}
      // 변환은 서버에서 끝낸다 — 패널은 마스킹도 스킴 검사도 다시 하지 않는다 (`S6`·`S7`)
      cells={toExtraCells(task.extras, role)}
      closeHref={closeHref}
    />
  );
}
