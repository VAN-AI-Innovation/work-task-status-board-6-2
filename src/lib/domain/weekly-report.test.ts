/**
 * 이 파일이 지키는 축은 넷이다.
 *
 * 1. **결정적인가.** 같은 입력이 항상 같은 문자열을 내고, 입력 배열 순서를 뒤집어도
 *    결과가 같아야 한다. 회의록에 붙여넣는 문서가 새로고침마다 줄 순서가 바뀌면 못 쓴다.
 * 2. **섹션 6개가 남는가.** 비어 있어도 제목과 「해당 없음」을 남긴다 — 통째로 지우면
 *    붙여넣은 쪽에서 「빠뜨린 건지 없는 건지」 알 수 없다.
 * 3. **표가 깨지지 않는가.** 업무명·과제명에 `|`나 개행이 있으면 GFM 표가 무너진다.
 * 4. **`extras`·`raw`가 새지 않는가.** 이 문자열은 복사돼 외부로 나간다. 연락처·계정이
 *    거기 있다 (CLAUDE.md 보안 규칙).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildKpiStrip, summarizeAllTeams } from '@/lib/domain/progress-stats';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { buildWeeklyReport, type WeeklyReportInput } from '@/lib/domain/weekly-report';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { AlertContext } from '@/lib/domain/alert-rules';
import type { GoalMetric, ParsedGoalMetric } from '@/types/goal';
import type { SettingsRegistry } from '@/types/sheet';
import type { ParsedTask, Task, TaskEvent, TaskStage } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
/** 2026-07-25는 **토요일**이다 — step 2~5와 같은 기준일을 쓴다 (그 주는 07-20~07-26) */
const TODAY = '2026-07-25';

let registry: SettingsRegistry;
let fixtureTasks: Task[];
let fixtureStages: TaskStage[];
let fixtureGoals: GoalMetric[];

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

function toGoalMetric(parsed: ParsedGoalMetric, index: number): GoalMetric {
  return {
    id: `goal-${index}`,
    teamId: parsed.teamKey,
    periodLabel: parsed.periodLabel,
    title: parsed.title,
    goalText: parsed.goalText,
    kpiName: parsed.kpiName,
    targetValue: parsed.targetValue,
    actualValue: parsed.actualValue,
    achievementRate: parsed.achievementRate,
    prevPeriodDelta: parsed.prevPeriodDelta,
    channel: parsed.channel,
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    execStatus: parsed.execStatus,
    analysis: parsed.analysis,
    wentWell: parsed.wentWell,
    needsImprovement: parsed.needsImprovement,
    startedAt: parsed.startedAt,
    dueAt: parsed.dueAt,
    extras: parsed.extras,
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
    title: `업무${seq}`,
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

let goalSeq = 0;

function goal(overrides: Partial<GoalMetric> = {}): GoalMetric {
  goalSeq += 1;
  return {
    id: `g${goalSeq}`,
    teamId: 'marketing',
    periodLabel: '2026-07 4주차',
    title: `과제${goalSeq}`,
    goalText: null,
    kpiName: '조회수',
    targetValue: 100,
    actualValue: 80,
    achievementRate: 80,
    prevPeriodDelta: null,
    channel: null,
    ownerMemberId: null,
    ownerNameRaw: null,
    execStatus: null,
    analysis: null,
    wentWell: null,
    needsImprovement: null,
    startedAt: null,
    dueAt: null,
    extras: {},
    sourceUploadId: null,
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 20,
    ...overrides,
  };
}

let eventSeq = 0;

function event(): TaskEvent {
  eventSeq += 1;
  return {
    id: `e${eventSeq}`,
    taskId: `t${eventSeq}`,
    uploadId: null,
    changedFields: ['status'],
    occurredAt: '2026-07-22T00:00:00Z',
  };
}

function ctx(overrides: Partial<AlertContext> = {}): AlertContext {
  return { today: TODAY, semanticIndex: buildSemanticIndex(registry), ...overrides };
}

function input(overrides: Partial<WeeklyReportInput> = {}): WeeklyReportInput {
  return {
    tasks: [],
    stages: [],
    goals: [],
    period: resolveReportPeriod(TODAY, null),
    events: [],
    ctx: ctx(),
    ...overrides,
  };
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
  fixtureGoals = parsed.tabs.flatMap((tab) => tab.goalMetrics).map(toGoalMetric);
});

describe('문서 뼈대', () => {
  it('문자열을 돌려주고 제목으로 시작한다', () => {
    const report = buildWeeklyReport(input());

    expect(typeof report).toBe('string');
    expect(report.startsWith('# 주간 업무 보고')).toBe(true);
  });

  it('제목의 기간이 today가 속한 주의 월~일이다', () => {
    // 2026-07-25(토)가 속한 주는 월요일 07-20 ~ 일요일 07-26이다
    expect(buildWeeklyReport(input())).toContain('# 주간 업무 보고 — 2026-07-20 ~ 2026-07-26');
  });

  it('한 팀만 담은 보고는 제목 앞에 그 팀 이름이 붙는다', () => {
    expect(
      buildWeeklyReport(input({ teams: ['edit'] })).startsWith(
        '# 편집팀 주간 업무 보고 — 2026-07-20 ~ 2026-07-26'
      )
    ).toBe(true);
  });

  it('전사(teams 없음)와 여러 팀은 팀 이름을 붙이지 않는다', () => {
    expect(buildWeeklyReport(input())).toContain('# 주간 업무 보고 — ');
    expect(buildWeeklyReport(input({ teams: ['edit', 'shoot'] }))).toContain(
      '# 주간 업무 보고 — '
    );
  });

  it('섹션 제목 6개가 전부 있다', () => {
    const report = buildWeeklyReport(input({ tasks: fixtureTasks, goals: fixtureGoals }));

    expect(report).toContain('## 요약');
    expect(report).toContain('## 팀별 현황');
    expect(report).toContain('## 지연 업무');
    expect(report).toContain('## 이번 주 마감');
    expect(report).toContain('## 목표 대비 성과');
    expect(report).toContain('## 확인 필요');
  });

  it('빈 입력에도 예외 없이 문자열이 나오고 요약이 0으로 채워진다', () => {
    const report = buildWeeklyReport(input());

    expect(report).toContain('- 전체 활성 업무: 0건');
    expect(report).toContain('- 이번 주 변경: 0건');
  });
});

describe('기간과 변경 건수', () => {
  it('제목의 기간은 today가 아니라 넘겨받은 period가 정한다', () => {
    // 같은 `ctx.today`로 지난 주를 뽑을 수 있어야 `/report`의 기간 선택이 성립한다
    const report = buildWeeklyReport(input({ period: resolveReportPeriod(TODAY, '2026-07-08') }));

    expect(report).toContain('# 주간 업무 보고 — 2026-07-06 ~ 2026-07-12');
  });

  it('「이번 주 마감」이 그 기간을 따라간다', () => {
    const tasks = [task({ id: 'a', title: '지난 주 마감', dueAt: '2026-07-09' })];

    expect(
      buildWeeklyReport(input({ tasks, period: resolveReportPeriod(TODAY, '2026-07-08') }))
    ).toContain('## 이번 주 마감 (1건)');
    expect(buildWeeklyReport(input({ tasks }))).toContain('## 이번 주 마감 (0건)');
  });

  it('events가 빈 배열이면 0건이다 — 실제로 아무 일도 없었다는 뜻이다', () => {
    expect(buildWeeklyReport(input({ events: [] }))).toContain('- 이번 주 변경: 0건');
  });

  it('events가 null이면 「집계되지 않음」이다 — 0건과 같은 말로 뭉개지 않는다', () => {
    const report = buildWeeklyReport(input({ events: null }));

    expect(report).toContain('- 이번 주 변경: 집계되지 않음');
    expect(report).not.toContain('- 이번 주 변경: 0건');
  });

  it('건수만 쓴다 — changedFields의 필드 이름이 문서에 실리지 않는다 (`S6`)', () => {
    const report = buildWeeklyReport(input({ events: [event(), event()] }));

    expect(report).toContain('- 이번 주 변경: 2건');
    expect(report).not.toContain('changedFields');
    expect(report).not.toContain('status');
  });
});

describe('결정성', () => {
  it('같은 입력을 두 번 넣으면 완전히 같은 문자열이 나온다', () => {
    const payload = input({
      tasks: fixtureTasks,
      stages: fixtureStages,
      goals: fixtureGoals,
      events: [event(), event()],
    });

    expect(buildWeeklyReport(payload)).toBe(buildWeeklyReport(payload));
  });

  it('입력 배열의 순서를 뒤집어도 같은 문자열이 나온다', () => {
    const base = input({ tasks: fixtureTasks, stages: fixtureStages, goals: fixtureGoals });
    const reversed = input({
      tasks: [...fixtureTasks].reverse(),
      stages: [...fixtureStages].reverse(),
      goals: [...fixtureGoals].reverse(),
    });

    expect(buildWeeklyReport(reversed)).toBe(buildWeeklyReport(base));
  });

  it('지연 목록이 dday 오름차순 → 팀 → 업무명 순이다', () => {
    const tasks = [
      task({ id: 'a', teamId: 'marketing', title: '나중', dueAt: '2026-07-24' }), // D-1
      task({ id: 'b', teamId: 'edit', title: '가장 오래됨', dueAt: '2026-07-01' }), // D-24
      task({ id: 'c', teamId: 'edit', title: 'ㄱ', dueAt: '2026-07-24' }), // D-1, 같은 날
    ];

    const lines = buildWeeklyReport(input({ tasks }))
      .split('## 지연 업무')[1]
      .split('\n##')[0]
      .split('\n')
      .filter((line) => line.startsWith('- ['));

    expect(lines.map((line) => line.split(' — ')[0])).toEqual([
      '- [편집팀] 가장 오래됨',
      '- [편집팀] ㄱ',
      '- [마케팅·관리팀] 나중',
    ]);
  });
});

describe('빈 섹션도 제목을 남긴다', () => {
  it('지연이 0건이어도 제목과 「해당 없음」이 있다', () => {
    const report = buildWeeklyReport(input());

    expect(report).toContain('## 지연 업무 (0건)');
    expect(report).toContain('## 이번 주 마감 (0건)');
    expect(report.match(/해당 없음/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('표', () => {
  it('팀별 표의 행 수가 summarizeAllTeams 결과와 같다', () => {
    const statsCtx = { today: TODAY, semanticIndex: buildSemanticIndex(registry) };
    const expected = summarizeAllTeams(fixtureTasks, statsCtx).length;

    const report = buildWeeklyReport(input({ tasks: fixtureTasks }));
    const section = report.split('## 팀별 현황')[1].split('\n##')[0];
    // 헤더 행 + 구분 행을 뺀 나머지가 팀 행이다
    const rows = section.split('\n').filter((line) => line.startsWith('|'));

    expect(rows.length - 2).toBe(expected);
  });

  it('과제명에 `|`가 있어도 표 행의 파이프 개수가 헤더와 같다', () => {
    const report = buildWeeklyReport(input({ goals: [goal({ title: 'A | B | C' })] }));
    const rows = report
      .split('## 목표 대비 성과')[1]
      .split('\n##')[0]
      .split('\n')
      .filter((line) => line.startsWith('|'));

    const pipes = (line: string): number => line.split('').filter((ch) => ch === '|').length;
    const escaped = (line: string): number => (line.match(/\\\|/g) ?? []).length;

    expect(rows).toHaveLength(3);
    // 이스케이프된 파이프는 칸 구분자가 아니므로 빼고 센다
    expect(pipes(rows[2]) - escaped(rows[2])).toBe(pipes(rows[0]));
  });

  it('과제명에 개행이 있어도 표 행이 한 줄이다', () => {
    const report = buildWeeklyReport(input({ goals: [goal({ title: '첫 줄\n둘째 줄' })] }));
    const rows = report
      .split('## 목표 대비 성과')[1]
      .split('\n##')[0]
      .split('\n')
      .filter((line) => line.startsWith('|'));

    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('첫 줄 둘째 줄');
  });

  it('지표가 없으면 목표 표 대신 「해당 없음」이 온다', () => {
    const section = buildWeeklyReport(input()).split('## 목표 대비 성과')[1].split('\n##')[0];

    expect(section).toContain('해당 없음');
    expect(section).not.toContain('|');
  });
});

describe('달성률 불일치 (요구 4번)', () => {
  it('불일치가 있으면 표 아래에 건수 한 줄이 붙는다', () => {
    // 목표 40·실적 12면 재계산 30인데 시트에는 95라고 적혀 있다
    const report = buildWeeklyReport(
      input({ goals: [goal({ targetValue: 40, actualValue: 12, achievementRate: 95 })] })
    );

    expect(report).toContain('달성률 불일치 1건');
  });

  it('불일치가 없으면 그 줄이 없다', () => {
    const report = buildWeeklyReport(input({ goals: [goal()] }));

    expect(report).not.toContain('달성률 불일치');
  });
});

describe('확인 필요 (알림 4종)', () => {
  it('알림 4종의 건수가 한 줄로 나온다', () => {
    const tasks = [
      task({ id: 'a', ownerNameRaw: '미정' }),
      task({ id: 'b', dueAt: null }),
      task({ id: 'c', lastProgressAt: '2026-07-01T00:00:00Z' }),
      task({ id: 'd', ownerNameRaw: '없는사람' }),
    ];

    const report = buildWeeklyReport(input({ tasks, ctx: ctx({ knownOwners: ['담당자1'] }) }));

    expect(report).toContain(
      '- 담당자 미지정 1건 / 기한 미설정 1건 / 장기 미갱신 1건 / 담당자 오타 의심 1건'
    );
  });
});

describe('보안 — 복사돼 밖으로 나가는 문자열이다', () => {
  it('extras 값이 결과에 들어 있지 않다', () => {
    const tasks = [
      task({
        id: 'a',
        dueAt: '2026-07-01',
        extras: { 연락처: '010-1234-5678', 계정: 'sample_account_1' },
        raw: { 업무명: '원본 업무명', 문의자: 'raw_account_9' },
      }),
    ];

    const report = buildWeeklyReport(input({ tasks }));

    expect(report).not.toContain('010-1234-5678');
    expect(report).not.toContain('sample_account_1');
    expect(report).not.toContain('raw_account_9');
    // 담당자 이름은 회의록 용도라 들어간다
    expect(report).toContain('담당자1');
  });

  it('픽스처 전체를 넣어도 extras·raw 값이 새지 않는다', () => {
    const report = buildWeeklyReport(
      input({ tasks: fixtureTasks, stages: fixtureStages, goals: fixtureGoals })
    );

    const leaked = fixtureTasks
      .flatMap((fixtureTask) => Object.values(fixtureTask.extras))
      .filter((value): value is string => typeof value === 'string' && value.trim().length >= 6)
      // 날짜는 마감 컬럼과 같은 값이라 「샜다」고 볼 수 없다
      .filter((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))
      // 담당자·업무명·다음 조치는 보고서가 원래 싣는 값이고, 같은 문자열이 extras에도 있다
      .filter(
        (value) =>
          !fixtureTasks.some(
            (fixtureTask) =>
              fixtureTask.title === value ||
              fixtureTask.ownerNameRaw === value ||
              fixtureTask.nextAction === value ||
              fixtureTask.dueAt === value
          )
      );

    for (const value of leaked) expect(report).not.toContain(value);
  });
});

describe('빈 값 표기', () => {
  it('null·undefined·NaN·[object Object] 문자열이 없다', () => {
    const report = buildWeeklyReport(
      input({
        tasks: [
          ...fixtureTasks,
          task({ id: 'z', title: null, ownerNameRaw: null, dueAt: '2026-07-02' }),
        ],
        stages: fixtureStages,
        goals: [...fixtureGoals, goal({ title: null, kpiName: null, targetValue: null })],
      })
    );

    expect(report).not.toContain('undefined');
    expect(report).not.toContain('null');
    expect(report).not.toContain('NaN');
    expect(report).not.toContain('[object Object]');
  });

  it('값이 없으면 `-`로 쓴다', () => {
    const report = buildWeeklyReport(
      input({ tasks: [task({ id: 'a', title: null, ownerNameRaw: null, dueAt: '2026-07-02' })] })
    );

    expect(report).toContain('- [편집팀] - — 담당 -');
  });
});

describe('요약이 KPI와 같은 숫자를 쓴다', () => {
  it('요약 줄의 네 숫자가 buildKpiStrip 값과 일치한다', () => {
    const statsCtx = { today: TODAY, semanticIndex: buildSemanticIndex(registry) };
    const kpi = new Map(buildKpiStrip(fixtureTasks, statsCtx).map((tile) => [tile.key, tile.value]));

    const report = buildWeeklyReport(input({ tasks: fixtureTasks }));

    expect(report).toContain(
      `- 전체 활성 업무: ${kpi.get('active_total')}건 / 완료율: ${kpi.get('completion_rate')}% /` +
        ` 지연: ${kpi.get('overdue')}건 / 마감 임박: ${kpi.get('due_soon')}건`
    );
  });

  it('이번 주 마감 목록의 건수가 KPI 「이번 주 마감」과 같다', () => {
    const statsCtx = { today: TODAY, semanticIndex: buildSemanticIndex(registry) };
    const kpi = buildKpiStrip(fixtureTasks, statsCtx).find((tile) => tile.key === 'due_this_week');

    const report = buildWeeklyReport(input({ tasks: fixtureTasks }));

    expect(report).toContain(`## 이번 주 마감 (${kpi?.value}건)`);
  });
});

describe('픽스처 통합 — 스냅샷', () => {
  it('픽스처 보고서 전문이 고정된다', () => {
    const report = buildWeeklyReport(
      input({
        tasks: fixtureTasks,
        stages: fixtureStages,
        goals: fixtureGoals,
        events: [event(), event(), event()],
      })
    );

    expect(report).toMatchInlineSnapshot(`
      "# 주간 업무 보고 — 2026-07-20 ~ 2026-07-26

      ## 요약

      - 전체 활성 업무: 9건 / 완료율: 0% / 지연: 2건 / 마감 임박: 0건
      - 이번 주 변경: 3건

      ## 팀별 현황

      | 팀 | 전체 | 진행 | 승인 대기 | 지연 | 완료 | 완료율 | 가장 가까운 마감 |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
      | 편집팀 | 5 | 0 | 0 | 0 | 0 | 0% | - |
      | 촬영·기획팀 | 1 | 1 | 0 | 0 | 0 | 0% | 2026-08-05 |
      | 마케팅·관리팀 | 3 | 0 | 0 | 2 | 0 | 0% | - |

      ## 지연 업무 (2건)

      - [마케팅·관리팀] [샘플] 협업 촬영 문의 — 담당 마케터1 · D-3 · 다음 조치: 없음
      - [마케팅·관리팀] [샘플] 모집 일정 문의 — 담당 마케터2 · D-2 · 다음 조치: 모집 일정 확정 대기

      ## 이번 주 마감 (2건)

      - [마케팅·관리팀] [샘플] 협업 촬영 문의 — 담당 마케터1 · 2026-07-22
      - [마케팅·관리팀] [샘플] 모집 일정 문의 — 담당 마케터2 · 2026-07-23

      ## 목표 대비 성과

      | 팀 | 과제 | KPI | 목표 | 실적 | 달성률 |
      | --- | --- | --- | ---: | ---: | ---: |
      | 마케팅·관리팀 | [샘플] 리그램 이벤트 | 유입수 | 100 | 120 | 120% |
      | 마케팅·관리팀 | [샘플] 숏폼 시리즈 | 저장수 | 50 | 41 | 82% |
      | 마케팅·관리팀 | [샘플] 오프라인 부스 | 전환수 | 40 | 12 | 30% |

      달성률 불일치 1건

      ## 확인 필요

      - 담당자 미지정 0건 / 기한 미설정 6건 / 장기 미갱신 0건 / 담당자 오타 의심 0건
      "
    `);
  });
});

/**
 * **팀별 현황 표에 세울 팀.** 팀장의 보고서는 자기 팀만 담으므로(`report-scope.ts`) 남의 팀
 * 줄은 전부 0이 되는데, 표의 `0`은 「그 팀이 이번 주에 아무 일도 안 했다」로 읽힌다 —
 * 없는 것보다 나쁜 거짓말이라 줄 자체를 뺀다.
 */
describe('buildWeeklyReport — 팀 범위', () => {
  it('`teams`를 주면 그 팀만 표에 선다', () => {
    const markdown = buildWeeklyReport({ ...input(), teams: ['edit'] });

    expect(markdown).toContain('편집팀');
    expect(markdown).not.toContain('촬영·기획팀');
    expect(markdown).not.toContain('마케팅·관리팀');
  });

  it('주지 않으면 전부 선다 — 어드민의 보고서가 그렇다', () => {
    const markdown = buildWeeklyReport(input());

    expect(markdown).toContain('편집팀');
    expect(markdown).toContain('촬영·기획팀');
    expect(markdown).toContain('마케팅·관리팀');
  });
});
