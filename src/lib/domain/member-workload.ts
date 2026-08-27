/**
 * 사람 하나의 업무 부하. 어드민 멤버 화면의 상세 패널이 「이 사람이 무엇을 얼마나 들고
 * 있는가」를 말할 때 쓴다.
 *
 * **세는 규칙을 여기서 새로 만들지 않는다.** 집계는 `summarizeTeam`이 이미 지고 있고,
 * 이 파일은 **대상을 좁혀 그 함수에 넘길 뿐**이다 (`ADR-006`). 여기서 따로 세면 같은 낱말
 * (「완료」·「지연」)이 팀 요약과 사람 요약에서 다른 수를 갖게 되고, 그 차이는 화면에서
 * 영영 드러나지 않는다.
 *
 * `now`를 직접 읽지 않는다 — 판정은 호출자가 만든 `StatsContext`에 이미 들어 있다
 * (CLAUDE.md CRITICAL).
 */

import { summarizeTeam, type StatsContext, type TeamSummary } from '@/lib/domain/progress-stats';
import type { Task } from '@/types/task';
import type { TeamKey } from '@/types/task';

/**
 * 담당자가 이 사람인 업무만. **`ownerMemberId`가 null인 행은 빠진다** — 담당자 미상을
 * 「내 것」으로 치면 그 업무가 계정 연결된 전원에게 붙는다 (`viewer-scope.ts` 결정 D와
 * 같은 판단이다).
 *
 * `memberId`가 null이면(명부에 안 붙은 계정) 빈 배열이다. null끼리 맞춰 버리면 위와 같은
 * 사고가 반대 방향으로 난다.
 */
export function tasksOwnedBy(tasks: readonly Task[], memberId: string | null): Task[] {
  if (memberId === null) return [];

  return tasks.filter((task) => task.ownerMemberId === memberId);
}

/**
 * 그 사람 몫의 요약. **팀을 모르면 `null`이다** — `summarizeTeam`은 팀을 기준으로 세므로
 * 넘길 값이 없고, 0건 요약으로 접으면 「업무가 없다」와 「셀 기준이 없다」가 화면에서 같아
 * 보인다.
 *
 * 명부에 안 붙은 계정(`memberId === null`)은 다르다 — 그쪽은 **정말로 0건**이라 요약을 준다.
 */
export function summarizeMemberWorkload(
  tasks: readonly Task[],
  ctx: StatsContext,
  memberId: string | null,
  teamKey: TeamKey | null
): TeamSummary | null {
  if (teamKey === null) return null;

  return summarizeTeam(tasksOwnedBy(tasks, memberId), ctx, teamKey);
}

/**
 * 아직 끝나지 않은 것만, **마감이 급한 순서로.** 이것이 「할 일 목록」이 되려면 순서가
 * 곧 우선순위여야 한다.
 *
 * 마감이 없는 건은 **맨 뒤**다. 빈 값을 이른 날짜로 치면 마감 없는 업무가 목록 맨 위에
 * 올라와 진짜 급한 것을 밀어낸다.
 *
 * 마지막 tie-break가 `id`인 것은 결정성 때문이다 — 같은 마감일이 흔한 데이터라, 안 잡아
 * 두면 새로고침할 때마다 줄 순서가 바뀐다.
 */
export function openTasksOf(
  tasks: readonly Task[],
  ctx: StatsContext,
  memberId: string | null
): Task[] {
  const open = tasksOwnedBy(tasks, memberId).filter((task) => {
    // 판정은 `deriveAllFlags`가 이미 냈다. 화면도 이 파일도 상태 문자열을 다시 읽지 않는다
    const semantic = ctx.flags?.get(task.id)?.semantic ?? null;
    return semantic !== 'done' && semantic !== 'pending_release' && semantic !== 'cancelled';
  });

  return open.sort((a, b) => {
    if (a.dueAt !== b.dueAt) {
      if (a.dueAt === null) return 1;
      if (b.dueAt === null) return -1;
      return a.dueAt < b.dueAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
