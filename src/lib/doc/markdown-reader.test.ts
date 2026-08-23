/**
 * 마크다운 리더의 계약을 고정한다. 이 리더는 **테스트 픽스처 전용**이지만(ADR-010),
 * 아웃라인 로직 전체가 이 출력으로 검증되므로 계약은 제품 경로와 같은 무게다.
 *
 * 케이스는 문자열 리터럴로 만든다 — 무엇을 검증하는지가 테스트 안에서 읽혀야 한다.
 * 픽스처를 읽는 것은 마지막 한 묶음뿐이다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readMarkdownOutline } from '@/lib/doc/markdown-reader';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));

describe('readMarkdownOutline — 제목', () => {
  it('`# 제목`은 level 1이고 lines가 비어 있다', () => {
    expect(readMarkdownOutline('# 제목')).toEqual([{ level: 1, text: '제목', lines: [] }]);
  });

  it('제목 텍스트를 원문 그대로 둔다 — 번호·난이도 표기를 자르지 않는다', () => {
    expect(readMarkdownOutline('### 1-2. 과제 (中上)')).toEqual([
      { level: 3, text: '1-2. 과제 (中上)', lines: [] },
    ]);
  });

  it('level 5·6까지 받는다', () => {
    const nodes = readMarkdownOutline('##### 다섯\n###### 여섯');
    expect(nodes.map((n) => n.level)).toEqual([5, 6]);
  });

  it('`#`이 일곱 개면 제목이 아니라 본문 줄이다', () => {
    expect(readMarkdownOutline('####### 일곱')).toEqual([
      { level: 0, text: '', lines: ['####### 일곱'] },
    ]);
  });

  it('`#제목`처럼 공백이 없으면 제목이 아니라 본문 줄이다', () => {
    expect(readMarkdownOutline('#제목')).toEqual([{ level: 0, text: '', lines: ['#제목'] }]);
  });

  it('제목 뒤 트레일링 공백은 trim한다', () => {
    expect(readMarkdownOutline('##   두 번째   ')).toEqual([
      { level: 2, text: '두 번째', lines: [] },
    ]);
  });
});

describe('readMarkdownOutline — 본문 줄', () => {
  it('불릿은 직전 노드의 lines에 기호를 떼고 담긴다', () => {
    expect(readMarkdownOutline('## 대분류\n- 항목')).toEqual([
      { level: 2, text: '대분류', lines: ['항목'] },
    ]);
  });

  it('`*`·`+`·`1.`·`1)`·`①`·`•`도 같은 규칙으로 기호만 뗀다', () => {
    const md = ['## 대분류', '* 별', '+ 더하기', '1. 숫자점', '2) 숫자괄호', '① 동그라미', '• 점'].join(
      '\n',
    );
    expect(readMarkdownOutline(md)[0].lines).toEqual([
      '별',
      '더하기',
      '숫자점',
      '숫자괄호',
      '동그라미',
      '점',
    ]);
  });

  it('불릿 기호는 줄 맨 앞에서 한 번만 뗀다 — 본문 안의 `-`는 살아 있다', () => {
    expect(readMarkdownOutline('## 대분류\n- 마감 2026-08-23 · -20% 축소안')[0].lines).toEqual([
      '마감 2026-08-23 · -20% 축소안',
    ]);
  });

  it('불릿 없는 줄이 `-`·`+`로 시작하면 기호를 떼지 않는다 — 부호가 값의 일부다', () => {
    expect(readMarkdownOutline('## 대분류\n-20% 축소안\n+15% 노출 개선\n@미정')[0].lines).toEqual([
      '-20% 축소안',
      '+15% 노출 개선',
      '@미정',
    ]);
  });

  it('숫자 뒤에 공백이 없으면 목록 번호가 아니다 — `1.5배`가 살아 있다', () => {
    expect(readMarkdownOutline('## 대분류\n1.5배 개선\n- 1. 진짜 목록')[0].lines).toEqual([
      '1.5배 개선',
      '1. 진짜 목록',
    ]);
  });

  it('들여쓴 불릿도 같은 lines에 평평하게 담긴다 — 깊이는 버린다', () => {
    expect(readMarkdownOutline('## 대분류\n- 상위\n  - 하위\n    * 더 하위')[0].lines).toEqual([
      '상위',
      '하위',
      '더 하위',
    ]);
  });

  it('일반 문단 줄도 그대로 lines에 담긴다', () => {
    expect(readMarkdownOutline('## 대분류\n문단이다.')[0].lines).toEqual(['문단이다.']);
  });

  it('빈 줄과 공백뿐인 줄은 lines에 넣지 않는다', () => {
    expect(readMarkdownOutline('## 대분류\n\n- 항목\n   \n- 항목2')[0].lines).toEqual([
      '항목',
      '항목2',
    ]);
  });

  it('기호만 있는 불릿(`-`)은 떼고 나면 빈 줄이라 담지 않는다', () => {
    expect(readMarkdownOutline('## 대분류\n-\n- 항목')[0].lines).toEqual(['항목']);
  });

  it('본문은 직전 제목에만 붙는다 — 다음 제목이 나오면 거기서 끊긴다', () => {
    const nodes = readMarkdownOutline('## 하나\n- a\n## 둘\n- b');
    expect(nodes).toEqual([
      { level: 2, text: '하나', lines: ['a'] },
      { level: 2, text: '둘', lines: ['b'] },
    ]);
  });

  it('CRLF 개행에서도 캐리지 리턴이 텍스트에 남지 않는다', () => {
    expect(readMarkdownOutline('## 대분류\r\n- 항목\r\n')).toEqual([
      { level: 2, text: '대분류', lines: ['항목'] },
    ]);
  });
});

describe('readMarkdownOutline — 제목 앞 본문과 빈 입력', () => {
  it('제목 앞에 나온 본문 줄을 버리지 않고 level 0 서두 노드에 담는다', () => {
    expect(readMarkdownOutline('머리말 한 줄\n# 제목')).toEqual([
      { level: 0, text: '', lines: ['머리말 한 줄'] },
      { level: 1, text: '제목', lines: [] },
    ]);
  });

  it('제목 앞에 담을 본문이 없으면 서두 노드를 만들지 않는다', () => {
    expect(readMarkdownOutline('\n\n# 제목')).toEqual([{ level: 1, text: '제목', lines: [] }]);
  });

  it('제목 앞의 줄이 기호뿐이면 서두 노드를 만들지 않는다', () => {
    expect(readMarkdownOutline('-\n# 제목')).toEqual([{ level: 1, text: '제목', lines: [] }]);
  });

  it('빈 문자열과 공백뿐인 입력은 빈 배열이다', () => {
    expect(readMarkdownOutline('')).toEqual([]);
    expect(readMarkdownOutline('   \n\n  ')).toEqual([]);
  });

  it('어떤 문자열을 넣어도 던지지 않고 배열을 돌려준다', () => {
    expect(() => readMarkdownOutline('```\n# 코드 펜스 안\n```')).not.toThrow();
    expect(Array.isArray(readMarkdownOutline('=cmd|\'/c calc\'!A1'))).toBe(true);
  });
});

describe('readMarkdownOutline — 픽스처 (sample-workload.md)', () => {
  const nodes = readMarkdownOutline(readFileSync(FIXTURE, 'utf8'));

  it('`N-M.` 접두사를 가진 과제 제목 6개가 level 3으로 잡힌다', () => {
    const tasks = nodes.filter((n) => n.level === 3 && /^\d+-\d+\./.test(n.text));
    expect(tasks.map((n) => n.text)).toEqual([
      '1-1. 숏폼 시리즈 기획 (上) (9/1까지)',
      '1-2. 썸네일 A/B 테스트 (中上)',
      '2-1. 커뮤니티 응대 체계 (中下) (9/15까지)',
      '2-2. 주간 리포트 자동화 (中) (추후 협의)',
      '3-1. 아카이브 정리',
      '3-2. 정산 서식 점검 (下)',
    ]);
  });

  it('번호 없는 절 제목도 같은 level 3으로 남는다 — 고르는 것은 위 계층의 일이다', () => {
    const bare = nodes.filter((n) => n.level === 3 && !/^\d/.test(n.text)).map((n) => n.text);
    expect(bare).toEqual(['작성 안내', '운영 유의사항', 'P0', 'P1']);
  });

  it('`## 워크로드 공유`가 level 2로 있다', () => {
    expect(nodes.some((n) => n.level === 2 && n.text === '워크로드 공유')).toBe(true);
  });

  it('과제의 세부항목이 기호 없이 순서대로 담긴다', () => {
    const first = nodes.find((n) => n.text.startsWith('1-1.'));
    expect(first?.lines).toEqual(['레퍼런스 20건 수집', '시리즈 컨셉 3안 도출', '파일럿 1편 촬영']);
  });

  it('수식으로 읽히는 값이 잘리지 않고 그대로 보존된다 (S1은 쓰기 쪽에서 막는다)', () => {
    const node = nodes.find((n) => n.text.startsWith('3-2.'));
    expect(node?.lines).toContain("=cmd|'/c calc'!A1");
  });

  it('파일 첫머리의 HTML 주석은 제목 앞 본문이라 서두 노드에 남는다', () => {
    expect(nodes[0].level).toBe(0);
    expect(nodes[0].lines[0]).toMatch(/^<!-- 익명화된 테스트 픽스처다/);
  });
});
