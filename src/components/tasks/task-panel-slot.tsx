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
  assignableMembers,
  canAssignOwner,
  canDeleteTask,
  canEditTaskDetails,
} from '@/lib/domain/task-authoring';
import {
  buildHref,
  countActiveFilters,
  FILTER_RESET_PATCH,
  type DashboardQuery,
} from '@/lib/view/dashboard-query';
import { toExtraCells } from '@/lib/view/extras-render';
import type { TaskResponse } from '@/types/api';
import type { MemberRecord } from '@/types/auth';
import type { TaskStage } from '@/types/task';

export function TaskPanelSlot({
  tasks,
  stages,
  role,
  query,
  pathname,
  editableIds,
  hasSession,
  members,
  statusOptions,
}: {
  /** **화면에 실제로 보이는 목록.** 칩으로 가린 업무의 패널이 열리면 표와 어긋난다 */
  tasks: TaskResponse[];
  stages: TaskStage[];
  role: ViewerRole;
  query: DashboardQuery;
  pathname: string;
  /**
   * 이 사람이 고칠 수 있는 업무의 id. **페이지가 `lib/domain/viewer-scope.ts`의 범위 판정을
   * 불러 만들어 넘긴다** — 여기서 역할을 읽지 않는다. 로그인하지 않았으면 빈 집합이라
   * 폼이 아예 뜨지 않는다.
   */
  editableIds: ReadonlySet<string>;
  /**
   * 로그인한 세션이 있는가. **「고칠 수 없다」와 「로그인하지 않았다」를 가르는 데만 쓴다** —
   * 데모에서는 `editableIds`가 늘 비어 있어서, 그것만 보면 모든 업무에 「다른 팀 업무입니다」가
   * 붙는다 (`team-visibility.ts`·`staff-tools.ts`가 같은 이유로 이 인자를 받는다).
   */
  hasSession: boolean;
  /**
   * 시트 명부 전량. 담당자 후보를 **여기서 좁힌다** — 페이지가 팀별로 미리 나눠 보내면
   * 어느 팀 것인지 아는 곳이 둘이 된다. 브라우저로 나가는 것은 좁힌 뒤의 `{id, name}`
   * 뿐이다 (`authUserId`를 클라이언트 번들에 싣지 않는다 — `S6`).
   */
  members: readonly MemberRecord[];
  /** 상태 드롭다운 목록. 문자열은 `STATUS_SEMANTIC_MAP` 한 곳에서 온다 (`ADR-009`) */
  statusOptions: readonly string[];
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
            className="text-ink hover:text-brand underline-offset-4 hover:underline"
          >
            필터 초기화
          </Link>
        )}
        <Link href={closeHref} className="text-ink hover:text-brand underline-offset-4 hover:underline">
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
      /*
       * 판정 결과를 **찾아보기만** 한다. 숨김은 방어가 아니고 거부는 `PATCH`가 한다.
       *
       * 범위(`editableIds`)에 역할 한 겹이 더 걸린다 — 그 겹의 근거는 `task-authoring.ts`에
       * 있다. `editableIds`는 이제 「보이는 것」이 아니라 **「고칠 수 있는 것」**이다
       * (`scopeEditableTasks`).
       */
      /*
       * **셋 다 범위 + 역할이다.** 담당자 지정만 오래도록 역할 하나로 서 있었는데, 팀장이
       * 전 팀을 **보게** 된 뒤로(`0012`) 그 자리에 「보이는데 못 고치는」 업무가 생겼다 —
       * 그대로 두면 팀장이 남의 팀 업무에서 담당자 폼을 보고 저장을 눌러 403을 받는다.
       */
      canEdit={editableIds.has(task.id) && canEditTaskDetails(role)}
      canAssign={editableIds.has(task.id) && canAssignOwner(role)}
      canDelete={editableIds.has(task.id) && canDeleteTask(role)}
      /*
       * **감추기만 하면 「어디 갔지」가 된다.** 폼 셋이 통째로 사라진 화면은 고장과 구분되지
       * 않으므로 한 줄로 사유를 적는다 (`UI_GUIDE.md`「접힌 것과 없는 것이 같아 보이면 안 된다」).
       * 로그인하지 않았으면 적지 않는다 — 그때는 「내 팀이 아니다」가 아니라 「아직 로그인이
       * 없다」이고, 데모 화면에 남의 팀 이야기를 띄울 이유가 없다.
       */
      readOnly={hasSession && !editableIds.has(task.id)}
      // 브라우저로 나가는 것은 이 둘뿐이다 (`MemberRecord`의 `authUserId`를 싣지 않는다)
      ownerCandidates={assignableMembers(members, task.teamId).map((member) => ({
        id: member.id,
        name: member.name,
      }))}
      statusOptions={statusOptions}
    />
  );
}
