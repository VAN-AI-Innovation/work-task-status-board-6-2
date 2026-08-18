/**
 * T3의 최종 대조 지점이다. 픽스처 워크북 하나를 통째로 넣어 완료 기준 1~7·9·10이
 * **파이프라인을 지나서도** 살아 있는지 확인한다 (개별 어댑터 테스트가 아니라 조립 결과를 본다).
 *
 * 두 번째 축은 실패 경로다 — 알려진 탭이 0개여도, 밴드를 못 찾아도, 어댑터가 던져도
 * **예외 없이** 나머지를 계속 처리한다는 것이 `X2`의 「부분 실패」다. 중단 판정은 T5의 일이다.
 * 그 경로들은 워크북 바이트로 만들 수 없어 리더·어댑터를 격자 주입으로 갈아끼워 확인한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as editTeam from '@/lib/sheet/adapter-edit-team';
import { FIELD_MAP as SHOOT_FIELD_MAP } from '@/lib/sheet/adapter-shoot-team';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import { WorkbookReadError, readWorkbook } from '@/lib/sheet/workbook-reader';
import type { ParseWarning, SheetCell, SheetCellValue, SheetGrid } from '@/types/sheet';
import type { WorkbookParseResult } from '@/types/task';

// 기본은 진짜 구현이고, 격자 주입이 필요한 케이스에서만 한 번씩 갈아끼운다.
vi.mock('@/lib/sheet/workbook-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sheet/workbook-reader')>();
  return { ...actual, readWorkbook: vi.fn(actual.readWorkbook) };
});
vi.mock('@/lib/sheet/adapter-edit-team', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sheet/adapter-edit-team')>();
  return { ...actual, parseEditTeamTab: vi.fn(actual.parseEditTeamTab) };
});

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const CTX = { baseYear: 2026 } as const;

/** 격자를 만든다. 빈 문자열이 빈 셀이다 */
function grid(name: string, rows: SheetCellValue[][]): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  const cells: SheetCell[][] = rows.map((row) =>
    Array.from({ length: columnCount }, (_, column): SheetCell => {
      const entry = row[column];
      return { value: entry === undefined || entry === '' ? null : entry, numFmt: null };
    })
  );
  return {
    name,
    rowCount: rows.length,
    columnCount,
    cells,
    merges: [],
    hiddenRows: [],
    hiddenColumns: [],
  };
}

const codesOf = (warnings: ParseWarning[]) => warnings.map((w) => w.code);

describe('parseWorkbook — 픽스처 sample-workbook.xlsx', () => {
  let result: WorkbookParseResult;

  beforeAll(async () => {
    result = await parseWorkbook(readFileSync(FIXTURE), CTX);
  });

  it('완료 기준 1 — 탭 3개만 남고 대시보드·설정은 tabs에 없다', () => {
    expect(result.tabs.map((tab) => tab.sheet)).toEqual([
      '01_편집팀',
      '02_촬영·기획팀',
      '03_마케팅·관리팀',
    ]);
    expect(result.tabs.map((tab) => tab.teamKey)).toEqual(['edit', 'shoot', 'marketing']);
  });

  it('settings가 null이 아니고 enums·slaRules가 채워져 있다', () => {
    expect(result.settings).not.toBeNull();
    expect(result.settings?.enums.length).toBeGreaterThan(0);
    expect(result.settings?.slaRules.length).toBeGreaterThan(0);
    // 진행 상태 10단계가 원문 그대로다 — semantic 매핑은 T4다 (ADR-009)
    const status = result.settings?.enums.filter((e) => e.groupKey === '공통_진행 상태') ?? [];
    expect(status.map((e) => e.value)).toContain('진행 중');
  });

  it('완료 기준 2 — 태스크 총합이 9건이고 유령 행 25건이 없다', () => {
    const counts = result.tabs.map((tab) => tab.tasks.length);
    expect(counts).toEqual([5, 1, 3]);
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(9);
  });

  it('완료 기준 5·6·7 — 지표 3건·팀 목표 1건·브리핑 5줄이 각자 자리에 있다', () => {
    const goalMetrics = result.tabs.flatMap((tab) => tab.goalMetrics);
    expect(goalMetrics).toHaveLength(3);
    expect(goalMetrics.map((m) => m.achievementRate)).toEqual([120, 82, 95]);

    const teamGoals = result.tabs.flatMap((tab) => tab.teamPeriodGoals);
    expect(teamGoals).toHaveLength(1);
    expect(teamGoals[0].teamKey).toBe('shoot');

    const briefing = result.tabs.flatMap((tab) => tab.briefingLines);
    expect(briefing).toHaveLength(5);
  });

  it('완료 기준 4 — 편집팀 태스크마다 단계가 3행이다', () => {
    const edit = result.tabs.find((tab) => tab.teamKey === 'edit');
    expect(edit?.tasks.map((task) => task.stages.length)).toEqual([3, 3, 3, 3, 3]);
    expect(edit?.tasks[0].stages.map((s) => s.stageKey)).toEqual([
      'concept',
      'production',
      'final',
    ]);
  });

  it('완료 기준 3 — 촬영팀 extras가 매핑되지 않은 컬럼 전량을 보존한다', () => {
    const shoot = result.tabs.find((tab) => tab.teamKey === 'shoot');
    const task = shoot?.tasks[0];
    expect(Object.keys(task?.raw ?? {})).toHaveLength(71);
    // 71 − FIELD_MAP(14) − 업무ID·공동 담당자(2). 상수가 아니라 계산식으로 대조한다
    expect(Object.keys(task?.extras ?? {})).toHaveLength(71 - SHOOT_FIELD_MAP.length - 2);
    expect(Object.keys(task?.extras ?? {})).toHaveLength(55);
  });

  it('정상 워크북이라 UNKNOWN_TAB·SETTINGS_TAB_MISSING·TAB_PARSE_FAILED가 없다', () => {
    expect(codesOf(result.warnings)).not.toContain('UNKNOWN_TAB');
    expect(codesOf(result.warnings)).not.toContain('SETTINGS_TAB_MISSING');
    expect(codesOf(result.warnings)).not.toContain('TAB_PARSE_FAILED');
    expect(codesOf(result.warnings)).not.toContain('HEADER_BAND_NOT_FOUND');
  });

  it('경고에 셀 값·사람 이름·계정 문자열이 하나도 없다', () => {
    const all = [
      ...result.warnings,
      ...(result.settings?.warnings ?? []),
      ...result.tabs.flatMap((tab) => tab.warnings),
    ];
    const allowed = ['code', 'sheet', 'row', 'column'];
    for (const warning of all) {
      expect(Object.keys(warning).filter((key) => !allowed.includes(key))).toEqual([]);
      expect(typeof warning.code).toBe('string');
      expect(typeof warning.sheet).toBe('string');
    }

    const serialized = JSON.stringify(all);
    for (const secret of [
      '[샘플]',
      '기획자',
      '편집자',
      '마케터',
      'sample_account',
      'example.test',
      '브랜드 필름',
      '#REF!',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('parseWorkbook — 실패 경로', () => {
  it('깨진 바이트는 WorkbookReadError 그대로 나온다 (다른 예외로 감싸지 않는다)', async () => {
    await expect(parseWorkbook(Buffer.from('not a workbook'), CTX)).rejects.toBeInstanceOf(
      WorkbookReadError
    );
  });

  it('알려진 탭이 0개여도 예외 없이 빈 tabs와 경고를 돌려준다 (중단 판정은 T5)', async () => {
    vi.mocked(readWorkbook).mockResolvedValueOnce({
      sheets: [grid('메모', [['오늘 할 일'], ['커피 사기']])],
      warnings: [],
    });

    const result = await parseWorkbook(Buffer.alloc(0), CTX);

    expect(result.tabs).toEqual([]);
    expect(result.settings).toBeNull();
    expect(codesOf(result.warnings).sort()).toEqual(['SETTINGS_TAB_MISSING', 'UNKNOWN_TAB']);
  });

  it('이름만 맞고 헤더 밴드가 없으면 HEADER_BAND_NOT_FOUND로 건너뛴다', async () => {
    vi.mocked(readWorkbook).mockResolvedValueOnce({
      sheets: [grid('01_편집팀', [['메모만 있는 탭']])],
      warnings: [],
    });

    const result = await parseWorkbook(Buffer.alloc(0), CTX);

    expect(result.tabs).toEqual([]);
    expect(codesOf(result.warnings)).toContain('HEADER_BAND_NOT_FOUND');
  });

  it('대시보드 탭은 건너뛰되 경고를 남기지 않는다 (E6 — 매 업로드마다 뜨는 잡음)', async () => {
    const workbook = await readWorkbook(readFileSync(FIXTURE));
    const dashboard = workbook.sheets.find((sheet) => sheet.name.includes('대시보드'));
    expect(dashboard).toBeDefined();

    vi.mocked(readWorkbook).mockResolvedValueOnce({ sheets: [dashboard!], warnings: [] });
    const result = await parseWorkbook(Buffer.alloc(0), CTX);

    expect(result.tabs).toEqual([]);
    expect(codesOf(result.warnings)).not.toContain('UNKNOWN_TAB');
    expect(codesOf(result.warnings)).toEqual(['SETTINGS_TAB_MISSING']);
  });

  it('어댑터가 던져도 나머지 탭은 계속 처리한다 (X2 부분 실패)', async () => {
    vi.mocked(editTeam.parseEditTeamTab).mockImplementationOnce(() => {
      throw new Error('/Users/누군가/secret/path 에서 터짐');
    });

    const result = await parseWorkbook(readFileSync(FIXTURE), CTX);

    expect(result.tabs.map((tab) => tab.sheet)).toEqual(['02_촬영·기획팀', '03_마케팅·관리팀']);
    const failed = result.warnings.filter((w) => w.code === 'TAB_PARSE_FAILED');
    expect(failed).toEqual([{ code: 'TAB_PARSE_FAILED', sheet: '01_편집팀' }]);
    // 예외 메시지·스택·내부 경로가 새지 않는다
    expect(JSON.stringify(result.warnings)).not.toContain('secret');
  });

  it('리더 경고(숨김 열 등)를 버리지 않는다 — 이 파이프라인이 유일한 호출자다', async () => {
    vi.mocked(readWorkbook).mockResolvedValueOnce({
      sheets: [grid('메모', [['오늘 할 일']])],
      warnings: [{ code: 'HIDDEN_COLUMN', sheet: '메모', column: 4 }],
    });

    const result = await parseWorkbook(Buffer.alloc(0), CTX);

    expect(result.warnings).toContainEqual({ code: 'HIDDEN_COLUMN', sheet: '메모', column: 4 });
  });
});
