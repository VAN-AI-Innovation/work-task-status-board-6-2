/**
 * 재는 것은 **무엇을 고칠 수 있게 두는가**다. 여기서 한 칸이라도 잘못 열리면 폼이 저장할 때
 * 400을 받거나(민감 키) 시트 값을 망가뜨린다(하이퍼링크).
 */

import { describe, expect, it } from 'vitest';

import { teamEnumGroups } from '@/lib/domain/team-enum-groups';
import { toExtraFields } from '@/lib/view/extras-edit';
import type { EnumOptionEntry } from '@/types/sheet';

const GROUPS = teamEnumGroups([
  { groupKey: '편집_콘텐츠 유형', value: '카드뉴스', sortOrder: 0 },
  { groupKey: '편집_콘텐츠 유형', value: '릴스', sortOrder: 1 },
] satisfies EnumOptionEntry[]);

describe('toExtraFields', () => {
  it('설정 탭에 짝이 있는 칸은 고를 값 목록을 갖는다', () => {
    const fields = toExtraFields({ '콘텐츠 유형': '릴스' }, 'edit', GROUPS);

    expect(fields).toEqual([{ key: '콘텐츠 유형', value: '릴스', options: ['카드뉴스', '릴스'] }]);
  });

  it('짝이 없으면 자유 입력이다 — 목록을 지어내지 않는다', () => {
    expect(toExtraFields({ 비고: '메모' }, 'edit', GROUPS)).toEqual([
      { key: '비고', value: '메모', options: null },
    ]);
  });

  it('민감 키는 폼에 두지 않는다 — 스키마가 거부하므로 두면 저장이 통째로 실패한다', () => {
    const fields = toExtraFields(
      { '출연자 연락처 (내부용)': '010', '계정·문의자': '@x', 비고: '메모' },
      'edit',
      GROUPS
    );

    expect(fields.map((field) => field.key)).toEqual(['비고']);
  });

  it('하이퍼링크 칸도 두지 않는다 — 문자열로 저장하면 시트의 링크가 사라진다', () => {
    const fields = toExtraFields(
      { 참고: { text: '문서', hyperlink: 'https://example.com' }, 비고: '메모' },
      'edit',
      GROUPS
    );

    expect(fields.map((field) => field.key)).toEqual(['비고']);
  });

  it('숫자·불리언·빈 값은 문자열로 편다 — 입력칸이 다루는 것은 문자열뿐이다', () => {
    expect(toExtraFields({ 조회수: 12, 완료: true, 메모: null }, 'edit', GROUPS)).toEqual([
      { key: '조회수', value: '12', options: null },
      { key: '완료', value: 'true', options: null },
      { key: '메모', value: '', options: null },
    ]);
  });

  it('다른 팀의 그룹은 붙지 않는다', () => {
    expect(toExtraFields({ '콘텐츠 유형': '릴스' }, 'shoot', GROUPS)[0]?.options).toBeNull();
  });
});
