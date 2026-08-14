/**
 * 두 층으로 검증한다.
 * - **픽스처** — 실제 격자에서 5개 탭이 각각 제 종류로 잡히는지.
 * - **이름을 바꾼 사본·손으로 만든 작은 격자** — 판별이 이름이 아니라 헤더 시그니처에
 *   걸려 있다는 사실을 고정한다. 픽스처만 쓰면 이름 덕에 통과한 것인지 알 수 없다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { detectTab } from '@/lib/sheet/tab-detector';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { SheetCellValue, SheetGrid, WorkbookGrid } from '@/types/sheet';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

let workbook: WorkbookGrid;

beforeAll(async () => {
  workbook = await readWorkbook(readFileSync(FIXTURE));
});

const sheet = (name: string): SheetGrid => {
  const found = workbook.sheets.find((s) => s.name === name);
  if (!found) throw new Error(`픽스처에 시트가 없다: ${name}`);
  return found;
};

/** 이름만 바꾼 사본. 격자는 그대로다 */
const renamed = (source: SheetGrid, name: string): SheetGrid => ({ ...source, name });

/** 값 배열로 작은 격자를 만든다 (header-resolver 테스트와 같은 모양) */
function grid(name: string, rows: SheetCellValue[][]): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  return {
    name,
    rowCount: rows.length,
    columnCount,
    cells: rows.map((row) =>
      Array.from({ length: columnCount }, (_, c) => ({ value: row[c] ?? null, numFmt: null }))
    ),
    merges: [],
    hiddenRows: [],
    hiddenColumns: [],
  };
}

describe('detectTab — 픽스처 5개 탭', () => {
  it('5개 탭이 각각 올바른 종류로 판별된다', () => {
    const kinds = workbook.sheets.map((s) => [s.name, detectTab(s).kind]);

    expect(kinds).toEqual([
      ['00_통합 대시보드', 'dashboard'],
      ['01_편집팀', 'edit_team'],
      ['02_촬영·기획팀', 'shoot_team'],
      ['03_마케팅·관리팀', 'marketing_team'],
      ['99_설정', 'settings'],
    ]);
  });

  it('이름과 시그니처가 둘 다 맞으면 matchedBy가 both다', () => {
    expect(workbook.sheets.map((s) => detectTab(s).matchedBy)).toEqual([
      'both',
      'both',
      'both',
      'both',
      'both',
    ]);
  });

  it('99_설정은 부분 일치로 이름도 맞는다 — 정확 일치였다면 여기서 깨진다', () => {
    const detection = detectTab(sheet('99_설정'));

    expect(detection.sheet).toBe('99_설정'); // 실제 시트 이름은 `설정`이 아니다 (T1 실측)
    expect(detection.matchedBy).toBe('both');
    expect(detection.matches.map((m) => m.signatureKey)).toEqual(['settings']);
  });

  it('03_마케팅·관리팀은 A·B 두 시그니처가 서로 다른 밴드에서 맞는다', () => {
    const detection = detectTab(sheet('03_마케팅·관리팀'));
    const byKey = new Map(detection.matches.map((m) => [m.signatureKey, m]));

    expect([...byKey.keys()].sort()).toEqual(['marketing_goal', 'marketing_inquiry']);
    expect(byKey.get('marketing_inquiry')!.band.labelRow).not.toBe(
      byKey.get('marketing_goal')!.band.labelRow
    );
    // T3의 section-splitter가 같은 탐색을 다시 하지 않도록 맞은 컬럼도 들고 나간다.
    expect(byKey.get('marketing_goal')!.matched).toContain('달성률');
  });

  it('01_편집팀은 그룹 라벨의 접미사를 넘어 접두 일치로 잡힌다', () => {
    const detection = detectTab(sheet('01_편집팀'));

    // 그룹 행 단독 밴드({groupRow:null,labelRow:7})도 그룹 라벨 3개가 맞지만,
    // 같은 시그니처는 가장 많이 맞은 밴드 하나만 남는다.
    expect(detection.matches).toHaveLength(1);
    // 원문은 `컨셉·레퍼런스 (+2일)` — 정확 일치였다면 안 맞는다.
    expect(detection.matches[0].matched).toEqual([
      '업무명',
      '담당자',
      '배정일',
      '컨셉·레퍼런스',
      '제작 진행',
      '최종본·업로드',
    ]);
    expect(detection.matches[0].band).toEqual({ groupRow: 7, labelRow: 8 });
  });

  it('00_통합 대시보드는 unknown이 아니다 — 읽지 않는 것과 모르는 것은 다르다', () => {
    const detection = detectTab(sheet('00_통합 대시보드'));

    expect(detection.kind).toBe('dashboard');
    expect(detection.matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectTab — 시그니처가 이름을 이긴다', () => {
  it('5개 탭 이름을 전부 무의미한 문자열로 바꿔도 종류가 그대로다', () => {
    const kinds = workbook.sheets.map((s, i) => detectTab(renamed(s, `Sheet${i + 1}`)));

    expect(kinds.map((d) => d.kind)).toEqual([
      'dashboard',
      'edit_team',
      'shoot_team',
      'marketing_team',
      'settings',
    ]);
    expect(kinds.map((d) => d.matchedBy)).toEqual([
      'signature',
      'signature',
      'signature',
      'signature',
      'signature',
    ]);
  });

  it('이름이 편집팀인데 헤더가 촬영팀 시그니처면 촬영팀으로 판별된다', () => {
    const detection = detectTab(renamed(sheet('02_촬영·기획팀'), '01_편집팀'));

    expect(detection.kind).toBe('shoot_team');
    expect(detection.matchedBy).toBe('signature');
  });

  it('시그니처가 없고 이름만 맞으면 name이고 matches는 비어 있다', () => {
    const detection = detectTab(grid('01_편집팀', [['안내'], ['자유 메모']]));

    expect(detection.kind).toBe('edit_team');
    expect(detection.matchedBy).toBe('name');
    expect(detection.matches).toEqual([]);
  });
});

describe('detectTab — 모르는 탭', () => {
  it('필수 컬럼이 2개만 맞으면 unknown이다', () => {
    const sheetGrid = grid('Sheet9', [
      ['업무명', '담당자', '메모', '첨부'],
      ['[샘플] 카드뉴스 A', '담당자1', '', ''],
    ]);

    expect(detectTab(sheetGrid).kind).toBe('unknown');
    expect(detectTab(sheetGrid).matchedBy).toBe('none');
  });

  it('필수 컬럼이 3개 맞으면 판별된다 — 2개와 3개의 경계가 규칙이다', () => {
    const sheetGrid = grid('Sheet9', [
      ['업무명', '담당자', '배정일', '첨부'],
      ['[샘플] 카드뉴스 A', '담당자1', '', ''],
    ]);

    expect(detectTab(sheetGrid).kind).toBe('edit_team');
    expect(detectTab(sheetGrid).matchedBy).toBe('signature');
  });

  it('헤더가 하나도 없는 빈 시트는 unknown이고 예외가 나지 않는다', () => {
    const empty: SheetGrid = {
      name: '',
      rowCount: 0,
      columnCount: 0,
      cells: [],
      merges: [],
      hiddenRows: [],
      hiddenColumns: [],
    };

    expect(() => detectTab(empty)).not.toThrow();
    expect(detectTab(empty)).toEqual({
      sheet: '',
      kind: 'unknown',
      matchedBy: 'none',
      matches: [],
    });
  });

  it('접두 일치는 담당자가 기획 담당자를 잡지 않는다', () => {
    // 맞는 것은 `업무명`·`배정일` 둘뿐이다. `담당자`가 `기획 담당자`를 잡으면 3개가 되어 통과해버린다.
    const sheetGrid = grid('Sheet9', [
      ['업무명', '기획 담당자', '배정일', '비고'],
      ['[샘플] 카드뉴스 A', '기획자1', '', ''],
    ]);

    expect(detectTab(sheetGrid).kind).toBe('unknown');
  });
});
