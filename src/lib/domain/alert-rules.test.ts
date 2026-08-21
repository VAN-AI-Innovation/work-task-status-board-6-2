/**
 * 이 파일이 지키는 축은 넷이다.
 *
 * 1. **4종이 전부 나오는가.** 마감 임박·장기 미갱신·담당자 미지정·**기한 미설정**
 *    (`T4` 완료 기준 6). 네 번째는 여정을 그려보고 추가된 항목이라 빠지기 쉽다 —
 *    마감일이 없는 업무는 지연 판정에서 조용히 빠져 별도 알림이 없으면 영영 안 보인다.
 * 2. **판정을 다시 구현하지 않았는가.** 임박·미갱신·미지정은 `task-derive.ts`의 플래그를
 *    읽기만 한다. 여기서 다시 세면 화면과 알림이 갈라진다.
 * 3. **단계 SLA가 정확히 매칭되는가.** `편집팀 컨셉 공유`와 `편집팀 컨셉 승인`이 섞이면
 *    엉뚱한 일수로 알림이 뜬다.
 * 4. **알림에 이름·업무명이 새지 않는가.** 알림 객체는 `taskId`만 들고, 마스킹은
 *    응답 계층(T5·T6)이 한다. 알림이 그 통제를 우회하면 안 된다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { collectAlerts, type AlertContext } from '@/lib/domain/alert-rules';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { SettingsRegistry } from '@/types/sheet';
import type { ParsedTask, Task, TaskStage } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
/** 2026-07-25는 **토요일**이다 — step 3·4와 같은 기준일을 쓴다 */
const TODAY = '2026-07-25';

let registry: SettingsRegistry;
let fixtureTasks: Task[];
let fixtureStages: TaskStage[];

/** `ParsedTask`를 저장 모델로 옮긴다. T5 커밋 이전이라 신원·감사 필드는 비어 있다 */
function toTask(parsed: ParsedTask, index: number): Task {
  return {
    id: `task-${index}`,
    teamId: parsed.teamKey,
    departmentId: null,
    sourceKey: parsed.sourceKey,
    title: parsed.title,
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    coOwnerNames: parsed.coOwnerNames,
    status: parsed.status,
    approvalStatus: parsed.approvalStatus,
    priority: parsed.priority,
    riskStatus: parsed.riskStatus,
    progress: parsed.progress,
    assignedAt: parsed.assignedAt,
    dueAt: parsed.dueAt,
    nextAction: parsed.nextAction,
    nextActionOwner: parsed.nextActionOwner,
    nextActionDue: parsed.nextActionDue,
    delayReason: parsed.delayReason,
    note: parsed.note,
    extras: parsed.extras,
    raw: parsed.raw,
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: parsed.sourceSheetTab,
    sourceRowIndex: parsed.sourceRowIndex,
  };
}

let seq = 0;

function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    teamId: 'edit',
    departmentId: null,
    sourceKey: `k${seq}`,
    title: null,
    ownerMemberId: null,
    ownerNameRaw: '담당자1',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: null,
    assignedAt: null,
    dueAt: '2026-09-30',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 10,
    ...overrides,
  };
}

let stageSeq = 0;

function stage(taskId: string, overrides: Partial<TaskStage> = {}): TaskStage {
  stageSeq += 1;
  return {
    id: `s${stageSeq}`,
    taskId,
    seq: 0,
    stageKey: 'concept',
    stageLabel: '컨셉·레퍼런스 (+2일)',
    plannedDate: null,
    actualDate: null,
    content: null,
    confirmStatus: null,
    slaDays: null,
    ...overrides,
  };
}

function ctx(overrides: Partial<AlertContext> = {}): AlertContext {
  return { today: TODAY, semanticIndex: buildSemanticIndex(registry), ...overrides };
}

beforeAll(async () => {
  const parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  expect(parsed.settings).not.toBeNull();
  registry = parsed.settings as SettingsRegistry;

  const tasks = parsed.tabs.flatMap((tab) => tab.tasks);
  fixtureTasks = tasks.map(toTask);
  fixtureStages = tasks.flatMap((parsedTask, index) =>
    parsedTask.stages.map((parsedStage) => ({
      id: `task-${index}-stage-${parsedStage.seq}`,
      taskId: `task-${index}`,
      ...parsedStage,
    }))
  );
});

describe('알림 4종 (T4 완료 기준 6)', () => {
  it('마감 임박 · 장기 미갱신 · 담당자 미지정 · 기한 미설정이 각각 나온다', () => {
    const tasks = [
      task({ id: 'a', dueAt: '2026-07-27' }), // D-2 → 마감 임박
      task({ id: 'b', lastProgressAt: '2026-07-01T00:00:00Z' }), // 24일 미갱신 → 장기 미갱신
      task({ id: 'c', ownerNameRaw: '미정' }), // 담당자 미지정
      task({ id: 'd', dueAt: null }), // 기한 미설정
    ];

    const kinds = new Set(collectAlerts(tasks, [], ctx()).map((alert) => alert.kind));

    expect(kinds).toEqual(new Set(['due_soon', 'stale', 'no_owner', 'no_due_date']));
  });

  it('알림에 taskId·teamKey가 실린다', () => {
    const alerts = collectAlerts([task({ id: 'x', teamId: 'marketing', dueAt: null })], [], ctx());

    expect(alerts).toEqual([
      { kind: 'no_due_date', taskId: 'x', teamKey: 'marketing', severity: 'warn', days: null, stageKey: null },
    ]);
  });

  it('구성원 목록에 없는 담당자는 unknown_owner로 나온다 (UC-12)', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', ownerNameRaw: '없는사람' })],
      [],
      ctx({ knownOwners: ['담당자1', '담당자2'] })
    );

    expect(alerts.map((alert) => alert.kind)).toEqual(['unknown_owner']);
  });
});

describe('끝난 업무는 다시 묻지 않는다', () => {
  it('완료 건은 no_owner·no_due_date·unknown_owner를 만들지 않는다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', status: '완료', ownerNameRaw: '미정', dueAt: null })],
      [],
      ctx({ knownOwners: ['담당자1'] })
    );

    expect(alerts).toEqual([]);
  });

  it('취소 건도 마찬가지다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', status: '취소', ownerNameRaw: null, dueAt: null })],
      [],
      ctx()
    );

    expect(alerts).toEqual([]);
  });
});

describe('stale — 미갱신 일수', () => {
  it('days가 실제 미갱신 일수와 같다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', lastProgressAt: '2026-07-05T09:00:00+09:00' })],
      [],
      ctx()
    );

    // 2026-07-05 → 2026-07-25 = 20일
    expect(alerts).toEqual([
      { kind: 'stale', taskId: 'x', teamKey: 'edit', severity: 'warn', days: 20, stageKey: null },
    ]);
  });
});

describe('단계 SLA 경로', () => {
  it('slaDays 2 · 예정일이 내일 · 실제일 없음이면 due_soon 1건이고 stageKey가 그 단계다', () => {
    const parent = task({ id: 'x' });
    const alerts = collectAlerts(
      [parent],
      [stage('x', { stageKey: 'production', slaDays: 2, plannedDate: '2026-07-26' })],
      ctx()
    );

    expect(alerts).toEqual([
      { kind: 'due_soon', taskId: 'x', teamKey: 'edit', severity: 'warn', days: 1, stageKey: 'production' },
    ]);
  });

  it('actualDate가 채워진 단계는 알림을 만들지 않는다 (이미 끝난 단계)', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { slaDays: 2, plannedDate: '2026-07-26', actualDate: '2026-07-24' })],
      ctx()
    );

    expect(alerts).toEqual([]);
  });

  it('plannedDate가 없으면 알림을 만들지 않는다', () => {
    const alerts = collectAlerts([task({ id: 'x' })], [stage('x', { slaDays: 2 })], ctx());

    expect(alerts).toEqual([]);
  });

  it('예정일이 어제면 severity가 danger이고 days가 -1이다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { slaDays: 2, plannedDate: '2026-07-24' })],
      ctx()
    );

    expect(alerts).toEqual([
      { kind: 'due_soon', taskId: 'x', teamKey: 'edit', severity: 'danger', days: -1, stageKey: 'concept' },
    ]);
  });

  it('SLA 밖(예정일이 멀리 있음)이면 알림이 없다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { slaDays: 2, plannedDate: '2026-09-01' })],
      ctx()
    );

    expect(alerts).toEqual([]);
  });

  it('소속 태스크가 취소면 단계 알림도 안 나온다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', status: '취소' })],
      [stage('x', { slaDays: 2, plannedDate: '2026-07-26' })],
      ctx()
    );

    expect(alerts).toEqual([]);
  });

  it('태스크 목록에 없는 단계는 무시한다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('없는태스크', { slaDays: 2, plannedDate: '2026-07-26' })],
      ctx()
    );

    expect(alerts).toEqual([]);
  });
});

describe('SLA 라벨 매칭', () => {
  it('단계에 slaDays가 없으면 slaRules에서 stageLabel과 같은 라벨의 일수를 쓴다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { stageLabel: '편집팀 컨셉 공유', slaDays: null, plannedDate: '2026-07-26' })],
      ctx({
        slaRules: [
          { label: '편집팀 컨셉 승인', days: 10 },
          { label: '편집팀 컨셉 공유', days: 1 },
        ],
      })
    );

    // 정확히 일치하는 `공유`(1일)를 썼다면 D-1은 SLA 안이라 알림이 뜬다
    expect(alerts.map((alert) => [alert.kind, alert.days])).toEqual([['due_soon', 1]]);
  });

  it('비슷한 라벨이 있어도 정확히 일치하는 것만 쓴다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { stageLabel: '편집팀 컨셉 공유', slaDays: null, plannedDate: '2026-07-30' })],
      ctx({
        slaRules: [
          { label: '편집팀 컨셉 승인', days: 10 },
          { label: '편집팀 컨셉 공유', days: 1 },
        ],
      })
    );

    // `승인`(10일)을 잘못 집었다면 D-5가 SLA 안에 들어 알림이 떴을 것이다
    expect(alerts).toEqual([]);
  });

  it('단계에 slaDays가 있으면 slaRules보다 그 값을 쓴다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { stageLabel: '편집팀 컨셉 공유', slaDays: 1, plannedDate: '2026-07-30' })],
      ctx({ slaRules: [{ label: '편집팀 컨셉 공유', days: 10 }] })
    );

    expect(alerts).toEqual([]);
  });

  it('slaDays도 slaRules 매칭도 없으면 단계 알림을 만들지 않는다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x' })],
      [stage('x', { slaDays: null, plannedDate: '2026-07-26' })],
      ctx({ slaRules: [{ label: '다른 단계', days: 5 }] })
    );

    expect(alerts).toEqual([]);
  });
});

describe('접지 않는다', () => {
  it('같은 태스크에서 태스크 경로와 단계 경로 알림이 둘 다 나온다', () => {
    const alerts = collectAlerts(
      [task({ id: 'x', dueAt: '2026-07-27' })],
      [stage('x', { slaDays: 2, plannedDate: '2026-07-26' })],
      ctx()
    );

    expect(alerts.map((alert) => [alert.kind, alert.stageKey, alert.days])).toEqual([
      ['due_soon', 'concept', 1],
      ['due_soon', null, 2],
    ]);
  });
});

describe('개인정보', () => {
  it('알림 객체에 업무명·담당자 문자열이 없다', () => {
    const alerts = collectAlerts(
      [
        task({ id: 'x', title: '[샘플] 카드뉴스 A', ownerNameRaw: '없는사람', dueAt: null }),
        task({ id: 'y', title: '기밀 프로젝트', ownerNameRaw: '미정', dueAt: '2026-07-26' }),
      ],
      [],
      ctx({ knownOwners: ['담당자1'] })
    );

    const serialized = JSON.stringify(alerts);
    expect(serialized).not.toContain('카드뉴스');
    expect(serialized).not.toContain('기밀');
    expect(serialized).not.toContain('없는사람');
    expect(serialized).not.toContain('미정');
  });
});

describe('정렬', () => {
  it('입력 순서를 뒤집어도 결과가 같다', () => {
    const tasks = [
      task({ id: 'a', dueAt: '2026-07-27' }),
      task({ id: 'b', dueAt: null, ownerNameRaw: '미정' }),
      task({ id: 'c', lastProgressAt: '2026-07-01T00:00:00Z' }),
      task({ id: 'd', dueAt: '2026-07-26' }),
    ];
    const stages = [
      stage('a', { stageKey: 'concept', slaDays: 3, plannedDate: '2026-07-24' }),
      stage('d', { stageKey: 'final', slaDays: 3, plannedDate: '2026-07-25' }),
    ];

    const forward = collectAlerts(tasks, stages, ctx());
    const reversed = collectAlerts([...tasks].reverse(), [...stages].reverse(), ctx());

    expect(reversed).toEqual(forward);
  });

  it('danger가 먼저, 그다음 kind 선언 순서, 그다음 days 오름차순이다', () => {
    const tasks = [
      task({ id: 'a', dueAt: '2026-07-27' }), // due_soon D-2
      task({ id: 'b', dueAt: '2026-07-25' }), // due_soon D-0
      task({ id: 'c', dueAt: null }), // no_due_date (days null)
      task({ id: 'd', lastProgressAt: '2026-07-01T00:00:00Z' }), // stale
    ];
    const stages = [stage('a', { slaDays: 3, plannedDate: '2026-07-23' })]; // danger

    const alerts = collectAlerts(tasks, stages, ctx());

    expect(alerts.map((alert) => [alert.severity, alert.kind, alert.days])).toEqual([
      ['danger', 'due_soon', -2],
      ['warn', 'due_soon', 0],
      ['warn', 'due_soon', 2],
      ['warn', 'stale', 24],
      ['warn', 'no_due_date', null],
    ]);
  });

  it('같은 칸이면 taskId 사전순이다', () => {
    const alerts = collectAlerts(
      [task({ id: 'z', dueAt: null }), task({ id: 'a', dueAt: null }), task({ id: 'm', dueAt: null })],
      [],
      ctx()
    );

    expect(alerts.map((alert) => alert.taskId)).toEqual(['a', 'm', 'z']);
  });
});

describe('빈 입력', () => {
  it('빈 배열이면 빈 배열이고 예외가 없다', () => {
    expect(collectAlerts([], [], ctx())).toEqual([]);
  });

  it('입력을 고치지 않는다', () => {
    const target = task({ id: 'x', dueAt: null });
    const snapshot = JSON.stringify(target);

    collectAlerts([target], [], ctx());

    expect(JSON.stringify(target)).toBe(snapshot);
  });
});

describe('픽스처 실측 (기준 2026-07-25)', () => {
  it('종류별 건수', () => {
    const knownOwners = registry.enums
      .filter((entry) => entry.groupKey.endsWith('구성원'))
      .map((entry) => entry.value);

    const alerts = collectAlerts(fixtureTasks, fixtureStages, ctx({ knownOwners }));
    const counts = new Map<string, number>();
    for (const alert of alerts) counts.set(alert.kind, (counts.get(alert.kind) ?? 0) + 1);

    expect(Object.fromEntries(counts)).toEqual({
      // 편집팀 5건은 마감 컬럼이 없어 전건 기한 미설정 + 마케팅 「자료 요청」(보류·마감 없음) 1건
      no_due_date: 6,
      // 「카드뉴스 A」의 `최종본·업로드 (+7일)` 단계 하나 — 예정 07-27, 실제일 비었고 SLA 7일 안이다
      due_soon: 1,
    });

    // 픽스처 담당자는 전원 설정 탭 구성원이고, 미지정도 없다
    expect(alerts.filter((alert) => alert.kind === 'unknown_owner')).toEqual([]);
    expect(alerts.filter((alert) => alert.kind === 'no_owner')).toEqual([]);
    // `lastProgressAt`은 업로드 커밋(T5)이 채운다. 파싱 직후에는 전건 null이라 미갱신이 0이다
    expect(alerts.filter((alert) => alert.kind === 'stale')).toEqual([]);
  });

  it('단계 알림의 stageKey가 실제 단계를 가리킨다', () => {
    const alerts = collectAlerts(fixtureTasks, fixtureStages, ctx());
    const stageAlerts = alerts.filter((alert) => alert.stageKey !== null);

    expect(stageAlerts.map((alert) => [alert.stageKey, alert.days, alert.severity])).toEqual([
      ['final', 2, 'warn'],
    ]);
  });
});
