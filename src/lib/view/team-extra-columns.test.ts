/**
 * 재는 것은 하나다 — **그 팀 업무가 실제로 쓰는 칸이 무엇인가.**
 *
 * 생성 폼에는 채울 값이 아직 없으므로 「어떤 칸이 있는지」를 기존 업무에서 알아내야 한다.
 * 시트 헤더 목록을 따로 저장해 두지 않기 때문이다 (`extras`가 곧 그 팀의 컬럼이다).
 */

import { describe, expect, it } from 'vitest';

import { teamEnumGroups } from '@/lib/domain/team-enum-groups';
import { teamExtraColumns } from '@/lib/view/team-extra-columns';
import type { EnumOptionEntry } from '@/types/sheet';
import type { Task } from '@/types/task';

const GROUPS = teamEnumGroups([
  { groupKey: '촬영_섭외 상태', value: '섭외 전', sortOrder: 0 },
  { groupKey: '촬영_섭외 상태', value: '섭외 확정', sortOrder: 1 },
] satisfies EnumOptionEntry[]);

function task(teamId: Task['teamId'], extras: Task['extras']): Task {
  return { teamId, extras } as Task;
}

describe('teamExtraColumns', () => {
  it('그 팀 업무의 칸만 모은다 — 다른 팀 칸이 섞이면 다음 업로드가 지운다', () => {
    const columns = teamExtraColumns(
      [task('shoot', { '섭외 / 섭외 상태': '섭외 전' }), task('edit', { '콘텐츠 유형': '릴스' })],
      'shoot',
      GROUPS
    );

    expect(columns.map((column) => column.key)).toEqual(['섭외 / 섭외 상태']);
  });

  it('여러 업무의 칸을 합친다 — 한 건만 보면 비어 있던 칸이 빠진다', () => {
    const columns = teamExtraColumns(
      [task('shoot', { A: '1' }), task('shoot', { B: null, A: '2' })],
      'shoot',
      GROUPS
    );

    expect(columns.map((column) => column.key).sort()).toEqual(['A', 'B']);
  });

  /**
   * **값을 미리 채우지 않는다.** 남의 업무 값이 새 업무의 기본값이 되면, 사용자가 지우지
   * 않은 칸이 그대로 저장돼 「내가 안 적은 값」이 들어간다.
   */
  it('값은 늘 비어 있다 — 다른 업무의 값을 물려주지 않는다', () => {
    const columns = teamExtraColumns([task('shoot', { A: '남의 값' })], 'shoot', GROUPS);

    expect(columns[0]!.value).toBe('');
  });

  it('고를 값 목록과 입력칸 종류는 그대로 붙는다 — 수정 폼과 같은 함수가 정한다', () => {
    const columns = teamExtraColumns(
      [task('shoot', { '섭외 / 섭외 상태': '섭외 전', '섭외 / 섭외 기한': '2026-07-28' })],
      'shoot',
      GROUPS
    );

    const byKey = Object.fromEntries(columns.map((column) => [column.key, column]));
    expect(byKey['섭외 / 섭외 상태']!.options).toEqual(['섭외 전', '섭외 확정']);
    expect(byKey['섭외 / 섭외 기한']!.kind).toBe('date');
  });

  it('민감 키·링크 칸은 빠진다 — 수정 폼과 같은 규칙이다', () => {
    const columns = teamExtraColumns(
      [
        task('shoot', {
          '섭외 / 출연자 연락처 (내부용)': '010',
          링크: { text: '문서', hyperlink: 'https://example.com' },
          비고: '메모',
        }),
      ],
      'shoot',
      GROUPS
    );

    expect(columns.map((column) => column.key)).toEqual(['비고']);
  });

  it('그 팀에 업무가 없으면 빈 배열이다 — 칸 목록을 지어내지 않는다', () => {
    expect(teamExtraColumns([], 'marketing', GROUPS)).toEqual([]);
  });
});
