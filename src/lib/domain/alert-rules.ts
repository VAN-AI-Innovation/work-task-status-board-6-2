/**
 * 알림 패널(`UC-12`·`UC-13`)의 내용물. **4종이 완료 기준**이다 (`T4` 완료 기준 6) —
 * 마감 임박 / 장기 미갱신 / 담당자 미지정 / **기한 미설정**.
 *
 * 네 번째가 눈에 안 띄는데, 마감일이 없는 업무는 `isOverdue` 판정에서 조용히 빠지므로
 * 별도 알림이 없으면 **영영 아무 화면에도 안 뜬다** (`PLAN.md`「여정에서 도출된 설계 요구」3번).
 *
 * 네 가지를 지킨다.
 * - **판정을 다시 하지 않는다.** 임박·미갱신·미지정은 `task-derive.ts`의 플래그를 읽기만
 *   한다. 판정이 두 곳에 있으면 갈라지고, 갈라진 쪽이 화면인지 알림인지 아무도 모르게 된다.
 *   이 파일이 더하는 것은 **단계 SLA 경로 하나**뿐이다 — `slaDays`가 `TaskStage`에 붙어
 *   태스크만 보는 `task-derive`가 볼 수 없었던 축이다.
 * - **오늘을 인자로 받는다** (`ctx.today`). 현재 시각을 스스로 읽지 않는다.
 * - **이름·업무명·셀 값을 담지 않는다.** `taskId`만 싣고 화면이 태스크를 다시 조회한다.
 *   민감 키 마스킹은 응답 계층(T5·T6)의 일이고, 알림 객체가 그 통제를 우회하면 안 된다.
 * - **지연(overdue)은 알림이 아니다.** 완료 기준 4종에 없고 KPI·행 강조로 다룬다.
 */

import { daysBetween, kstDateOf } from '@/lib/domain/kst-today';
import { deriveTaskFlags, type DeriveContext, type TaskFlags } from '@/lib/domain/task-derive';
import type { SlaRuleEntry } from '@/types/sheet';
import type { Task, TaskSemantic, TaskStage, TeamKey } from '@/types/task';

export type AlertKind =
  | 'due_soon' // 마감 임박          (완료 기준 6 ①)
  | 'stale' // 장기 미갱신        (완료 기준 6 ②)
  | 'no_owner' // 담당자 미지정      (완료 기준 6 ③)
  | 'no_due_date' // 기한 미설정        (완료 기준 6 ④)
  | 'unknown_owner'; // 구성원 목록에 없는 담당자 (UC-12. 4종에는 포함되지 않는 보조 신호)

/** 정렬의 두 번째 축. 위 선언 순서를 그대로 옮긴 것이고 화면 묶음 순서도 이걸 따른다 */
const KIND_ORDER: readonly AlertKind[] = [
  'due_soon',
  'stale',
  'no_owner',
  'no_due_date',
  'unknown_owner',
];

/** 끝난 업무는 담당자도 기한도 단계도 다시 묻지 않는다. `task-derive.ts`와 같은 집합이다 */
const TERMINAL_SEMANTICS: readonly TaskSemantic[] = ['done', 'cancelled'];

export interface Alert {
  kind: AlertKind;
  taskId: string;
  teamKey: TeamKey;
  severity: 'warn' | 'danger';
  /** `due_soon`이면 남은 일수, `stale`이면 미갱신 일수. 나머지는 null */
  days: number | null;
  /** 단계 SLA 때문에 뜬 알림이면 그 단계의 `stageKey`. 태스크 마감 기준이면 null */
  stageKey: string | null;
}

export interface AlertContext extends DeriveContext {
  /** 미리 계산한 플래그. 없으면 태스크마다 `deriveTaskFlags`로 만든다 */
  flags?: ReadonlyMap<string, TaskFlags>;
  /** 설정 탭 SLA 표. 라벨→일수. **단계에 `slaDays`가 없을 때만** 참고한다 */
  slaRules?: readonly SlaRuleEntry[];
}

/** 이미 지났으면 danger. 「내일까지」와 「어제까지였다」를 같은 색으로 두면 안 된다 */
function severityOf(days: number): Alert['severity'] {
  return days < 0 ? 'danger' : 'warn';
}

/**
 * 단계에 쓸 SLA 일수.
 *
 * `TaskStage.slaDays`는 T3의 `STAGE_GROUPS`가 시트 그룹 헤더의 `(+N일)`에서 이미 넣어뒀다.
 * 그 값이 있으면 그것을 쓰고, 없을 때만 설정 탭 표에서 찾는다. `SlaRuleEntry`에는
 * `stageKey`가 없어서(T2의 결정) 잇는 축이 라벨뿐이고, **정확히 일치**만 인정한다 —
 * 부분 일치를 쓰면 `편집팀 컨셉 공유`와 `편집팀 컨셉 승인`이 섞여 엉뚱한 일수가 붙는다.
 */
function slaDaysOf(stage: TaskStage, slaRules: readonly SlaRuleEntry[]): number | null {
  if (stage.slaDays !== null) return stage.slaDays;

  const label = stage.stageLabel.trim();
  return slaRules.find((rule) => rule.label.trim() === label)?.days ?? null;
}

export function collectAlerts(
  tasks: readonly Task[],
  stages: readonly TaskStage[],
  ctx: AlertContext
): Alert[] {
  const alerts: Alert[] = [];
  const byId = new Map<string, { task: Task; flags: TaskFlags; isTerminal: boolean }>();

  for (const task of tasks) {
    const flags = ctx.flags?.get(task.id) ?? deriveTaskFlags(task, ctx);
    const isTerminal = flags.semantic !== null && TERMINAL_SEMANTICS.includes(flags.semantic);
    byId.set(task.id, { task, flags, isTerminal });

    const push = (kind: AlertKind, days: number | null, stageKey: string | null): void => {
      alerts.push({
        kind,
        taskId: task.id,
        teamKey: task.teamId,
        severity: days === null ? 'warn' : severityOf(days),
        days,
        stageKey,
      });
    };

    // 태스크 마감 기준 임박. 단계 경로와 접지 않는다 — 둘은 다른 사실을 말한다
    if (flags.isDueSoon) push('due_soon', flags.dday, null);

    if (flags.isStale) {
      // `isStale`이 참이면 `lastProgressAt`이 있다는 뜻이다. 그래도 타임스탬프를 직접 자르지
      // 않고 `kstDateOf`로 KST 날짜를 얻는다 — `task-derive`와 하루가 어긋나면 안 된다
      const lastDate = kstDateOf(task.lastProgressAt);
      push('stale', lastDate === null ? null : daysBetween(lastDate, ctx.today), null);
    }

    // 끝난 업무의 담당자를 지금 찾을 이유가 없다
    if (!isTerminal && flags.hasNoOwner) push('no_owner', null, null);
    // `hasNoDueDate`는 이미 종결 건을 뺀다. 대칭을 눈에 보이게 두려고 조건을 다시 적지 않았다
    if (flags.hasNoDueDate) push('no_due_date', null, null);
    if (!isTerminal && flags.hasUnknownOwner) push('unknown_owner', null, null);
  }

  const slaRules = ctx.slaRules ?? [];

  for (const stage of stages) {
    const parent = byId.get(stage.taskId);
    // 목록에 없는 태스크의 단계는 소속도 종결 여부도 알 수 없다. 조용히 건너뛴다
    if (parent === undefined || parent.isTerminal) continue;
    // 실제일이 찼으면 끝난 단계다. 예정일이 없으면 잴 기준이 없다
    if (stage.actualDate !== null || stage.plannedDate === null) continue;

    const slaDays = slaDaysOf(stage, slaRules);
    if (slaDays === null) continue;

    const remaining = daysBetween(ctx.today, stage.plannedDate);
    if (remaining === null || remaining > slaDays) continue;

    alerts.push({
      kind: 'due_soon',
      taskId: stage.taskId,
      teamKey: parent.task.teamId,
      severity: severityOf(remaining),
      days: remaining,
      stageKey: stage.stageKey,
    });
  }

  return sortAlerts(alerts);
}

/**
 * 정렬은 결정적이어야 한다. 입력 순서가 결과를 바꾸면 화면이 새로고침마다 흔들리고
 * 테스트도 못 쓴다. `days`의 null은 「급한 정도를 잴 수 없다」라 뒤로 보낸다.
 */
function sortAlerts(alerts: Alert[]): Alert[] {
  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'danger' ? -1 : 1;

    const kindDiff = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (kindDiff !== 0) return kindDiff;

    if (a.days !== b.days) {
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    }

    if (a.taskId !== b.taskId) return a.taskId < b.taskId ? -1 : 1;
    return (a.stageKey ?? '').localeCompare(b.stageKey ?? '');
  });
}
