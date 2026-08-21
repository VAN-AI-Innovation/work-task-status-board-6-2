/**
 * 업무 표. **공통 8칸만 뿌린다** — 촬영팀 탭은 70컬럼이고 그것을 표에 펼치면 아무도 못 쓴다
 * (`ADR-002`). 팀 전용 필드(`extras`)와 단계 타임라인은 사이드 패널(step 7)이 진다.
 *
 * 행마다의 링크가 그 패널의 입구다. `?task=`만 갈아끼우고 나머지 필터를 그대로 들고 가므로,
 * 패널을 닫으면 보던 목록으로 돌아온다 (`UC-15`). 지금은 링크만 있고 패널은 없다 —
 * 자기 페이지를 다시 그리는 것뿐이라 404가 나지 않는다.
 *
 * 판정은 한 줄도 하지 않는다. 5색 칸(`displayStatus`)·D-DAY(`flags.dday`)·마감 임박
 * (`flags.isDueSoon`)은 전부 조회 응답에 실려 온 값이고, 화면은 어느 클래스로 그릴지만 고른다
 * (`ADR-006`).
 */

import Link from 'next/link';

import { StatusBadge } from '@/components/tasks/status-badge';
import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';
import { EMPTY, formatDate, formatDday, formatPercent } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';
import { rowClassOf } from '@/lib/view/status-badge';
import type { TaskResponse } from '@/types/api';

/** 컬럼 확정값 (`ARCHITECTURE.md`「부서별 탭」의 공통 8~10컬럼) */
const COLUMNS: readonly { label: string; numeric?: true }[] = [
  { label: '상태' },
  { label: '팀' },
  { label: '업무명' },
  { label: '담당자' },
  { label: '마감', numeric: true },
  { label: 'D-DAY', numeric: true },
  { label: '진행률', numeric: true },
  { label: '다음 조치' },
];

/**
 * D-DAY만 색을 갖는다. 지연은 이미 배지와 좌측 보더가 말하고 있으므로 여기서는 **마감 임박**
 * (앰버)이 실제 정보다 — 아직 지나지 않았지만 곧 지난다는 사실은 다른 칸 어디에도 없다.
 */
function ddayClassOf(task: TaskResponse): string {
  if (task.flags.isOverdue) return 'text-late';

  return task.flags.isDueSoon ? 'text-warn' : 'text-ink';
}

export function TaskTable({
  tasks,
  query,
  pathname,
}: {
  tasks: TaskResponse[];
  query: DashboardQuery;
  pathname: string;
}) {
  return (
    // 표만 가로로 스크롤한다. 페이지 전체가 밀리면 1024px에서 사이드바까지 따라 움직인다
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="bg-raise text-ink-muted sticky top-0 text-xs font-medium">
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                className={`px-3 py-2 ${column.numeric === true ? 'text-right' : 'text-left'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              className={`border-line hover:bg-raise h-10 border-b ${rowClassOf(task.displayStatus)}`}
            >
              <td className="px-3 py-2">
                <StatusBadge status={task.displayStatus} />
              </td>
              <td className="text-ink-body px-3 py-2 whitespace-nowrap">
                {teamLabel(task.teamId)}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={buildHref(pathname, query, { task: task.id })}
                  className="text-ink underline-offset-4 hover:underline"
                >
                  {task.title ?? EMPTY}
                </Link>
              </td>
              <td className="text-ink-body px-3 py-2 whitespace-nowrap">
                {task.ownerNameRaw ?? EMPTY}
              </td>
              <td className="text-ink px-3 py-2 text-right tabular-nums">
                {formatDate(task.dueAt)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${ddayClassOf(task)}`}>
                {formatDday(task.flags.dday)}
              </td>
              <td className="text-ink px-3 py-2 text-right tabular-nums">
                {formatPercent(task.progress)}
              </td>
              <td className="text-ink-body px-3 py-2">{task.nextAction ?? EMPTY}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
