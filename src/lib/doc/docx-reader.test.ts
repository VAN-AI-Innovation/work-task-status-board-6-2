/**
 * `.docx` 리더의 계약을 고정한다. 이 파일이 지키는 것은 mammoth가 아니라 **경계**다 —
 * 리더 둘(`docx-reader`·`markdown-reader`)이 같은 `OutlineNode[]`를 내지 않으면
 * 그 아래 세 계층이 입력 형식을 알게 된다 (T7 완료 기준 2).
 *
 * `.docx`는 바이너리라 픽스처로 최악이므로(ADR-010) 두 겹으로 검증한다.
 *  1. HTML → 아웃라인은 **순수 함수**(`outlineFromHtml`)라 바이너리 없이 문자열로 잰다
 *  2. 손으로 만든 최소 `.docx` 하나로 mammoth 경로까지 실제로 통과시킨다
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { outlineFromHtml, readDocxOutline } from '@/lib/doc/docx-reader';
import { readMarkdownOutline } from '@/lib/doc/markdown-reader';

const DOCX_FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.docx', import.meta.url));

describe('outlineFromHtml — 제목', () => {
  it('`h2`는 level 2이고 lines가 비어 있다', () => {
    expect(outlineFromHtml('<h2>1. 대분류</h2>')).toEqual([
      { level: 2, text: '1. 대분류', lines: [] },
    ]);
  });

  it('제목 텍스트를 원문 그대로 둔다 — 번호·난이도 표기를 자르지 않는다', () => {
    expect(outlineFromHtml('<h3>1-1. 과제 (中上)</h3>')).toEqual([
      { level: 3, text: '1-1. 과제 (中上)', lines: [] },
    ]);
  });

  it('`h1`~`h6`이 level 1~6으로 잡힌다', () => {
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>제목${n}</h${n}>`).join('');
    expect(outlineFromHtml(html).map((n) => n.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('제목 안의 인라인 태그는 텍스트만 남는다', () => {
    expect(outlineFromHtml('<h2><strong>1.</strong> 대분류</h2>')[0].text).toBe('1. 대분류');
  });
});

describe('outlineFromHtml — 본문 줄', () => {
  it('`p`는 직전 노드의 lines에 담긴다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><p>본문</p>')).toEqual([
      { level: 2, text: '대분류', lines: ['본문'] },
    ]);
  });

  it('`ul`의 각 `li`가 한 줄씩 담긴다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><ul><li>가</li><li>나</li></ul>')[0].lines).toEqual([
      '가',
      '나',
    ]);
  });

  it('`ol`도 `ul`과 같게 다룬다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><ol><li>가</li><li>나</li></ol>')[0].lines).toEqual([
      '가',
      '나',
    ]);
  });

  it('중첩 목록은 평평해지고, 바깥 항목 텍스트에 안쪽이 섞이지 않는다', () => {
    const html = '<h2>대분류</h2><ul><li>가<ul><li>나</li></ul></li></ul>';
    expect(outlineFromHtml(html)[0].lines).toEqual(['가', '나']);
  });

  it('`p` 안의 인라인 태그는 텍스트만 남는다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><p><strong>굵게</strong> 섞임</p>')[0].lines).toEqual([
      '굵게 섞임',
    ]);
  });

  it('엔티티를 디코드한다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><p>A &amp; B &lt;C&gt;</p>')[0].lines).toEqual([
      'A & B <C>',
    ]);
  });

  it('빈 `p`는 lines에 빈 문자열을 넣지 않는다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><p></p><p>  </p>')[0].lines).toEqual([]);
  });

  it('빈 `li`도 lines에 넣지 않는다', () => {
    expect(outlineFromHtml('<h2>대분류</h2><ul><li></li><li>가</li></ul>')[0].lines).toEqual(['가']);
  });

  it('앞뒤 공백을 trim한다', () => {
    expect(outlineFromHtml('<h2>  대분류  </h2><p>  본문  </p>')).toEqual([
      { level: 2, text: '대분류', lines: ['본문'] },
    ]);
  });

  it('제목 앞 본문은 버리지 않고 level 0 서두 노드가 받는다', () => {
    expect(outlineFromHtml('<p>서두</p><h1>제목</h1>')).toEqual([
      { level: 0, text: '', lines: ['서두'] },
      { level: 1, text: '제목', lines: [] },
    ]);
  });

  it('`table`은 무시하고 예외를 던지지 않는다', () => {
    const html = '<h2>대분류</h2><table><tr><td>셀</td></tr></table><p>본문</p>';
    expect(outlineFromHtml(html)).toEqual([{ level: 2, text: '대분류', lines: ['본문'] }]);
  });

  it('빈 문자열에도 던지지 않고 빈 배열을 준다', () => {
    expect(outlineFromHtml('')).toEqual([]);
  });
});

describe('outlineFromHtml — 마크다운 리더와 같은 출력 (T7 완료 기준 2)', () => {
  const md = [
    '서두 문장',
    '# [샘플] 26-2 워크로드',
    '## 1. 콘텐츠 제작',
    '### 작성 안내',
    '- 이 절은 번호 접두사가 없다.',
    '### 1-1. 숏폼 시리즈 기획 (上) (9/1까지)',
    '- 레퍼런스 20건 수집',
    '- 시리즈 컨셉 3안 도출',
    '본문 한 줄',
    '## 워크로드 공유',
    '### P0',
    '- 1-1',
  ].join('\n');

  const html = [
    '<p>서두 문장</p>',
    '<h1>[샘플] 26-2 워크로드</h1>',
    '<h2>1. 콘텐츠 제작</h2>',
    '<h3>작성 안내</h3>',
    '<ul><li>이 절은 번호 접두사가 없다.</li></ul>',
    '<h3>1-1. 숏폼 시리즈 기획 (上) (9/1까지)</h3>',
    '<ul><li>레퍼런스 20건 수집</li><li>시리즈 컨셉 3안 도출</li></ul>',
    '<p>본문 한 줄</p>',
    '<h2>워크로드 공유</h2>',
    '<h3>P0</h3>',
    '<ul><li>1-1</li></ul>',
  ].join('');

  it('같은 내용의 md와 html이 깊은 동등인 아웃라인을 만든다', () => {
    expect(outlineFromHtml(html)).toEqual(readMarkdownOutline(md));
  });

  it('그 아웃라인이 비어 있지 않다 — 양쪽이 빈 배열이어서 같은 것이 아니다', () => {
    const nodes = outlineFromHtml(html);
    expect(nodes.length).toBe(7);
    expect(nodes.flatMap((n) => n.lines).length).toBe(6);
  });
});

describe('readDocxOutline — mammoth 경로 (픽스처)', () => {
  const buffer = readFileSync(DOCX_FIXTURE);

  it('`.docx`에서 아웃라인이 나오고 `h1`~`h3`이 level 1~3으로 잡힌다', async () => {
    const nodes = await readDocxOutline(buffer);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.filter((n) => n.level === 1).map((n) => n.text)).toEqual([
      '[샘플] 26-2 워크로드',
    ]);
    expect(nodes.filter((n) => n.level === 2).map((n) => n.text)).toEqual([
      '1. 콘텐츠 제작',
      '워크로드 공유',
    ]);
    expect(nodes.filter((n) => n.level === 3).map((n) => n.text)).toEqual([
      '작성 안내',
      '1-1. 숏폼 시리즈 기획 (上) (9/1까지)',
      '1-2. 썸네일 A/B 테스트 (中上)',
      'P0',
      'P1',
    ]);
  });

  it('본문 문단이 직전 제목의 lines로 들어간다', async () => {
    const nodes = await readDocxOutline(buffer);
    const task = nodes.find((n) => n.text.startsWith('1-1.'));
    expect(task?.lines).toEqual(['레퍼런스 20건 수집', '시리즈 컨셉 3안 도출']);
  });

  it('같은 내용을 적은 마크다운과 깊은 동등이다 — 두 리더가 갈리지 않는다', async () => {
    const md = [
      '# [샘플] 26-2 워크로드',
      '## 1. 콘텐츠 제작',
      '### 작성 안내',
      '- 이 절은 번호 접두사가 없다. 과제로 잡히면 안 된다.',
      '### 1-1. 숏폼 시리즈 기획 (上) (9/1까지)',
      '- 레퍼런스 20건 수집',
      '- 시리즈 컨셉 3안 도출',
      '### 1-2. 썸네일 A/B 테스트 (中上)',
      '- +15% 노출 개선을 목표로 시안 4종 제작',
      '## 워크로드 공유',
      '### P0',
      '- 1-1',
      '### P1',
      '- 1-2',
    ].join('\n');
    expect(await readDocxOutline(buffer)).toEqual(readMarkdownOutline(md));
  });

  it('`Uint8Array`로 넘겨도 같은 결과를 낸다', async () => {
    const bytes = new Uint8Array(buffer);
    expect(await readDocxOutline(bytes)).toEqual(await readDocxOutline(buffer));
  });

  it('손상된 바이트에는 예외를 던진다 — 잡는 것은 파이프라인의 몫이다', async () => {
    await expect(readDocxOutline(Buffer.from('not a docx'))).rejects.toThrow();
  });
});
