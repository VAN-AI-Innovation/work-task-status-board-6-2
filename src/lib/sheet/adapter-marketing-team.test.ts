/**
 * 픽스처 `03_마케팅·관리팀`으로 세 섹션이 **각각 다른 목적지**로 가는지 고정한다 (T3 완료 기준 5).
 *
 * 이 파일이 지키는 급소 셋 —
 * - `담당자`와 `후속 담당자`가 뒤바뀌지 않는다 (접두 일치를 쓰면 뒤바뀐다).
 * - `계정·문의자`가 파싱 단계에서 살아 있다 (마스킹은 T6의 응답 계층이다).
 * - 섹션이 없어도 예외가 아니라 경고다 (부분 업로드 UC-04가 정상 경로다).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseGoalMetrics } from '@/lib/sheet/adapter-goal-metrics';
import { FIELD_MAP, parseMarketingTeamTab } from '@/lib/sheet/adapter-marketing-team';
import { splitSections } from '@/lib/sheet/section-splitter';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { SheetCell, SheetCellValue, SheetGrid } from '@/types/sheet';
import type { TabParseResult } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const SHEET_NAME = '03_마케팅·관리팀';
const CTX = { baseYear: 2026 } as const;

/** 격자를 만든다. 빈 문자열이 빈 셀이다 */
function grid(rows: SheetCellValue[][]): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  const cells: SheetCell[][] = rows.map((row) =>
    Array.from({ length: columnCount }, (_, column): SheetCell => {
      const entry = row[column];
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

describe('parseMarketingTeamTab — 픽스처 03_마케팅·관리팀', () => {
  let sheet: SheetGrid;
  let result: TabParseResult;

  beforeAll(async () => {
    const workbook = await readWorkbook(readFileSync(FIXTURE));
    const found = workbook.sheets.find((s) => s.name === SHEET_NAME);
    if (!found) throw new Error(`픽스처에 ${SHEET_NAME}이 없다`);
    sheet = found;
    result = parseMarketingTeamTab(sheet, CTX);
  });

  it('한 번의 호출로 태스크 3건 · 지표 3건 · 브리핑 5줄이 나온다 (완료 기준 5)', () => {
    expect(result.sheet).toBe(SHEET_NAME);
    expect(result.teamKey).toBe('marketing');
    expect(result.tasks).toHaveLength(3);
    expect(result.goalMetrics).toHaveLength(3);
    expect(result.briefingLines).toHaveLength(5);
    // 브리핑은 목표가 아니라 회고 문장이다 — team_period_goals로 새지 않는다.
    expect(result.teamPeriodGoals).toEqual([]);
  });

  it('태스크의 title이 문의 내용 요약이고 sourceKey가 문의 ID 값이다', () => {
    expect(result.tasks.map((t) => t.sourceKey)).toEqual([
      '[샘플] Q-001',
      '[샘플] Q-002',
      '[샘플] Q-003',
    ]);
    expect(result.tasks.map((t) => t.title)).toEqual([
      '[샘플] 협업 촬영 문의',
      '[샘플] 모집 일정 문의',
      '[샘플] 자료 요청',
    ]);
    expect(result.tasks.map((t) => t.sourceRowIndex)).toEqual([18, 19, 20]);
    expect(result.tasks.map((t) => t.teamKey)).toEqual(['marketing', 'marketing', 'marketing']);
  });

  it('`담당자`와 `후속 담당자`가 뒤바뀌지 않았다 (마지막 조각 정확 일치)', () => {
    expect(result.tasks[1].ownerNameRaw).toBe('마케터2');
    expect(result.tasks[1].nextActionOwner).toBe('마케터2');
    // 셋째 건에서 갈린다 — 담당자는 있고 후속 담당자는 비었다.
    expect(result.tasks[2].ownerNameRaw).toBe('마케터1');
    expect(result.tasks[2].nextActionOwner).toBeNull();
  });

  it('셋째 건의 dueAt이 null이다 — "기한 미설정"의 근거가 보존된다', () => {
    expect(result.tasks[0].dueAt).toBe('2026-07-22');
    expect(result.tasks[1].dueAt).toBe('2026-07-23');
    expect(result.tasks[2].dueAt).toBeNull();
  });

  it('상태·긴급도·후속 조치가 시트 원문 그대로다', () => {
    expect(result.tasks.map((t) => t.status)).toEqual(['답변 완료', '미답변', '보류']);
    expect(result.tasks.map((t) => t.priority)).toEqual(['높음', '보통', '낮음']);
    expect(result.tasks.map((t) => t.riskStatus)).toEqual(['완료', '진행 중', '보류']);
    expect(result.tasks[1].nextAction).toBe('모집 일정 확정 대기');
    expect(result.tasks[1].nextActionDue).toBe('2026-07-24');
    expect(result.tasks[1].note).toBe('일정 확정 후 회신');
    expect(result.tasks.map((t) => t.assignedAt)).toEqual([
      '2026-07-21',
      '2026-07-22',
      '2026-07-22',
    ]);
  });

  it('`계정·문의자`가 extras에 값째로 남는다 — 마스킹은 T6의 응답 계층이다', () => {
    expect(result.tasks[0].extras['계정·문의자']).toBe('sample_account_1');
    expect(result.tasks[1].extras['계정·문의자']).toBe('sample_account_2');
  });

  it('매핑되지 않은 컬럼이 누락 없이 extras에 남는다', () => {
    const rawKeys = Object.keys(result.tasks[0].raw);
    // 매핑 필드 + 문의 ID(sourceKey로 갔다)만 빠진다.
    expect(Object.keys(result.tasks[0].extras)).toHaveLength(rawKeys.length - FIELD_MAP.length - 1);

    for (const header of [
      '채널',
      '문의 유형',
      '접수 시간',
      '실제 답변일',
      '완료 여부',
      '답변 필요 여부',
      '답변 내용 요약',
    ]) {
      expect(result.tasks[0].extras).toHaveProperty(header);
    }
    for (const header of ['문의 ID', '담당자', '후속 담당자', '답변 기한']) {
      expect(result.tasks[0].extras).not.toHaveProperty(header);
      expect(result.tasks[0].raw).toHaveProperty(header);
    }
  });

  it('브리핑 첫 줄이 본문이고 배너 문자열은 들어 있지 않다', () => {
    expect(result.briefingLines[0]).toBe('직전 주 핵심 마케팅 성과');
    expect(result.briefingLines).not.toContain('C. 주간 회의 브리핑');
    expect(result.briefingLines[4]).toBe('[샘플] 다음 주 임원진 보고 자료 초안 준비');
  });

  it('B섹션 지표가 parseGoalMetrics의 결과와 같다 — 복제하지 않고 위임한다', () => {
    const b = splitSections(sheet).find((s) => s.key === 'B');
    if (!b) throw new Error('B섹션을 찾지 못했다');
    const delegated = parseGoalMetrics(sheet, b, { teamKey: 'marketing', baseYear: 2026 });
    expect(result.goalMetrics).toEqual(delegated.goalMetrics);
  });

  it('stages가 전부 빈 배열이다 — 마케팅 문의는 단계 컬럼 그룹이 없다', () => {
    expect(result.tasks.every((t) => t.stages.length === 0)).toBe(true);
  });

  it('경고에 셀 값·계정·이름이 들어 있지 않다', () => {
    for (const warning of result.warnings) {
      expect(Object.keys(warning).every((k) => ['code', 'sheet', 'row', 'column'].includes(k))).toBe(
        true
      );
      expect(warning.code).toMatch(/^[A-Z_]+$/);
      expect(warning.sheet).toBe(SHEET_NAME);
    }
  });
});

describe('parseMarketingTeamTab — 작은 격자', () => {
  it('A섹션만 있으면 태스크는 나오고 B·C에 MARKETING_SECTION_MISSING이 난다', () => {
    const sheet = grid([
      ['A. 상시 문의·SNS 관리', '', ''],
      ['문의 ID', '문의 내용 요약', '담당자'],
      ['[샘플] Q-001', '[샘플] 협업 문의', '마케터1'],
    ]);
    const result = parseMarketingTeamTab(sheet, CTX);

    expect(result.tasks.map((t) => t.sourceKey)).toEqual(['[샘플] Q-001']);
    expect(result.goalMetrics).toEqual([]);
    expect(result.briefingLines).toEqual([]);
    expect(result.warnings).toEqual([
      { code: 'MARKETING_SECTION_MISSING', sheet: '테스트' },
      { code: 'MARKETING_SECTION_MISSING', sheet: '테스트' },
    ]);
  });

  it('섹션이 하나도 없으면 예외 없이 빈 결과 + 경고 3건이다 (UC-04)', () => {
    const sheet = grid([
      ['문의 ID', '문의 내용 요약', '담당자'],
      ['[샘플] Q-001', '[샘플] 협업 문의', '마케터1'],
    ]);
    const result = parseMarketingTeamTab(sheet, CTX);

    expect(result.tasks).toEqual([]);
    expect(result.goalMetrics).toEqual([]);
    expect(result.briefingLines).toEqual([]);
    expect(result.teamKey).toBe('marketing');
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.every((w) => w.code === 'MARKETING_SECTION_MISSING')).toBe(true);
  });

  it('C섹션의 빈 행은 브리핑 줄이 되지 않는다', () => {
    const sheet = grid([
      ['C. 주간 회의 브리핑', ''],
      ['첫 줄', ''],
      ['', ''],
      ['셋째 줄', ''],
    ]);
    expect(parseMarketingTeamTab(sheet, CTX).briefingLines).toEqual(['첫 줄', '셋째 줄']);
  });
});
