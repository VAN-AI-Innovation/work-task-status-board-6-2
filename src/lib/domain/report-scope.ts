/**
 * **주간 보고가 다루는 팀.** 열람 범위(`viewer-scope.ts`)와 **일부러 다른 물음**이다.
 *
 * ## 왜 열람 범위를 그대로 쓰지 않나
 *
 * `0012`가 팀장의 열람을 전사로 넓혔고, 그래서 `read.tasks`에는 세 팀 업무가 다 들어 있다.
 * 보고서는 그것을 그대로 요약했으므로 **팀장이 여는 주간 보고에 남의 팀 업무가 섞였다.**
 *
 * 그것이 틀린 이유는 범위가 아니라 **문서의 쓰임**이다. 주간 보고는 「우리 팀이 이번 주에
 * 무엇을 했는가」를 어드민에게 올리는 물건이다 (`report-submission.ts`의 제출·검토 흐름이
 * 그 모양으로 서 있다 — 팀장이 팀별로 올리고 어드민이 병합해 본다). 남의 팀 숫자가 섞인
 * 문서는 올릴 물건이 아니고, 어드민이 그것을 병합하면 같은 업무가 두 번 세어진다.
 *
 * 그래서 **보는 범위는 그대로 두고 보고 범위만 좁힌다.** 팀장은 여전히 전사 대시보드를
 * 보고(`canSeeOrgDashboard`), 남의 팀 업무도 읽는다 — 다만 자기 이름으로 나가는 문서에는
 * 자기 팀만 담는다.
 *
 * ## `null`은 「전부」다
 *
 * 빈 배열(`[]`)과 갈라 둔 것이 요점이다. `[]`는 **「다룰 팀이 없다」**(팀을 모르는 팀장)이고
 * `null`은 **「좁히지 않는다」**(어드민·데모)다. 하나로 뭉개면 팀 없는 계정이 전사 보고서를
 * 받는다 — `team-visibility.ts`가 같은 자리에서 같은 실수를 막는다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskStage, TeamKey } from '@/types/task';

export function reportTeams(
  role: ViewerRole,
  /** `profiles.team_id`. 대표·실장은 null일 수 있다 */
  teamId: TeamKey | null,
  /** 로그인한 세션이 있는가. 없으면 데모라 좁히지 않는다 (머리말) */
  hasSession: boolean
): readonly TeamKey[] | null {
  if (!hasSession) return null;

  switch (role) {
    case 'admin':
      return null;
    case 'lead':
    case 'member':
      return teamId === null ? [] : [teamId];
  }
}

/** 보고서가 세는 것 전부. `buildWeeklyReport`가 받는 것과 같은 네 축이다 */
export interface ReportInputs {
  tasks: readonly Task[];
  stages: readonly TaskStage[];
  goals: readonly GoalMetric[];
  /** `null`은 **「집계되지 않음」**이고 빈 배열은 「0건」이다 (`report-context.ts`) */
  events: readonly TaskEvent[] | null;
}

/**
 * 네 축을 **한 번에** 좁힌다. 호출부가 따로 거르면 「업무는 우리 팀인데 목표 지표는 전사」
 * 같은 문서가 만들어지고, 그 문서는 섹션마다 모수가 달라 읽을 수 없다.
 *
 * `teams`가 `null`이면 그대로 돌려준다 (머리말 — 어드민·데모).
 *
 * 단계와 이력은 **팀 칸이 없다.** 그래서 남은 업무의 id로 좁힌다 — 팀을 다시 조회해서
 * 붙이면 이 함수가 저장소를 알게 된다.
 */
export function scopeReportInputs(
  teams: readonly TeamKey[] | null,
  input: ReportInputs
): ReportInputs {
  if (teams === null) return input;

  const tasks = input.tasks.filter((task) => teams.includes(task.teamId));
  const ids = new Set(tasks.map((task) => task.id));

  return {
    tasks,
    stages: input.stages.filter((stage) => ids.has(stage.taskId)),
    goals: input.goals.filter((goal) => teams.includes(goal.teamId)),
    // `null`(집계 실패)은 빈 배열로 접지 않는다 — 「못 읽었다」와 「0건」은 다르다
    events: input.events === null ? null : input.events.filter((event) => ids.has(event.taskId)),
  };
}
