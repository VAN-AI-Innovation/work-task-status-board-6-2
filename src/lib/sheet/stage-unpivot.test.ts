/**
 * 손으로 만든 작은 격자로 언피벗 규칙을 좁게 고정한다.
 * 실제 시트 검증은 어댑터(step 3·4)가 픽스처로 한다.
 */
import { describe, expect, it } from 'vitest';

import type { RowRecord } from '@/lib/sheet/row-mapper';
import { stageColumnLabels, unpivotStages, type StageGroupSpec } from '@/lib/sheet/stage-unpivot';
import type { HeaderColumn, SheetCellValue } from '@/types/sheet';

const CTX = { sheet: '테스트', baseYear: 2026 };

/** `[경로, 값]` 목록으로 한 행을 만든다. 컬럼 인덱스는 나열 순서다 */
function record(row: number, entries: [string[], SheetCellValue][]): RowRecord {
  const columns: HeaderColumn[] = entries.map(([path], index) => ({
    index,
    path,
    label: path.join(' / '),
  }));
  return {
    row,
    cells: new Map(
      columns.map((column, index) => [column.label, { value: entries[index][1], numFmt: null }])
    ),
    columns,
  };
}

const FULL_COLS = { planned: '예정일', actual: '실제', content: '내용', confirm: '확인' };

const groupA: StageGroupSpec = {
  key: 'first',
  label: '1단계',
  groupHeader: '1단계 (+2일)',
  slaDays: 2,
  cols: FULL_COLS,
};

const groupB: StageGroupSpec = {
  key: 'second',
  label: '2단계',
  groupHeader: '2단계 (+5일)',
  slaDays: 5,
  cols: FULL_COLS,
};

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe('unpivotStages', () => {
  it('그룹 2개 × 컬럼 4종이 단계 2행으로 펴지고 seq가 0·1이다', () => {
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], '2026-09-01'],
      [['1단계 (+2일)', '실제'], '2026-09-02'],
      [['1단계 (+2일)', '내용'], '초안 공유'],
      [['1단계 (+2일)', '확인'], true],
      [['2단계 (+5일)', '예정일'], '2026-09-08'],
      [['2단계 (+5일)', '실제'], null],
      [['2단계 (+5일)', '내용'], '촬영본 정리'],
      [['2단계 (+5일)', '확인'], false],
    ]);

    const { stages, warnings } = unpivotStages(row, [groupA, groupB], CTX);

    expect(warnings).toEqual([]);
    expect(stages).toHaveLength(2);
    expect(stages[0]).toEqual({
      seq: 0,
      stageKey: 'first',
      // 화면에 시트와 같은 글자가 떠야 사용자가 대조할 수 있다 — spec.label이 아니다.
      stageLabel: '1단계 (+2일)',
      plannedDate: '2026-09-01',
      actualDate: '2026-09-02',
      content: '초안 공유',
      confirmStatus: 'true',
      slaDays: 2,
    });
    expect(stages[1].seq).toBe(1);
    expect(stages[1].stageKey).toBe('second');
    expect(stages[1].actualDate).toBeNull();
  });

  it('두 그룹의 하위 라벨이 똑같아도 값이 섞이지 않는다', () => {
    // 이 모듈의 존재 이유. 라벨 마지막 조각만 보면 컬럼 8개가 4개로 뭉개진다.
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], '2026-09-01'],
      [['2단계 (+5일)', '예정일'], '2026-09-08'],
      [['1단계 (+2일)', '실제'], '2026-09-02'],
      [['2단계 (+5일)', '실제'], '2026-09-09'],
    ]);

    const { stages } = unpivotStages(row, [groupA, groupB], CTX);

    expect(stages[0].plannedDate).toBe('2026-09-01');
    expect(stages[0].actualDate).toBe('2026-09-02');
    expect(stages[1].plannedDate).toBe('2026-09-08');
    expect(stages[1].actualDate).toBe('2026-09-09');
  });

  it('불리언 확인 값을 임의로 해석하지 않는다', () => {
    // 상태 해석은 T4의 task-semantic이 설정 탭 레지스트리를 근거로 한다.
    const row = record(9, [[['1단계 (+2일)', '확인'], false]]);

    const { stages } = unpivotStages(row, [groupA], CTX);

    expect(stages[0].confirmStatus).toBe('false');
  });

  it('값이 전부 빈 그룹도 단계 행이 만들어진다', () => {
    // 단계가 아직 시작되지 않은 것과 단계가 없는 것은 다르다.
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], null],
      [['1단계 (+2일)', '실제'], null],
      [['1단계 (+2일)', '내용'], null],
      [['1단계 (+2일)', '확인'], null],
    ]);

    const { stages, warnings } = unpivotStages(row, [groupA], CTX);

    expect(warnings).toEqual([]);
    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      plannedDate: null,
      actualDate: null,
      content: null,
      confirmStatus: null,
    });
  });

  it('cols에 content가 없는 그룹은 시트에 그 컬럼이 있어도 content가 null이다', () => {
    const withoutContent: StageGroupSpec = {
      ...groupA,
      cols: { planned: '예정일', actual: '실제', confirm: '확인' },
    };
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], '2026-09-01'],
      [['1단계 (+2일)', '내용'], '읽으면 안 되는 값'],
      [['1단계 (+2일)', '확인'], '완료'],
    ]);

    const { stages } = unpivotStages(row, [withoutContent], CTX);

    expect(stages[0].content).toBeNull();
    expect(stages[0].plannedDate).toBe('2026-09-01');
    expect(stages[0].confirmStatus).toBe('완료');
  });

  it('slaDays가 그대로 실리고 null도 null로 남는다', () => {
    const noSla: StageGroupSpec = { ...groupB, slaDays: null };
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], null],
      [['2단계 (+5일)', '예정일'], null],
    ]);

    const { stages } = unpivotStages(row, [groupA, noSla], CTX);

    expect(stages[0].slaDays).toBe(2);
    expect(stages[1].slaDays).toBeNull();
  });

  it('groupHeader에 맞는 컬럼이 없으면 경고를 남기고 행은 그대로 만든다', () => {
    const row = record(9, [[['1단계 (+2일)', '예정일'], '2026-09-01']]);

    const { stages, warnings } = unpivotStages(row, [groupA, groupB], CTX);

    expect(stages).toHaveLength(2);
    expect(stages[1].stageKey).toBe('second');
    expect(stages[1].plannedDate).toBeNull();
    expect(warnings).toEqual([
      { code: 'STAGE_GROUP_NOT_FOUND', sheet: '테스트', row: 10 },
    ]);
  });

  it('1900-01-01 시리얼 날짜는 null이 되고 경고 좌표가 1-based로 승격된다', () => {
    const row = record(5, [
      [['1단계 (+2일)', '예정일'], null],
      [['1단계 (+2일)', '실제'], new Date(Date.UTC(1900, 0, 1))],
    ]);

    const { stages, warnings } = unpivotStages(row, [groupA], CTX);

    expect(stages[0].actualDate).toBeNull();
    expect(codes(warnings)).toEqual(['DATE_OUT_OF_RANGE']);
    expect(warnings[0]).toEqual({
      code: 'DATE_OUT_OF_RANGE',
      sheet: '테스트',
      row: 6,
      column: 2,
    });
  });
});

describe('stageColumnLabels', () => {
  it('그룹에 묶인 단계 컬럼 라벨을 전부 돌려준다', () => {
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], null],
      [['1단계 (+2일)', '실제'], null],
      [['1단계 (+2일)', '내용'], null],
      [['1단계 (+2일)', '확인'], null],
      [['2단계 (+5일)', '예정일'], null],
      [['2단계 (+5일)', '실제'], null],
      [['2단계 (+5일)', '내용'], null],
      [['2단계 (+5일)', '확인'], null],
      [['기본 업무정보', '업무명'], null],
    ]);

    expect(stageColumnLabels(row.columns, [groupA, groupB])).toEqual([
      '1단계 (+2일) / 예정일',
      '1단계 (+2일) / 실제',
      '1단계 (+2일) / 내용',
      '1단계 (+2일) / 확인',
      '2단계 (+5일) / 예정일',
      '2단계 (+5일) / 실제',
      '2단계 (+5일) / 내용',
      '2단계 (+5일) / 확인',
    ]);
  });

  it('cols가 가리키지 않는 그룹 내 컬럼은 남긴다', () => {
    // extras에서 지우면 어느 단계에도 실리지 않아 그대로 사라진다 (T3 완료 기준 3).
    const row = record(9, [
      [['1단계 (+2일)', '예정일'], null],
      [['1단계 (+2일)', '비고'], null],
    ]);

    expect(stageColumnLabels(row.columns, [groupA])).toEqual(['1단계 (+2일) / 예정일']);
  });

  it('맞는 컬럼이 없는 그룹은 아무 라벨도 내지 않는다', () => {
    const row = record(9, [[['기본 업무정보', '업무명'], null]]);

    expect(stageColumnLabels(row.columns, [groupA])).toEqual([]);
  });
});
