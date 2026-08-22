import { describe, expect, it } from 'vitest';

import type { Alert, AlertKind } from '@/lib/domain/alert-rules';
import {
  ALERT_LABELS,
  alertDetail,
  approvalQueue,
  groupAlerts,
  type AlertGroup,
} from '@/lib/view/alert-groups';
import type { TaskResponse } from '@/types/api';
import type { TaskSemantic } from '@/types/task';

function alert(overrides: Partial<Alert> & { kind: AlertKind; taskId: string }): Alert {
  return {
    teamKey: 'edit',
    severity: 'warn',
    days: null,
    stageKey: null,
    ...overrides,
  };
}

function task(
  overrides: Partial<TaskResponse> & { id: string } & {
    semantic?: TaskSemantic | null;
    lastProgressAt?: string | null;
  }
): TaskResponse {
  const { semantic = 'approval', ...rest } = overrides;

  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: rest.id,
    title: rest.id,
    ownerMemberId: null,
    ownerNameRaw: null,
    coOwnerNames: [],
    status: null,
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: null,
    assignedAt: null,
    dueAt: null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 1,
    flags: {
      semantic,
      dday: null,
      isOverdue: false,
      isDueSoon: false,
      isStale: false,
      hasNoOwner: false,
      hasUnknownOwner: false,
      hasNoDueDate: false,
    },
    displayStatus: 'planned',
    statusLabel: '예정',
    ...rest,
  } as TaskResponse;
}

const KINDS = Object.keys(ALERT_LABELS) as AlertKind[];

describe('ALERT_LABELS', () => {
  /**
   * **4종 + 보조 1종이 완료 기준이다** (T6 완료 기준 2). 네 번째(`no_due_date`)가 특히
   * 빠지기 쉬운데, 마감일이 없는 업무는 지연 판정에서 조용히 빠져 이 알림이 유일한 노출
   * 경로다. 표가 줄어들면 여기서 먼저 깨진다.
   */
  it('다섯 종류를 전부 덮고 한글 라벨이 서로 다르다', () => {
    expect(KINDS).toEqual(['due_soon', 'stale', 'no_owner', 'no_due_date', 'unknown_owner']);
    expect(ALERT_LABELS.no_due_date).toBe('기한 미설정');
    expect(new Set(Object.values(ALERT_LABELS)).size).toBe(5);
  });
});

describe('groupAlerts', () => {
  /**
   * **0건인 묶음도 남는다.** 묶음이 사라지면 「그 문제가 없는 것」과 「그 검사를 안 한 것」이
   * 화면에서 같아진다.
   */
  it('빈 입력이어도 5묶음을 순서 그대로 낸다', () => {
    const groups = groupAlerts([], new Set());

    expect(groups.map((group) => group.kind)).toEqual(KINDS);
    expect(groups.map((group) => group.label)).toEqual(KINDS.map((kind) => ALERT_LABELS[kind]));
    expect(groups.every((group: AlertGroup) => group.items.length === 0)).toBe(true);
  });

  /**
   * 이름은 화면이 자기 목록에서 붙인다 (`S6` — `Alert`에는 업무명이 없다). 목록에 없는
   * `taskId`를 남기면 「(알 수 없음)」이라는 클릭 못 하는 줄이 생긴다.
   */
  it('목록에 없는 taskId는 걸러 낸다', () => {
    const groups = groupAlerts(
      [alert({ kind: 'no_owner', taskId: 'a' }), alert({ kind: 'no_owner', taskId: 'ghost' })],
      new Set(['a'])
    );

    expect(groups[2].items.map((item) => item.taskId)).toEqual(['a']);
  });

  it('묶음 안은 `days` 오름차순이고 null이 뒤로 간다 — 급한 것이 먼저다', () => {
    const groups = groupAlerts(
      [
        alert({ kind: 'due_soon', taskId: 'c', days: null }),
        alert({ kind: 'due_soon', taskId: 'b', days: 2 }),
        alert({ kind: 'due_soon', taskId: 'a', days: -3 }),
      ],
      new Set(['a', 'b', 'c'])
    );

    expect(groups[0].items.map((item) => item.taskId)).toEqual(['a', 'b', 'c']);
  });

  it('동률은 taskId·stageKey로 갈린다 — 입력 순서가 결과를 바꾸지 않는다', () => {
    const items = [
      alert({ kind: 'due_soon', taskId: 'b', days: 1 }),
      alert({ kind: 'due_soon', taskId: 'a', days: 1, stageKey: 'z' }),
      alert({ kind: 'due_soon', taskId: 'a', days: 1, stageKey: null }),
    ];

    const forward = groupAlerts(items, new Set(['a', 'b']));
    const reversed = groupAlerts([...items].reverse(), new Set(['a', 'b']));

    expect(forward[0].items).toEqual(reversed[0].items);
    expect(forward[0].items.map((item) => [item.taskId, item.stageKey])).toEqual([
      ['a', null],
      ['a', 'z'],
      ['b', null],
    ]);
  });

  it('입력을 고치지 않는다', () => {
    const items = [
      alert({ kind: 'stale', taskId: 'b', days: 9 }),
      alert({ kind: 'stale', taskId: 'a', days: 1 }),
    ];
    const snapshot = JSON.stringify(items);

    groupAlerts(items, new Set(['a', 'b']));

    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('alertDetail', () => {
  it('마감 임박은 D-표기, 장기 미갱신은 경과 일수다', () => {
    expect(alertDetail(alert({ kind: 'due_soon', taskId: 'a', days: 2 }))).toBe('D-2');
    expect(alertDetail(alert({ kind: 'due_soon', taskId: 'a', days: -1 }))).toBe('D+1');
    expect(alertDetail(alert({ kind: 'stale', taskId: 'a', days: 9 }))).toBe('9일 경과');
  });

  it('일수가 없는 종류는 빈 문자열이다', () => {
    expect(alertDetail(alert({ kind: 'no_owner', taskId: 'a' }))).toBe('');
    expect(alertDetail(alert({ kind: 'no_due_date', taskId: 'a' }))).toBe('');
    expect(alertDetail(alert({ kind: 'unknown_owner', taskId: 'a' }))).toBe('');
  });

  /** 태스크 마감과 단계 SLA는 같은 업무에 둘 다 뜬다. 구분이 없으면 중복으로 읽힌다 */
  it('단계 SLA로 뜬 알림은 그 사실을 덧붙인다', () => {
    expect(alertDetail(alert({ kind: 'due_soon', taskId: 'a', days: 1, stageKey: 'concept' }))).toBe(
      'D-1 · 단계'
    );
  });
});

describe('approvalQueue', () => {
  it('승인 대기 건만 남고 대기 일수가 내림차순이다', () => {
    const items = approvalQueue(
      [
        task({ id: 'a', lastProgressAt: '2026-08-18T01:00:00.000Z' }),
        task({ id: 'b', lastProgressAt: '2026-08-10T01:00:00.000Z' }),
        task({ id: 'c', semantic: 'in_progress', lastProgressAt: '2026-08-01T01:00:00.000Z' }),
      ],
      '2026-08-22'
    );

    expect(items.map((item) => item.taskId)).toEqual(['b', 'a']);
    expect(items.map((item) => item.days)).toEqual([12, 4]);
  });

  /** 「모른다」를 「0일 대기」로 접으면 방금 올라온 건과 같아진다 */
  it('lastProgressAt이 없으면 days가 null이고 뒤로 간다', () => {
    const items = approvalQueue(
      [
        task({ id: 'a', lastProgressAt: null }),
        task({ id: 'b', lastProgressAt: '2026-08-21T01:00:00.000Z' }),
      ],
      '2026-08-22'
    );

    expect(items.map((item) => item.taskId)).toEqual(['b', 'a']);
    expect(items[1].days).toBeNull();
  });

  it('동률은 taskId로 갈리고 입력을 고치지 않는다', () => {
    const tasks = [
      task({ id: 'b', lastProgressAt: '2026-08-20T01:00:00.000Z' }),
      task({ id: 'a', lastProgressAt: '2026-08-20T01:00:00.000Z' }),
    ];
    const snapshot = tasks.map((item) => item.id);

    expect(approvalQueue(tasks, '2026-08-22').map((item) => item.taskId)).toEqual(['a', 'b']);
    expect(tasks.map((item) => item.id)).toEqual(snapshot);
  });

  it('승인 대기가 없으면 빈 배열이다', () => {
    expect(approvalQueue([task({ id: 'a', semantic: 'done' })], '2026-08-22')).toEqual([]);
  });
});
