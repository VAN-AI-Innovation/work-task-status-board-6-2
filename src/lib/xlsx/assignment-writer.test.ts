/**
 * 배정표 xlsx의 계약을 고정한다. 재는 것이 셋이고 셋 다 T7 완료 기준에 이름이 있다 —
 * 드롭다운(4) · 수식 주입 방어(5) · 왕복(6).
 *
 * **되읽는 길을 자체로 만들지 않는다.** 구조·값 검증은 전부 시트 파서(`readWorkbook` +
 * `findHeaderBands`/`resolveHeaders`/`toText`)로 되읽는다 — 쓰기와 읽기를 같은 파일이 쥐면
 * 자기 자신과 비교하는 셈이라 「고리가 닫힌다」를 증명하지 못한다.
 *
 * 예외는 둘뿐이고 이유가 같다 — 시트 파서가 담지 않는 것을 재야 할 때다.
 * `readWorkbook`은 격자에 `dataValidation`을 싣지 않고, 값이 빈 셀의 `numFmt`도 버린다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 확인용 import — 완료 기준 4는 `dataValidation`을 재야 증명된다. `CLAUDE.md`의
// 「exceljs는 두 파일에서만」은 `src/` 제품 코드가 대상이고 테스트는 그 밖이다.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  buildAssignmentRows,
  DIFFICULTY_LEVELS,
  PRIORITY_LEVELS,
} from '@/lib/doc/assignment-mapper';
import { readMarkdownOutline } from '@/lib/doc/markdown-reader';
import { buildOutline } from '@/lib/doc/outline-builder';
import { parseWorkloadPriorities } from '@/lib/doc/workload-parser';
import { STATUS_SEMANTIC_MAP } from '@/lib/domain/task-semantic';
import { toText } from '@/lib/sheet/cell-normalizer';
import { findHeaderBands, resolveHeaders } from '@/lib/sheet/header-resolver';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import {
  ASSIGNMENT_COLUMNS,
  buildAssignmentWorkbook,
  DEFAULT_DROPDOWNS,
  sanitizeCellText,
} from '@/lib/xlsx/assignment-writer';
import type { AssignmentRow } from '@/types/doc';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));

const BASE_YEAR = 2026;

const HEADERS = [
  '카테고리',
  '번호',
  '과제명',
  '난이도',
  '마감',
  '우선순위',
  '세부항목',
  '담당자',
  '상태',
  '진행률',
  '비고',
];

const assignmentRow = (extra: Partial<AssignmentRow> = {}): AssignmentRow => ({
  category: '콘텐츠 제작',
  taskNo: '1-1',
  title: '숏폼 시리즈 기획',
  difficulty: '상',
  deadlineRaw: '9/1까지',
  deadlineDate: '2026-09-01',
  priority: '긴급',
  priorityRaw: 'P0',
  details: '레퍼런스 20건 수집',
  ...extra,
});

/**
 * 배정표 행 하나가 셀 11칸으로 어떻게 흩어지는지 — **테스트가 독립적으로 다시 적는다.**
 * 구현에서 가져오면 구현이 틀려도 기대가 함께 틀린다.
 */
const cellsOf = (row: AssignmentRow): string[] => [
  row.category ?? '',
  row.taskNo,
  row.title,
  row.difficulty ?? '',
  row.deadlineDate ?? row.deadlineRaw ?? '',
  row.priority ?? '',
  row.details,
  '',
  '',
  '',
  '',
];

/** 되읽은 셀의 기대값. 방어가 붙은 칸은 `'` 하나가 더 있는 것이 **정상**이다 */
const expectedCell = (raw: string): string | null => {
  const value = sanitizeCellText(raw);
  return value === '' ? null : value;
};

/**
 * exceljs로 직접 되읽는다. **두 가지만** 이 길을 쓴다 —
 * `dataValidation`은 격자가 담지 않고, 값이 빈 셀의 `numFmt`는 리더가 버린다
 * (`workbook-reader`가 빈 셀을 `{value:null, numFmt:null}`로 채운다).
 */
async function loadSheet(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return workbook.getWorksheet(1)!;
}

/** 시트 파서로 되읽는다. 헤더 밴드는 1행(0-based 0)이다 */
async function readBack(bytes: Uint8Array) {
  const { sheets } = await readWorkbook(Buffer.from(bytes));
  const sheet = sheets[0];
  const band = findHeaderBands(sheet).find((candidate) => candidate.labelRow === 0);
  if (!band) throw new Error('헤더 밴드를 찾지 못했다');

  const columns = resolveHeaders(sheet, band);
  const rows: (string | null)[][] = [];
  for (let row = band.labelRow + 1; row < sheet.rowCount; row += 1) {
    rows.push(columns.map((column) => toText(sheet.cells[row]?.[column.index]?.value).value));
  }

  return { sheet, headers: columns.map((column) => column.label), rows, columns };
}

describe('sanitizeCellText — 수식 주입 방어 (S1 · ADR-012)', () => {
  it.each([
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@user', "'@user"],
    ['\t머리', "'\t머리"],
    ['\n머리', "'\n머리"],
    ['\r머리', "'\r머리"],
  ])('위험 문자로 시작하면 프리픽스를 붙인다: %j', (input, expected) => {
    expect(sanitizeCellText(input)).toBe(expected);
  });

  it('앞 공백이 있어도 붙인다 — 엑셀은 앞 공백을 무시하고 수식으로 읽는다', () => {
    expect(sanitizeCellText(' =SUM(A1)')).toBe("' =SUM(A1)");
    expect(sanitizeCellText('  -1')).toBe("'  -1");
  });

  it.each(['정상 텍스트', '2026-09-01', '9/1까지', '1-1', '중간에 = 있는 값', ''])(
    '안전한 값은 그대로 둔다: %j',
    (input) => {
      expect(sanitizeCellText(input)).toBe(input);
    }
  );

  it('공백만 있는 값은 그대로 둔다', () => {
    expect(sanitizeCellText('   ')).toBe('   ');
  });

  it('이미 프리픽스가 붙은 값에 두 번 붙이지 않는다', () => {
    expect(sanitizeCellText("'=cmd")).toBe("'=cmd");
    expect(sanitizeCellText(sanitizeCellText('=cmd'))).toBe("'=cmd");
  });

  it('값을 삭제하지 않는다 — 위험 문자가 프리픽스 뒤에 그대로 남는다', () => {
    expect(sanitizeCellText('=1+1').slice(1)).toBe('=1+1');
  });
});

describe('buildAssignmentWorkbook — 파일 구조', () => {
  it('1행이 헤더 11칸이고 순서가 PLAN.md 그림과 같다', async () => {
    const { headers } = await readBack(await buildAssignmentWorkbook([assignmentRow()]));
    expect(headers).toEqual(HEADERS);
  });

  it('ASSIGNMENT_COLUMNS가 그 헤더의 단일 출처다', () => {
    expect(ASSIGNMENT_COLUMNS.map((column) => column.header)).toEqual(HEADERS);
    expect(ASSIGNMENT_COLUMNS.every((column) => column.width > 0)).toBe(true);
  });

  it('데이터 행 수가 rows.length와 같다', async () => {
    const rows = [
      assignmentRow({ taskNo: '1-1' }),
      assignmentRow({ taskNo: '1-2' }),
      assignmentRow({ taskNo: '2-1' }),
    ];
    const { rows: readRows } = await readBack(await buildAssignmentWorkbook(rows));
    expect(readRows).toHaveLength(3);
    expect(readRows.map((row) => row[1])).toEqual(['1-1', '1-2', '2-1']);
  });

  it('워크시트가 1개다', async () => {
    const { sheets } = await readWorkbook(
      Buffer.from(await buildAssignmentWorkbook([assignmentRow()]))
    );
    expect(sheets).toHaveLength(1);
  });

  it('빈 rows도 헤더만 있는 파일을 만든다 — 던지지 않는다', async () => {
    const { sheets } = await readWorkbook(Buffer.from(await buildAssignmentWorkbook([])));
    const sheet = sheets[0];
    expect(sheet.rowCount).toBe(1);
    expect(sheet.cells[0].map((cell) => toText(cell.value).value)).toEqual(HEADERS);
  });

  it('시트 이름을 옵션으로 바꿀 수 있고 기본값이 있다', async () => {
    const { sheets } = await readWorkbook(
      Buffer.from(await buildAssignmentWorkbook([assignmentRow()]))
    );
    expect(sheets[0].name.length).toBeGreaterThan(0);

    const { sheets: renamed } = await readWorkbook(
      Buffer.from(await buildAssignmentWorkbook([assignmentRow()], { sheetName: '배정' }))
    );
    expect(renamed[0].name).toBe('배정');
  });

  it('담당자·상태·진행률·비고는 빈 칸이다 — 기계가 메우지 않는다', async () => {
    const { rows } = await readBack(await buildAssignmentWorkbook([assignmentRow()]));
    expect(rows[0].slice(7)).toEqual([null, null, null, null]);
  });

  it('마감은 문자열 한 컬럼이다 — 추론 성공·실패가 같은 타입으로 섞인다', async () => {
    const { sheet } = await readBack(
      await buildAssignmentWorkbook([
        assignmentRow({ deadlineRaw: '9/1까지', deadlineDate: '2026-09-01' }),
        assignmentRow({ taskNo: '2-2', deadlineRaw: '추후 협의', deadlineDate: null }),
      ])
    );
    expect(typeof sheet.cells[1][4].value).toBe('string');
    expect(sheet.cells[1][4].value).toBe('2026-09-01');
    expect(typeof sheet.cells[2][4].value).toBe('string');
    expect(sheet.cells[2][4].value).toBe('추후 협의');
  });

  it('진행률 칸에 % 서식이 붙는다', async () => {
    const sheet = await loadSheet(await buildAssignmentWorkbook([assignmentRow()]));
    // 1-based: 진행률 J(10). 값이 빈 셀이라 시트 파서로는 서식이 보이지 않는다
    expect(sheet.getRow(2).getCell(10).numFmt).toBe('0%');
  });
});

/**
 * **셀이 옆 칸을 침범하지 않는다.** 배정표는 담당자·상태·비고가 빈 채로 나가는 파일이라,
 * 줄바꿈이 꺼져 있으면 세부항목 한 줄이 빈 칸들 위를 가로질러 어느 컬럼의 값인지 알 수 없다.
 * 실제로 받은 파일에서 그렇게 보였고, 같은 속성이 개행(`\n`)도 화면에 나타나게 한다.
 */
describe('buildAssignmentWorkbook — 셀 줄바꿈', () => {
  it('데이터 셀은 줄바꿈이 켜져 있고 위쪽 정렬이다', async () => {
    const sheet = await loadSheet(
      await buildAssignmentWorkbook([assignmentRow({ details: '가\n나\n다' })])
    );

    for (let column = 1; column <= 11; column += 1) {
      const cell = sheet.getRow(2).getCell(column);
      expect(cell.alignment?.wrapText).toBe(true);
      expect(cell.alignment?.vertical).toBe('top');
    }
  });

  it('행 높이를 박아 두지 않는다 — 엑셀이 접힌 줄 수에 맞춰 잡아야 한다', async () => {
    const sheet = await loadSheet(
      await buildAssignmentWorkbook([assignmentRow({ details: '가\n나\n다\n라\n마' })])
    );

    expect(sheet.getRow(2).height).toBeUndefined();
  });
});

describe('buildAssignmentWorkbook — 드롭다운 (T7 완료 기준 4)', () => {
  const listOf = (values: readonly string[]) => `"${values.join(',')}"`;

  it('DEFAULT_DROPDOWNS는 이미 있는 단일 출처에서 온다 (결정 B)', () => {
    expect(DEFAULT_DROPDOWNS.status).toEqual(Object.keys(STATUS_SEMANTIC_MAP));
    expect(DEFAULT_DROPDOWNS.difficulty).toEqual(DIFFICULTY_LEVELS);
    expect(DEFAULT_DROPDOWNS.priority).toEqual(PRIORITY_LEVELS);
  });

  it('난이도·우선순위·상태의 데이터 행 셀에 목록 검증이 붙는다', async () => {
    const sheet = await loadSheet(await buildAssignmentWorkbook([assignmentRow()]));

    // 1-based: 난이도 D(4) · 우선순위 F(6) · 상태 I(9)
    const expectations: [number, readonly string[]][] = [
      [4, DEFAULT_DROPDOWNS.difficulty],
      [6, DEFAULT_DROPDOWNS.priority],
      [9, DEFAULT_DROPDOWNS.status],
    ];

    for (const [column, values] of expectations) {
      const validation = sheet.getRow(2).getCell(column).dataValidation;
      expect(validation?.type).toBe('list');
      expect(validation?.allowBlank).toBe(true);
      expect(validation && 'formulae' in validation ? validation.formulae : null).toEqual([
        listOf(values),
      ]);
    }
  });

  it('헤더 행과 나머지 컬럼에는 붙지 않는다', async () => {
    const sheet = await loadSheet(await buildAssignmentWorkbook([assignmentRow()]));

    for (let column = 1; column <= HEADERS.length; column += 1) {
      expect(sheet.getRow(1).getCell(column).dataValidation).toBeUndefined();
    }
    for (const column of [1, 2, 3, 5, 7, 8, 10, 11]) {
      expect(sheet.getRow(2).getCell(column).dataValidation).toBeUndefined();
    }
  });

  it('모든 데이터 행에 붙는다', async () => {
    const rows = [assignmentRow({ taskNo: '1-1' }), assignmentRow({ taskNo: '1-2' })];
    const sheet = await loadSheet(await buildAssignmentWorkbook(rows));
    expect(sheet.getRow(2).getCell(9).dataValidation?.type).toBe('list');
    expect(sheet.getRow(3).getCell(9).dataValidation?.type).toBe('list');
  });

  it('목록을 인자로 바꿀 수 있다 — 설정 탭 enum을 받을 자리다', async () => {
    const sheet = await loadSheet(
      await buildAssignmentWorkbook([assignmentRow()], {
        dropdowns: { status: ['진행 중', '완료'], difficulty: ['상', '하'], priority: ['긴급'] },
      })
    );
    const validation = sheet.getRow(2).getCell(9).dataValidation;
    expect(validation && 'formulae' in validation ? validation.formulae : null).toEqual([
      '"진행 중,완료"',
    ]);
  });
});

describe('buildAssignmentWorkbook — 수식 주입 방어 (T7 완료 기준 5)', () => {
  const PAYLOAD = "=cmd|'/c calc'!A1";

  it('페이로드가 수식이 아니라 텍스트로 들어간다', async () => {
    const { sheet } = await readBack(
      await buildAssignmentWorkbook([assignmentRow({ details: PAYLOAD })])
    );
    const cell = sheet.cells[1][6];

    expect(typeof cell.value).toBe('string');
    expect(cell.value).toBe(`'${PAYLOAD}`);
    expect(cell.numFmt).toBe('@');
  });

  it('어느 칸에 들어와도 막는다 — 방어는 컬럼이 아니라 셀의 성질이다', async () => {
    const { rows } = await readBack(
      await buildAssignmentWorkbook([
        assignmentRow({ category: '@사내', title: '-20% 축소안', deadlineRaw: '\t추후', deadlineDate: null }),
      ])
    );
    expect(rows[0][0]).toBe("'@사내");
    expect(rows[0][2]).toBe("'-20% 축소안");
    expect(rows[0][4]).toBe("'\t추후");
  });

  it('헤더도 같은 함수를 통과한다 — 예외를 만들지 않는다', async () => {
    const { sheet } = await readBack(await buildAssignmentWorkbook([assignmentRow()]));
    for (const cell of sheet.cells[0]) {
      expect(cell.numFmt).toBe('@');
    }
  });

  it('문자열 셀이 하나도 수식 객체가 아니다', async () => {
    const { sheet } = await readBack(
      await buildAssignmentWorkbook([assignmentRow({ details: PAYLOAD })])
    );
    for (const row of sheet.cells) {
      for (const cell of row) {
        if (cell.value === null) continue;
        expect(typeof cell.value).toBe('string');
      }
    }
  });
});

describe('왕복 — md → 행 → xlsx → 시트 파서 (T7 완료 기준 6)', () => {
  const sourceRows = () => {
    const nodes = readMarkdownOutline(readFileSync(FIXTURE, 'utf8'));
    const { tasks } = buildOutline(nodes);
    const workload = parseWorkloadPriorities(nodes);
    return buildAssignmentRows(tasks, workload, { baseYear: BASE_YEAR });
  };

  it('픽스처가 실제로 수식 페이로드를 싣고 있다 — 아니면 이 테스트는 아무것도 안 잰다', () => {
    const rows = sourceRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.details.startsWith('='))).toBe(true);
    expect(rows.some((row) => row.details.startsWith('+'))).toBe(true);
    expect(rows.some((row) => row.details.startsWith('-'))).toBe(true);
    expect(rows.some((row) => row.details.startsWith('@'))).toBe(true);
    expect(rows.some((row) => row.details.includes('\n'))).toBe(true);
  });

  it('되읽은 행이 원래 행과 같다 — 방어가 붙은 칸은 프리픽스까지 포함해 같다', async () => {
    const rows = sourceRows();
    const { headers, rows: readRows } = await readBack(await buildAssignmentWorkbook(rows));

    expect(headers).toEqual(HEADERS);
    expect(readRows).toHaveLength(rows.length);
    expect(readRows).toEqual(rows.map((row) => cellsOf(row).map(expectedCell)));
  });

  it('빈 필드는 빈 셀로 간다 — 문자열 `null`이 되지 않는다', async () => {
    const rows = sourceRows();
    const withoutPriority = rows.filter((row) => row.priority === null);
    expect(withoutPriority.length).toBeGreaterThan(0);

    const { rows: readRows } = await readBack(await buildAssignmentWorkbook(rows));
    const target = readRows.find((row) => row[1] === withoutPriority[0].taskNo);
    expect(target?.[5]).toBeNull();
  });
});
