/**
 * 재는 것은 둘이다 — **팀 전용 그룹을 팀별로 갈라내는가**, 그리고 **그 그룹이 업무의 어느
 * 칸에 붙는가**. 붙이는 근거는 이름 하나뿐이라(`팀_이름` → 컬럼 라벨) 그 규칙이 흔들리면
 * 화면의 드롭다운이 조용히 사라지거나 엉뚱한 칸에 뜬다.
 */

import { describe, expect, it } from 'vitest';

import { enumOptionsFor, teamEnumGroups } from '@/lib/domain/team-enum-groups';
import type { EnumOptionEntry } from '@/types/sheet';

const ENUMS: EnumOptionEntry[] = [
  { groupKey: '공통_진행 상태', value: '진행 중', sortOrder: 0 },
  { groupKey: '편집_콘텐츠 유형', value: '카드뉴스', sortOrder: 0 },
  { groupKey: '편집_콘텐츠 유형', value: '릴스', sortOrder: 1 },
  { groupKey: '촬영_섭외 상태', value: '미착수', sortOrder: 0 },
  { groupKey: '촬영·기획팀 구성원', value: '담당자1', sortOrder: 0 },
];

describe('teamEnumGroups', () => {
  it('팀 접두사가 붙은 그룹만 팀별로 갈라낸다', () => {
    const groups = teamEnumGroups(ENUMS);

    expect(groups.map((group) => group.groupKey)).toEqual([
      '편집_콘텐츠 유형',
      '촬영_섭외 상태',
    ]);
    expect(groups[0]).toEqual({
      groupKey: '편집_콘텐츠 유형',
      teamId: 'edit',
      name: '콘텐츠 유형',
      values: ['카드뉴스', '릴스'],
    });
  });

  it('공통 그룹과 구성원 목록은 팀 그룹이 아니다 — 상태 드롭다운은 `STATUS_OPTIONS`가 진다', () => {
    const keys = teamEnumGroups(ENUMS).map((group) => group.groupKey);

    expect(keys).not.toContain('공통_진행 상태');
    expect(keys).not.toContain('촬영·기획팀 구성원');
  });

  it('값은 시트 순서(`sortOrder`)를 지킨다 — 순서가 곧 진행 흐름인 그룹이 있다', () => {
    const shuffled: EnumOptionEntry[] = [
      { groupKey: '편집_콘텐츠 유형', value: '릴스', sortOrder: 1 },
      { groupKey: '편집_콘텐츠 유형', value: '카드뉴스', sortOrder: 0 },
    ];

    expect(teamEnumGroups(shuffled)[0]?.values).toEqual(['카드뉴스', '릴스']);
  });
});

describe('enumOptionsFor', () => {
  const groups = teamEnumGroups(ENUMS);

  it('컬럼 라벨이 그룹 이름과 같으면 그 팀의 값 목록을 준다', () => {
    expect(enumOptionsFor(groups, 'edit', '콘텐츠 유형')).toEqual(['카드뉴스', '릴스']);
  });

  it('결합 라벨은 **마지막 조각**으로 잰다 — 헤더가 두 줄인 탭이 있다', () => {
    expect(enumOptionsFor(groups, 'edit', 'B. 제작 / 콘텐츠 유형')).toEqual([
      '카드뉴스',
      '릴스',
    ]);
  });

  it('다른 팀의 그룹은 붙지 않는다 — 같은 이름이 팀마다 다른 값을 가질 수 있다', () => {
    expect(enumOptionsFor(groups, 'shoot', '콘텐츠 유형')).toBeNull();
  });

  it('짝이 없는 칸은 `null`이다 — 그 칸은 자유 입력으로 남는다', () => {
    expect(enumOptionsFor(groups, 'edit', '비고')).toBeNull();
  });
});
