/**
 * 두 층으로 검증한다.
 * - **손으로 만든 작은 격자** — 판정 규칙을 하나씩 좁게 고정한다. 픽스처만 쓰면
 *   테스트가 통과한 이유가 규칙 때문인지 우연인지 알 수 없다.
 * - **픽스처 통합** — 실제 격자(`sample-workbook.xlsx`)로 T2 완료 기준 2를 확인한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { findHeaderBands, resolveHeaders } from '@/lib/sheet/header-resolver';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type { MergeRange, SheetCellValue, SheetGrid, WorkbookGrid } from '@/types/sheet';

/** 값 배열로 격자를 만든다. 행 길이는 리더와 같게 columnCount로 맞춘다 */
function grid(rows: SheetCellValue[][], merges: MergeRange[] = []): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  return {
    name: '테스트',
    rowCount: rows.length,
    columnCount,
    cells: rows.map((row) =>
      Array.from({ length: columnCount }, (_, c) => ({ value: row[c] ?? null, numFmt: null }))
    ),
    merges,
    hiddenRows: [],
    hiddenColumns: [],
  };
}

const labelRows = (sheet: SheetGrid) => findHeaderBands(sheet).map((b) => b.labelRow);

describe('findHeaderBands — 후보 판정 규칙 (작은 격자)', () => {
  it('전체 폭 병합 배너 행은 후보에서 탈락한다', () => {
    // 리더가 병합 슬레이브에도 마스터 값을 채워 주므로 배너 행은 "값 4개, 서로 다른 값 1개"다.
    const sheet = grid(
      [
        ['배너 문구', '배너 문구', '배너 문구', '배너 문구'],
        ['업무명', '담당자', '기한', '비고'],
        ['카드뉴스', '담당자1', null, null],
      ],
      [{ top: 0, left: 0, bottom: 0, right: 3 }]
    );

    expect(labelRows(sheet)).toEqual([1]);
    // 배너는 그룹 행으로도 붙지 않는다 (전체 폭 병합).
    expect(findHeaderBands(sheet)[0].groupRow).toBeNull();
  });

  it('수식 값만 있는 KPI 행은 후보에서 탈락한다', () => {
    const sheet = grid([
      [
        { formula: 'COUNTIF(A:A,"<>")', result: 5 },
        { formula: 'COUNTIF(B:B,"<>")', result: 3 },
        { formula: 'A1/B1' },
      ],
      ['업무명', '담당자', '기한'],
      ['카드뉴스', '담당자1', null],
    ]);

    expect(labelRows(sheet)).toEqual([1]);
  });

  it('값이 2개뿐인 행은 후보에서 탈락한다 (3개 이상 규칙)', () => {
    const sheet = grid([
      ['항목', '일수', null],
      ['업무명', '담당자', '기한'],
      ['카드뉴스', '담당자1', null],
    ]);

    expect(labelRows(sheet)).toEqual([1]);
  });

  it('아래에 행이 남지 않은 마지막 행은 후보가 아니다', () => {
    const sheet = grid([
      ['업무명', '담당자', '기한'],
      ['제목', '이름', '날짜'],
    ]);

    expect(labelRows(sheet)).toEqual([0]);
  });

  it('그룹 행이 없으면 groupRow가 null이다', () => {
    const sheet = grid([
      ['공통_우선순위', '공통_진행 상태', '공통_승인 상태'],
      ['긴급', '진행 중', '승인 완료'],
    ]);

    expect(findHeaderBands(sheet)).toEqual([{ groupRow: null, labelRow: 0 }]);
  });

  it('가로 병합이 있는 바로 위 행이 groupRow로 붙는다', () => {
    const sheet = grid(
      [
        ['기본 업무정보', null, '컨셉·레퍼런스 (+2일)', null],
        ['업무명', '담당자', '예정일', '실제'],
        ['카드뉴스', '담당자1', null, null],
      ],
      [
        { top: 0, left: 0, bottom: 0, right: 1 },
        { top: 0, left: 2, bottom: 0, right: 3 },
      ]
    );

    expect(findHeaderBands(sheet)).toContainEqual({ groupRow: 0, labelRow: 1 });
  });

  it('세로 병합만 있는 행은 groupRow가 되지 않는다', () => {
    const sheet = grid(
      [
        ['시리즈 E', '담당자2', '2026-07-21'],
        ['업무명', '담당자', '기한'],
        ['카드뉴스', '담당자1', null],
      ],
      [{ top: 0, left: 0, bottom: 1, right: 0 }]
    );

    expect(findHeaderBands(sheet)).toContainEqual({ groupRow: null, labelRow: 1 });
  });
});

describe('resolveHeaders — 경로 결합 (작은 격자)', () => {
  it('병합 범위 밖 컬럼에는 그룹 값이 번지지 않는다', () => {
    // 그룹 셀이 비어 있어도 채우기 근거는 merges뿐이다. 무조건 forward-fill이면
    // `기본 업무정보`가 C·D까지 번져 컬럼 키가 전부 오염된다.
    const sheet = grid(
      [
        ['기본 업무정보', null, null, null],
        ['업무명', '담당자', '예정일', '실제'],
        ['카드뉴스', '담당자1', null, null],
      ],
      [{ top: 0, left: 0, bottom: 0, right: 1 }]
    );

    expect(resolveHeaders(sheet, { groupRow: 0, labelRow: 1 })).toEqual([
      { index: 0, path: ['기본 업무정보', '업무명'], label: '기본 업무정보 / 업무명' },
      { index: 1, path: ['기본 업무정보', '담당자'], label: '기본 업무정보 / 담당자' },
      { index: 2, path: ['예정일'], label: '예정일' },
      { index: 3, path: ['실제'], label: '실제' },
    ]);
  });

  it('그룹과 라벨이 같은 문자열이면 경로가 하나로 접힌다', () => {
    const sheet = grid([
      ['비고', '기본 업무정보'],
      ['비고', '업무명'],
      ['메모', '카드뉴스'],
    ]);

    expect(resolveHeaders(sheet, { groupRow: 0, labelRow: 1 })).toEqual([
      { index: 0, path: ['비고'], label: '비고' },
      { index: 1, path: ['기본 업무정보', '업무명'], label: '기본 업무정보 / 업무명' },
    ]);
  });

  it('그룹·라벨이 둘 다 빈 컬럼은 제외되고 index가 컬럼 좌표를 보존한다', () => {
    const sheet = grid([
      ['업무명', null, '담당자'],
      ['카드뉴스', null, '담당자1'],
    ]);

    expect(resolveHeaders(sheet, { groupRow: null, labelRow: 0 })).toEqual([
      { index: 0, path: ['업무명'], label: '업무명' },
      { index: 2, path: ['담당자'], label: '담당자' },
    ]);
  });
});

describe('픽스처 통합', () => {
  let wb: WorkbookGrid;
  const sheet = (name: string): SheetGrid => {
    const found = wb.sheets.find((s) => s.name === name);
    if (!found) throw new Error(`픽스처에 시트가 없다: ${name}`);
    return found;
  };

  beforeAll(async () => {
    const fixture = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
    wb = await readWorkbook(readFileSync(fixture));
  });

  it('01_편집팀의 2단 헤더가 r8·r9 밴드로 잡힌다', () => {
    // 0-based: r8 → 7(그룹), r9 → 8(라벨)
    expect(findHeaderBands(sheet('01_편집팀'))).toContainEqual({ groupRow: 7, labelRow: 8 });
  });

  it('컨셉·레퍼런스 그룹의 예정일 컬럼이 경로로 결합된다 (완료 기준 2)', () => {
    const columns = resolveHeaders(sheet('01_편집팀'), { groupRow: 7, labelRow: 8 });
    const concept = columns.filter((c) => c.path[0]?.startsWith('컨셉·레퍼런스'));

    expect(concept).toHaveLength(4);
    expect(concept[0].path[1]).toBe('예정일');
    expect(concept[0].index).toBe(4); // E열
    expect(concept[0].label).toBe('컨셉·레퍼런스 (+2일) / 예정일');
    // `(+2일)`은 T3의 STAGE_GROUPS가 SLA 기본값을 읽을 근거다 — 잘라내지 않는다.
    expect(concept[0].path[0]).toBe('컨셉·레퍼런스 (+2일)');
  });

  it('01_편집팀 결합 라벨 16개가 전부 유일하다 (결합의 존재 이유)', () => {
    const columns = resolveHeaders(sheet('01_편집팀'), { groupRow: 7, labelRow: 8 });

    expect(columns).toHaveLength(16);
    expect(new Set(columns.map((c) => c.label)).size).toBe(16);
    // 결합하지 않으면 `예정일`·`실제`·`확인`이 단계마다 반복돼 유일성이 깨진다.
    const bare = columns.map((c) => c.path[c.path.length - 1]);
    expect(new Set(bare).size).toBeLessThan(16);
  });

  it('기본 업무정보 그룹은 A~D에만 붙고 E부터는 컨셉·레퍼런스다', () => {
    const columns = resolveHeaders(sheet('01_편집팀'), { groupRow: 7, labelRow: 8 });
    const groupOf = (index: number) => columns.find((c) => c.index === index)?.path[0];

    expect([0, 1, 2, 3].map(groupOf)).toEqual([
      '기본 업무정보',
      '기본 업무정보',
      '기본 업무정보',
      '기본 업무정보',
    ]);
    expect(groupOf(4)).toBe('컨셉·레퍼런스 (+2일)');
    expect(groupOf(15)).toBe('비고'); // P열은 그룹·라벨이 같아 하나로 접힌다
  });

  it('02_촬영·기획팀 71컬럼이 결합되고 그룹 8종이 실제 컬럼 수만큼 붙는다', () => {
    const shoot = sheet('02_촬영·기획팀');
    expect(findHeaderBands(shoot)).toContainEqual({ groupRow: 7, labelRow: 8 });

    const columns = resolveHeaders(shoot, { groupRow: 7, labelRow: 8 });
    expect(columns).toHaveLength(71);

    const counts = new Map<string, number>();
    for (const c of columns) counts.set(c.path[0], (counts.get(c.path[0]) ?? 0) + 1);

    expect(Object.fromEntries(counts)).toEqual({
      '기본 업무정보': 10,
      섭외: 10,
      '촬영 일정·준비': 9,
      '기획안 초안': 7,
      '기획안 완성본': 8,
      '촬영 실행': 9,
      '편집 이관 또는 자체 편집': 9,
      관리: 9,
    });
  });

  it('03_마케팅·관리팀은 A·B 섹션 두 밴드를 모두 돌려준다', () => {
    const marketing = sheet('03_마케팅·관리팀');
    const bands = findHeaderBands(marketing);
    const labelSets = bands.map((b) => resolveHeaders(marketing, b).map((c) => c.label));

    expect(bands.length).toBeGreaterThanOrEqual(2);
    const inquiry = labelSets.filter((labels) => labels.includes('문의 ID'));
    const execution = labelSets.filter((labels) => labels.includes('마케팅 과제명'));
    expect(inquiry).toHaveLength(1);
    expect(execution).toHaveLength(1);
    // 한 탭 안의 서로 다른 밴드다 — 하나로 좁히면 이 탭이 깨진다.
    expect(inquiry[0]).not.toEqual(execution[0]);
  });

  it('99_설정은 단층 헤더(groupRow: null)로 잡힌다', () => {
    const settings = sheet('99_설정');
    const bands = findHeaderBands(settings).filter((b) => b.groupRow === null);
    const withStatus = bands.filter((b) =>
      resolveHeaders(settings, b).some((c) => c.label === '공통_진행 상태')
    );

    expect(withStatus).toHaveLength(1);
    expect(withStatus[0]).toEqual({ groupRow: null, labelRow: 2 }); // r3 그룹명 행
  });
});
