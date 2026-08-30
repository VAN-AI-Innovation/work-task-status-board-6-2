/**
 * 팀의 **단계 뼈대.** 「이 팀의 업무에는 어떤 단계가 몇 번째로 서는가」 하나만 답한다.
 *
 * ## 왜 필요해졌나
 *
 * 단계 행은 여태 **시트 업로드만** 만들었다 (`adapter-edit-team.ts`가 wide 컬럼을 펴서
 * 넣는다). 그래서 웹에서 만든 편집팀 업무에는 단계가 한 줄도 없었고, 그 팀의 실제 진행이
 * 전부 단계에 들어 있으므로 **웹에서 만든 업무만 타임라인이 빈 채로** 남았다.
 *
 * 만들 때 뼈대를 세우려면 「편집팀 업무에는 컨셉·제작·최종본 셋이 있다」를 아는 자리가
 * 필요한데, 그 앎은 지금까지 **파서 안에만** 있었다.
 *
 * ## 파서와 한 벌이다
 *
 * `adapter-edit-team.ts`의 `EDIT_TEAM_STAGE_GROUPS`가 이 표를 **읽어서** 자기 것을 만든다 —
 * 거기에 더 붙는 것은 시트에만 있는 것들(그룹 헤더 원문, 하위 컬럼 이름)이다. 반대 방향으로
 * 두지 않은 이유는 이쪽이 더 좁기 때문이다: 업무를 만드는 경로가 시트 파서를 끌고 들어갈
 * 이유가 없다 (`ADR-003`의 결).
 *
 * 두 벌로 두면 시트에 단계가 하나 늘어난 날 파서만 고쳐지고, 그때부터 **업로드로 만든 업무와
 * 웹으로 만든 업무의 단계 수가 다르다.** `team-stage-template.test.ts`가 그 어긋남을 잰다.
 *
 * ## 값은 여기 없다
 *
 * 계획일·실제일·확인·내용은 사람이 채우는 값이라 뼈대에 담지 않는다. 이 표가 정하는 것은
 * `key`·`label`·순서·`slaDays` 넷뿐이고, 그 넷은 화면에서 고칠 수 없다 (`0018` 2절 —
 * 컬럼 GRANT가 같은 선을 긋는다).
 */

import type { TeamKey } from '@/types/task';

export interface StageTemplate {
  /** 안정 키. 시트 문자열이 바뀌어도 유지된다 (`stage-unpivot.ts`) */
  key: string;
  /** 화면에 보일 짧은 이름 */
  label: string;
  /** 시트 그룹 헤더의 `(+N일)`. 없으면 null */
  slaDays: number | null;
}

/**
 * 편집팀 셋. **배열 순서가 곧 `seq`다** — 타임라인이라 뒤섞이면 목록이 된다.
 *
 * ⚠ `label`은 **그룹 헤더 원문이 아니다.** 시트에서 오는 `stage_label`은 `컨셉·레퍼런스
 *   (+2일)`처럼 SLA가 붙은 문자열이고, 여기서 만드는 것은 그 괄호가 없는 짧은 이름이다.
 *   업로드로 온 행과 웹에서 만든 행이 화면에서 조금 다르게 보이는데, **그것이 사실이다** —
 *   `(+2일)`은 시트가 적어 둔 말이고 이 행은 시트에서 오지 않았다.
 */
const EDIT_TEAM_STAGES: readonly StageTemplate[] = [
  { key: 'concept', label: '컨셉·레퍼런스', slaDays: 2 },
  { key: 'production', label: '제작 진행', slaDays: 5 },
  { key: 'final', label: '최종본·업로드', slaDays: 7 },
];

const BY_TEAM: Readonly<Record<TeamKey, readonly StageTemplate[]>> = {
  edit: EDIT_TEAM_STAGES,
  /*
   * 촬영·마케팅팀에는 단계가 없다. **빈 배열이 사실이다** — 그 두 팀의 진행은 단계가 아니라
   * 팀 전용 칸에 들어 있고(`섭외 상태`·`촬영 실행 상태` …), 그래서 그쪽 화면에는 채울
   * 타임라인이 애초에 없다. 뼈대를 지어내면 아무도 쓰지 않는 빈 줄 셋이 패널에 선다.
   */
  shoot: [],
  marketing: [],
};

/** 그 팀 업무가 갖는 단계 뼈대. 없는 팀은 빈 배열이다 */
export function stageTemplateFor(teamId: TeamKey): readonly StageTemplate[] {
  return BY_TEAM[teamId];
}

/** 그 팀의 그 단계. 모르는 키면 `null`이다 — 라우트가 그것을 400으로 옮긴다 */
export function stageTemplateOf(teamId: TeamKey, key: string): StageTemplate | null {
  return stageTemplateFor(teamId).find((stage) => stage.key === key) ?? null;
}
