/**
 * `extras` 한 칸을 **고칠 수 있는 모양으로** 접는다. 읽기 전용 나열은 `extras-render.ts`가
 * 하고, 여기는 수정 폼이 쓴다.
 *
 * ## 무엇을 열지 않는가
 *
 * - **민감 키**(연락처·계정 …). 스키마가 문 앞에서 거부하므로(`task-patch-schema.ts`),
 *   폼에 두면 다른 칸까지 통째로 저장에 실패한다. 판정은 다시 쓰지 않고 도메인 것을 부른다.
 * - **하이퍼링크 칸.** 값이 `{text, hyperlink}`인 칸을 문자열 입력으로 바꾸면 저장하는 순간
 *   시트에서 온 링크가 사라진다. 그 칸은 읽기 전용 목록에 그대로 남는다.
 *
 * 두 경우 모두 **값을 지우지 않는다** — 폼이 그 키를 보내지 않으므로 저장에도 영향이 없다
 * (라우트가 기존 `extras`에 보낸 키만 얹는다).
 *
 * 고를 값 목록은 `설정` 탭에서 온다 (`team-enum-groups.ts`). 짝이 없으면 `null`이고 그 칸은
 * 자유 입력이다 — 목록을 지어내면 시트에 없는 값이 드롭다운에 선다.
 *
 * ## 날짜·시각 칸은 그 입력칸을 준다
 *
 * 팀 전용 칸의 절반 가까이가 날짜다 (`실제 완성 기획안 제출일`·`섭외 기한`·`편집 마감일` …).
 * 자유 입력으로 두면 사람이 `7/28`이라고 적고, 그 값은 시트의 `YYYY-MM-DD`와 다른 모양으로
 * 저장돼 정렬도 비교도 되지 않는다 — 공통 칸(`마감`·`배정일`)이 이미 `type="date"`인 것과
 * 같은 이유다.
 *
 * **판정은 라벨의 마지막 조각으로 한다.** 앞의 그룹 이름에 「일정」처럼 날짜로 읽히는 낱말이
 * 섞여 있어서다 (`촬영 일정·준비 / 촬영 장소`는 장소다).
 *
 * ⚠ **시트 값이 그 모양이 아니면 자유 입력으로 되돌린다.** `<input type="date">`는 못 읽는
 *   값을 빈칸으로 그리므로, 그대로 두면 시트에 있는 값이 화면에서 **사라진 것처럼** 보인다 —
 *   그 상태로 다른 칸을 저장하면 사용자는 이 칸이 지워졌다고 읽는다.
 */

import { isSensitiveExtraKey } from '@/lib/domain/extras-visibility';
import { enumOptionsFor, type TeamEnumGroup } from '@/lib/domain/team-enum-groups';
import type { ExtraValue, TeamKey } from '@/types/task';

export interface ExtraField {
  /** 시트 헤더 원문. 그대로 `PATCH`의 키가 된다 */
  key: string;
  /** 입력칸의 초기값. 빈 칸은 `''`다 */
  value: string;
  /** 드롭다운으로 고를 값. 짝이 없으면 `null`(자유 입력) */
  options: string[] | null;
  /** 자유 입력일 때 화면이 세울 입력칸. `options`가 있으면 언제나 `'text'`다 */
  kind: ExtraFieldKind;
}

export type ExtraFieldKind = 'text' | 'date' | 'time';

/** 시트의 날짜 칸 모양. `task-patch-schema.ts`의 `ISO_DATE`와 같은 규칙이다 (`E4`) */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `<input type="time">`이 읽고 쓰는 모양. 시트의 `접수 시간`이 그대로 이 꼴이다 */
const HH_MM = /^\d{2}:\d{2}$/;

/** 결합 라벨(`촬영 일정·준비 / 촬영 장소`)의 **마지막 조각**. 판정은 여기에만 건다 */
function lastSegment(label: string): string {
  const parts = label.split('/');
  return (parts[parts.length - 1] ?? label).trim();
}

/**
 * 이 칸에 세울 입력칸. **값이 이미 있으면 그 모양이 이긴다** (머리말 ⚠).
 */
function fieldKind(key: string, value: string): ExtraFieldKind {
  const name = lastSegment(key);

  if (name.endsWith('시간') || name.endsWith('시각')) {
    return value === '' || HH_MM.test(value) ? 'time' : 'text';
  }
  if (name.endsWith('일') || name.endsWith('기한')) {
    return value === '' || ISO_DATE.test(value) ? 'date' : 'text';
  }
  return 'text';
}

export function toExtraFields(
  extras: Record<string, ExtraValue>,
  teamId: TeamKey,
  groups: readonly TeamEnumGroup[]
): ExtraField[] {
  const fields: ExtraField[] = [];

  for (const [key, value] of Object.entries(extras)) {
    if (isSensitiveExtraKey(key)) continue;
    if (typeof value === 'object' && value !== null) continue;

    const text = value === null ? '' : String(value);
    const options = enumOptionsFor(groups, teamId, key);

    fields.push({
      key,
      value: text,
      options,
      // 드롭다운이 이긴다 — 고를 값이 정해진 칸은 이름이 무엇이든 목록에서 고르는 칸이다
      kind: options === null ? fieldKind(key, text) : 'text',
    });
  }

  return fields;
}
