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

    expect(fields).toEqual([
      { key: '콘텐츠 유형', value: '릴스', options: ['카드뉴스', '릴스'], kind: 'text' },
    ]);
  });

  it('짝이 없으면 자유 입력이다 — 목록을 지어내지 않는다', () => {
    expect(toExtraFields({ 비고: '메모' }, 'edit', GROUPS)).toEqual([
      { key: '비고', value: '메모', options: null, kind: 'text' },
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
      { key: '조회수', value: '12', options: null, kind: 'text' },
      { key: '완료', value: 'true', options: null, kind: 'text' },
      { key: '메모', value: '', options: null, kind: 'text' },
    ]);
  });

  it('다른 팀의 그룹은 붙지 않는다', () => {
    expect(toExtraFields({ '콘텐츠 유형': '릴스' }, 'shoot', GROUPS)[0]?.options).toBeNull();
  });
});

/**
 * **입력칸의 종류.** 날짜 칸에 자유 입력을 주면 사람이 `7/28`이라고 적고, 그 값은 시트의
 * `YYYY-MM-DD`와 다른 모양으로 저장돼 정렬도 비교도 되지 않는다.
 *
 * 판정 근거는 **라벨의 마지막 조각**이다 (`촬영 일정·준비 / 촬영 예정일` → `촬영 예정일`) —
 * 앞의 그룹 이름에도 「일정」처럼 날짜로 읽히는 낱말이 섞여 있어서다.
 */
describe('toExtraFields — 입력칸의 종류', () => {
  const kindOf = (key: string, value = ''): string =>
    toExtraFields({ [key]: value }, 'edit', GROUPS)[0]!.kind;

  it('`…일`·`…기한`으로 끝나면 날짜 칸이다', () => {
    expect(kindOf('실제 답변일')).toBe('date');
    expect(kindOf('기획안 완성본 / 완성 기획안 제출 예정일')).toBe('date');
    expect(kindOf('섭외 / 섭외 기한')).toBe('date');
    expect(kindOf('편집 이관 또는 자체 편집 / 편집 마감일')).toBe('date');
  });

  it('`…시간`·`…시각`으로 끝나면 시각 칸이다', () => {
    expect(kindOf('접수 시간')).toBe('time');
    expect(kindOf('촬영 일정·준비 / 촬영 시간')).toBe('time');
  });

  it('그룹 이름에 든 낱말에는 걸리지 않는다 — 마지막 조각만 본다', () => {
    // 「촬영 일정·준비」가 앞에 있지만 이 칸은 장소다
    expect(kindOf('촬영 일정·준비 / 촬영 장소')).toBe('text');
    expect(kindOf('촬영 일정·준비 / 촬영 장비 준비 상태')).toBe('text');
    expect(kindOf('관리 / D-DAY')).toBe('text');
  });

  it('고를 값 목록이 있으면 드롭다운이 이긴다 — 이름이 무엇이든', () => {
    const groups = teamEnumGroups([{ groupKey: '편집_확정일', value: '미정', sortOrder: 0 }]);
    expect(toExtraFields({ 확정일: '미정' }, 'edit', groups)[0]!.kind).toBe('text');
  });

  /**
   * **모양이 다른 값이 이미 있으면 자유 입력으로 둔다.** `<input type="date">`는 못 읽는
   * 값을 빈칸으로 그리므로, 그대로 두면 시트에 있는 값이 화면에서 **사라진 것처럼** 보인다.
   */
  it('시트 값이 그 모양이 아니면 자유 입력으로 남는다', () => {
    expect(kindOf('실제 답변일', '7월 말')).toBe('text');
    expect(kindOf('접수 시간', '오후 2시')).toBe('text');
    // 모양이 맞으면 그대로 날짜·시각 칸이다
    expect(kindOf('실제 답변일', '2026-07-22')).toBe('date');
    expect(kindOf('접수 시간', '14:20')).toBe('time');
  });
});
