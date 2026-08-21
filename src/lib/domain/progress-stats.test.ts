/**
 * 이 파일이 지키는 축은 셋이다.
 *
 * 1. **모수를 틀리지 않는가.** 완료율에서 취소가 빠지고(`T4` 완료 기준 3), 평균 진행률에서
 *    `null`은 빠지되 `0`은 들어간다(완료 기준 4). 둘 다 틀리면 대시보드 숫자가 통째로 거짓말이 된다.
 * 2. **`display-status.ts`와 편이 갈리지 않는가.** `rework`는 진행 쪽, `pending_release`는
 *    완료 쪽이다. 여기서 갈리면 화면 색과 표 숫자가 어긋난다.
 * 3. **오늘을 주입받은 대로만 쓰는가.** `today`를 옮겼을 때 날짜에 매인 칸만 움직여야 한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildKpiStrip,
  summarizeAllTeams,
  summarizeTeam,
  type StatsContext,
} from '@/lib/domain/progress-stats';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { SettingsRegistry } from '@/types/sheet';
import type { ParsedTask, Task, TeamKey } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
/** 2026-07-25는 **토요일**이다 — 이 주는 07-20(월)~07-26(일) */
const TODAY = '2026-07-25';

let registry: SettingsRegistry;
let fixtureTasks: Task[];

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

function task(overrides: Partial<Task>): Task {
  seq += 1;
  return {
    ...toTask(
      {
        teamKey: 'edit',
        sourceKey: `k${seq}`,
        title: null,
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
        raw: {},
        sourceSheetTab: '01_편집팀',
        sourceRowIndex: 10,
        stages: [],
      },
      seq
    ),
    ...overrides,
  };
}

function ctx(overrides: Partial<StatsContext> = {}): StatsContext {
  return { today: TODAY, semanticIndex: buildSemanticIndex(registry), ...overrides };
}

beforeAll(async () => {
  const parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  expect(parsed.settings).not.toBeNull();
  registry = parsed.settings as SettingsRegistry;
  fixtureTasks = parsed.tabs.flatMap((tab) => tab.tasks).map(toTask);
});

describe('summarizeTeam — 완료율 모수', () => {
  it('취소 2건 + 완료 1건 + 진행 1건이면 완료율이 50이다 (모수에서 취소가 빠진다)', () => {
    const tasks = [
      task({ status: '취소' }),
      task({ status: '취소' }),
      task({ status: '완료' }),
      task({ status: '진행 중' }),
    ];

    const summary = summarizeTeam(tasks, ctx(), 'edit');

    expect(summary.total).toBe(4);
    expect(summary.cancelled).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.completionRate).toBe(50);
  });

  it('전건이 취소면 완료율이 0이 아니라 null이다 — "0%"와 "셀 것이 없음"은 다르다', () => {
    const summary = summarizeTeam([task({ status: '취소' }), task({ status: '취소' })], ctx(), 'edit');

    expect(summary.completionRate).toBeNull();
    expect(summary.delayRate).toBeNull();
  });

  it('지연율도 같은 모수(전체 − 취소)를 쓴다', () => {
    const tasks = [
      task({ status: '진행 중', dueAt: '2026-07-20' }),
      task({ status: '진행 중' }),
      task({ status: '취소' }),
    ];

    expect(summarizeTeam(tasks, ctx(), 'edit').delayRate).toBe(50);
  });
});

describe('summarizeTeam — 평균 진행률', () => {
  it('progress가 [80, null, 0]이면 40이다 — null은 빼고 0은 넣는다', () => {
    const tasks = [task({ progress: 80 }), task({ progress: null }), task({ progress: 0 })];

    expect(summarizeTeam(tasks, ctx(), 'edit').avgProgress).toBe(40);
  });

  it('progress가 전부 null이면 평균은 null이다', () => {
    const tasks = [task({ progress: null }), task({ progress: null })];

    expect(summarizeTeam(tasks, ctx(), 'edit').avgProgress).toBeNull();
  });
});

describe('summarizeTeam — 편 가르기가 display-status와 같다', () => {
  it('rework는 진행 쪽, pending_release는 완료 쪽이다', () => {
    const tasks = [
      task({ status: '수정 중' }),
      task({ status: '진행 중' }),
      task({ status: '게시·이관 대기' }),
      task({ status: '완료' }),
    ];

    const summary = summarizeTeam(tasks, ctx(), 'edit');

    expect(summary.inProgress).toBe(2);
    expect(summary.done).toBe(2);
    expect(summary.completionRate).toBe(50);
  });

  it('검토 요청은 reviewWaiting, 승인 대기는 approvalWaiting으로 갈린다', () => {
    const tasks = [task({ status: '검토 요청' }), task({ status: '승인 대기' })];

    const summary = summarizeTeam(tasks, ctx(), 'edit');

    expect(summary.reviewWaiting).toBe(1);
    expect(summary.approvalWaiting).toBe(1);
    expect(summary.active).toBe(2);
  });

  it('active는 완료·취소가 아닌 건이다', () => {
    const tasks = [
      task({ status: '진행 중' }),
      task({ status: '완료' }),
      task({ status: '취소' }),
      task({ status: '보류' }),
    ];

    const summary = summarizeTeam(tasks, ctx(), 'edit');

    expect(summary.active).toBe(2);
  });
});

describe('summarizeTeam — nearestDueAt', () => {
  it('지난 마감을 고르지 않는다', () => {
    const tasks = [
      task({ status: '진행 중', dueAt: '2026-07-01' }),
      task({ status: '진행 중', dueAt: '2026-08-10' }),
    ];

    expect(summarizeTeam(tasks, ctx(), 'edit').nearestDueAt).toBe('2026-08-10');
  });

  it('완료·취소 건의 마감을 고르지 않는다', () => {
    const tasks = [
      task({ status: '완료', dueAt: '2026-07-26' }),
      task({ status: '취소', dueAt: '2026-07-27' }),
      task({ status: '진행 중', dueAt: '2026-07-28' }),
    ];

    expect(summarizeTeam(tasks, ctx(), 'edit').nearestDueAt).toBe('2026-07-28');
  });

  it('오늘 마감은 아직 지나지 않았으므로 포함한다', () => {
    expect(summarizeTeam([task({ status: '진행 중', dueAt: TODAY })], ctx(), 'edit').nearestDueAt).toBe(
      TODAY
    );
  });

  it('고를 것이 없으면 null이다', () => {
    expect(summarizeTeam([task({ status: '진행 중' })], ctx(), 'edit').nearestDueAt).toBeNull();
  });
});

describe('summarizeTeam — 빈 배열', () => {
  it('예외 없이 전 필드가 0 또는 null이다', () => {
    const summary = summarizeTeam([], ctx(), 'shoot');

    expect(summary).toEqual({
      teamKey: 'shoot',
      total: 0,
      active: 0,
      inProgress: 0,
      approvalWaiting: 0,
      reviewWaiting: 0,
      done: 0,
      cancelled: 0,
      overdue: 0,
      dueSoon: 0,
      completionRate: null,
      delayRate: null,
      avgProgress: null,
      nearestDueAt: null,
    });
  });
});

describe('summarizeAllTeams', () => {
  it('태스크가 하나도 없는 팀도 행으로 돌려준다 — 표에 0으로 나와야 한다', () => {
    const summaries = summarizeAllTeams([task({ teamId: 'edit', status: '진행 중' })], ctx());

    expect(summaries.map((summary) => summary.teamKey)).toEqual(['edit', 'shoot', 'marketing']);
    expect(summaries.map((summary) => summary.total)).toEqual([1, 0, 0]);
  });

  it('팀 밖의 업무를 세지 않는다', () => {
    const tasks = [
      task({ teamId: 'edit', status: '완료' }),
      task({ teamId: 'shoot', status: '진행 중' }),
    ];

    const byTeam = new Map(summarizeAllTeams(tasks, ctx()).map((s) => [s.teamKey, s]));

    expect(byTeam.get('edit')?.done).toBe(1);
    expect(byTeam.get('shoot')?.done).toBe(0);
  });
});

describe('buildKpiStrip', () => {
  const EXPECTED_KEYS = [
    'active_total',
    'edit_active',
    'shoot_active',
    'marketing_active',
    'approval_waiting',
    'rework',
    'due_this_week',
    'due_soon',
    'overdue',
    'completion_rate',
  ];

  /** 시트 `00_통합 대시보드` 5행 원문. `촬영·기획팀`의 가운뎃점은 U+00B7이다 */
  const EXPECTED_LABELS = [
    '전체 활성 업무',
    '편집팀 진행',
    '촬영·기획팀 진행',
    '마케팅·관리팀 진행',
    '승인 대기',
    '수정 요청',
    '이번 주 마감',
    '마감 임박',
    '지연',
    '전체 완료율',
  ];

  it('정확히 10칸을 시트 순서대로 돌려준다', () => {
    const strip = buildKpiStrip([], ctx());

    expect(strip).toHaveLength(10);
    expect(strip.map((tile) => tile.key)).toEqual(EXPECTED_KEYS);
    expect(strip.map((tile) => tile.label)).toEqual(EXPECTED_LABELS);
  });

  it('전체 완료율만 percent이고 나머지 9칸은 count다', () => {
    const strip = buildKpiStrip([], ctx());
    const units = new Map(strip.map((tile) => [tile.key, tile.unit]));

    expect(units.get('completion_rate')).toBe('percent');
    expect(strip.filter((tile) => tile.unit === 'count')).toHaveLength(9);
  });

  it('팀별 진행 칸이 팀마다 따로 세어진다', () => {
    const tasks = [
      task({ teamId: 'edit', status: '진행 중' }),
      task({ teamId: 'edit', status: '검토 요청' }),
      task({ teamId: 'marketing', status: '진행 중' }),
      task({ teamId: 'marketing', status: '완료' }),
    ];

    const values = new Map(buildKpiStrip(tasks, ctx()).map((tile) => [tile.key, tile.value]));

    expect(values.get('active_total')).toBe(3);
    expect(values.get('edit_active')).toBe(2);
    expect(values.get('shoot_active')).toBe(0);
    expect(values.get('marketing_active')).toBe(1);
  });

  it('수정 요청 칸은 semantic rework만 센다 (진행 중은 세지 않는다)', () => {
    const tasks = [task({ status: '수정 중' }), task({ status: '진행 중' })];
    const values = new Map(buildKpiStrip(tasks, ctx()).map((tile) => [tile.key, tile.value]));

    expect(values.get('rework')).toBe(1);
    expect(values.get('approval_waiting')).toBe(0);
  });

  it('이번 주 마감은 월요일·일요일을 포함하고 다음 주 월요일을 제외한다', () => {
    const tasks = [
      task({ status: '진행 중', dueAt: '2026-07-20' }), // 이번 주 월요일
      task({ status: '진행 중', dueAt: '2026-07-26' }), // 이번 주 일요일
      task({ status: '진행 중', dueAt: '2026-07-27' }), // 다음 주 월요일
      task({ status: '진행 중', dueAt: '2026-07-19' }), // 지난 주 일요일
    ];

    const values = new Map(buildKpiStrip(tasks, ctx()).map((tile) => [tile.key, tile.value]));

    expect(values.get('due_this_week')).toBe(2);
  });

  it('이번 주 마감에서 완료·취소 건은 빠진다', () => {
    const tasks = [
      task({ status: '완료', dueAt: '2026-07-22' }),
      task({ status: '취소', dueAt: '2026-07-22' }),
      task({ status: '진행 중', dueAt: '2026-07-22' }),
    ];

    const values = new Map(buildKpiStrip(tasks, ctx()).map((tile) => [tile.key, tile.value]));

    expect(values.get('due_this_week')).toBe(1);
  });

  it('전체 완료율은 전 팀 합산이고 모수에서 취소가 빠진다', () => {
    const tasks = [
      task({ teamId: 'edit', status: '완료' }),
      task({ teamId: 'shoot', status: '진행 중' }),
      task({ teamId: 'marketing', status: '취소' }),
    ];

    const values = new Map(buildKpiStrip(tasks, ctx()).map((tile) => [tile.key, tile.value]));

    expect(values.get('completion_rate')).toBe(50);
  });
});

describe('today 주입', () => {
  it('today를 옮기면 날짜에 매인 칸만 바뀌고 완료율은 그대로다', () => {
    const tasks = [
      task({ status: '진행 중', dueAt: '2026-07-22' }),
      task({ status: '완료', dueAt: '2026-07-22' }),
    ];

    const before = summarizeTeam(tasks, ctx({ today: '2026-07-25' }), 'edit');
    const after = summarizeTeam(tasks, ctx({ today: '2026-07-21' }), 'edit');

    expect(before.overdue).toBe(1);
    expect(after.overdue).toBe(0);
    expect(after.dueSoon).toBe(1);
    expect(before.completionRate).toBe(50);
    expect(after.completionRate).toBe(50);
  });

  it('미리 계산한 flags를 넘기면 그것을 그대로 쓴다', () => {
    const subject = task({ status: '진행 중', dueAt: '2026-07-22' });
    const flags = new Map([
      [
        subject.id,
        {
          semantic: 'in_progress' as const,
          dday: 3,
          isOverdue: false,
          isDueSoon: true,
          isStale: false,
          hasNoOwner: false,
          hasUnknownOwner: false,
          hasNoDueDate: false,
        },
      ],
    ]);

    const summary = summarizeTeam([subject], ctx({ flags }), 'edit');

    expect(summary.overdue).toBe(0);
    expect(summary.dueSoon).toBe(1);
  });
});

describe('픽스처 실측 (기준 2026-07-25)', () => {
  it('팀별 total이 [5, 1, 3]이다', () => {
    const summaries = summarizeAllTeams(fixtureTasks, ctx());

    expect(summaries.map((summary) => summary.teamKey)).toEqual(['edit', 'shoot', 'marketing']);
    expect(summaries.map((summary) => summary.total)).toEqual([5, 1, 3]);
  });

  it('팀별 요약 실측값', () => {
    const byTeam = new Map<TeamKey, ReturnType<typeof summarizeTeam>>(
      summarizeAllTeams(fixtureTasks, ctx()).map((summary) => [summary.teamKey, summary])
    );

    // 편집팀 5건은 상태가 비어 있어 semantic이 전부 null이다 — 완료가 아니므로 전건 active다
    expect(byTeam.get('edit')).toMatchObject({
      active: 5,
      done: 0,
      overdue: 0,
      completionRate: 0,
      avgProgress: 33, // 5건 중 진행률이 있는 건은 1건(33)뿐. null 4건은 평균에서 빠진다
      nearestDueAt: null,
    });

    expect(byTeam.get('shoot')).toMatchObject({
      active: 1,
      inProgress: 1,
      overdue: 0,
      dueSoon: 0,
      avgProgress: 40,
      nearestDueAt: '2026-08-05',
    });

    // 마케팅 3건 중 2건은 마감이 7/22·7/23이라 지났다. 상태 원문이 마케팅 전용 값이라
    // semantic은 null이지만 완료가 아니므로 지연에 든다
    expect(byTeam.get('marketing')).toMatchObject({
      active: 3,
      overdue: 2,
      delayRate: 67,
      avgProgress: null,
      nearestDueAt: null,
    });
  });

  it('KPI 10칸 실측값', () => {
    const strip = buildKpiStrip(fixtureTasks, ctx());

    expect(strip.map((tile) => [tile.key, tile.value])).toEqual([
      ['active_total', 9],
      ['edit_active', 5],
      ['shoot_active', 1],
      ['marketing_active', 3],
      ['approval_waiting', 0],
      ['rework', 0],
      ['due_this_week', 2],
      ['due_soon', 0],
      ['overdue', 2],
      ['completion_rate', 0],
    ]);
  });
});
