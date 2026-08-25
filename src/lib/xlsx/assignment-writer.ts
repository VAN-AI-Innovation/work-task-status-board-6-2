/**
 * 배정표 xlsx를 만든다.
 *
 * **제품 코드가 `exceljs`를 쓰기 위해 import하는 유일한 파일이다** (ADR-003).
 * 읽기 쪽 짝은 `lib/sheet/workbook-reader.ts`이고, 그 둘 말고는 아무도 이 라이브러리를 모른다.
 *
 * 이 파일이 만드는 파일은 **조직 사람들에게 배포된다** (`PLAN.md` S1). 문서 본문의 값이
 * 그대로 셀에 들어가는데 `=`로 시작하는 문자열을 엑셀은 수식으로 읽고, `=cmd|'/c calc'!A1`은
 * 받는 사람 PC에서 실행된다. 그래서 방어를 **여기 한 곳에서 강제한다** (ADR-012):
 * 모든 문자열 셀이 `sanitizeCellText`를 통과하고 텍스트 서식(`@`)을 단다. 헤더도 예외가 아니다 —
 * 한 칸이라도 예외를 만들면 다음 사람이 우회 경로를 하나 더 만든다.
 *
 * 동시에 이 파일이 **고리를 닫는다.** 배정표는 사람이 채워 `/upload`에 다시 올릴 입력 파일이라,
 * 드롭다운이 붙어 있어야 재업로드에서 enum이 맞는다. 그래서 꾸미기는 틀고정·굵은 헤더·열 너비까지다 —
 * 색·조건부 서식·자동 필터·차트를 넣지 않는다. 꾸밈이 늘수록 재업로드에서 파서가 만날 셀 형태가 는다.
 */

import ExcelJS from 'exceljs';

import { DIFFICULTY_LEVELS, PRIORITY_LEVELS } from '@/lib/doc/assignment-mapper';
import { STATUS_SEMANTIC_MAP } from '@/lib/domain/task-semantic';
import type { AssignmentRow } from '@/types/doc';

/** 배정표에 붙는 드롭다운 목록 셋. 컬럼 이름이 아니라 **의미**로 부른다 */
export interface AssignmentDropdowns {
  status: readonly string[];
  difficulty: readonly string[];
  priority: readonly string[];
}

/**
 * 기본 목록 (`PLAN.md`「T7 착수 시 확정」결정 B).
 *
 * **세 값 모두 이미 코드에 있는 단일 출처를 가리킨다.** 특히 상태 10개를 여기 다시 적지 않는다 —
 * 가운뎃점 하나만 달라져도(`게시·이관 대기`) 재업로드에서 조용히 미매핑되고, 상태 원문의 출처를
 * 한 곳으로 몰아 둔 `ADR-009`가 그 자리에서 깨진다.
 */
export const DEFAULT_DROPDOWNS: AssignmentDropdowns = {
  status: Object.keys(STATUS_SEMANTIC_MAP),
  difficulty: DIFFICULTY_LEVELS,
  priority: PRIORITY_LEVELS,
};

export interface AssignmentColumn {
  header: string;
  /** 엑셀 열 너비 (문자 수 기준) */
  width: number;
  /** 이 칸에 붙는 드롭다운 목록. 없으면 자유 입력이다 */
  dropdown?: keyof AssignmentDropdowns;
  /** 표시 서식. 기본은 텍스트(`@`)이고 진행률만 다르다 */
  numFmt?: string;
}

/**
 * 컬럼 11개 (`PLAN.md` 5절의 그림). **순서가 계약이다** — 사람이 채워 되올릴 파일이라
 * 컬럼이 움직이면 시트 파서의 헤더 매칭이 달라진다.
 *
 * 담당자·상태·진행률·비고는 빈 칸이다. 기계가 그럴듯하게 메우면 받는 사람이 그것을 믿는다.
 */
export const ASSIGNMENT_COLUMNS: readonly AssignmentColumn[] = [
  { header: '카테고리', width: 18 },
  { header: '번호', width: 8 },
  { header: '과제명', width: 32 },
  { header: '난이도', width: 10, dropdown: 'difficulty' },
  { header: '마감', width: 14 },
  { header: '우선순위', width: 10, dropdown: 'priority' },
  { header: '세부항목', width: 48 },
  { header: '담당자', width: 12 },
  { header: '상태', width: 14, dropdown: 'status' },
  { header: '진행률', width: 10, numFmt: '0%' },
  { header: '비고', width: 20 },
];

const DEFAULT_SHEET_NAME = '업무 배정표';

/** 텍스트 서식. 문자열 셀은 전부 이것을 단다 */
const TEXT_FORMAT = '@';

/**
 * 엑셀이 수식으로 읽기 시작하는 문자들. 탭·개행이 여기 있는 이유는 그 둘로 시작하는 셀을
 * 엑셀이 앞 공백처럼 흘려보내고 뒤의 `=`를 집기 때문이다 (`CLAUDE.md` 보안 규칙).
 */
const DANGEROUS_LEADERS = ['=', '+', '-', '@', '\t', '\r', '\n'];

/** 방어를 알리는 프리픽스. 엑셀이 「이건 텍스트다」로 읽는 관습적 표기다 */
const TEXT_PREFIX = "'";

/**
 * `S1`의 방어. **이 함수 하나가 규칙의 전부다.**
 *
 * 위험 문자를 **삭제하지 않는다** — 프리픽스를 붙여 값을 보존한다. `ADR-012`의 트레이드오프가
 * 그것이다: 「`=`로 시작하는 정당한 텍스트도 앞에 `'`가 붙는다. 사람이 지우면 그만이다.」
 * 값을 지우는 쪽이 훨씬 나쁜 실패다.
 *
 * 앞 공백을 건너뛰고 한 번 더 보는 이유는 엑셀이 ` =SUM(A1)`을 수식으로 읽기 때문이다.
 * 이미 프리픽스가 붙은 값에는 두 번 붙이지 않는다 — 이 함수는 멱등이다.
 */
export function sanitizeCellText(value: string): string {
  if (value === '') return value;
  if (value.startsWith(TEXT_PREFIX)) return value;

  if (DANGEROUS_LEADERS.includes(value[0])) return TEXT_PREFIX + value;

  const leading = value.replace(/^\s+/, '');
  if (leading !== '' && DANGEROUS_LEADERS.includes(leading[0])) return TEXT_PREFIX + value;

  return value;
}

/** 배정표 행 하나를 셀 11칸으로 흩는다. 빈 칸은 빈 문자열이다 */
function cellsOf(row: AssignmentRow): string[] {
  return [
    row.category ?? '',
    row.taskNo,
    row.title,
    row.difficulty ?? '',
    // 날짜 타입으로 쓰지 않는다. 추론에 성공한 행(`2026-09-01`)과 실패한 행(`추후 협의`)이
    // 같은 컬럼에 섞이는데, 타입이 갈리면 재업로드에서 한 컬럼이 두 가지로 읽힌다.
    row.deadlineDate ?? row.deadlineRaw ?? '',
    row.priority ?? '',
    row.details,
    // 담당자 · 상태 · 진행률 · 비고 — 사람이 채운다
    '',
    '',
    '',
    '',
  ];
}

/**
 * 인라인 목록으로 만든다. **엑셀 한도는 255자**이고 기본 목록 셋은 그보다 훨씬 짧다.
 * 넘길 만큼 긴 목록(설정 탭 enum 전량 같은 것)을 넣게 되면 별도 시트 참조로 바꿔야 한다.
 * 그리고 **값에 `,`가 들어가면 목록이 그 자리에서 갈라진다** — 구분자가 쉼표뿐이라 escape가 없다.
 */
function listFormula(values: readonly string[]): string {
  return `"${values.join(',')}"`;
}

/**
 * 배정표 xlsx 바이트를 만든다. 빈 `rows`도 헤더만 있는 파일이 되고 던지지 않는다 —
 * 「과제 0건」의 판정은 파이프라인의 몫이지 쓰기 계층의 몫이 아니다.
 */
export async function buildAssignmentWorkbook(
  rows: readonly AssignmentRow[],
  opts?: { dropdowns?: AssignmentDropdowns; sheetName?: string }
): Promise<Uint8Array> {
  const dropdowns = opts?.dropdowns ?? DEFAULT_DROPDOWNS;

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(opts?.sheetName ?? DEFAULT_SHEET_NAME);
  // 1행 틀고정. 배정표는 세로로 길어지는 입력 파일이라 헤더가 붙어 있어야 한다.
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  ASSIGNMENT_COLUMNS.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });

  const headerRow = worksheet.getRow(1);
  ASSIGNMENT_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = sanitizeCellText(column.header);
    cell.numFmt = TEXT_FORMAT;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle' };
  });

  rows.forEach((row, rowIndex) => {
    const values = cellsOf(row);
    const sheetRow = worksheet.getRow(rowIndex + 2);

    ASSIGNMENT_COLUMNS.forEach((column, index) => {
      const cell = sheetRow.getCell(index + 1);
      const text = sanitizeCellText(values[index]);

      // `cell.value`에는 문자열만 넣는다. `{formula: …}` 객체를 만들 길이 이 파일에 없어야
      // 실수로도 수식이 나가지 않는다.
      cell.value = text === '' ? null : text;
      cell.numFmt = column.numFmt ?? TEXT_FORMAT;

      /*
       * **줄바꿈을 켠다.** 엑셀은 셀이 넘치면 오른쪽 칸이 비어 있는 동안 그 위로 글자를
       * 흘려 보낸다 — 배정표는 담당자·상태·비고가 **빈 채로** 나가는 파일이라, 세부항목 한
       * 줄이 표 절반을 가로질러 어느 칸의 값인지 알 수 없게 된다.
       *
       * 켜면 부수 효과가 하나 더 따라온다: 세부항목을 개행으로 이어 담았는데(`\n`) 그 개행이
       * 이 속성 없이는 화면에 나타나지 않는다. 불릿 셋이 한 문단으로 붙어 보이던 것이
       * 그래서였다.
       *
       * 행 높이는 **지정하지 않는다.** 엑셀이 접힌 줄 수에 맞춰 자동으로 잡으며, 여기서
       * 숫자를 박으면 긴 항목이 잘린 채 고정된다.
       */
      cell.alignment = { wrapText: true, vertical: 'top' };

      // 드롭다운은 **데이터 행에만** 건다. 헤더에 걸면 헤더가 목록 밖 값이 되어 경고가 뜬다.
      if (column.dropdown) {
        cell.dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [listFormula(dropdowns[column.dropdown])],
        };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  // 라우트가 그대로 응답 본문에 실을 수 있어야 한다. Node Buffer도 ArrayBuffer도 여기서 수렴한다.
  return new Uint8Array(buffer as ArrayBuffer);
}
