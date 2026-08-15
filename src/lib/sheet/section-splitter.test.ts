/**
 * 픽스처의 `03_마케팅·관리팀`으로 실제 배치를 고정하고, 작은 격자로 경계 규칙을 좁힌다.
 *
 * 이 탭의 급소는 **섹션 순서가 A→B→C가 아니라 C→A→B**라는 것이다.
 * 정렬하면 통과하는 테스트를 쓰면 안 된다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { splitSections, type SheetSection } from '@/lib/sheet/section-splitter';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { SheetCell, SheetGrid } from '@/types/sheet';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

/** 문자열 격자로 시트를 만든다. 빈 문자열이 빈 셀이다 */
function grid(rows: string[][]): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  const cells: SheetCell[][] = rows.map((row) =>
    Array.from({ length: columnCount }, (_, column) => ({
      value: row[column] === undefined || row[column] === '' ? null : row[column],
      numFmt: null,
    }))
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

describe('splitSections — 픽스처 03_마케팅·관리팀', () => {
  let sections: SheetSection[];

  beforeAll(async () => {
    const workbook = await readWorkbook(readFileSync(FIXTURE));
    const sheet = workbook.sheets.find((s) => s.name === '03_마케팅·관리팀');
    if (!sheet) throw new Error('픽스처에 03_마케팅·관리팀이 없다');
    sections = splitSections(sheet);
  });

  it('섹션이 3개이고 순서가 C · A · B다 — 정렬하지 않는다', () => {
    expect(sections.map((s) => s.key)).toEqual(['C', 'A', 'B']);
  });

  it('A·B 섹션의 밴드가 각각 라벨 행 16·23을 가리킨다', () => {
    const a = sections.find((s) => s.key === 'A');
    const b = sections.find((s) => s.key === 'B');
    expect(a?.band).toEqual({ groupRow: null, labelRow: 16 });
    expect(b?.band).toEqual({ groupRow: null, labelRow: 23 });
  });

  it('C 섹션은 자유 텍스트라 밴드가 null이다', () => {
    expect(sections.find((s) => s.key === 'C')?.band).toBeNull();
  });

  it('A 섹션의 endRow가 19다 — 뒤의 빈 행 2줄이 딸려 오지 않는다', () => {
    const a = sections.find((s) => s.key === 'A');
    expect(a?.titleRow).toBe(15);
    expect(a?.startRow).toBe(16);
    expect(a?.endRow).toBe(19);
  });

  it('C 섹션의 endRow가 12다', () => {
    const c = sections.find((s) => s.key === 'C');
    expect(c?.titleRow).toBe(7);
    expect(c?.startRow).toBe(8);
    expect(c?.endRow).toBe(12);
  });

  it('title이 배너 원문 그대로다', () => {
    expect(sections.map((s) => s.title)).toEqual([
      'C. 주간 회의 브리핑',
      'A. 상시 문의·SNS 관리',
      'B. 주간 마케팅 실행·성과 관리',
    ]);
  });

  it('마지막 섹션의 endRow가 시트 마지막 행이다', () => {
    expect(sections[2].endRow).toBe(26);
  });
});

describe('splitSections — 작은 격자', () => {
  it('배너가 없으면 빈 배열이다 (예외를 던지지 않는다)', () => {
    const sheet = grid([
      ['업무명', '담당자', '기한'],
      ['[샘플] 업무1', '담당자1', '2026-09-01'],
    ]);
    expect(splitSections(sheet)).toEqual([]);
  });

  it('배너가 하나뿐이면 endRow가 마지막 비지 않은 행이다', () => {
    const sheet = grid([
      ['A. 상시 문의', '', ''],
      ['업무명', '담당자', '기한'],
      ['[샘플] 문의1', '마케터1', '2026-09-01'],
      ['', '', ''],
      ['', '', ''],
    ]);
    expect(splitSections(sheet)).toEqual([
      {
        key: 'A',
        title: 'A. 상시 문의',
        titleRow: 0,
        startRow: 1,
        endRow: 2,
        band: { groupRow: null, labelRow: 1 },
      },
    ]);
  });

  it('`A/B 테스트 결과`처럼 닮기만 한 텍스트는 배너가 아니다', () => {
    const sheet = grid([
      ['A/B 테스트 결과', '', ''],
      ['업무명', '담당자', '기한'],
      ['[샘플] 문의1', '마케터1', '2026-09-01'],
    ]);
    expect(splitSections(sheet)).toEqual([]);
  });
});
