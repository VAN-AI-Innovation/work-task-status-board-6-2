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

import { LinkPendingDot } from '@/components/tasks/link-pending-dot';

import { StatusBadge } from '@/components/tasks/status-badge';
import { buildHref, type DashboardQuery } from '@/lib/view/dashboard-query';
import { EMPTY, formatDate, formatDday, formatPercent } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';
import { rowClassOf } from '@/lib/view/status-badge';
import type { TaskResponse } from '@/types/api';

/** 컬럼 확정값 (`ARCHITECTURE.md`「부서별 탭」의 공통 8~10컬럼) */
const COLUMNS: readonly string[] = [
  '상태',
  '팀',
  '업무명',
  '담당자',
  '마감',
  'D-DAY',
  '진행률',
  '다음 조치',
];

/**
 * 담당자 칸의 글자. **주 담당과 공동 담당을 한 칸에 잇는다** — 시트가 두 칸으로 갖고 있고
 * 패널도 두 줄로 보여 주지만, 표에서 공동 담당이 빠지면 「이 업무는 누가 하나」에 절반만
 * 답하게 된다. 실제로 공동 담당을 걸어 둔 사람이 표에서 자기 이름을 못 찾는 일이 있었다.
 *
 * 주 담당이 **먼저**다. 그 순서가 열람 범위를 정하는 순서이기도 하다 (`viewer-scope.ts`).
 * 주 담당이 비었는데 공동 담당만 있는 행도 있으므로(시트에서 그렇게 온다) 빈 자리를
 * 건너뛰고 잇는다.
 */
function ownerText(task: TaskResponse): string {
  const names = [task.ownerNameRaw, ...task.coOwnerNames].filter(
    (name): name is string => name !== null && name.trim() !== ''
  );

  return names.length === 0 ? EMPTY : names.join(', ');
}

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
          <tr className="bg-brand-soft text-brand sticky top-0 text-xs font-medium">
            {COLUMNS.map((label) => (
              <th key={label} className="px-3 py-2 text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              className={`border-line hover:bg-brand-soft h-10 border-b ${rowClassOf(task.displayStatus)}`}
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
                  className="text-ink hover:text-brand underline-offset-4 hover:underline"
                >
                  {task.title ?? EMPTY}
                  {/* 누른 그 줄에 반응을 둔다 — 패널은 같은 라우트라 골격이 서지 않는다 */}
                  <LinkPendingDot />
                </Link>
              </td>
              {/* 이름이 여럿이면 줄바꿈을 허용한다 — `nowrap`이면 긴 목록이 표를 옆으로 민다 */}
              <td className="text-ink-body px-3 py-2">{ownerText(task)}</td>
              <td className="text-ink px-3 py-2 text-left tabular-nums">
                {formatDate(task.dueAt)}
              </td>
              <td className={`px-3 py-2 text-left tabular-nums ${ddayClassOf(task)}`}>
                {formatDday(task.flags.dday)}
              </td>
              <td className="text-ink px-3 py-2 text-left tabular-nums">
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
