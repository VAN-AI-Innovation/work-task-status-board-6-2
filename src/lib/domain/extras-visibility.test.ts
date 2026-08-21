import { describe, expect, it } from 'vitest';

import {
  SENSITIVE_EXTRA_KEYS,
  isSensitiveExtraKey,
  maskExtras,
  type ViewerRole,
} from '@/lib/domain/extras-visibility';
import type { ExtraValue } from '@/types/task';

const ROLES: ViewerRole[] = ['admin', 'lead', 'member'];

describe('isSensitiveExtraKey', () => {
  it.each(SENSITIVE_EXTRA_KEYS)('목록의 키 %s 자체를 잡는다', (key) => {
    expect(isSensitiveExtraKey(key)).toBe(true);
  });

  it.each([
    '출연자 연락처',
    '담당자 연락처(내부용)',
    '문의자 계정',
    '계정번호',
    '이메일 주소',
    '비상 전화',
    'Contact Email',
    'PHONE',
    ' email ',
  ])('접두어·접미어·대소문자가 붙은 %s도 부분 일치로 잡는다', (key) => {
    expect(isSensitiveExtraKey(key)).toBe(true);
  });

  it.each(['업무명', '진행률', '비고', 'title', 'due', ''])('일반 키 %s는 잡지 않는다', (key) => {
    expect(isSensitiveExtraKey(key)).toBe(false);
  });
});

describe('maskExtras', () => {
  const extras: Record<string, ExtraValue> = {
    촬영장소: '스튜디오 A',
    '출연자 연락처': '010-0000-0000',
    '문의자 계정': '@someone',
    '담당 이메일': 'a@b.c',
    참고링크: { text: '기획서', hyperlink: 'https://example.com' },
    회차: 3,
    확인: true,
    메모: null,
  };

  it.each<[ViewerRole]>([['admin'], ['lead']])('%s에게는 원본 값이 그대로 간다', (role) => {
    expect(maskExtras(extras, role)).toEqual(extras);
  });

  it('member에게는 민감 키의 값만 null이 되고 키는 남는다', () => {
    const masked = maskExtras(extras, 'member');

    expect(masked).toEqual({
      촬영장소: '스튜디오 A',
      '출연자 연락처': null,
      '문의자 계정': null,
      '담당 이메일': null,
      참고링크: { text: '기획서', hyperlink: 'https://example.com' },
      회차: 3,
      확인: true,
      메모: null,
    });
    // 키가 사라지면 무엇이 가려졌는지 알 수 없다
    expect(Object.keys(masked)).toEqual(Object.keys(extras));
  });

  it.each(ROLES)('%s: 입력 객체를 고치지 않고 새 객체를 돌려준다', (role) => {
    const input: Record<string, ExtraValue> = { '출연자 연락처': '010-0000-0000', 회차: 1 };
    const before = JSON.stringify(input);

    const masked = maskExtras(input, role);

    expect(JSON.stringify(input)).toBe(before);
    expect(masked).not.toBe(input);
  });

  it.each(ROLES)('%s: 빈 객체는 빈 객체로 나온다', (role) => {
    expect(maskExtras({}, role)).toEqual({});
  });

  it('민감 키의 값이 하이퍼링크 객체여도 null로 지운다 — URL에 계정이 들어 있다', () => {
    const masked = maskExtras(
      { '문의자 계정': { text: '@someone', hyperlink: 'https://x.com/someone' } },
      'member'
    );

    expect(masked).toEqual({ '문의자 계정': null });
  });

  it('member 응답을 직렬화해도 민감 값이 남지 않는다', () => {
    const serialized = JSON.stringify(maskExtras(extras, 'member'));

    expect(serialized).not.toContain('010-0000-0000');
    expect(serialized).not.toContain('@someone');
    expect(serialized).not.toContain('a@b.c');
  });
});
