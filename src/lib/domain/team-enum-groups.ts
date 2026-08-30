/**
 * `설정` 탭의 **팀 전용 enum 그룹**을 화면이 쓸 수 있는 모양으로 바꾼다.
 *
 * ## 왜 필요한가
 *
 * 공통 4종(진행 상태·승인·우선순위·리스크)은 타입 컬럼이라 `STATUS_OPTIONS` 같은 확정값이
 * 있지만, 팀 전용 컬럼(`콘텐츠 유형`·`섭외 상태` …)은 `extras`로 흘러가 **고를 값 목록이
 * 어디에도 없었다.** 그래서 수정 폼에서 그 칸들은 자유 입력이었고, 사람이 시트에 없는 값을
 * 적으면 다음 업로드가 미등록 경고를 냈다. 목록의 출처는 `설정` 탭 하나뿐이다.
 *
 * ## 붙이는 근거는 이름 하나다
 *
 * 시트에는 「이 그룹이 저 컬럼의 값이다」라고 적힌 자리가 없다. 대신 규칙이 하나 있다 —
 * 그룹 이름이 `팀_컬럼명`이고, 그 컬럼명이 팀 탭의 헤더와 같다 (`촬영_섭외 상태` ↔ 촬영 탭의
 * `섭외 상태`). 그래서 **이름이 같으면 붙이고, 아니면 붙이지 않는다.** 못 붙인 그룹은 버리는
 * 것이 아니라 그냥 쓰이지 않을 뿐이고, 그 칸은 자유 입력으로 남는다 — 시트가 진실의 원천인
 * 이상 화면이 짝을 지어내면 안 된다.
 *
 * 팀 접두사는 **시트 원문**이다 (`편집`·`촬영`·`마케팅`). 팀 라벨(`편집팀`)과 다르므로
 * `team-slug.ts`를 쓰지 않는다.
 */

import type { EnumOptionEntry } from '@/types/sheet';
import type { TeamKey } from '@/types/task';

/** 그룹 이름 앞머리 → 팀. 시트 `설정` 탭이 쓰는 낱말 그대로다 */
const TEAM_PREFIX: Readonly<Record<string, TeamKey>> = {
  편집: 'edit',
  촬영: 'shoot',
  마케팅: 'marketing',
};

export interface TeamEnumGroup {
  /** 시트 원문. 예: `촬영_섭외 상태` */
  groupKey: string;
  teamId: TeamKey;
  /** 접두사를 뗀 이름. 이것이 컬럼 라벨과 맞춰진다 */
  name: string;
  /** 시트 순서를 지킨 값 목록 */
  values: string[];
}

/** 결합 라벨(`A. 문의 관리 / 문의 유형`)의 **마지막 조각**. 헤더가 두 줄인 탭이 있다 */
function lastSegment(label: string): string {
  const parts = label.split('/');
  return (parts[parts.length - 1] ?? label).trim();
}

/**
 * 팀 접두사가 붙은 그룹만 골라 팀별로 갈라낸다. 공통 그룹(`공통_*`)과 구성원 목록
 * (`촬영·기획팀 구성원`)은 여기 들어오지 않는다 — 앞엣것은 타입 컬럼이 이미 갖고 있고,
 * 뒤엣것은 명부(`listMembers`)가 진다.
 */
export function teamEnumGroups(enums: readonly EnumOptionEntry[]): TeamEnumGroup[] {
  const byGroup = new Map<string, EnumOptionEntry[]>();

  for (const entry of enums) {
    const separator = entry.groupKey.indexOf('_');
    if (separator <= 0) continue;
    if (TEAM_PREFIX[entry.groupKey.slice(0, separator)] === undefined) continue;

    const bucket = byGroup.get(entry.groupKey);
    if (bucket === undefined) byGroup.set(entry.groupKey, [entry]);
    else bucket.push(entry);
  }

  return [...byGroup.entries()].map(([groupKey, entries]) => {
    const separator = groupKey.indexOf('_');

    return {
      groupKey,
      teamId: TEAM_PREFIX[groupKey.slice(0, separator)]!,
      name: groupKey.slice(separator + 1).trim(),
      // 시트 순서가 곧 뜻인 그룹이 있다 (진행 흐름). 값 문자열로 다시 정렬하지 않는다
      values: [...entries].sort((left, right) => left.sortOrder - right.sortOrder).map((entry) => entry.value),
    };
  });
}

/**
 * 그 팀의 그 칸에 고를 값 목록. 짝이 없으면 `null`이고, 그때 화면은 자유 입력으로 둔다.
 */
export function enumOptionsFor(
  groups: readonly TeamEnumGroup[],
  teamId: TeamKey,
  columnLabel: string
): string[] | null {
  const name = lastSegment(columnLabel);
  const found = groups.find((group) => group.teamId === teamId && group.name === name);

  return found === undefined ? null : found.values;
}
