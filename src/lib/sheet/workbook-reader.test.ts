/**
 * 픽스처(`sample-workbook.xlsx`)의 계약을 고정한다.
 * 파일 경로가 아니라 **Buffer**로 넘긴다 — 제품 경로(T5 업로드)가 바이트를 받기 때문이다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { toProgress, unwrapCellValue } from '@/lib/sheet/cell-normalizer';
import { ArchiveLimitError, readWorkbook, WorkbookReadError } from '@/lib/sheet/workbook-reader';
import { WORKBOOK_LIMITS, type WorkbookLimits } from '@/lib/upload/upload-limits';
import type { SheetGrid, WorkbookGrid } from '@/types/sheet';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

let wb: WorkbookGrid;
const sheet = (name: string): SheetGrid => {
  const found = wb.sheets.find((s) => s.name === name);
  if (!found) throw new Error(`픽스처에 시트가 없다: ${name}`);
  return found;
};

beforeAll(async () => {
  wb = await readWorkbook(readFileSync(FIXTURE));
});

describe('readWorkbook — 시트 순회', () => {
  it('워크시트 5개가 파일 순서 그대로 나온다', () => {
    expect(wb.sheets.map((s) => s.name)).toEqual([
      '00_통합 대시보드',
      '01_편집팀',
      '02_촬영·기획팀',
      '03_마케팅·관리팀',
      '99_설정',
    ]);
  });

  it('02_촬영·기획팀의 columnCount가 71이고 헤더 행(0-based 8)이 71개 차 있다', () => {
    const shoot = sheet('02_촬영·기획팀');
    expect(shoot.columnCount).toBe(71);
    expect(shoot.cells[8]).toHaveLength(71);
    expect(shoot.cells[8].filter((c) => c.value !== null)).toHaveLength(71);
  });

  it('모든 행의 길이가 columnCount로 맞춰지고 빈 셀도 자리를 채운다', () => {
    for (const s of wb.sheets) {
      expect(s.cells).toHaveLength(s.rowCount);
      for (const row of s.cells) expect(row).toHaveLength(s.columnCount);
    }
    // 01_편집팀 N10(0-based [9][13])은 값이 없지만 자리는 있다.
    expect(sheet('01_편집팀').cells[9][13]).toEqual({ value: null, numFmt: null });
  });
});

describe('readWorkbook — dimensions 기준 절단 (A7)', () => {
  it('00_통합 대시보드의 rowCount가 dimensions 기준이라 패딩 행이 들어오지 않는다', () => {
    const dash = sheet('00_통합 대시보드');
    // 픽스처는 r41~r200을 값 없이 서식만 채워 exceljs의 rowCount를 200으로 부풀린다.
    expect(dash.rowCount).toBe(19);
    expect(dash.rowCount).toBeLessThan(41);
    expect(dash.cells).toHaveLength(19);
  });
});

describe('readWorkbook — 병합 (완료 기준 8)', () => {
  it('세로 병합 A14:A15의 두 셀이 같은 값을 갖는다', () => {
    const edit = sheet('01_편집팀');
    expect(edit.cells[13][0].value).toBe('[샘플] 시리즈 E');
    expect(edit.cells[14][0].value).toBe(edit.cells[13][0].value);
  });

  it('merges에 세로 병합과 r8 가로 병합이 0-based 범위로 들어 있다', () => {
    const edit = sheet('01_편집팀');
    expect(edit.merges).toContainEqual({ top: 13, left: 0, bottom: 14, right: 0 }); // A14:A15
    expect(edit.merges).toContainEqual({ top: 7, left: 0, bottom: 7, right: 3 }); // A8:D8
  });
});

describe('readWorkbook — 숨김 행·열', () => {
  it('숨김 행이 hiddenRows에 실리되 격자에서 지워지지 않는다', () => {
    const edit = sheet('01_편집팀');
    expect(edit.hiddenRows).toEqual([12]); // 1-based r13
    expect(edit.cells[12][0].value).toBe('[샘플] 비공개 작업 D');
  });

  it('숨김 행에는 경고를 남기지 않는다', () => {
    expect(wb.warnings.filter((w) => w.code === 'HIDDEN_COLUMN')).toHaveLength(0);
    expect(wb.warnings).toHaveLength(0);
    for (const s of wb.sheets) expect(s.hiddenColumns).toEqual([]);
  });
});

describe('readWorkbook — 값을 해석하지 않는다', () => {
  it('numFmt가 보존된다', () => {
    const edit = sheet('01_편집팀');
    expect(edit.cells[9][2].numFmt).toContain('%'); // C10
    expect(edit.cells[0][0].numFmt).toBeNull();
  });

  it('셀 형태가 원형 그대로 와서 cell-normalizer가 풀 수 있다', () => {
    const edit = sheet('01_편집팀');

    // {formula, result} — 값은 0.33 그대로이고 퍼센트 변환은 normalizer의 몫이다.
    const c10 = edit.cells[9][2];
    expect(unwrapCellValue(c10.value).value).toBe(0.33);
    expect(toProgress(c10.value, c10.numFmt ?? undefined).value).toBe(33);

    // {sharedFormula} — result가 없어 경고가 된다.
    expect(unwrapCellValue(edit.cells[10][2].value).warning).toBe('FORMULA_WITHOUT_RESULT');

    // {error}
    expect(unwrapCellValue(edit.cells[11][6].value).warning).toBe('CELL_ERROR');
  });

  it('날짜 셀이 Date 그대로 온다 (문자열화하지 않는다)', () => {
    expect(sheet('01_편집팀').cells[12][3].value).toBeInstanceOf(Date);
  });
});

describe('readWorkbook — 손상된 워크북', () => {
  it('WorkbookReadError를 던지고 메시지에 내부 정보를 담지 않는다', async () => {
    const err = await readWorkbook(Buffer.from('not a workbook')).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(WorkbookReadError);
    const message = (err as WorkbookReadError).message;
    expect((err as WorkbookReadError).code).toBe('WORKBOOK_CORRUPT');
    expect(message).not.toMatch(/https?:|\/|\\|zip|jszip|Error:/i);
  });
});

/**
 * 한도는 **셀 배열을 만들기 전에** 걸려야 의미가 있다 (S2). `dimensions`는 워크북 XML 안의
 * 속성이라 위조할 수 있고, 위조된 사각형을 믿고 배열을 할당하면 수 KB 파일 하나로 프로세스가
 * 죽는다 — step 0의 해제 총량 상한은 실제 데이터의 부피만 막는다.
 *
 * 숫자는 여기 적지 않는다. 정책은 `upload-limits.ts` 한 곳이고 리더는 받은 숫자를 지킬 뿐이다.
 */
describe('readWorkbook — 한도 (T5 완료 기준 6)', () => {
  const bytes = () => readFileSync(FIXTURE);
  const catchCode = async (limits: WorkbookLimits): Promise<unknown> =>
    readWorkbook(bytes(), limits).then(
      () => null,
      (e: unknown) => e
    );

  it('limits 없이 부르면 지금과 똑같이 읽힌다', async () => {
    const plain = await readWorkbook(bytes());
    expect(plain.sheets.map((s) => s.name)).toEqual(wb.sheets.map((s) => s.name));
    expect(plain.warnings).toEqual([]);
  });

  it('실제 상한(WORKBOOK_LIMITS)으로 부르면 픽스처가 통과한다', async () => {
    // 오탐 회귀 — 정상 업무 파일을 거부하는 방어는 방어가 아니라 장애다 (T1)
    const guarded = await readWorkbook(bytes(), WORKBOOK_LIMITS);
    expect(guarded.sheets).toHaveLength(5);
  });

  it('시트 수 초과를 시트 순회 전에 잡는다', async () => {
    const err = await catchCode({ ...WORKBOOK_LIMITS, maxSheets: 1 });
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).code).toBe('ARCHIVE_LIMIT_EXCEEDED');
  });

  it('시트당 셀 수 초과를 잡는다', async () => {
    const err = await catchCode({ ...WORKBOOK_LIMITS, maxCellsPerSheet: 10 });
    expect(err).toBeInstanceOf(ArchiveLimitError);
  });

  it('시트별로는 통과해도 워크북 합계에서 잡는다', async () => {
    // 픽스처 최대 시트는 2,485셀이라 시트당 상한에는 걸리지 않는다
    const err = await catchCode({ maxSheets: 20, maxCellsPerSheet: 100_000, maxCellsPerWorkbook: 1_000 });
    expect(err).toBeInstanceOf(ArchiveLimitError);
  });

  it('한도 메시지에 시트 이름·셀 수·내부 경로가 없다', async () => {
    const err = await catchCode({ ...WORKBOOK_LIMITS, maxSheets: 1 });
    const message = (err as ArchiveLimitError).message;
    expect(message).not.toMatch(/촬영|편집|설정|대시보드|\d|https?:|\/src\/|Error:/);
  });
});
