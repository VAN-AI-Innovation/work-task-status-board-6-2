/**
 * 통합 대시보드(`UC-07`)의 숫자를 만드는 곳. **집계는 SQL이 아니라 여기 순수 함수다**
 * (CLAUDE.md CRITICAL, `ADR-006`) — memory·supabase 두 구현의 결과가 갈라지면 안 되기 때문이고,
 * 조직 전체가 수백~수천 행 규모라 SQL 집계의 성능 이점도 없다.
 *
 * 네 가지를 지킨다.
 * - **오늘을 인자로 받는다** (`ctx.today`). 이 파일은 현재 시각을 스스로 읽지 않는다.
 * - **지연·임박을 다시 판정하지 않는다.** `task-derive.ts`의 플래그를 센다. 판정이 두 곳에
 *   있으면 언젠가 갈라지고, 갈라진 쪽이 화면인지 표인지 아무도 모르게 된다.
 * - **편 가르기를 `display-status.ts`와 맞춘다.** `rework`는 진행 쪽, `pending_release`는
 *   완료 쪽이다. 5색과 표 숫자가 어긋나면 둘 중 하나는 거짓말이 된다.
 * - **KPI 10종은 발명하지 않는다.** 시트 `00_통합 대시보드` 5행에 이미 있는 10칸을 그대로
 *   옮긴다. 시트 수식은 일부가 `#REF!`로 깨져 있어 믿지 않고, 태스크에서 다시 센다.
 *   시트 값과의 대조는 화면(T6)이 한다.
 */

import { endOfWeek, startOfWeek } from '@/lib/domain/kst-today';
import { deriveTaskFlags, type DeriveContext, type TaskFlags } from '@/lib/domain/task-derive';
import type { Task, TaskSemantic, TeamKey } from '@/types/task';

/**
 * 팀 순회 순서. 팀별 요약표 행과 KPI 2~4번이 **이 배열 하나로** 정해진다.
 * 팀마다 `if`를 쓰기 시작하면 팀이 늘 때 고칠 곳이 흩어진다.
 */
export const TEAM_KEYS: readonly TeamKey[] = ['edit', 'shoot', 'marketing'];

/** 완료 쪽으로 세는 semantic. `display-status.ts`의 `done` 칸과 같은 편이다 */
const DONE_SEMANTICS: readonly TaskSemantic[] = ['done', 'pending_release'];

/** 진행 쪽으로 세는 semantic. `display-status.ts`의 `in_progress` 칸과 같은 편이다 */
const IN_PROGRESS_SEMANTICS: readonly TaskSemantic[] = ['in_progress', 'rework'];

/** 마감을 더 묻지 않는 semantic. `task-derive.ts`의 종결 판정과 같은 집합이다 */
const TERMINAL_SEMANTICS: readonly TaskSemantic[] = ['done', 'cancelled'];

export interface StatsContext extends DeriveContext {
  /** 미리 계산한 플래그. 없으면 내부에서 태스크마다 `deriveTaskFlags`로 만든다 */
  flags?: ReadonlyMap<string, TaskFlags>;
}

export interface TeamSummary {
  teamKey: TeamKey;
  /** 취소 포함 전체 행 수 */
  total: number;
  /** `done`·`cancelled` 어느 쪽도 아닌 건 */
  active: number;
  /** semantic `in_progress`·`rework` */
  inProgress: number;
  /** semantic `approval` */
  approvalWaiting: number;
  /** semantic `review` */
  reviewWaiting: number;
  /** semantic `done`·`pending_release` */
  done: number;
  cancelled: number;
  overdue: number;
  dueSoon: number;
  /** `done / (total - cancelled)`를 0~100 정수로. 모수가 0이면 **null** */
  completionRate: number | null;
  /** `overdue / (total - cancelled)`를 0~100 정수로. 모수가 0이면 null */
  delayRate: number | null;
  /** `progress`가 null인 행을 **제외한** 평균. 대상이 0건이면 null */
  avgProgress: number | null;
  /** 아직 안 지난 것 중 가장 이른 `dueAt`. 없으면 null */
  nearestDueAt: string | null;
}

export interface KpiTile {
  key: string;
  /** 시트 `00_통합 대시보드` 5행의 라벨 원문 */
  label: string;
  value: number | null;
  unit: 'count' | 'percent';
}

/** 미리 받은 플래그가 있으면 그것을, 없으면 그 자리에서 판정한다 */
function flagsOf(task: Task, ctx: StatsContext): TaskFlags {
  return ctx.flags?.get(task.id) ?? deriveTaskFlags(task, ctx);
}

/** 0~100 정수 비율. 모수가 0이면 null — "0%"와 "셀 것이 없음"은 다르다 */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;

  return Math.round((numerator / denominator) * 100);
}

function isTerminal(semantic: TaskSemantic | null): boolean {
  return semantic !== null && TERMINAL_SEMANTICS.includes(semantic);
}

/**
 * 아직 남아 있는 마감인가. `YYYY-MM-DD`는 사전순이 곧 시간순이라 문자열 비교로 충분하다.
 * 오늘 마감은 아직 지나지 않았으므로 포함한다.
 */
function isOpenDue(task: Task, semantic: TaskSemantic | null, today: string): boolean {
  return task.dueAt !== null && task.dueAt >= today && !isTerminal(semantic);
}

/**
 * **넘겨받은 배열만** 센다. 팀으로 거르는 것은 `summarizeAllTeams`의 일이다.
 * `teamKey`를 데이터에서 추론하지 않고 인자로 받는 이유는 **빈 팀도 표에 0으로 나와야** 하기
 * 때문이다 — 태스크가 하나도 없으면 추론할 근거가 없다.
 */
export function summarizeTeam(
  tasks: readonly Task[],
  ctx: StatsContext,
  teamKey: TeamKey
): TeamSummary {
  let inProgress = 0;
  let approvalWaiting = 0;
  let reviewWaiting = 0;
  let done = 0;
  let cancelled = 0;
  let overdue = 0;
  let dueSoon = 0;
  let progressSum = 0;
  let progressCount = 0;
  let nearestDueAt: string | null = null;

  for (const task of tasks) {
    const flags = flagsOf(task, ctx);
    const semantic = flags.semantic;

    if (semantic !== null && IN_PROGRESS_SEMANTICS.includes(semantic)) inProgress += 1;
    if (semantic === 'approval') approvalWaiting += 1;
    if (semantic === 'review') reviewWaiting += 1;
    if (semantic !== null && DONE_SEMANTICS.includes(semantic)) done += 1;
    if (semantic === 'cancelled') cancelled += 1;

    if (flags.isOverdue) overdue += 1;
    if (flags.isDueSoon) dueSoon += 1;

    // 미입력(null)은 빼고 0은 넣는다. 0으로 치면 미입력이 많은 팀의 진행률이 바닥으로 끌린다
    if (task.progress !== null) {
      progressSum += task.progress;
      progressCount += 1;
    }

    if (isOpenDue(task, semantic, ctx.today)) {
      const dueAt = task.dueAt as string;
      if (nearestDueAt === null || dueAt < nearestDueAt) nearestDueAt = dueAt;
    }
  }

  const total = tasks.length;
  // 취소를 모수에 넣으면 완료율이 영구히 100%에 못 미친다 (`T4` 완료 기준 3)
  const denominator = total - cancelled;

  return {
    teamKey,
    total,
    active: total - done - cancelled,
    inProgress,
    approvalWaiting,
    reviewWaiting,
    done,
    cancelled,
    overdue,
    dueSoon,
    completionRate: ratio(done, denominator),
    delayRate: ratio(overdue, denominator),
    avgProgress: progressCount === 0 ? null : Math.round(progressSum / progressCount),
    nearestDueAt,
  };
}

/** 팀마다 한 행. **태스크가 하나도 없는 팀도 행으로 나온다** */
export function summarizeAllTeams(tasks: readonly Task[], ctx: StatsContext): TeamSummary[] {
  return TEAM_KEYS.map((teamKey) =>
    summarizeTeam(
      tasks.filter((task) => task.teamId === teamKey),
      ctx,
      teamKey
    )
  );
}

/** KPI 2~4번 라벨. `촬영·기획팀`의 가운뎃점은 `·`(U+00B7)이다 — 시트 원문 그대로다 */
const TEAM_KPI: Readonly<Record<TeamKey, { key: string; label: string }>> = {
  edit: { key: 'edit_active', label: '편집팀 진행' },
  shoot: { key: 'shoot_active', label: '촬영·기획팀 진행' },
  marketing: { key: 'marketing_active', label: '마케팅·관리팀 진행' },
};

/**
 * 시트 `00_통합 대시보드` 5행의 10칸. **순서와 개수를 바꾸지 마라** —
 * 화면이 `grid-cols-5` 2행으로 그리고(`UI_GUIDE.md`), 시트와의 1:1 대응이 이 표의 근거다.
 */
export function buildKpiStrip(tasks: readonly Task[], ctx: StatsContext): KpiTile[] {
  const summaries = summarizeAllTeams(tasks, ctx);
  const byTeam = new Map(summaries.map((summary) => [summary.teamKey, summary]));

  const sum = (pick: (summary: TeamSummary) => number): number =>
    summaries.reduce((acc, summary) => acc + pick(summary), 0);

  const weekStart = startOfWeek(ctx.today);
  const weekEnd = endOfWeek(ctx.today);

  let rework = 0;
  let dueThisWeek = 0;

  for (const task of tasks) {
    const semantic = flagsOf(task, ctx).semantic;

    // 시트 수식은 `COUNTIFS(..., "수정 중")`으로 원문을 세지만 우리는 semantic `rework`를 센다.
    // 같은 것이다 — 시트에서 이름이 바뀌어도 매핑표만 고치면 이 칸은 그대로 맞는다 (`ADR-009`)
    if (semantic === 'rework') rework += 1;

    if (
      task.dueAt !== null &&
      weekStart !== null &&
      weekEnd !== null &&
      task.dueAt >= weekStart &&
      task.dueAt <= weekEnd &&
      !isTerminal(semantic)
    ) {
      dueThisWeek += 1;
    }
  }

  const doneTotal = sum((summary) => summary.done);
  const cancelledTotal = sum((summary) => summary.cancelled);

  return [
    { key: 'active_total', label: '전체 활성 업무', value: sum((s) => s.active), unit: 'count' },
    ...TEAM_KEYS.map((teamKey): KpiTile => {
      const { key, label } = TEAM_KPI[teamKey];
      return { key, label, value: byTeam.get(teamKey)?.active ?? 0, unit: 'count' };
    }),
    {
      key: 'approval_waiting',
      label: '승인 대기',
      value: sum((s) => s.approvalWaiting),
      unit: 'count',
    },
    { key: 'rework', label: '수정 요청', value: rework, unit: 'count' },
    { key: 'due_this_week', label: '이번 주 마감', value: dueThisWeek, unit: 'count' },
    { key: 'due_soon', label: '마감 임박', value: sum((s) => s.dueSoon), unit: 'count' },
    { key: 'overdue', label: '지연', value: sum((s) => s.overdue), unit: 'count' },
    {
      key: 'completion_rate',
      label: '전체 완료율',
      value: ratio(doneTotal, tasks.length - cancelledTotal),
      unit: 'percent',
    },
  ];
}
