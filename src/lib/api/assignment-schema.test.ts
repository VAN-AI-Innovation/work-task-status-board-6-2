/**
 * 이 스키마가 지는 계약은 하나다 — **내려받기 요청의 행은 우리가 만든 것이 아니다.**
 * `/extract`는 아무것도 저장하지 않아서(`ADR-022`) 행 JSON이 브라우저를 한 번 왕복하고,
 * 돌아온 것은 그냥 사용자 입력이다. 그 입력으로 **사람들에게 배포될 xlsx**를 만든다(`S1`).
 *
 * 그래서 여기서 재는 것은 「모양이 맞나」가 아니라 **「이 값으로 파일을 만들어도 되나」**다:
 * 모르는 키가 섞이지 않았는지, 한 요청이 만들 수 있는 파일 크기에 상한이 있는지,
 * 파일명이 헤더를 넘어 다른 줄로 새지 않는지.
 */

import { describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_MAX_DETAILS_LENGTH,
  ASSIGNMENT_MAX_ROWS,
  ASSIGNMENT_MAX_TITLE_LENGTH,
  assignmentExportSchema,
  safeDownloadFilename,
} from '@/lib/api/assignment-schema';
import type { AssignmentRow } from '@/types/doc';

const ROW: AssignmentRow = {
  category: '콘텐츠 기획',
  taskNo: '1-1',
  title: '주간 콘텐츠 캘린더 정리',
  difficulty: '中上',
  deadlineRaw: '9/1까지',
  deadlineDate: '2026-09-01',
  priority: '긴급',
  priorityRaw: 'P0',
  details: '- 채널별 발행 주기 정리\n- 담당자 배분',
};

const rowWith = (patch: Partial<Record<string, unknown>>): unknown => ({ ...ROW, ...patch });

describe('assignmentExportSchema — 통과하는 것', () => {
  it('배정표 행 그대로를 통과시킨다', () => {
    const parsed = assignmentExportSchema.parse({ rows: [ROW] });

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual(ROW);
    expect(parsed.filename).toBeUndefined();
  });

  it('null 필드를 허용한다 — 조인·추론 실패는 정상 결과다 (ADR-021)', () => {
    const empty: AssignmentRow = {
      category: null,
      taskNo: '9-9',
      title: '이름만 있는 과제',
      difficulty: null,
      deadlineRaw: null,
      deadlineDate: null,
      priority: null,
      priorityRaw: null,
      details: '',
    };

    expect(assignmentExportSchema.parse({ rows: [empty] }).rows[0]).toEqual(empty);
  });

  it('빈 배열을 통과시킨다 — 「과제 0건」의 판정은 doc-pipeline의 몫이다', () => {
    expect(assignmentExportSchema.parse({ rows: [] }).rows).toEqual([]);
  });

  it('filename을 주면 그대로 담는다 — 정리는 safeDownloadFilename이 한다', () => {
    expect(assignmentExportSchema.parse({ rows: [ROW], filename: '배정표.xlsx' }).filename).toBe(
      '배정표.xlsx',
    );
  });
});

describe('assignmentExportSchema — 거부하는 것', () => {
  it('모르는 키가 든 행을 거부한다 (.strict)', () => {
    expect(() => assignmentExportSchema.parse({ rows: [rowWith({ owner: '홍길동' })] })).toThrow();
  });

  it('본문에 모르는 키가 있으면 거부한다', () => {
    expect(() => assignmentExportSchema.parse({ rows: [ROW], sheetName: '아무거나' })).toThrow();
  });

  it.each([
    ['rows 없음', {}],
    ['rows가 배열이 아님', { rows: ROW }],
    ['taskNo가 숫자', { rows: [rowWith({ taskNo: 11 })] }],
    ['details가 null', { rows: [rowWith({ details: null })] }],
    ['필드 누락', { rows: [{ taskNo: '1-1', title: '제목' }] }],
    ['filename이 숫자', { rows: [ROW], filename: 7 }],
  ])('%s는 거부한다', (_label, body) => {
    expect(() => assignmentExportSchema.parse(body)).toThrow();
  });

  it('제목 길이 상한을 넘으면 거부한다', () => {
    const ok = 'ㄱ'.repeat(ASSIGNMENT_MAX_TITLE_LENGTH);
    expect(() => assignmentExportSchema.parse({ rows: [rowWith({ title: ok })] })).not.toThrow();
    expect(() => assignmentExportSchema.parse({ rows: [rowWith({ title: ok + 'ㄱ' })] })).toThrow();
  });

  it('세부항목 길이 상한을 넘으면 거부한다 — 한 요청이 만들 파일 크기의 상한이다', () => {
    const ok = 'ㄴ'.repeat(ASSIGNMENT_MAX_DETAILS_LENGTH);
    expect(() => assignmentExportSchema.parse({ rows: [rowWith({ details: ok })] })).not.toThrow();
    expect(() =>
      assignmentExportSchema.parse({ rows: [rowWith({ details: ok + 'ㄴ' })] }),
    ).toThrow();
  });

  it('행 수 상한을 넘으면 거부한다', () => {
    const rows = (count: number): unknown[] => Array.from({ length: count }, () => ROW);

    expect(() =>
      assignmentExportSchema.parse({ rows: rows(ASSIGNMENT_MAX_ROWS) }),
    ).not.toThrow();
    expect(() => assignmentExportSchema.parse({ rows: rows(ASSIGNMENT_MAX_ROWS + 1) })).toThrow();
  });

  it('상한이 실측 과제 수보다 넉넉하다 — 정상 문서를 거부하면 방어가 아니라 고장이다', () => {
    // 실측 워크로드 문서의 과제는 20건이다 (`scripts/smoke/RESULT.md`「H8」)
    expect(ASSIGNMENT_MAX_ROWS).toBeGreaterThanOrEqual(2000);
  });
});

describe('safeDownloadFilename', () => {
  it('평범한 이름은 그대로 두고 확장자만 보장한다', () => {
    expect(safeDownloadFilename('배정표.xlsx', 'assignment.xlsx')).toBe('배정표.xlsx');
    expect(safeDownloadFilename('배정표', 'assignment.xlsx')).toBe('배정표.xlsx');
  });

  it('없거나 비어 있으면 fallback이다', () => {
    expect(safeDownloadFilename(undefined, 'assignment.xlsx')).toBe('assignment.xlsx');
    expect(safeDownloadFilename('   ', 'assignment.xlsx')).toBe('assignment.xlsx');
    expect(safeDownloadFilename('.xlsx', 'assignment.xlsx')).toBe('assignment.xlsx');
  });

  it.each([
    ['경로 구분자', '../../etc/passwd'],
    ['윈도 경로', 'C:\\Windows\\system32\\config'],
    ['상위 이동만', '../..'],
  ])('%s에서 경로가 사라진다', (_label, input) => {
    const name = safeDownloadFilename(input, 'assignment.xlsx');

    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
    expect(name).not.toContain('..');
    expect(name.endsWith('.xlsx')).toBe(true);
  });

  it('개행·따옴표·제어문자를 없앤다 — Content-Disposition의 헤더 인젝션 자리다', () => {
    const name = safeDownloadFilename('a"\r\nSet-Cookie: x=1\u0000.xlsx', 'assignment.xlsx');

    // 헤더를 다른 줄로 가르는 것은 CR·LF다. 남은 글자가 「Set-Cookie」처럼 보여도 그것은
    // 파일명 안의 텍스트일 뿐이라 지우지 않는다 — 지우기 시작하면 목록이 끝없이 는다.
    expect(name).not.toMatch(/[\r\n"\u0000]/);
    expect(name.endsWith('.xlsx')).toBe(true);
  });

  it('길이에 상한이 있다', () => {
    const name = safeDownloadFilename('가'.repeat(500), 'assignment.xlsx');

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('.xlsx')).toBe(true);
  });

  it('확장자를 두 번 붙이지 않는다 — 멱등이다', () => {
    const once = safeDownloadFilename('배정표.xlsx', 'assignment.xlsx');
    expect(safeDownloadFilename(once, 'assignment.xlsx')).toBe(once);
  });
});
