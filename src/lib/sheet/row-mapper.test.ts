/**
 * 손으로 만든 작은 격자로 판정 규칙을 하나씩 좁게 고정한다.
 * 픽스처 통합 검증은 어댑터(step 3·4)가 진짜 시트로 한다 — 여기서 픽스처를 쓰면
 * 통과한 이유가 규칙 때문인지 그 시트의 우연 때문인지 구분되지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { mapRows, type RowMapSpec } from '@/lib/sheet/row-mapper';
import type { SheetCell, SheetCellValue, SheetGrid } from '@/types/sheet';

type CellInput = SheetCellValue | { value: SheetCellValue; numFmt: string | null };

function cell(input: CellInput): SheetCell {
  if (input !== null && typeof input === 'object' && 'numFmt' in input) {
    return { value: input.value, numFmt: input.numFmt };
  }
  return { value: input as SheetCellValue, numFmt: null };
}

function grid(rows: CellInput[][], hiddenRows: number[] = []): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  return {
    name: '테스트',
    rowCount: rows.length,
    columnCount,
    cells: rows.map((row) =>
      Array.from({ length: columnCount }, (_, c) => cell(c < row.length ? row[c] : null))
    ),
    merges: [],
    hiddenRows,
    hiddenColumns: [],
  };
}

const BAND = { groupRow: null, labelRow: 0 };

/** 업무명·담당자만 매핑하는 최소 스펙 */
const baseSpec: RowMapSpec = {
  teamKey: 'edit',
  identityHeaders: ['업무명', '담당자'],
  fieldMap: [
    { header: '업무명', field: 'title', kind: 'text' },
    { header: '담당자', field: 'ownerNameRaw', kind: 'text' },
  ],
  baseYear: 2026,
};

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe('행 선별', () => {
  it('신원 컬럼이 전부 비면 다른 컬럼에 값이 있어도 태스크가 아니고 경고도 없다', () => {
    // E1 — 유령 행 25건이 만드는 값이 정확히 이 모양이다.
    // 25건이 25개의 경고가 되면 진짜 경고가 묻힌다.
    const sheet = grid([
      ['업무명', '담당자', '진행률', '확인'],
      [null, null, { value: 0, numFmt: '0%' }, false],
      [null, null, { value: 0, numFmt: '0%' }, false],
    ]);

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.tasks).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('신원 컬럼의 값이 수식뿐이면 태스크가 아니다', () => {
    // 수식 결과 컬럼으로 행을 살리면 유령 행이 그대로 되살아난다.
    const sheet = grid([
      ['업무명', '담당자', '비고'],
      [{ formula: 'IF(A3="","",A3)', result: '카드뉴스' }, { sharedFormula: 'B2', result: '담당자1' }, null],
    ]);

    expect(mapRows(sheet, BAND, baseSpec).tasks).toHaveLength(0);
  });

  it('신원 컬럼 하나에만 값이 있어도 태스크다', () => {
    const sheet = grid([
      ['업무명', '담당자', '비고'],
      ['카드뉴스', null, null],
    ]);

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe('카드뉴스');
    expect(result.tasks[0].ownerNameRaw).toBeNull();
    expect(result.tasks[0].sourceSheetTab).toBe('테스트');
    expect(result.tasks[0].sourceRowIndex).toBe(2); // 1-based
    expect(result.tasks[0].teamKey).toBe('edit');
    expect(result.tasks[0].stages).toEqual([]); // 언피벗은 이 엔진의 일이 아니다
  });

  it('숨김 행은 신원 컬럼에 값이 있어도 건너뛴다', () => {
    const sheet = grid(
      [
        ['업무명', '담당자', '비고'],
        ['임시 메모', '담당자1', null],
        ['카드뉴스', '담당자2', null],
      ],
      [1]
    );

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe('카드뉴스');
  });

  it('range 밖의 행은 읽지 않는다', () => {
    const sheet = grid([
      ['업무명', '담당자', '비고'],
      ['A섹션 업무', '담당자1', null],
      ['B섹션 업무', '담당자2', null],
      ['C섹션 업무', '담당자3', null],
    ]);

    const result = mapRows(sheet, BAND, baseSpec, { startRow: 2, endRow: 2 });

    expect(result.tasks.map((t) => t.title)).toEqual(['B섹션 업무']);
  });
});

describe('extras · raw — 컬럼 누락 금지', () => {
  const spec: RowMapSpec = {
    ...baseSpec,
    idHeader: '업무ID',
    coOwnerHeader: '공동 담당자',
  };

  const sheet = grid([
    ['업무ID', '업무명', '담당자', '공동 담당자', '진행률', '비고', '링크'],
    [
      'E-001',
      '카드뉴스',
      '담당자1',
      '담당자2, 담당자3',
      { value: 0.66, numFmt: '0%' },
      null,
      { text: '기획안', hyperlink: 'https://example.test/doc' },
    ],
  ]);

  it('매핑되지 않은 컬럼이 전부 extras에 남는다', () => {
    const [task] = mapRows(sheet, BAND, spec).tasks;

    // 전체 7컬럼 − 매핑 2 − idHeader 1 − coOwnerHeader 1 = 3
    expect(Object.keys(task.extras).sort()).toEqual(['링크', '비고', '진행률'].sort());
    expect(Object.keys(task.raw)).toHaveLength(7);
  });

  it('매핑되지 않은 신원 컬럼도 extras에 남는다', () => {
    // 판정에 썼다는 이유로 지우면 완료 기준 3(누락 없음)이 깨진다.
    const shootLike: RowMapSpec = {
      teamKey: 'shoot',
      identityHeaders: ['프로젝트명', '촬영 담당자'],
      fieldMap: [{ header: '프로젝트명', field: 'title', kind: 'text' }],
      baseYear: 2026,
    };
    const shootSheet = grid([
      ['프로젝트명', '촬영 담당자'],
      ['브이로그', '담당자1'],
    ]);

    const [task] = mapRows(shootSheet, BAND, shootLike).tasks;

    expect(task.extras['촬영 담당자']).toBe('담당자1');
  });

  it('값이 null인 미매핑 컬럼도 키가 남는다', () => {
    const [task] = mapRows(sheet, BAND, spec).tasks;

    // 키가 있어야 "컬럼이 있는데 비었다"와 "컬럼이 없다"가 구분된다.
    expect('비고' in task.extras).toBe(true);
    expect(task.extras['비고']).toBeNull();
  });

  it('하이퍼링크 셀이 text·hyperlink 둘 다 보존된다', () => {
    const [task] = mapRows(sheet, BAND, spec).tasks;

    expect(task.extras['링크']).toEqual({ text: '기획안', hyperlink: 'https://example.test/doc' });
    expect(task.raw['링크']).toEqual({ text: '기획안', hyperlink: 'https://example.test/doc' });
  });

  it('매핑된 컬럼·idHeader·coOwnerHeader도 raw에는 남는다', () => {
    const [task] = mapRows(sheet, BAND, spec).tasks;

    expect(task.raw['업무ID']).toBe('E-001');
    expect(task.raw['업무명']).toBe('카드뉴스');
    expect(task.raw['공동 담당자']).toBe('담당자2, 담당자3');
    expect(task.coOwnerNames).toEqual(['담당자2', '담당자3']);
  });

  it('excludeFromExtras로 넘긴 라벨은 extras에서만 빠지고 raw에는 남는다', () => {
    const [task] = mapRows(sheet, BAND, { ...spec, excludeFromExtras: ['진행률'] }).tasks;

    expect('진행률' in task.extras).toBe(false);
    expect(task.raw['진행률']).toBe(0.66);
  });
});

describe('sourceKey와 중복 검출', () => {
  it('idHeader 값이 있으면 그것이 sourceKey다', () => {
    const sheet = grid([
      ['업무ID', '업무명', '담당자'],
      ['E-001', '카드뉴스', '담당자1'],
    ]);

    const [task] = mapRows(sheet, BAND, { ...baseSpec, idHeader: '업무ID' }).tasks;

    expect(task.sourceKey).toBe('E-001');
  });

  it('idHeader가 없으면 slug(업무명)::slug(담당자)다', () => {
    const sheet = grid([
      ['업무명', '담당자'],
      ['  카드 뉴스  ', '담당자1'],
    ]);

    const [task] = mapRows(sheet, BAND, baseSpec).tasks;

    // 한글을 지우거나 음차하지 않는다.
    expect(task.sourceKey).toBe('카드-뉴스::담당자1');
  });

  it('중복 sourceKey는 경고 1건을 남기고 두 태스크를 모두 돌려준다', () => {
    // 조용히 덮어쓰면 미리보기의 "신규 N건"이 오히려 줄어들어 사람이 감지할 수 없다 (E5).
    const sheet = grid([
      ['업무명', '담당자'],
      ['카드뉴스', '담당자1'],
      ['카드뉴스', '담당자1'],
    ]);

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.tasks).toHaveLength(2);
    expect(codes(result.warnings).filter((c) => c === 'DUPLICATE_SOURCE_KEY')).toHaveLength(1);
  });

  it('경고에 sourceKey·업무명·담당자 문자열이 담기지 않는다', () => {
    const sheet = grid([
      ['업무명', '담당자'],
      ['카드뉴스', '담당자1'],
      ['카드뉴스', '담당자1'],
    ]);

    const serialized = JSON.stringify(mapRows(sheet, BAND, baseSpec).warnings);

    expect(serialized).not.toContain('카드뉴스');
    expect(serialized).not.toContain('담당자1');
    expect(serialized).not.toContain('카드-뉴스');
  });
});

describe('값 매핑', () => {
  it('cell-normalizer의 경고가 1-based 좌표로 승격된다', () => {
    // 엑셀 시리얼 2 = 1900-01-01. 유령 행 아티팩트라 null로 떨어진다 (E1).
    const sheet = grid([
      ['업무명', '담당자', '기한'],
      ['카드뉴스', '담당자1', 2],
    ]);
    const spec: RowMapSpec = {
      ...baseSpec,
      fieldMap: [...baseSpec.fieldMap, { header: '기한', field: 'dueAt', kind: 'date' }],
    };

    const result = mapRows(sheet, BAND, spec);

    expect(result.tasks[0].dueAt).toBeNull();
    expect(result.warnings).toContainEqual({
      code: 'DATE_OUT_OF_RANGE',
      sheet: '테스트',
      row: 2,
      column: 3,
    });
  });

  it('진행률은 퍼센트 서식을 반영해 0~100 정수가 된다', () => {
    const sheet = grid([
      ['업무명', '담당자', '진행률'],
      ['카드뉴스', '담당자1', { value: 0.66, numFmt: '0%' }],
    ]);
    const spec: RowMapSpec = {
      ...baseSpec,
      fieldMap: [...baseSpec.fieldMap, { header: '진행률', field: 'progress', kind: 'progress' }],
    };

    expect(mapRows(sheet, BAND, spec).tasks[0].progress).toBe(66);
  });

  it('마지막 조각이 정확히 일치할 때만 매칭된다', () => {
    // 접두 일치를 쓰면 `담당자`가 `후속 담당자`를 잡아 값이 뒤바뀐다.
    const sheet = grid([
      ['업무명', '후속 담당자'],
      ['카드뉴스', '담당자9'],
    ]);

    const [task] = mapRows(sheet, BAND, baseSpec).tasks;

    expect(task.ownerNameRaw).toBeNull();
    expect(task.extras['후속 담당자']).toBe('담당자9');
  });

  it('같은 마지막 조각을 가진 컬럼이 둘이면 AMBIGUOUS_FIELD_HEADER가 시트당 1건이다', () => {
    const sheet = grid([
      ['기획', '후속', '상세'],
      ['담당자', '담당자', '업무명'],
      ['담당자1', '담당자9', '카드뉴스'],
      ['담당자2', '담당자8', '릴스'],
    ]);

    const result = mapRows(sheet, { groupRow: 0, labelRow: 1 }, baseSpec);

    // 행마다가 아니라 시트당 한 번이다.
    expect(codes(result.warnings).filter((c) => c === 'AMBIGUOUS_FIELD_HEADER')).toHaveLength(1);
    // 첫 컬럼을 쓴다.
    expect(result.tasks.map((t) => t.ownerNameRaw)).toEqual(['담당자1', '담당자2']);
  });
});

describe('검증 · records', () => {
  it('검증 실패는 경고가 될 뿐 태스크를 버리지 않는다', () => {
    const sheet = grid([
      ['업무명', '담당자'],
      [null, '담당자1'],
    ]);

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.tasks).toHaveLength(1);
    expect(codes(result.warnings)).toContain('TASK_TITLE_MISSING');
  });

  it('records가 tasks와 같은 순서로 라벨 색인된 행을 돌려준다', () => {
    const sheet = grid([
      ['업무명', '담당자'],
      ['카드뉴스', '담당자1'],
    ]);

    const result = mapRows(sheet, BAND, baseSpec);

    expect(result.records).toHaveLength(result.tasks.length);
    expect(result.records[0].row).toBe(1); // 0-based
    expect(result.records[0].cells.get('업무명')?.value).toBe('카드뉴스');
    expect(result.records[0].columns.map((c) => c.label)).toEqual(['업무명', '담당자']);
  });
});
