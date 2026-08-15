/**
 * 픽스처(`sample-workbook.xlsx`)의 `01_편집팀`을 통합 검증한다.
 *
 * 밴드를 손으로 적지 않고 `detectTab`에서 꺼낸다 — 파이프라인(step 8)이 넘길 값과
 * 같은 경로여야 "테스트는 통과하는데 제품은 다른 헤더를 본다"가 생기지 않는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseEditTeamTab } from '@/lib/sheet/adapter-edit-team';
import { detectTab } from '@/lib/sheet/tab-detector';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { ParseWarning } from '@/types/sheet';
import type { ParsedTask, TabParseResult } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const BASE_YEAR = 2026;

let result: TabParseResult;

beforeAll(async () => {
  const workbook = await readWorkbook(readFileSync(FIXTURE));
  const sheet = workbook.sheets.find((s) => s.name === '01_편집팀');
  if (!sheet) throw new Error('픽스처에 01_편집팀이 없다');

  const detection = detectTab(sheet);
  expect(detection.kind).toBe('edit_team');
  // 판별은 T2가 끝냈다. 어댑터는 그 결과를 받기만 한다.
  expect(detection.matches[0].band).toEqual({ groupRow: 7, labelRow: 8 });

  result = parseEditTeamTab(sheet, detection.matches[0].band, { baseYear: BASE_YEAR });
});

/** 0-based 행 좌표로 태스크를 집는다 (`sourceRowIndex`는 1-based다) */
const atRow = (row: number): ParsedTask => {
  const found = result.tasks.find((t) => t.sourceRowIndex === row + 1);
  if (!found) throw new Error(`태스크가 없다: 0-based ${row}`);
  return found;
};

const codesAt = (row: number): string[] =>
  result.warnings.filter((w) => w.row === row + 1).map((w) => w.code);

describe('parseEditTeamTab — 행 판정', () => {
  it('탭 결과가 편집팀이고 목표 지표·브리핑은 비어 있다', () => {
    expect(result.sheet).toBe('01_편집팀');
    expect(result.teamKey).toBe('edit');
    expect(result.goalMetrics).toEqual([]);
    expect(result.teamPeriodGoals).toEqual([]);
    expect(result.briefingLines).toEqual([]);
  });

  it('태스크가 정확히 5건이고 숨김 행이 빠진다', () => {
    // 숨김 행(0-based 12)은 신원 컬럼에 값이 있다 — 건너뛰지 않으면 6건이 된다 (E6).
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.map((t) => t.sourceRowIndex)).toEqual([10, 11, 12, 14, 15]);
    expect(result.tasks.map((t) => t.title)).not.toContain('[샘플] 비공개 작업 D');
  });

  it('모든 태스크가 teamKey edit이다', () => {
    expect(result.tasks.every((t) => t.teamKey === 'edit')).toBe(true);
  });
});

describe('parseEditTeamTab — 단계 언피벗', () => {
  it('태스크마다 단계가 정확히 3행이고 seq가 0·1·2다', () => {
    for (const task of result.tasks) {
      expect(task.stages.map((s) => s.seq)).toEqual([0, 1, 2]);
      expect(task.stages.map((s) => s.stageKey)).toEqual(['concept', 'production', 'final']);
    }
  });

  it('slaDays가 그룹 헤더의 (+N일)에서 온 2·5·7이다', () => {
    // 설정 탭 SLA 표와 잇는 일은 T4다. 여기서는 헤더 원문이 근거다.
    expect(atRow(9).stages.map((s) => s.slaDays)).toEqual([2, 5, 7]);
  });

  it('stageLabel이 시트 그룹 헤더 원문이다', () => {
    expect(atRow(9).stages.map((s) => s.stageLabel)).toEqual([
      '컨셉·레퍼런스 (+2일)',
      '제작 진행 (+5일)',
      '최종본·업로드 (+7일)',
    ]);
  });

  it('세 번째 그룹은 내용 컬럼이 없어 content가 항상 null이다', () => {
    // 시트의 M~O가 3컬럼이다. 오타가 아니다.
    expect(result.tasks.every((t) => t.stages[2].content === null)).toBe(true);
  });

  it('두 그룹의 예정일이 서로 다른 값이다', () => {
    // 하위 라벨(`예정일`)이 그룹마다 반복된다 — 마지막 조각만 보면 값이 섞인다.
    const task = atRow(9);
    expect(task.stages[0].plannedDate).toBe('2026-07-22');
    expect(task.stages[1].plannedDate).toBe('2026-07-25');
    expect(task.stages[2].plannedDate).toBe('2026-07-27');
  });
});

describe('parseEditTeamTab — 셀 형태별 값', () => {
  it('0-based 9행: 수식 result가 Date·퍼센트·문자열 날짜까지 수렴한다', () => {
    const task = atRow(9);

    expect(task.title).toBe('[샘플] 카드뉴스 A');
    expect(task.ownerNameRaw).toBe('담당자1');
    expect(task.progress).toBe(33); // 0.33 + `0%` 서식 (E3)
    expect(task.assignedAt).toBe('2026-07-20');
    expect(task.stages[0].actualDate).toBe('2026-07-22'); // '2026.07.22' 문자열
    expect(task.stages[0].confirmStatus).toBe('true');
    expect(task.stages[1].confirmStatus).toBe('false');
  });

  it('0-based 10행: result 없는 공유 수식은 null + FORMULA_WITHOUT_RESULT다', () => {
    const task = atRow(10);

    expect(task.progress).toBeNull(); // 0으로 뭉개면 팀 진행률이 바닥으로 끌린다
    expect(task.stages[0].plannedDate).toBeNull();
    expect(codesAt(10)).toContain('FORMULA_WITHOUT_RESULT');
  });

  it('0-based 10행: 배정일 시리얼 숫자 46000이 날짜로 변환된다', () => {
    expect(atRow(10).assignedAt).toBe('2025-12-09');
  });

  it('0-based 11행: 연도 없는 9/1이 baseYear로 채워지고 #REF!는 CELL_ERROR다', () => {
    const task = atRow(11);

    expect(task.stages[0].plannedDate).toBe(`${BASE_YEAR}-09-01`);
    expect(task.stages[0].actualDate).toBeNull(); // '-'는 정상적인 빈칸이다
    expect(task.stages[0].content).toBeNull();
    expect(codesAt(11)).toContain('CELL_ERROR');
  });

  it('리치텍스트 비고가 조각을 이어붙인 문자열이 된다', () => {
    expect(atRow(9).note).toBe('컨셉 확정 승인자1 확인 필요');
  });
});

describe('parseEditTeamTab — 자연키', () => {
  it('세로 병합된 두 행은 업무명이 같아도 sourceKey가 다르다', () => {
    const first = atRow(13);
    const second = atRow(14);

    expect(first.title).toBe('[샘플] 시리즈 E');
    expect(second.title).toBe('[샘플] 시리즈 E');
    expect(first.ownerNameRaw).toBe('담당자2');
    expect(second.ownerNameRaw).toBe('담당자3');
    expect(first.sourceKey).not.toBe(second.sourceKey);
  });

  it('DUPLICATE_SOURCE_KEY 경고가 없다', () => {
    // 담당자가 자연키에 들어 있으니 합쳐지면 안 된다 (E5).
    expect(result.warnings.map((w) => w.code)).not.toContain('DUPLICATE_SOURCE_KEY');
    expect(new Set(result.tasks.map((t) => t.sourceKey)).size).toBe(5);
  });
});

describe('parseEditTeamTab — extras와 raw', () => {
  it('extras에 단계 컬럼이 하나도 없다', () => {
    // 들어가면 사이드 패널에 같은 값이 단계와 extras로 두 번 뜬다.
    for (const task of result.tasks) {
      for (const key of Object.keys(task.extras)) {
        expect(key).not.toMatch(/예정일|실제|내용|확인/);
      }
    }
  });

  it('16컬럼이 전부 raw에 남고 매핑·단계 컬럼이 extras에서 빠진다', () => {
    const task = atRow(9);
    const rawKeys = Object.keys(task.raw);

    expect(rawKeys).toHaveLength(16);
    expect(rawKeys).toContain('기본 업무정보 / 업무명');
    expect(rawKeys).toContain('컨셉·레퍼런스 (+2일) / 예정일');
    expect(rawKeys).toContain('제작 진행 (+5일) / 예정일');
    expect(rawKeys).toContain('최종본·업로드 (+7일) / 확인');
    expect(rawKeys).toContain('비고');
    // 편집팀 16컬럼은 5개가 필드로, 11개가 단계로 간다 — 남는 컬럼이 없다.
    expect(Object.keys(task.extras)).toEqual([]);
  });

  it('하이퍼링크 셀의 URL이 raw에 보존되고 stages에는 표시 문자열이 실린다', () => {
    const task = atRow(9);

    expect(task.stages[0].content).toBe('컨셉 문서');
    expect(task.stages[1].content).toBe('제작 파일');
    expect(task.raw['컨셉·레퍼런스 (+2일) / 내용']).toEqual({
      text: '컨셉 문서',
      hyperlink: 'https://example.test/docs/concept-a',
    });
    expect(task.raw['제작 진행 (+5일) / 내용']).toEqual({
      text: '제작 파일',
      hyperlink: 'https://example.test/canva/card-a',
    });
  });
});

describe('parseEditTeamTab — 경고 위생', () => {
  it('경고에 셀 값·업무명·담당자가 들어 있지 않다', () => {
    const allowed = new Set(['code', 'sheet', 'row', 'column']);

    for (const warning of result.warnings as ParseWarning[]) {
      expect(Object.keys(warning).every((key) => allowed.has(key))).toBe(true);
      expect(warning.sheet).toBe('01_편집팀');
    }
    expect(JSON.stringify(result.warnings)).not.toMatch(/샘플|담당자|승인자|example\.test/);
  });

  it('좌표가 1-based로 올라간다', () => {
    for (const warning of result.warnings) {
      if (warning.row !== undefined) expect(warning.row).toBeGreaterThanOrEqual(1);
      if (warning.column !== undefined) expect(warning.column).toBeGreaterThanOrEqual(1);
    }
  });
});
