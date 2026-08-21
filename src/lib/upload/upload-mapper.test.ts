/**
 * 입력은 **실제 파서 출력**이다. 손으로 지은 `TabParseResult`를 쓰면 이 파일만 통과하고
 * 배포에서 깨진다 — 어댑터가 필드 이름을 바꿔도 가짜 객체는 아무 말이 없기 때문이다.
 *
 * 가장 중요한 두 줄은 마지막 두 테스트다. `extras`·`raw`가 한 키도 사라지지 않는다는 것
 * (T3 완료 기준 3의 연장)과, 경고에 업무명·담당자가 실리지 않는다는 것(CLAUDE.md 보안 규칙).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import {
  TEAM_DEPARTMENT,
  collectDuplicateKeyWarnings,
  toGoalMetricUpsertInputs,
  toTaskUpsertInputs,
} from '@/lib/upload/upload-mapper';
import type { TabParseResult, WorkbookParseResult } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

describe('upload-mapper', () => {
  let parsed: WorkbookParseResult;
  let editTab: TabParseResult;
  let shootTab: TabParseResult;
  let marketingTab: TabParseResult;

  beforeAll(async () => {
    parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
    editTab = parsed.tabs.find((tab) => tab.teamKey === 'edit')!;
    shootTab = parsed.tabs.find((tab) => tab.teamKey === 'shoot')!;
    marketingTab = parsed.tabs.find((tab) => tab.teamKey === 'marketing')!;
  });

  it('편집팀 탭의 태스크 수가 그대로 옮겨진다', () => {
    const inputs = toTaskUpsertInputs(editTab, 'upload-1');
    expect(inputs).toHaveLength(editTab.tasks.length);
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('소속이 채워지고 ownerMemberId는 전부 null이다', () => {
    const inputs = toTaskUpsertInputs(shootTab, 'upload-1');

    for (const input of inputs) {
      expect(input.teamId).toBe('shoot');
      expect(input.departmentId).toBe(TEAM_DEPARTMENT.shoot);
      // 시트의 담당자는 자유 입력 문자열이다. 구성원 해석은 T8의 일이다
      expect(input.ownerMemberId).toBeNull();
      expect(input.ownerNameRaw).not.toBeUndefined();
      expect(input.sourceUploadId).toBe('upload-1');
      expect(input.sourceSheetTab).toBe(shootTab.sheet);
    }
  });

  it('행 번호를 1-based 그대로 옮긴다 — 여기서 더하지 않는다', () => {
    const inputs = toTaskUpsertInputs(editTab, null);
    expect(inputs.map((input) => input.sourceRowIndex)).toEqual(
      editTab.tasks.map((task) => task.sourceRowIndex),
    );
    expect(inputs[0].sourceUploadId).toBeNull();
  });

  it('extras·raw의 키가 하나도 사라지지 않는다 (촬영팀 70컬럼)', () => {
    const [input] = toTaskUpsertInputs(shootTab, null);
    const [task] = shootTab.tasks;

    expect(Object.keys(input.extras).length).toBeGreaterThan(50);
    expect(Object.keys(input.extras)).toEqual(Object.keys(task.extras));
    expect(Object.keys(input.raw)).toEqual(Object.keys(task.raw));
    expect(input.extras).toEqual(task.extras);
  });

  it('stages가 보존된다 (편집팀 3단계)', () => {
    const [input] = toTaskUpsertInputs(editTab, null);
    expect(input.stages).toHaveLength(3);
    expect(input.stages).toEqual(editTab.tasks[0].stages);
  });

  it('목표 지표가 옮겨지고 ownerMemberId는 null이다', () => {
    const inputs = toGoalMetricUpsertInputs(marketingTab, 'upload-1');

    expect(inputs).toHaveLength(marketingTab.goalMetrics.length);
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.teamId).toBe('marketing');
      expect(input.ownerMemberId).toBeNull();
      expect(input.sourceUploadId).toBe('upload-1');
    }
    expect(inputs[0].extras).toEqual(marketingTab.goalMetrics[0].extras);
  });

  it('teamKey가 null인 탭은 예외가 아니라 빈 배열이다', () => {
    const unknownTab: TabParseResult = {
      sheet: '99_설정',
      teamKey: null,
      tasks: [],
      goalMetrics: [],
      teamPeriodGoals: [],
      briefingLines: [],
      warnings: [],
    };

    expect(toTaskUpsertInputs(unknownTab, null)).toEqual([]);
    expect(toGoalMetricUpsertInputs(unknownTab, null)).toEqual([]);
  });

  it('같은 자연키가 두 번이면 두 번째부터 경고다', () => {
    const inputs = toTaskUpsertInputs(editTab, null);
    const doubled = [...inputs, inputs[0]];

    const warnings = collectDuplicateKeyWarnings(doubled);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('DUPLICATE_SOURCE_KEY');
    expect(warnings[0].sheet).toBe(editTab.sheet);
    expect(warnings[0].row).toBe(inputs[0].sourceRowIndex);
  });

  it('팀이 다르면 같은 sourceKey도 다른 업무다 — 경고가 아니다', () => {
    const [edit] = toTaskUpsertInputs(editTab, null);
    const twin = { ...edit, teamId: 'shoot' as const };

    expect(collectDuplicateKeyWarnings([edit, twin])).toEqual([]);
  });

  it('중복 경고에 업무명·담당자·자연키가 실리지 않는다', () => {
    const inputs = toTaskUpsertInputs(editTab, null);
    const warnings = collectDuplicateKeyWarnings([...inputs, inputs[0]]);
    const serialized = JSON.stringify(warnings);

    expect(serialized).not.toContain(inputs[0].sourceKey);
    expect(serialized).not.toContain(inputs[0].title);
    expect(serialized).not.toContain(inputs[0].ownerNameRaw);
  });
});
