/**
 * `UC-08`("주간 브리핑 생성·복사 → 회의록에 붙여넣기")의 산출물이자 과제 요구 5번의 실체다.
 * 전용 화면은 T9지만 **문자열을 만드는 함수는 여기서 확정한다** — T6가 대시보드 카드로
 * 먼저 노출하기 때문이다.
 *
 * 돌려주는 것은 **마크다운 문자열 하나**다. HTML도 React 엘리먼트도 아니다. 회의록에 그대로
 * 붙여넣는 것이 용도라 표는 GFM 파이프 표를 쓰고 링크·이미지는 넣지 않는다.
 *
 * 규칙 넷.
 * - **집계하지 않고 가져다 쓴다.** `summarizeAllTeams`·`buildKpiStrip`·`summarizeGoals`·
 *   `collectAlerts`·`deriveAllFlags`를 호출한다. 여기서 새 계산식을 만들면 화면 숫자와
 *   보고서 숫자가 갈라지고, 회의 자리에서 그 둘이 다르면 둘 다 못 믿게 된다.
 * - **오늘을 인자로 받는다** (`ctx.today`). 주 범위도 **받는다** — `resolveReportPeriod`가
 *   한 번 정한 값을 넘겨받으므로 API·화면이 같은 주를 본다. 여기서 다시 계산하지 않는다.
 * - **출력이 결정적이다.** 모든 목록에 정렬 기준이 있고 `Map`·`Set` 순회 순서에 기대지
 *   않는다. 같은 입력이 다른 문서를 내면 스냅샷도 회의록도 못 믿는다.
 * - **`extras`·`raw`를 한 값도 싣지 않는다.** 이 문자열은 복사돼 밖으로 나간다. 연락처·
 *   계정·이메일이 거기 있다 (CLAUDE.md 보안 규칙). 담당자 이름은 회의록 용도라 싣는다.
 */

import { collectAlerts, type Alert, type AlertContext } from '@/lib/domain/alert-rules';
import { summarizeGoals, type ComputedGoalMetric } from '@/lib/domain/goal-stats';
import type { ReportPeriod } from '@/lib/domain/report-period';
import {
  buildKpiStrip,
  summarizeAllTeams,
  TEAM_KEYS,
  type KpiTile,
  type TeamSummary,
} from '@/lib/domain/progress-stats';
import { deriveAllFlags, type TaskFlags } from '@/lib/domain/task-derive';
import type { GoalMetric } from '@/types/goal';
import type { Task, TaskEvent, TaskSemantic, TaskStage, TeamKey } from '@/types/task';

/** 표·목록에 쓰는 팀 이름. 가운뎃점은 `·`(U+00B7)로 시트 원문과 같다 */
const TEAM_LABELS: Readonly<Record<TeamKey, string>> = {
  edit: '편집팀',
  shoot: '촬영·기획팀',
  marketing: '마케팅·관리팀',
};

/** 팀 정렬 순서. `TEAM_KEYS` 하나에서 나오므로 표와 목록의 팀 순서가 어긋나지 않는다 */
const TEAM_RANK: ReadonlyMap<TeamKey, number> = new Map(TEAM_KEYS.map((key, index) => [key, index]));

/** 마감을 더 묻지 않는 semantic. `progress-stats`·`task-derive`와 같은 집합이다 */
const TERMINAL_SEMANTICS: readonly TaskSemantic[] = ['done', 'cancelled'];

const EMPTY = '해당 없음';

export interface WeeklyReportInput {
  tasks: readonly Task[];
  stages: readonly TaskStage[];
  goals: readonly GoalMetric[];
  /** 보고 기간. `resolveReportPeriod`가 정한 값을 그대로 받는다 */
  period: ReportPeriod;
  /**
   * 그 기간의 변경 이력. **건수만 쓴다** — `changedFields`를 풀어 쓰지 않는다
   * (`S6`: 이력은 이름만 담고 값을 담지 않으며, 이 문자열은 복사돼 밖으로 나간다).
   *
   * **`null`은 「0건」이 아니라 「이력을 읽지 못했다」다.** 둘을 같게 말하면 회의에서
   * 「이번 주 아무 일도 없었다」로 읽힌다. 빈 배열은 실제로 0건이라는 뜻이다.
   */
  events: readonly TaskEvent[] | null;
  ctx: AlertContext;
}

/**
 * 표 한 칸에 넣을 수 있는 모양으로 접는다. **모든 값이 이 함수를 통과한다.**
 *
 * - 개행은 공백으로 바꾼다. 한 줄이 두 줄이 되면 GFM 표가 그 자리에서 끝난다.
 * - `|`는 이스케이프한다. 업무명에 파이프가 하나만 있어도 칸이 밀린다.
 * - 빈 값은 `-`다. `null`·`undefined`·`NaN`이 문자열에 나오면 안 된다.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';

  const flattened = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  return flattened === '' ? '-' : flattened.replace(/\|/g, '\\|');
}

/** 퍼센트 칸. 모수가 없어 계산되지 않은 것(`null`)과 `0%`는 다르다 */
function percent(value: number | null): string {
  return value === null ? '-' : `${value}%`;
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** 문자열 비교. `localeCompare`는 실행 환경에 따라 결과가 달라져 쓰지 않는다 */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function teamRank(teamKey: TeamKey): number {
  return TEAM_RANK.get(teamKey) ?? TEAM_KEYS.length;
}

function isTerminal(semantic: TaskSemantic | null): boolean {
  return semantic !== null && TERMINAL_SEMANTICS.includes(semantic);
}

/** `D-3`·`D+2`. 마감일이 없으면 일수를 말할 수 없다 */
function ddayLabel(dday: number | null): string {
  if (dday === null) return '기한 미설정';
  return dday < 0 ? `D${dday}` : `D+${dday}`;
}

function kpiValue(tiles: readonly KpiTile[], key: string): number | null {
  return tiles.find((tile) => tile.key === key)?.value ?? null;
}

function countKind(alerts: readonly Alert[], kind: Alert['kind']): number {
  return alerts.filter((alert) => alert.kind === kind).length;
}

/** 섹션 본문이 비면 제목만 남기지 않고 「해당 없음」을 넣는다 */
function section(title: string, body: readonly string[]): string {
  return [`## ${title}`, '', ...(body.length === 0 ? [EMPTY] : body)].join('\n');
}

/** 「0건」과 「집계되지 않음」을 같은 문장으로 말하지 않는다 — 앞은 사실이고 뒤는 결측이다 */
function eventCountLabel(events: readonly TaskEvent[] | null): string {
  return events === null ? '집계되지 않음' : `${events.length}건`;
}

function summarySection(
  tiles: readonly KpiTile[],
  events: readonly TaskEvent[] | null
): string {
  return section('요약', [
    `- 전체 활성 업무: ${cell(kpiValue(tiles, 'active_total'))}건` +
      ` / 완료율: ${percent(kpiValue(tiles, 'completion_rate'))}` +
      ` / 지연: ${cell(kpiValue(tiles, 'overdue'))}건` +
      ` / 마감 임박: ${cell(kpiValue(tiles, 'due_soon'))}건`,
    `- 이번 주 변경: ${eventCountLabel(events)}`,
  ]);
}

function teamSection(summaries: readonly TeamSummary[]): string {
  const header = ['팀', '전체', '진행', '승인 대기', '지연', '완료', '완료율', '가장 가까운 마감'];
  const divider = ['---', '---:', '---:', '---:', '---:', '---:', '---:', '---'];

  return section('팀별 현황', [
    row(header),
    row(divider),
    ...summaries.map((summary) =>
      row([
        cell(TEAM_LABELS[summary.teamKey]),
        cell(summary.total),
        cell(summary.inProgress),
        cell(summary.approvalWaiting),
        cell(summary.overdue),
        cell(summary.done),
        percent(summary.completionRate),
        cell(summary.nearestDueAt),
      ])
    ),
  ]);
}

/** `- [팀] 업무명 — 담당 이름 · …`. 업무명·담당자만 싣고 `extras`는 건드리지 않는다 */
function taskLine(task: Task, tail: readonly string[]): string {
  return `- [${TEAM_LABELS[task.teamId]}] ${cell(task.title)} — 담당 ${cell(task.ownerNameRaw)}${tail
    .map((part) => ` · ${part}`)
    .join('')}`;
}

function overdueSection(tasks: readonly Task[], flags: ReadonlyMap<string, TaskFlags>): string {
  const rows = tasks
    .filter((task) => flags.get(task.id)?.isOverdue === true)
    .map((task) => ({ task, dday: flags.get(task.id)?.dday ?? null }))
    // 급한 것부터. `dday`가 없는 건(시트가 지연이라 표시한 무기한 업무)은 뒤로 보낸다
    .sort((a, b) => {
      if (a.dday !== b.dday) {
        if (a.dday === null) return 1;
        if (b.dday === null) return -1;
        return a.dday - b.dday;
      }
      const rankDiff = teamRank(a.task.teamId) - teamRank(b.task.teamId);
      if (rankDiff !== 0) return rankDiff;
      const titleDiff = compareText(a.task.title ?? '', b.task.title ?? '');
      return titleDiff !== 0 ? titleDiff : compareText(a.task.id, b.task.id);
    });

  const lines = rows.map(({ task, dday }) =>
    taskLine(task, [ddayLabel(dday), `다음 조치: ${cell(task.nextAction)}`])
  );

  return section(`지연 업무 (${lines.length}건)`, lines);
}

/**
 * 이번 주에 마감이 걸린 업무.
 *
 * 거르는 조건은 KPI 「이번 주 마감」칸과 **같다** — 주 범위 안이고 끝나지 않은 건이다.
 * 조건이 갈라지면 요약의 숫자와 목록의 줄 수가 어긋난다.
 */
function dueThisWeekSection(
  tasks: readonly Task[],
  flags: ReadonlyMap<string, TaskFlags>,
  weekStart: string,
  weekEnd: string
): string {
  const rows = tasks
    .filter((task) => {
      if (task.dueAt === null) return false;
      if (task.dueAt < weekStart || task.dueAt > weekEnd) return false;
      return !isTerminal(flags.get(task.id)?.semantic ?? null);
    })
    .sort((a, b) => {
      const dueDiff = compareText(a.dueAt as string, b.dueAt as string);
      if (dueDiff !== 0) return dueDiff;
      const rankDiff = teamRank(a.teamId) - teamRank(b.teamId);
      if (rankDiff !== 0) return rankDiff;
      const titleDiff = compareText(a.title ?? '', b.title ?? '');
      return titleDiff !== 0 ? titleDiff : compareText(a.id, b.id);
    });

  const lines = rows.map((task) => taskLine(task, [cell(task.dueAt)]));

  return section(`이번 주 마감 (${lines.length}건)`, lines);
}

/**
 * 목표 대비 성과 (요구 4번).
 *
 * 표에 싣는 달성률은 `goal-stats`가 `actual / target`으로 **재계산한 값**이다. 시트 값과
 * 어긋난 건이 있으면 표 아래에 건수를 한 줄 남긴다 — 그 불일치가 파서 정확성의 실측
 * 지표이고, 회의에서 「이 숫자 맞아?」가 나오는 자리이기도 하다.
 */
function goalSection(goals: readonly GoalMetric[]): string {
  const { items } = summarizeGoals(goals);

  if (items.length === 0) return section('목표 대비 성과', []);

  const sorted = [...items].sort((a, b) => {
    const rankDiff = teamRank(a.metric.teamId) - teamRank(b.metric.teamId);
    if (rankDiff !== 0) return rankDiff;
    const titleDiff = compareText(a.metric.title ?? '', b.metric.title ?? '');
    return titleDiff !== 0 ? titleDiff : compareText(a.metric.id, b.metric.id);
  });

  const header = ['팀', '과제', 'KPI', '목표', '실적', '달성률'];
  const divider = ['---', '---', '---', '---:', '---:', '---:'];

  const body: string[] = [
    row(header),
    row(divider),
    ...sorted.map((item: ComputedGoalMetric) =>
      row([
        cell(TEAM_LABELS[item.metric.teamId]),
        cell(item.metric.title),
        cell(item.metric.kpiName),
        cell(item.metric.targetValue),
        cell(item.metric.actualValue),
        percent(item.computedRate),
      ])
    ),
  ];

  const mismatch = sorted.filter((item) => item.rateMismatch).length;
  if (mismatch > 0) body.push('', `달성률 불일치 ${mismatch}건`);

  return section('목표 대비 성과', body);
}

/** 알림 4종을 건수로 접는다. 어느 업무인지는 화면(T6)이 알림 패널에서 보여준다 */
function checkSection(alerts: readonly Alert[]): string {
  return section('확인 필요', [
    `- 담당자 미지정 ${countKind(alerts, 'no_owner')}건` +
      ` / 기한 미설정 ${countKind(alerts, 'no_due_date')}건` +
      ` / 장기 미갱신 ${countKind(alerts, 'stale')}건` +
      ` / 담당자 오타 의심 ${countKind(alerts, 'unknown_owner')}건`,
  ]);
}

export function buildWeeklyReport(input: WeeklyReportInput): string {
  const { tasks, stages, goals, period, events, ctx } = input;

  // 한 번 판정해 모든 집계에 같은 플래그를 넘긴다. 섹션마다 다시 판정하면 느린 것보다
  // 갈라지는 것이 문제다
  const flags = ctx.flags ?? deriveAllFlags(tasks, ctx);
  const withFlags: AlertContext = { ...ctx, flags };

  const { weekStart, weekEnd } = period;

  return [
    `# 주간 업무 보고 — ${cell(weekStart)} ~ ${cell(weekEnd)}`,
    '',
    summarySection(buildKpiStrip(tasks, withFlags), events),
    '',
    teamSection(summarizeAllTeams(tasks, withFlags)),
    '',
    overdueSection(tasks, flags),
    '',
    dueThisWeekSection(tasks, flags, weekStart, weekEnd),
    '',
    goalSection(goals),
    '',
    checkSection(collectAlerts(tasks, stages, withFlags)),
    '',
  ].join('\n');
}
