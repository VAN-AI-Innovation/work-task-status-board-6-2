/**
 * 「워크로드 공유」 절의 계약을 고정한다. 이 절은 아웃라인과 **문법이 다르다** —
 * 우선순위가 `P0`·`P1` 블록으로 묶이고 항목이 `①②③④`로 나열된다. 여기서 나오는 것은
 * 과제가 아니라 `taskNo → 우선순위` 대응표뿐이고, **이 파서는 실패해도 된다.**
 *
 * 케이스는 문자열 리터럴로 만든다. 픽스처를 읽는 것은 마지막 한 묶음뿐이다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readMarkdownOutline } from '@/lib/doc/markdown-reader';
import { parseWorkloadPriorities } from '@/lib/doc/workload-parser';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));

/** 리터럴 케이스도 리더를 거쳐 만든다 — 두 계층이 실제로 맞물리는지 함께 본다 */
const parse = (markdown: string) => parseWorkloadPriorities(readMarkdownOutline(markdown));

/** 「워크로드 공유」 절 안의 본문을 만든다. 절 밖 케이스는 이 헬퍼를 쓰지 않는다 */
const inSection = (body: string) => parse(`## 워크로드 공유\n\n${body}`);

describe('parseWorkloadPriorities — 우선순위 토큰과 과제 번호', () => {
  it('한 줄에 토큰과 번호가 함께 있으면 그 줄의 번호도 담는다', () => {
    expect(inSection('P0: 1-1, 2-3')).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '2-3', priorityRaw: 'P0' },
    ]);
  });

  it('한 줄에 번호가 여럿이면 전부 담는다', () => {
    expect(inSection('P0: 1-1, 1-2, 1-3').map((e) => e.taskNo)).toEqual(['1-1', '1-2', '1-3']);
  });

  it('블록은 다음 P 토큰까지 이어진다', () => {
    const entries = inSection('P0 (최우선)\n\n- ① 1-1 시트 파서\n- ② 2-3 대시보드');

    expect(entries).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '2-3', priorityRaw: 'P0' },
    ]);
  });

  it('다음 블록이 시작되면 그 아래 번호는 새 우선순위를 받는다', () => {
    const entries = inSection('P0\n- ① 1-1\n\nP1\n- ② 2-3\n- ③ 3-4');

    expect(entries).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '2-3', priorityRaw: 'P1' },
      { taskNo: '3-4', priorityRaw: 'P1' },
    ]);
  });

  it('블록은 제목 줄로도 열린다 — 절 안의 제목과 본문을 같은 줄 목록으로 읽는다', () => {
    const entries = inSection('### P0\n\n- ① 1-1\n\n### P1\n\n- ② 1-2');

    expect(entries).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '1-2', priorityRaw: 'P1' },
    ]);
  });

  it('같은 번호가 두 블록에 있으면 먼저 나온 것이 이긴다', () => {
    expect(inSection('P0\n- ① 1-1\n\nP1\n- ② 1-1')).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
    ]);
  });

  it('우선순위가 정해지기 전에 나온 번호는 담지 않는다', () => {
    expect(inSection('- 대상: 1-1, 2-3\n\nP0\n- ① 3-4').map((e) => e.taskNo)).toEqual(['3-4']);
  });

  it('대소문자를 가리지 않고, 원문 표기와 무관하게 `P0` 형태로 담는다', () => {
    // 소문자를 그대로 담으면 매핑(step 4)에서 조용히 조인 실패가 된다.
    expect(inSection('p0: 1-1')).toEqual([{ taskNo: '1-1', priorityRaw: 'P0' }]);
  });

  it('P 뒤에 숫자가 아닌 것이 붙으면 토큰이 아니다', () => {
    expect(inSection('PM: 1-1')).toEqual([]);
    expect(inSection('P0X: 1-1')).toEqual([]);
  });

  it('존재하지 않는 번호도 그대로 담는다 — 조인 실패 판단은 이 파서의 일이 아니다', () => {
    expect(inSection('P0: 9-9')).toEqual([{ taskNo: '9-9', priorityRaw: 'P0' }]);
  });
});

describe('parseWorkloadPriorities — 절의 범위', () => {
  it('절이 아예 없으면 빈 배열이다', () => {
    expect(parse('## 1. 콘텐츠\n### 1-1. 과제\n- P0: 1-1')).toEqual([]);
  });

  it('절은 있는데 P 토큰이 없으면 빈 배열이다', () => {
    expect(inSection('- ① 1-1\n- ② 2-3')).toEqual([]);
  });

  it('절 밖의 P 토큰은 줍지 않는다 — 절 앞도 뒤도 마찬가지다', () => {
    const md = [
      '## 1. 콘텐츠',
      '- P3: 8-8',
      '## 워크로드 공유',
      '- P0: 1-1',
      '## 2. 채널',
      '- P1: 9-9',
    ].join('\n');

    expect(parse(md)).toEqual([{ taskNo: '1-1', priorityRaw: 'P0' }]);
  });

  it('절의 끝은 같거나 더 얕은 level의 다음 제목 직전이다', () => {
    const md = '## 워크로드 공유\n### P0\n- ① 1-1\n### P1\n- ② 1-2\n## 3. 지원\n- P2: 9-9';

    expect(parse(md).map((e) => e.taskNo)).toEqual(['1-1', '1-2']);
  });

  it('절이 두 번 나오면 둘 다 읽는다 — 한쪽만 읽으면 조용히 사라진다', () => {
    const md = '## 워크로드 공유\n- P0: 1-1\n## 1. 콘텐츠\n## 워크로드 공유\n- P1: 2-3';

    expect(parse(md)).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '2-3', priorityRaw: 'P1' },
    ]);
  });

  it('절 제목에 번호가 붙어 있어도 절로 본다', () => {
    expect(parse('## 5. 워크로드 공유\n- P0: 1-1')).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
    ]);
  });
});

describe('parseWorkloadPriorities — 실패해도 되는 파서다', () => {
  it('빈 입력에도 던지지 않는다', () => {
    expect(parseWorkloadPriorities([])).toEqual([]);
    expect(parse('')).toEqual([]);
  });

  it('절 제목만 있고 내용이 없어도 던지지 않는다', () => {
    expect(parse('## 워크로드 공유')).toEqual([]);
  });
});

describe('parseWorkloadPriorities — 픽스처', () => {
  const entries = parseWorkloadPriorities(readMarkdownOutline(readFileSync(FIXTURE, 'utf8')));

  it('픽스처의 P0·P1 블록에서 4건이 나온다', () => {
    expect(entries).toEqual([
      { taskNo: '1-1', priorityRaw: 'P0' },
      { taskNo: '2-1', priorityRaw: 'P0' },
      { taskNo: '1-2', priorityRaw: 'P1' },
      { taskNo: '9-9', priorityRaw: 'P1' },
    ]);
  });

  it('아웃라인 본문의 번호(`3-1`·`3-2`)를 줍지 않는다 — 절 안만 본다', () => {
    expect(entries.map((e) => e.taskNo)).not.toContain('3-1');
    expect(entries.map((e) => e.taskNo)).not.toContain('3-2');
  });
});
