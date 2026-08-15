/**
 * 픽스처 `03_마케팅·관리팀` B섹션으로 실제 배치를 고정하고, 작은 격자로 경계 규칙을 좁힌다.
 *
 * 이 파일이 지키는 급소는 **달성률**이다 —
 * 120%가 경고 없이 나와야 하고(진행률이 아니다), 시트 값이 목표·실적과 어긋나도
 * 파서가 고치지 않아야 한다(재계산은 T4 `summarizeGoals`의 일이다).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { GOAL_FIELD_MAP, parseGoalMetrics } from '@/lib/sheet/adapter-goal-metrics';
import { splitSections, type SheetSection } from '@/lib/sheet/section-splitter';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { ParsedGoalMetric } from '@/types/goal';
import type { ParseWarning, SheetCell, SheetCellValue, SheetGrid } from '@/types/sheet';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const SHEET_NAME = '03_마케팅·관리팀';
const CTX = { teamKey: 'marketing', baseYear: 2026 } as const;

/** 격자를 만든다. `numFmt`가 필요한 셀은 `[값, 서식]`으로 준다 */
function grid(rows: (SheetCellValue | [SheetCellValue, string])[][]): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  const cells: SheetCell[][] = rows.map((row) =>
    Array.from({ length: columnCount }, (_, column): SheetCell => {
      const entry = row[column];
      if (Array.isArray(entry)) return { value: entry[0], numFmt: entry[1] };
      return { value: entry === undefined || entry === '' ? null : entry, numFmt: null };
    })
  );
  return {
    name: '테스트',
    rowCount: rows.length,
    columnCount,
    cells,
    merges: [],
    hiddenRows: [],
    hiddenColumns: [],
  };
}

/** 라벨 행 하나 + 데이터 행들로 이루어진 섹션 */
function section(labelRow: number, endRow: number): SheetSection {
  return {
    key: 'B',
    title: 'B. 주간 마케팅 실행·성과 관리',
    titleRow: labelRow - 1,
    startRow: labelRow,
    endRow,
    band: { groupRow: null, labelRow },
  };
}

describe('parseGoalMetrics — 픽스처 03_마케팅·관리팀 B섹션', () => {
  let sheet: SheetGrid;
  let metrics: ParsedGoalMetric[];
  let warnings: ParseWarning[];

  beforeAll(async () => {
    const workbook = await readWorkbook(readFileSync(FIXTURE));
    const found = workbook.sheets.find((s) => s.name === SHEET_NAME);
    if (!found) throw new Error(`픽스처에 ${SHEET_NAME}이 없다`);
    sheet = found;

    const b = splitSections(sheet).find((s) => s.key === 'B');
    if (!b) throw new Error('B섹션을 찾지 못했다');

    const result = parseGoalMetrics(sheet, b, CTX);
    metrics = result.goalMetrics;
    warnings = result.warnings;
  });

  it('지표가 정확히 3건이다 (헤더 행·배너가 섞이지 않는다)', () => {
    expect(metrics).toHaveLength(3);
    expect(metrics.map((m) => m.sourceRowIndex)).toEqual([25, 26, 27]);
    expect(metrics.map((m) => m.sourceSheetTab)).toEqual([SHEET_NAME, SHEET_NAME, SHEET_NAME]);
    expect(metrics.map((m) => m.teamKey)).toEqual(['marketing', 'marketing', 'marketing']);
  });

  it('첫 건의 목표·실적·달성률이 시트 값 그대로다', () => {
    expect(metrics[0].title).toBe('[샘플] 리그램 이벤트');
    expect(metrics[0].kpiName).toBe('유입수');
    expect(metrics[0].targetValue).toBe(100);
    expect(metrics[0].actualValue).toBe(120);
    expect(metrics[0].achievementRate).toBe(120);
  });

  it('둘째 건의 달성률이 82이고 PROGRESS_OUT_OF_RANGE가 없다 — toProgress를 쓰지 않았다', () => {
    expect(metrics[1].achievementRate).toBe(82);
    expect(warnings.map((w) => w.code)).not.toContain('PROGRESS_OUT_OF_RANGE');
  });

  it('셋째 건은 목표 40·실적 12인데 달성률 95를 그대로 둔다 — 재계산하지 않는다', () => {
    expect(metrics[2].targetValue).toBe(40);
    expect(metrics[2].actualValue).toBe(12);
    // 40 → 12면 30%지만 시트 값은 95%다. 불일치 판정은 T4 summarizeGoals의 일이다.
    expect(metrics[2].achievementRate).toBe(95);
  });

  it('기준 주차와 직전 주 대비 변화가 문자열 원문이다', () => {
    expect(metrics.map((m) => m.periodLabel)).toEqual([
      '2026-07 4주차',
      '2026-07 4주차',
      '2026-07 4주차',
    ]);
    expect(metrics.map((m) => m.prevPeriodDelta)).toEqual(['+18%', '-4%', '신규']);
  });

  it('목표·성과 분석·잘된 점·개선 필요사항이 채워진다', () => {
    expect(metrics[0].goalText).toBe('신규 팔로워 확보');
    expect(metrics[0].analysis).toBe('[샘플] 참여 유도 문구가 효과적');
    expect(metrics[0].wentWell).toBe('[샘플] 반응 속도 빠름');
    expect(metrics[0].needsImprovement).toBe('[샘플] 경품 안내 보완');
    expect(metrics.every((m) => m.goalText !== null && m.analysis !== null)).toBe(true);
  });

  it('`목표`가 `목표 KPI`·`목표 수치`를 잡아채지 않는다 (마지막 조각 정확 일치)', () => {
    expect(metrics[1].goalText).toBe('저장수 증대');
    expect(metrics[1].kpiName).toBe('저장수');
    expect(metrics[1].targetValue).toBe(50);
  });

  it('실행 시작일·기한이 YYYY-MM-DD다', () => {
    expect(metrics[0].startedAt).toBe('2026-07-21');
    expect(metrics[0].dueAt).toBe('2026-07-27');
    expect(metrics[2].startedAt).toBe('2026-07-24');
    expect(metrics[2].dueAt).toBe('2026-07-30');
  });

  it('담당자·채널·실행 상태가 실행 컬럼에서 온다 (제안자가 아니다)', () => {
    expect(metrics.map((m) => m.ownerNameRaw)).toEqual(['마케터1', '마케터2', '마케터2']);
    expect(metrics.map((m) => m.channel)).toEqual(['인스타그램', '유튜브', '오프라인']);
    expect(metrics.map((m) => m.execStatus)).toEqual(['완료', '진행 중', '진행 중']);
  });

  it('매핑되지 않은 컬럼이 누락 없이 extras에 남는다', () => {
    const rawKeys = Object.keys(metrics[0].raw);
    expect(Object.keys(metrics[0].extras)).toHaveLength(rawKeys.length - GOAL_FIELD_MAP.length);

    for (const header of ['회의일', '제안자', '대상', '실행 방식', '관련 링크', '비고']) {
      expect(metrics[0].extras).toHaveProperty(header);
    }
    // 매핑된 컬럼은 extras에 없다 — raw에는 남는다.
    for (const header of ['마케팅 과제명', '달성률', '목표 수치']) {
      expect(metrics[0].extras).not.toHaveProperty(header);
      expect(metrics[0].raw).toHaveProperty(header);
    }
  });

  it('`관련 링크`의 하이퍼링크 URL이 extras에 보존된다', () => {
    expect(metrics[0].extras['관련 링크']).toEqual({
      text: '실행 기록',
      hyperlink: 'https://example.test/marketing/1',
    });
  });

  it('경고에 셀 값·과제명·담당자가 들어 있지 않다', () => {
    for (const warning of warnings) {
      expect(Object.keys(warning).sort()).toEqual(
        expect.arrayContaining(['code', 'sheet'])
      );
      expect(Object.keys(warning).every((k) => ['code', 'sheet', 'row', 'column'].includes(k))).toBe(
        true
      );
      expect(warning.code).toMatch(/^[A-Z_]+$/);
      expect(warning.sheet).toBe(SHEET_NAME);
    }
  });
});

describe('parseGoalMetrics — 작은 격자', () => {
  it('band가 null이면 빈 결과이고 경고가 없다', () => {
    const sheet = grid([
      ['직전 주 핵심 마케팅 성과'],
      ['[샘플] 리그램 이벤트로 신규 팔로워 120명 유입'],
    ]);
    const free: SheetSection = {
      key: 'C',
      title: 'C. 주간 회의 브리핑',
      titleRow: 0,
      startRow: 1,
      endRow: 1,
      band: null,
    };
    expect(parseGoalMetrics(sheet, free, CTX)).toEqual({ goalMetrics: [], warnings: [] });
  });

  it('신원 컬럼이 수식뿐인 행은 지표가 되지 않는다 (E1)', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자', '목표 수치', '달성률'],
      ['[샘플] 실행1', '마케터1', 10, [0.5, '0%']],
      [{ formula: 'A2', result: '' }, { sharedFormula: 'B2', result: '' }, 0, [0, '0%']],
    ]);
    const result = parseGoalMetrics(sheet, section(0, 2), CTX);
    expect(result.goalMetrics).toHaveLength(1);
    expect(result.goalMetrics[0].achievementRate).toBe(50);
    expect(result.warnings).toEqual([]);
  });

  it('숨김 행은 건너뛴다 (E6)', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자'],
      ['[샘플] 실행1', '마케터1'],
      ['[샘플] 실행2', '마케터2'],
    ]);
    sheet.hiddenRows = [1];
    const result = parseGoalMetrics(sheet, section(0, 2), CTX);
    expect(result.goalMetrics.map((m) => m.title)).toEqual(['[샘플] 실행2']);
  });

  it('퍼센트 서식이 아닌 달성률은 곱하지 않는다', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자', '달성률'],
      ['[샘플] 실행1', '마케터1', 120],
    ]);
    const result = parseGoalMetrics(sheet, section(0, 1), CTX);
    expect(result.goalMetrics[0].achievementRate).toBe(120);
    expect(result.warnings).toEqual([]);
  });

  it('셀 오류는 값을 버리고 1-based 좌표 경고만 남긴다', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자', '목표 수치'],
      ['[샘플] 실행1', '마케터1', { error: '#REF!' }],
    ]);
    const result = parseGoalMetrics(sheet, section(0, 1), CTX);
    expect(result.goalMetrics[0].targetValue).toBeNull();
    expect(result.warnings).toEqual([
      { code: 'CELL_ERROR', sheet: '테스트', row: 2, column: 3 },
    ]);
  });

  it('과제명이 비면 지표를 버리지 않고 GOAL_TITLE_MISSING만 남긴다', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자'],
      ['', '마케터1'],
    ]);
    const result = parseGoalMetrics(sheet, section(0, 1), CTX);
    expect(result.goalMetrics).toHaveLength(1);
    expect(result.goalMetrics[0].title).toBeNull();
    expect(result.warnings).toEqual([
      { code: 'GOAL_TITLE_MISSING', sheet: '테스트', row: 2 },
    ]);
  });

  it('같은 헤더가 둘이면 AMBIGUOUS_FIELD_HEADER를 남기고 첫 컬럼을 쓴다', () => {
    const sheet = grid([
      ['마케팅 과제명', '실행 담당자', '달성률', '달성률'],
      ['[샘플] 실행1', '마케터1', [0.5, '0%'], [0.9, '0%']],
    ]);
    const result = parseGoalMetrics(sheet, section(0, 1), CTX);
    expect(result.goalMetrics[0].achievementRate).toBe(50);
    expect(result.warnings).toEqual([
      { code: 'AMBIGUOUS_FIELD_HEADER', sheet: '테스트', row: 1, column: 3 },
    ]);
  });
});
