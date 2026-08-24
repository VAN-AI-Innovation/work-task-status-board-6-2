/**
 * 배정표 행의 계약을 고정한다. 이 계층에 판단 셋이 모여 있어 케이스도 셋으로 갈린다 —
 * 난이도(긴 것부터 매칭) · 마감(연도 주입, 실패해도 원문 보존) · 우선순위(조인, 실패는 침묵).
 *
 * 케이스는 문자열 리터럴로 만들고, 픽스처는 마지막 한 묶음에서 전 계층을 통과시킬 때만 읽는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildAssignmentRows,
  DIFFICULTY_LABELS,
  DIFFICULTY_LEVELS,
  DIFFICULTY_MATCH_ORDER,
  PRIORITY_LEVELS,
  WORKLOAD_PRIORITY_MAP,
} from '@/lib/doc/assignment-mapper';
import { readMarkdownOutline } from '@/lib/doc/markdown-reader';
import { buildOutline } from '@/lib/doc/outline-builder';
import { parseWorkloadPriorities } from '@/lib/doc/workload-parser';
import type { OutlineTask, WorkloadEntry } from '@/types/doc';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));

const BASE_YEAR = 2026;

const task = (headingRaw: string, extra: Partial<OutlineTask> = {}): OutlineTask => ({
  category: '테스트 대분류',
  taskNo: /^(\d+-\d+)/.exec(headingRaw)?.[1] ?? '0-0',
  headingRaw,
  orderIndex: 0,
  details: [],
  ...extra,
});

/** 과제 하나를 워크로드 없이 매핑한 행 */
const row = (headingRaw: string, baseYear = BASE_YEAR) =>
  buildAssignmentRows([task(headingRaw)], [], { baseYear })[0];

describe('buildAssignmentRows — 난이도 (T7 완료 기준 3)', () => {
  it('매칭 순서 배열은 두 글자짜리가 먼저다 — 이 순서가 정규식의 순서다', () => {
    expect(DIFFICULTY_MATCH_ORDER.indexOf('中上')).toBeLessThan(
      DIFFICULTY_MATCH_ORDER.indexOf('中')
    );
    expect(DIFFICULTY_MATCH_ORDER.indexOf('中下')).toBeLessThan(
      DIFFICULTY_MATCH_ORDER.indexOf('中')
    );
    /*
     * 매칭 목록(한자)과 표시 목록(한글)은 **같은 다섯 단계여야 한다.** 한쪽만 늘리면
     * 문서에서 잡히는데 드롭다운에 없는 값(또는 그 반대)이 생기고, 그 배정표를 재업로드하면
     * 미등록 값이 된다. 둘을 잇는 것이 `DIFFICULTY_LABELS`다.
     */
    expect([...DIFFICULTY_MATCH_ORDER].sort()).toEqual(Object.keys(DIFFICULTY_LABELS).sort());
    expect([...DIFFICULTY_LEVELS].sort()).toEqual(Object.values(DIFFICULTY_LABELS).sort());
  });

  it('표시용 배열은 사람이 읽는 순서다 — 상에서 하로 내려간다', () => {
    expect(DIFFICULTY_LEVELS).toEqual(['상', '중상', '중', '중하', '하']);
  });

  it('한글 표기가 한자 단계와 1:1이다 — 두 단계가 같은 글자로 뭉개지지 않는다', () => {
    expect(new Set(Object.values(DIFFICULTY_LABELS)).size).toBe(
      Object.keys(DIFFICULTY_LABELS).length
    );
  });

  it('`中上`이 `中`으로 떨어지지 않는다', () => {
    expect(row('3-2. 이상치 리포트 (中上)').difficulty).toBe('중상');
  });

  it('`中下`가 `中`으로 떨어지지 않는다', () => {
    expect(row('3-3. 회귀 점검 (中下)').difficulty).toBe('중하');
  });

  it('한 글자짜리 셋도 그대로 잡힌다', () => {
    expect(row('3-1. 과제 (上)').difficulty).toBe('상');
    expect(row('3-1. 과제 (中)').difficulty).toBe('중');
    expect(row('3-1. 과제 (下)').difficulty).toBe('하');
  });

  it('난이도가 없으면 null이다 — 추론하지 않는다', () => {
    expect(row('3-5. 이름만 있는 과제').difficulty).toBeNull();
  });

  it('제목 본문의 글자를 난이도로 줍지 않는다 — 괄호 안만 본다', () => {
    const mapped = row('3-8. 上반기 결산 정리');

    expect(mapped.difficulty).toBeNull();
    expect(mapped.title).toBe('上반기 결산 정리');
  });
});

describe('buildAssignmentRows — 제목', () => {
  it('번호 접두사와 난이도·마감 괄호를 뗀다', () => {
    expect(row('3-1. 시트 통합 파서 (上, 9/1까지)').title).toBe('시트 통합 파서');
  });

  it('괄호가 둘이어도 둘 다 뗀다', () => {
    expect(row('3-6. 과제 (中) (2026-10-05까지)').title).toBe('과제');
  });

  it('난이도도 마감도 없는 괄호는 제목의 일부다 — 떼지 않는다', () => {
    const mapped = row('3-9. 촬영 가이드 (2부)');

    expect(mapped.title).toBe('촬영 가이드 (2부)');
    expect(mapped.deadlineRaw).toBeNull();
  });

  it('`)` 구분자와 공백 구분자도 번호로 인정한다', () => {
    expect(row('3-1) 괄호 구분자').title).toBe('괄호 구분자');
    expect(row('3-1 공백 구분자').title).toBe('공백 구분자');
  });

  it('번호와 난이도만 있는 제목은 빈 문자열이 된다 — 던지지 않는다', () => {
    expect(row('3-1. (上)').title).toBe('');
  });
});

describe('buildAssignmentRows — 마감', () => {
  it('`M/D` 표기가 baseYear로 채워진다', () => {
    const mapped = row('3-1. 시트 통합 파서 (上, 9/1까지)');

    expect(mapped.deadlineRaw).toBe('9/1까지');
    expect(mapped.deadlineDate).toBe('2026-09-01');
  });

  it('연도는 하드코딩이 아니라 주입값이다', () => {
    expect(row('3-1. 과제 (上, 9/1까지)', 2027).deadlineDate).toBe('2027-09-01');
    expect(row('3-1. 과제 (上, 9/1까지)', 2030).deadlineDate).toBe('2030-09-01');
  });

  it('`YYYY-MM-DD` 표기는 그 연도를 그대로 쓴다', () => {
    const mapped = row('3-6. 과제 (中) (2026-10-05까지)');

    expect(mapped.deadlineRaw).toBe('2026-10-05까지');
    expect(mapped.deadlineDate).toBe('2026-10-05');
  });

  it('`N월 M일` 표기도 날짜가 된다', () => {
    const mapped = row('3-7. 과제 (9월 1일까지)');

    expect(mapped.deadlineRaw).toBe('9월 1일까지');
    expect(mapped.deadlineDate).toBe('2026-09-01');
  });

  it('추론에 실패해도 원문은 남는다 — 사람이 그 칸을 보고 채운다', () => {
    const mapped = row('3-4. 문서 정리 (下, 추후 협의)');

    expect(mapped.difficulty).toBe('하');
    expect(mapped.deadlineRaw).toBe('추후 협의');
    expect(mapped.deadlineDate).toBeNull();
  });

  it('달력에 없는 날짜도 원문을 버리지 않는다', () => {
    const mapped = row('3-1. 과제 (上, 13/45까지)');

    expect(mapped.deadlineRaw).toBe('13/45까지');
    expect(mapped.deadlineDate).toBeNull();
  });

  it('마감이 없으면 둘 다 null이다', () => {
    const mapped = row('3-5. 이름만 있는 과제');

    expect(mapped.deadlineRaw).toBeNull();
    expect(mapped.deadlineDate).toBeNull();
  });
});

describe('buildAssignmentRows — 우선순위 (ADR-021)', () => {
  const workload: WorkloadEntry[] = [{ taskNo: '3-1', priorityRaw: 'P0' }];

  it('매핑표는 결정 A의 네 값이고 시트 enum과 같다', () => {
    expect(WORKLOAD_PRIORITY_MAP).toEqual({ P0: '긴급', P1: '높음', P2: '보통', P3: '낮음' });
    expect(Object.values(WORKLOAD_PRIORITY_MAP)).toEqual([...PRIORITY_LEVELS]);
  });

  it('`P0`이 시트 enum 값으로 옮겨지고 원문도 남는다', () => {
    const [mapped] = buildAssignmentRows([task('3-1. 과제')], workload, { baseYear: BASE_YEAR });

    expect(mapped.priority).toBe('긴급');
    expect(mapped.priorityRaw).toBe('P0');
  });

  it('네 값이 모두 옮겨진다', () => {
    const tasks = ['3-1. 가', '3-2. 나', '3-3. 다', '3-4. 라'].map((h) => task(h));
    const entries: WorkloadEntry[] = [
      { taskNo: '3-1', priorityRaw: 'P0' },
      { taskNo: '3-2', priorityRaw: 'P1' },
      { taskNo: '3-3', priorityRaw: 'P2' },
      { taskNo: '3-4', priorityRaw: 'P3' },
    ];

    expect(buildAssignmentRows(tasks, entries, { baseYear: BASE_YEAR }).map((r) => r.priority)) //
      .toEqual(['긴급', '높음', '보통', '낮음']);
  });

  it('워크로드에 없는 과제는 조용히 빈칸이다 — 경고를 내지 않는다', () => {
    const [mapped] = buildAssignmentRows([task('3-9. 과제')], workload, { baseYear: BASE_YEAR });

    expect(mapped.priority).toBeNull();
    expect(mapped.priorityRaw).toBeNull();
  });

  it('워크로드에만 있는 번호는 행을 만들지 않는다', () => {
    const rows = buildAssignmentRows([task('3-1. 과제')], [{ taskNo: '9-9', priorityRaw: 'P1' }], {
      baseYear: BASE_YEAR,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].taskNo).toBe('3-1');
    expect(rows[0].priority).toBeNull();
  });

  it('표에 없는 원문은 셀을 비우되 원문은 남긴다 — 목록 밖 값을 셀에 쓰지 않는다', () => {
    const rows = buildAssignmentRows([task('3-1. 과제')], [{ taskNo: '3-1', priorityRaw: 'P7' }], {
      baseYear: BASE_YEAR,
    });

    expect(rows[0].priority).toBeNull();
    expect(rows[0].priorityRaw).toBe('P7');
  });

  it('같은 번호가 두 번 오면 처음 것이 이긴다', () => {
    const entries: WorkloadEntry[] = [
      { taskNo: '3-1', priorityRaw: 'P0' },
      { taskNo: '3-1', priorityRaw: 'P3' },
    ];

    expect(buildAssignmentRows([task('3-1. 과제')], entries, { baseYear: BASE_YEAR })[0].priority) //
      .toBe('긴급');
  });
});

describe('buildAssignmentRows — 세부항목·순서·안전', () => {
  it('세부항목은 개행으로 이어진다', () => {
    const mapped = buildAssignmentRows(
      [task('3-1. 과제', { details: ['가', '나', '다'] })],
      [],
      { baseYear: BASE_YEAR }
    )[0];

    expect(mapped.details).toBe('가\n나\n다');
  });

  it('세부항목이 없으면 빈 문자열이다', () => {
    expect(row('3-1. 과제').details).toBe('');
  });

  it('대분류와 번호는 그대로 옮긴다', () => {
    const mapped = buildAssignmentRows([task('3-1. 과제', { category: null })], [], {
      baseYear: BASE_YEAR,
    })[0];

    expect(mapped.category).toBeNull();
    expect(mapped.taskNo).toBe('3-1');
  });

  it('문서 순서를 그대로 유지한다', () => {
    const tasks = ['3-2. 나', '3-1. 가'].map((h) => task(h));

    expect(buildAssignmentRows(tasks, [], { baseYear: BASE_YEAR }).map((r) => r.taskNo)) //
      .toEqual(['3-2', '3-1']);
  });

  it('빈 입력에도 던지지 않는다', () => {
    expect(buildAssignmentRows([], [], { baseYear: BASE_YEAR })).toEqual([]);
  });

  it('담당자·상태·진행률을 만들지 않는다 — 사람이 채우는 칸이다', () => {
    expect(Object.keys(row('3-1. 과제')).sort()).toEqual([
      'category',
      'deadlineDate',
      'deadlineRaw',
      'details',
      'difficulty',
      'priority',
      'priorityRaw',
      'taskNo',
      'title',
    ]);
  });
});

describe('buildAssignmentRows — 픽스처 (리더→빌더→파서→매퍼)', () => {
  const nodes = readMarkdownOutline(readFileSync(FIXTURE, 'utf8'));
  const rows = buildAssignmentRows(buildOutline(nodes).tasks, parseWorkloadPriorities(nodes), {
    baseYear: BASE_YEAR,
  });

  it('과제 6건이 순서대로 나온다', () => {
    expect(rows.map((r) => r.taskNo)).toEqual(['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']);
  });

  it('난이도 5종이 모두 정확히 나온다', () => {
    expect(rows.map((r) => r.difficulty)).toEqual(['상', '중상', '중하', '중', null, '하']);
  });

  it('마감은 추론된 것과 원문만 남은 것이 갈린다', () => {
    expect(rows.map((r) => [r.deadlineRaw, r.deadlineDate])).toEqual([
      ['9/1까지', '2026-09-01'],
      [null, null],
      ['9/15까지', '2026-09-15'],
      ['추후 협의', null],
      [null, null],
      [null, null],
    ]);
  });

  it('제목에서 번호와 난이도·마감 괄호가 빠진다', () => {
    expect(rows.map((r) => r.title)).toEqual([
      '숏폼 시리즈 기획',
      '썸네일 A/B 테스트',
      '커뮤니티 응대 체계',
      '주간 리포트 자동화',
      '아카이브 정리',
      '정산 서식 점검',
    ]);
  });

  it('워크로드 조인은 세 건만 붙고 나머지는 빈칸이다', () => {
    expect(rows.map((r) => r.priority)).toEqual(['긴급', '높음', '긴급', null, null, null]);
  });

  it('수식 주입 페이로드가 세부항목에 원문 그대로 살아 있다 — 방어는 쓰기 계층이다', () => {
    const target = rows.find((r) => r.taskNo === '3-2');

    expect(target?.details).toContain("=cmd|'/c calc'!A1");
  });

  it('대분류가 세 종류로 붙는다', () => {
    expect(rows.map((r) => r.category)).toEqual([
      '콘텐츠 제작',
      '콘텐츠 제작',
      '채널 운영',
      '채널 운영',
      '지원 업무',
      '지원 업무',
    ]);
  });
});
