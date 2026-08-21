/**
 * 알림 패널(과제 요구 3번, T6 완료 기준 2)이 그릴 **묶음을 만드는 곳**. 판정은 하지 않는다 —
 * 어떤 업무가 왜 알림인지는 `lib/domain/alert-rules.ts`가 이미 정했고, 여기서는 그 결과를
 * 종류별로 접고 순서를 고정할 뿐이다 (`ADR-006`).
 *
 * 세 가지를 못박는다.
 *
 * - **묶음 5개를 항상 낸다.** 0건이라고 숨기면 「그 문제가 없는 것」과 「그 검사를 안 한 것」이
 *   화면에서 같아진다. 특히 `기한 미설정`은 마감일이 없는 업무의 **유일한 노출 경로**다 —
 *   그 업무는 지연 판정에서 조용히 빠지므로 이 줄이 없으면 영영 아무 화면에도 안 뜬다.
 * - **이름은 여기서 붙이지 않는다.** `Alert`에 업무명·담당자가 없는 것은 의도다 — 이 응답이
 *   화면 밖(T10 디스코드 웹훅)으로도 나갈 수 있어서다 (`S6`). 화면이 자기 목록에서 이름을
 *   붙이고, 그래서 **목록에 없는 `taskId`는 걸러 낸다** — 이름을 못 붙이는 항목을
 *   「(알 수 없음)」으로 남기면 클릭할 수 없는 줄이 된다.
 * - **오늘을 인자로 받는다.** 이 파일은 시각을 스스로 읽지 않는다 (`E4`).
 */

import type { Alert, AlertKind } from '@/lib/domain/alert-rules';
import { daysBetween, kstDateOf } from '@/lib/domain/kst-today';
import { formatDday } from '@/lib/view/kpi-format';
import type { TaskResponse } from '@/types/api';

/** `days`를 어떻게 읽을지. `dday`는 남은 일수, `elapsed`는 지나간 일수다 */
type DayMode = 'dday' | 'elapsed' | null;

/**
 * **종류에 대한 결정이 여기 한 줄씩 모여 있다.** 라벨과 일수 해석이 같은 자리에 있어야
 * 「이 줄에 숫자가 붙는가」를 표 하나로 대조할 수 있다.
 *
 * 키 순서가 곧 화면 묶음 순서이며 `alert-rules.ts`의 정렬 순서와 같다 — 알림 목록과 패널이
 * 서로 다른 차례로 늘어서면 같은 화면을 두 번 볼 때 눈이 다시 읽어야 한다.
 *
 * 아이콘을 두지 않는다. 종류는 **한글 라벨로 구분한다** (`UI_GUIDE.md`「아이콘」).
 */
const KINDS: Readonly<Record<AlertKind, { label: string; days: DayMode }>> = {
  due_soon: { label: '마감 임박', days: 'dday' },
  stale: { label: '장기 미갱신', days: 'elapsed' },
  no_owner: { label: '담당자 미지정', days: null },
  no_due_date: { label: '기한 미설정', days: null },
  unknown_owner: { label: '담당자 오타 의심', days: null },
};

/** 화면이 쓰는 한글 라벨. 손으로 적으면 언젠가 한쪽만 고쳐진다 */
export const ALERT_LABELS: Readonly<Record<AlertKind, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(KINDS).map(([kind, entry]) => [kind, entry.label])
  ) as Record<AlertKind, string>
);

/** 묶음 순서. 위 표의 키 순서 그대로다 — 두 번째 정의를 만들지 않는다 */
const GROUP_ORDER = Object.keys(KINDS) as AlertKind[];

export interface AlertGroup {
  kind: AlertKind;
  label: string;
  items: Alert[];
}

/**
 * 항목 옆 한 줄. **종류 이름을 다시 적지 않고** 위 표의 해석만 따른다.
 *
 * 단계 SLA로 뜬 알림에는 그 사실을 덧붙인다 — 태스크 마감과 단계 SLA는 같은 업무에 둘 다
 * 뜰 수 있고, 구분이 없으면 같은 줄이 두 번 찍힌 것으로 읽힌다.
 */
export function alertDetail(alert: Alert): string {
  const mode = KINDS[alert.kind].days;
  if (mode === null || alert.days === null) return '';

  const base = mode === 'dday' ? formatDday(alert.days) : `${alert.days}일 경과`;
  return alert.stageKey === null ? base : `${base} · 단계`;
}

/**
 * 급한 것이 먼저다. `days`의 `null`은 「급한 정도를 잴 수 없다」라 뒤로 보내고, 동률은
 * `taskId`·`stageKey`로 갈라 **입력 순서가 결과를 바꾸지 않게** 한다.
 */
function compareAlerts(left: Alert, right: Alert): number {
  if (left.days !== right.days) {
    if (left.days === null) return 1;
    if (right.days === null) return -1;
    return left.days - right.days;
  }

  if (left.taskId !== right.taskId) return left.taskId < right.taskId ? -1 : 1;

  const leftStage = left.stageKey ?? '';
  const rightStage = right.stageKey ?? '';
  if (leftStage === rightStage) return 0;
  return leftStage < rightStage ? -1 : 1;
}

/** 5묶음을 **항상** 돌려준다. 입력 배열은 고치지 않는다 */
export function groupAlerts(
  alerts: readonly Alert[],
  knownTaskIds: ReadonlySet<string>
): AlertGroup[] {
  const known = alerts.filter((alert) => knownTaskIds.has(alert.taskId));

  return GROUP_ORDER.map((kind) => ({
    kind,
    label: ALERT_LABELS[kind],
    items: known.filter((alert) => alert.kind === kind).sort(compareAlerts),
  }));
}

export interface WaitingItem {
  taskId: string;
  /** 대기 일수. `lastProgressAt`이 없으면 null이고 **뒤로 정렬된다** */
  days: number | null;
}

/**
 * 승인 대기함 (`UC-09`). 「승인 대기」 KPI 타일에 숫자만 있고 목록이 없어서 만든다.
 *
 * 거르는 축은 조회 응답에 이미 실려 온 `flags.semantic`이다 — 화면이 상태 문자열을 다시
 * 해석하지 않는다. **대기 일수만 여기서 잰다** (`daysBetween`).
 */
export function approvalQueue(tasks: readonly TaskResponse[], today: string): WaitingItem[] {
  return tasks
    .filter((task) => task.flags.semantic === 'approval')
    .map((task) => {
      // 타임스탬프를 직접 자르지 않는다. KST 하루가 어긋나면 대기 일수가 통째로 밀린다 (`E4`)
      const since = kstDateOf(task.lastProgressAt);
      return { taskId: task.id, days: since === null ? null : daysBetween(since, today) };
    })
    .sort((left, right) => {
      // 오래 기다린 것이 위로. 「모른다」는 0일과 다른 사실이라 맨 뒤에 둔다
      if (left.days !== right.days) {
        if (left.days === null) return 1;
        if (right.days === null) return -1;
        return right.days - left.days;
      }
      if (left.taskId === right.taskId) return 0;
      return left.taskId < right.taskId ? -1 : 1;
    });
}
