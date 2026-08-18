/**
 * 검증기의 계약을 좁게 고정한다.
 * - 하드 실패시키지 않는다 (예외를 던지지 않고 입력을 고치지도 않는다)
 * - 경고에 사람 이름·셀 값이 새어 나가지 않는다
 */
import { describe, expect, it } from 'vitest';

import { validateParsedGoalMetric, validateParsedTask } from '@/lib/sheet/task-schema';
import type { ParsedGoalMetric } from '@/types/goal';
import type { ParsedTask } from '@/types/task';

function task(overrides: Partial<ParsedTask> = {}): ParsedTask {
  return {
    teamKey: 'edit',
    sourceKey: 'EDIT-001',
    title: '오프닝 영상 편집',
    ownerNameRaw: '김가나',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-07-01',
    dueAt: '2026-07-22',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    stages: [],
    ...overrides,
  };
}

function metric(overrides: Partial<ParsedGoalMetric> = {}): ParsedGoalMetric {
  return {
    teamKey: 'marketing',
    periodLabel: '2026-07 4주차',
    title: '인스타 릴스 확장',
    goalText: null,
    kpiName: '도달수',
    targetValue: 10000,
    actualValue: 12000,
    achievementRate: 120,
    prevPeriodDelta: null,
    channel: null,
    ownerNameRaw: null,
    execStatus: null,
    analysis: null,
    wentWell: null,
    needsImprovement: null,
    startedAt: '2026-07-20',
    dueAt: '2026-07-26',
    extras: {},
    raw: {},
    sourceSheetTab: '03_마케팅·관리팀',
    sourceRowIndex: 12,
    ...overrides,
  };
}

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe('validateParsedTask', () => {
  it('정상 태스크는 경고가 없다', () => {
    expect(validateParsedTask(task())).toEqual([]);
  });

  it('title이 null이면 TASK_TITLE_MISSING을 내고 입력을 고치지 않는다', () => {
    const input = task({ title: null });
    const warnings = validateParsedTask(input);

    expect(codes(warnings)).toEqual(['TASK_TITLE_MISSING']);
    expect(input.title).toBeNull();
  });

  it('title이 빈 문자열이어도 TASK_TITLE_MISSING', () => {
    expect(codes(validateParsedTask(task({ title: '' })))).toEqual(['TASK_TITLE_MISSING']);
  });

  it('progress 120은 PROGRESS_INVALID, 0은 경고 없음 (0과 null을 구분한다)', () => {
    expect(codes(validateParsedTask(task({ progress: 120 })))).toEqual(['PROGRESS_INVALID']);
    expect(validateParsedTask(task({ progress: 0 }))).toEqual([]);
    expect(codes(validateParsedTask(task({ progress: 33.5 })))).toEqual(['PROGRESS_INVALID']);
  });

  it('progress가 null이면 경고가 없다', () => {
    expect(validateParsedTask(task({ progress: null }))).toEqual([]);
  });

  it('dueAt이 `2026.07.22`면 DATE_FORMAT_INVALID', () => {
    const warnings = validateParsedTask(task({ dueAt: '2026.07.22' }));
    expect(codes(warnings)).toEqual(['DATE_FORMAT_INVALID']);
    expect(warnings[0]).toMatchObject({ sheet: '01_편집팀', row: 5 });
  });

  it('assignedAt·nextActionDue도 같은 코드로 검사된다', () => {
    expect(codes(validateParsedTask(task({ assignedAt: '7/1' })))).toEqual([
      'DATE_FORMAT_INVALID',
    ]);
    expect(codes(validateParsedTask(task({ nextActionDue: '내일' })))).toEqual([
      'DATE_FORMAT_INVALID',
    ]);
  });

  it('sourceKey가 빈 문자열이면 SOURCE_KEY_EMPTY', () => {
    expect(codes(validateParsedTask(task({ sourceKey: '' })))).toEqual(['SOURCE_KEY_EMPTY']);
  });

  it('경고에 업무명·담당자·셀 값이 들어 있지 않다', () => {
    const warnings = validateParsedTask(
      task({ sourceKey: '', title: null, progress: 120, dueAt: '2026.07.22' })
    );

    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'row', 'sheet']);
      const serialized = JSON.stringify(warning);
      expect(serialized).not.toContain('오프닝');
      expect(serialized).not.toContain('김가나');
      expect(serialized).not.toContain('2026.07.22');
      expect(serialized).not.toContain('120');
    }
  });
});

describe('validateParsedGoalMetric', () => {
  it('정상 지표는 경고가 없다 — 달성률 120은 정상이다', () => {
    expect(validateParsedGoalMetric(metric())).toEqual([]);
    expect(validateParsedGoalMetric(metric({ achievementRate: 120 }))).toEqual([]);
  });

  it('title이 null이면 GOAL_TITLE_MISSING을 내고 입력을 고치지 않는다', () => {
    const input = metric({ title: null });
    const warnings = validateParsedGoalMetric(input);

    expect(codes(warnings)).toEqual(['GOAL_TITLE_MISSING']);
    expect(input.title).toBeNull();
    expect(warnings[0]).toMatchObject({ sheet: '03_마케팅·관리팀', row: 12 });
  });

  it('startedAt·dueAt 형식이 어긋나면 DATE_FORMAT_INVALID', () => {
    expect(codes(validateParsedGoalMetric(metric({ startedAt: '7월 20일' })))).toEqual([
      'DATE_FORMAT_INVALID',
    ]);
    expect(codes(validateParsedGoalMetric(metric({ dueAt: '2026/07/26' })))).toEqual([
      'DATE_FORMAT_INVALID',
    ]);
  });

  it('경고에 지표명·셀 값이 들어 있지 않다', () => {
    const warnings = validateParsedGoalMetric(metric({ title: null, dueAt: '2026/07/26' }));

    expect(warnings.length).toBeGreaterThan(0);
    for (const warning of warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'row', 'sheet']);
      expect(JSON.stringify(warning)).not.toContain('2026/07/26');
    }
  });
});
