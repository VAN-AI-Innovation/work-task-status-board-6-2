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

    fields.push({
      key,
      value: value === null ? '' : String(value),
      options: enumOptionsFor(groups, teamId, key),
    });
  }

  return fields;
}
