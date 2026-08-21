/**
 * 이 파일이 **완료 기준 12의 실질 검증면**이다. 시드에는 `javascript:` 셀이 없고 앞으로도
 * 넣을 이유가 없으므로(픽스처는 익명화된 정상 데이터다), 스킴 화이트리스트가 실제로 도는지는
 * 여기서만 확인된다. 케이스를 지우면 방어가 사라진 것을 아무도 모른다.
 */

import { describe, expect, it } from 'vitest';

import { safeHref, toExtraCells } from '@/lib/view/extras-render';
import type { ExtraValue } from '@/types/task';

describe('safeHref — http·https만 통과한다 (S7)', () => {
  it('http·https는 대소문자를 가리지 않고 통과한다', () => {
    expect(safeHref('https://x.com/a?b=1')).toBe('https://x.com/a?b=1');
    expect(safeHref('HTTP://x.com')).toBe('HTTP://x.com');
    expect(safeHref('  https://x.com  ')).toBe('https://x.com');
  });

  it('javascript·data·vbscript·file·mailto는 전부 막는다', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>x</script>')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
    expect(safeHref('mailto:a@b.c')).toBeNull();
  });

  it('선행 공백·제어문자로 스킴을 숨겨도 막는다', () => {
    expect(safeHref(' javascript:alert(1)')).toBeNull();
    expect(safeHref('\tjavascript:alert(1)')).toBeNull();
    // 브라우저는 URL 안의 탭·개행을 지우고 읽는다. 판정도 같은 모양을 봐야 한다
    expect(safeHref('java\tscript:alert(1)')).toBeNull();
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
  });

  /**
   * **`includes`로 찾으면 이 줄이 깨진다.** 정상 URL의 경로에 `javascript`가 들어 있을 뿐이다.
   */
  it('경로에 javascript가 들어 있는 정상 URL은 막지 않는다', () => {
    expect(safeHref('https://x.com/javascript-tips')).toBe('https://x.com/javascript-tips');
  });

  it('URL이 아니거나 상대 경로면 null이다 — 던지지 않는다', () => {
    expect(safeHref('')).toBeNull();
    expect(safeHref('   ')).toBeNull();
    expect(safeHref('/teams/edit')).toBeNull();
    expect(safeHref('그냥 텍스트')).toBeNull();
  });
});

describe('toExtraCells — 값 접기', () => {
  it('false와 0이 「값 없음」으로 뭉개지지 않는다', () => {
    const cells = toExtraCells({ 확정: false, 재촬영: 0 }, 'admin');

    expect(cells.find((cell) => cell.label === '확정')?.text).toBe('false');
    expect(cells.find((cell) => cell.label === '재촬영')?.text).toBe('0');
  });

  it('null과 빈 문자열은 —다', () => {
    const cells = toExtraCells({ 비고: null, 메모: '   ' }, 'admin');

    expect(cells.map((cell) => cell.text)).toEqual(['—', '—']);
    expect(cells.every((cell) => cell.masked === false)).toBe(true);
  });

  it('하이퍼링크 셀은 텍스트와 URL을 따로 든다', () => {
    const extras: Record<string, ExtraValue> = {
      기획안: { text: '기획안 문서', hyperlink: 'https://docs.example.com/a' },
      위험: { text: '눌러 보세요', hyperlink: 'javascript:alert(1)' },
      무제: { text: null, hyperlink: 'https://x.com' },
    };
    const cells = toExtraCells(extras, 'admin');
    const at = (label: string) => cells.find((cell) => cell.label === label);

    expect(at('기획안')).toMatchObject({
      text: '기획안 문서',
      href: 'https://docs.example.com/a',
    });
    // 값은 보이되 앵커가 되지 않는다 — 텍스트로만 남는다
    expect(at('위험')).toMatchObject({ text: '눌러 보세요', href: null });
    expect(at('무제')).toMatchObject({ text: 'https://x.com', href: 'https://x.com' });
  });

  it('빈 객체는 빈 배열이다', () => {
    expect(toExtraCells({}, 'member')).toEqual([]);
  });
});

describe('toExtraCells — 마스킹 표시 (S6 · 완료 기준 13)', () => {
  /** 응답 계층이 이미 값을 지웠다. 패널은 그 `null`이 무엇인지 **표시**만 한다 */
  const masked: Record<string, ExtraValue> = { '출연자 연락처': null, 채널: '인스타그램' };
  const kept: Record<string, ExtraValue> = { '출연자 연락처': '010-0000-0000', 채널: '인스타그램' };

  it('member에게 민감 키의 null은 (비공개)다', () => {
    const cells = toExtraCells(masked, 'member');
    const contact = cells.find((cell) => cell.label === '출연자 연락처');

    expect(contact?.text).toBe('(비공개)');
    expect(contact?.masked).toBe(true);
  });

  it('admin·lead에게는 같은 null이 —다 — 가려진 것이 없기 때문이다', () => {
    for (const role of ['admin', 'lead'] as const) {
      const contact = toExtraCells(masked, role).find((cell) => cell.label === '출연자 연락처');

      expect(contact?.text).toBe('—');
      expect(contact?.masked).toBe(false);
    }
  });

  it('민감 키가 아니면 member에게도 (비공개)가 아니다', () => {
    const cells = toExtraCells({ 비고: null }, 'member');

    expect(cells[0]?.text).toBe('—');
    expect(cells[0]?.masked).toBe(false);
  });

  it('값이 남아 있으면 마스킹이 아니다 — 패널이 다시 거르지 않는다', () => {
    const contact = toExtraCells(kept, 'admin').find((cell) => cell.label === '출연자 연락처');

    expect(contact?.text).toBe('010-0000-0000');
    expect(contact?.masked).toBe(false);
  });

  it('키는 절대 지우지 않는다 — 무엇이 가려졌는지 보여야 한다', () => {
    expect(toExtraCells(masked, 'member')).toHaveLength(Object.keys(masked).length);
  });
});

describe('toExtraCells — 정렬과 불변', () => {
  it('키 순서가 입력 순서와 무관하게 같다', () => {
    const a = toExtraCells({ 채널: '1', 가나: '2', ZZ: '3', ab: '4' }, 'admin');
    const b = toExtraCells({ ab: '4', ZZ: '3', 채널: '1', 가나: '2' }, 'admin');

    expect(a.map((cell) => cell.label)).toEqual(b.map((cell) => cell.label));
    // 코드포인트 순: ASCII 대문자 → 소문자 → 한글
    expect(a.map((cell) => cell.label)).toEqual(['ZZ', 'ab', '가나', '채널']);
  });

  it('입력 객체를 고치지 않는다', () => {
    const extras: Record<string, ExtraValue> = { '출연자 연락처': null, 채널: '인스타그램' };
    const before = JSON.stringify(extras);

    toExtraCells(extras, 'member');

    expect(JSON.stringify(extras)).toBe(before);
  });
});
