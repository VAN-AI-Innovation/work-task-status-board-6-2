/**
 * 과제 판별의 계약을 고정한다. 이 파일이 지키는 사실 하나는 실측에서 나왔다 —
 * 실제 문서의 `h3` 50건 중 과제는 `N-M.` 접두사를 가진 20건뿐이고 나머지 30건은
 * 절 제목이다 (`scripts/smoke/RESULT.md`「H8」). **깊이가 아니라 접두사가 진실이다.**
 *
 * 케이스는 문자열 리터럴로 만든다. 픽스처를 읽는 것은 마지막 한 묶음뿐이다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildOutline, WORKLOAD_SECTION_PATTERN } from '@/lib/doc/outline-builder';
import { readMarkdownOutline } from '@/lib/doc/markdown-reader';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));

/** 리터럴 케이스는 리더를 거쳐 만든다 — 두 계층이 실제로 맞물리는지도 함께 본다 */
const build = (markdown: string) => buildOutline(readMarkdownOutline(markdown));

describe('buildOutline — 대분류와 과제', () => {
  it('`## N. 대분류` 아래 `### N-M. 과제`를 과제 한 건으로 만든다', () => {
    const { tasks, warnings } = build('## 3. 데이터\n### 3-1. 파서');

    expect(tasks).toEqual([
      { category: '데이터', taskNo: '3-1', headingRaw: '3-1. 파서', orderIndex: 0, details: [] },
    ]);
    expect(warnings).toEqual([]);
  });

  it('category는 대분류 제목에서 번호를 뗀 이름이다', () => {
    expect(build('## 12. 채널 운영\n### 12-3. 응대').tasks[0].category).toBe('채널 운영');
  });

  it('대분류도 `.`·`)` 둘 다 받는다', () => {
    expect(build('## 3) 데이터\n### 3-1. 파서').tasks[0].category).toBe('데이터');
  });

  it('headingRaw는 번호를 포함한 제목 원문이다 — 난이도·마감 표기를 자르지 않는다', () => {
    const { tasks } = build('## 1. 콘텐츠\n### 1-1. 숏폼 기획 (上) (9/1까지)');
    expect(tasks[0].headingRaw).toBe('1-1. 숏폼 기획 (上) (9/1까지)');
  });

  it('orderIndex는 문서에 나온 순서로 0부터 매겨진다', () => {
    const md = '## 1. 가\n### 1-1. 하나\n### 1-2. 둘\n## 2. 나\n### 2-1. 셋';
    const { tasks } = build(md);

    expect(tasks.map((t) => [t.taskNo, t.orderIndex])).toEqual([
      ['1-1', 0],
      ['1-2', 1],
      ['2-1', 2],
    ]);
    expect(tasks.map((t) => t.category)).toEqual(['가', '가', '나']);
  });
});

describe('buildOutline — 과제 판별은 깊이가 아니라 번호 접두사다', () => {
  it('`##`에 붙은 `N-M.`도 과제다 (level을 보지 않는다)', () => {
    const { tasks } = build('## 1-1. 과제');
    expect(tasks.map((t) => t.taskNo)).toEqual(['1-1']);
  });

  it('`#####`에 붙은 `N-M.`도 과제다', () => {
    expect(build('## 1. 가\n##### 1-1. 과제').tasks.map((t) => t.taskNo)).toEqual(['1-1']);
  });

  it('`### 3-1.과제`처럼 점 뒤 공백이 없어도 과제다', () => {
    const { tasks } = build('## 3. 가\n### 3-1.과제');
    expect(tasks[0]).toMatchObject({ taskNo: '3-1', headingRaw: '3-1.과제' });
  });

  it('`### 3-1) 과제`처럼 괄호 구분자도 과제다', () => {
    expect(build('## 3. 가\n### 3-1) 과제').tasks[0].taskNo).toBe('3-1');
  });

  it('`### 3-1 과제`처럼 구분자 없이 공백만 있어도 과제다', () => {
    expect(build('## 3. 가\n### 3-1 과제').tasks[0].taskNo).toBe('3-1');
  });

  it('제목이 번호뿐인 `### 3-1.`도 과제다', () => {
    expect(build('## 3. 가\n### 3-1.').tasks.map((t) => t.taskNo)).toEqual(['3-1']);
  });

  it('`#### 3-1-1. 하위`는 과제가 아니다 — `N-M.` 두 단만 과제다', () => {
    const { tasks } = build('## 3. 가\n### 3-1. 파서\n#### 3-1-1. 하위\n- 세부');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].taskNo).toBe('3-1');
    expect(tasks[0].details).toEqual(['3-1-1. 하위', '세부']);
  });

  it('`### 3-11. 과제`는 두 자리 번호의 과제다', () => {
    expect(build('## 3. 가\n### 3-11. 과제').tasks[0].taskNo).toBe('3-11');
  });
});

describe('buildOutline — 번호 없는 절은 과제가 아니라 세부항목이다', () => {
  it('직전 과제의 details에 절 제목과 그 lines가 순서대로 흡수된다', () => {
    const md = ['## 3. 가', '### 3-1. 파서', '- 본문 하나', '### 검토 포인트', '- 본문 둘'].join('\n');
    const { tasks, warnings } = build(md);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].details).toEqual(['본문 하나', '검토 포인트', '본문 둘']);
    expect(warnings).toEqual([]);
  });

  it('과제 자신의 lines가 details의 앞머리다', () => {
    expect(build('## 3. 가\n### 3-1. 파서\n- 하나\n- 둘').tasks[0].details).toEqual(['하나', '둘']);
  });

  it('세부항목이 없으면 details는 빈 배열이다', () => {
    expect(build('## 3. 가\n### 3-1. 파서').tasks[0].details).toEqual([]);
  });

  it('직전 과제가 없으면 어디에도 붙지 않고 버려지며 경고 1건이 남는다', () => {
    const { tasks, warnings } = build('## 3. 가\n### 작성 안내\n- 버려질 본문');

    expect(tasks).toEqual([]);
    expect(warnings).toEqual(['ORPHAN_SECTION']);
  });

  it('제목 앞 서두 본문도 직전 과제가 없으므로 버려지고 경고가 남는다', () => {
    const { tasks, warnings } = build('머리말 한 줄\n## 3. 가\n### 3-1. 파서');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].details).toEqual([]);
    expect(warnings).toEqual(['ORPHAN_SECTION']);
  });

  it('대분류가 바뀌면 흡수가 끊긴다 — 다음 대분류의 절이 이전 과제에 붙지 않는다', () => {
    const md = ['## 1. 가', '### 1-1. 하나', '## 2. 나', '### 안내', '- 나의 본문'].join('\n');
    const { tasks, warnings } = build(md);

    expect(tasks[0].details).toEqual([]);
    expect(warnings).toEqual(['ORPHAN_SECTION']);
  });
});

describe('buildOutline — 경고', () => {
  it('대분류 없이 나온 과제는 category가 null이고 경고가 남되 버려지지 않는다', () => {
    const { tasks, warnings } = build('### 5-1. 대분류 없는 과제');

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ category: null, taskNo: '5-1' });
    expect(warnings).toEqual(['NO_CATEGORY:5-1']);
  });

  it('같은 taskNo가 두 번 나오면 둘 다 남기고 경고 1건을 낸다', () => {
    const { tasks, warnings } = build('## 3. 가\n### 3-1. 앞\n### 3-1. 뒤');

    expect(tasks.map((t) => [t.taskNo, t.orderIndex, t.headingRaw])).toEqual([
      ['3-1', 0, '3-1. 앞'],
      ['3-1', 1, '3-1. 뒤'],
    ]);
    expect(warnings).toEqual(['DUPLICATE_TASK_NO:3-1']);
  });

  it('세 번 나오면 경고도 두 건이다 — 중복 발생마다 하나씩', () => {
    const { warnings } = build('## 3. 가\n### 3-1. 하나\n### 3-1. 둘\n### 3-1. 셋');
    expect(warnings).toEqual(['DUPLICATE_TASK_NO:3-1', 'DUPLICATE_TASK_NO:3-1']);
  });

  it('경고에 문서 본문·제목 원문이 섞이지 않는다 (문서에는 사람 이름이 있다)', () => {
    const md = [
      '## 3. 가',
      '### 3-1. 홍길동 담당 과제',
      '- 연락처 010-0000-0000',
      '### 5-1. 대분류 없는 척',
      '### 안내',
    ].join('\n');
    const { warnings } = build(`${md}`);

    for (const w of warnings) {
      expect(w).toMatch(/^(NO_CATEGORY|ORPHAN_SECTION|DUPLICATE_TASK_NO)(:[\d-]+)?$/);
    }
  });
});

describe('buildOutline — 「워크로드 공유」 절', () => {
  it('절 안의 노드는 과제로도 대분류로도 잡히지 않고 경고도 내지 않는다', () => {
    const md = ['## 1. 가', '### 1-1. 하나', '## 워크로드 공유', '### P0', '- ① 1-1', '### 9-9. 함정'].join(
      '\n',
    );
    const { tasks, warnings } = build(md);

    expect(tasks.map((t) => t.taskNo)).toEqual(['1-1']);
    expect(tasks[0].details).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('같거나 더 얕은 level의 다음 제목에서 절이 끝난다', () => {
    const md = ['## 워크로드 공유', '### P0', '## 2. 나', '### 2-1. 다시 과제'].join('\n');
    expect(build(md).tasks.map((t) => t.taskNo)).toEqual(['2-1']);
  });

  it('더 깊은 제목은 절을 끝내지 않는다', () => {
    const md = ['## 워크로드 공유', '#### 1-1. 절 안의 번호', '### P1'].join('\n');
    expect(build(md).tasks).toEqual([]);
  });

  it('WORKLOAD_SECTION_PATTERN은 번호가 붙은 제목도 알아본다', () => {
    expect(WORKLOAD_SECTION_PATTERN.test('워크로드 공유')).toBe(true);
    expect(WORKLOAD_SECTION_PATTERN.test('5. 워크로드 공유')).toBe(true);
    expect(WORKLOAD_SECTION_PATTERN.test('워크로드공유')).toBe(true);
    expect(WORKLOAD_SECTION_PATTERN.test('콘텐츠 제작')).toBe(false);
  });
});

describe('buildOutline — 하드 실패하지 않는다', () => {
  it('빈 배열은 빈 결과다', () => {
    expect(buildOutline([])).toEqual({ tasks: [], warnings: [] });
  });

  it('제목이 하나도 없는 문서에도 던지지 않는다', () => {
    expect(() => build('- 본문만 있는 문서')).not.toThrow();
  });

  it('과제가 0건이어도 예외가 아니다 — 그 판정은 doc-pipeline의 몫이다', () => {
    expect(build('## 1. 가\n### 안내').tasks).toEqual([]);
  });
});

describe('buildOutline — 픽스처', () => {
  const result = buildOutline(readMarkdownOutline(readFileSync(FIXTURE, 'utf8')));

  it('과제 6건을 문서 순서대로 고른다', () => {
    expect(result.tasks.map((t) => t.taskNo)).toEqual(['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']);
  });

  it('번호 없는 `###` 절 제목이 과제로 잡히지 않는다 (T7 실측 리스크 그 자체)', () => {
    const headings = result.tasks.map((t) => t.headingRaw);
    expect(headings).not.toContain('작성 안내');
    expect(headings).not.toContain('운영 유의사항');
  });

  it('「워크로드 공유」 절의 `P0`·`P1`이 과제가 아니다', () => {
    expect(result.tasks.map((t) => t.headingRaw)).not.toContain('P0');
    expect(result.tasks.map((t) => t.headingRaw)).not.toContain('P1');
  });

  it('category가 대분류 셋으로 갈린다', () => {
    expect(result.tasks.map((t) => t.category)).toEqual([
      '콘텐츠 제작',
      '콘텐츠 제작',
      '채널 운영',
      '채널 운영',
      '지원 업무',
      '지원 업무',
    ]);
  });

  it('번호 없는 절이 직전 과제의 details로 흡수된다', () => {
    const t = result.tasks.find((x) => x.taskNo === '2-2');
    expect(t?.details).toEqual([
      '-20% 축소안까지 함께 검토',
      '지표 수집 스크립트 초안',
      '리포트 서식 확정',
      '운영 유의사항',
      '이 절도 번호 접두사가 없다.',
    ]);
  });

  it('수식 주입 페이로드가 details에 원문 그대로 남는다', () => {
    const t = result.tasks.find((x) => x.taskNo === '3-2');
    expect(t?.details).toContain("=cmd|'/c calc'!A1");
  });

  it('경고는 과제 앞 절 3건뿐이고 코드만 담는다', () => {
    expect(result.warnings).toEqual(['ORPHAN_SECTION', 'ORPHAN_SECTION', 'ORPHAN_SECTION']);
  });
});
