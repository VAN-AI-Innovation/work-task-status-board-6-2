/**
 * 그 팀이 **어떤 팀 전용 칸을 쓰는가.** 업무 생성 폼이 빈 칸을 세우는 데 쓴다.
 *
 * ## 왜 기존 업무에서 알아내나
 *
 * 시트의 컬럼 목록을 따로 저장해 두는 자리가 없다 — 파서가 팀 전용 컬럼을 `tasks.extras`에
 * 통째로 넣고 끝난다 (`row-mapper.ts`). 그래서 「촬영팀 업무에는 어떤 칸이 있나」의 유일한
 * 근거가 **그 팀 업무들의 `extras` 키**다.
 *
 * 앞서 생성 폼은 `설정` 탭에 값 목록이 있는 칸만 세웠다 — 촬영팀 55칸 중 6칸이다. 나머지
 * 49칸(제출일·링크·요약 …)은 만들 때 채울 자리가 아예 없었고, 그래서 웹에서 만든 촬영팀
 * 업무는 만들자마자 패널을 다시 열어 [수정하기]를 눌러야 했다.
 *
 * ## 값은 물려주지 않는다
 *
 * 키만 가져오고 값은 **늘 빈 문자열**이다. 남의 업무 값이 새 업무의 기본값이 되면, 사용자가
 * 지우지 않은 칸이 그대로 저장돼 「내가 적지 않은 값」이 들어간다.
 *
 * 다만 **`kind`는 값을 보고 정해진다** (`extras-edit.ts` — 날짜 칸에 `7월 말` 같은 값이
 * 들어 있으면 자유 입력으로 되돌린다). 그래서 키를 모을 때 값 하나를 표본으로 함께 들고
 * 가서 판정에만 쓰고, 폼에 넣기 전에 비운다.
 *
 * 무엇을 빼는지는 **다시 정하지 않는다** — 민감 키와 하이퍼링크 칸을 거르는 것은
 * `toExtraFields` 하나다 (`S6`).
 */

import { toExtraFields, type ExtraField } from '@/lib/view/extras-edit';
import type { TeamEnumGroup } from '@/lib/domain/team-enum-groups';
import type { ExtraValue, Task, TeamKey } from '@/types/task';

export function teamExtraColumns(
  tasks: readonly Task[],
  teamId: TeamKey,
  groups: readonly TeamEnumGroup[]
): ExtraField[] {
  /*
   * 여러 업무의 키를 **합친다.** 한 건만 보면 그 업무에서 비어 있던 칸이 목록에서 빠지고,
   * 그러면 새 업무를 만드는 사람에게 그 칸이 존재하지 않는 것으로 보인다.
   *
   * 표본 값은 **먼저 만난 빈칸 아닌 값**이다. 값이 하나도 없는 칸은 `null`로 남고,
   * 그때 `kind`는 이름만 보고 정해진다.
   */
  const sample: Record<string, ExtraValue> = {};
  for (const task of tasks) {
    if (task.teamId !== teamId) continue;
    for (const [key, value] of Object.entries(task.extras)) {
      if (sample[key] === undefined || (sample[key] === null && value !== null)) {
        sample[key] = value;
      }
    }
  }

  // 표본은 판정에만 쓴다 — 폼에 남기면 남의 업무 값이 기본값이 된다 (머리말)
  return toExtraFields(sample, teamId, groups).map((field) => ({ ...field, value: '' }));
}
