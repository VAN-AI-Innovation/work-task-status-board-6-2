/**
 * 재는 것은 둘이다 — **뼈대가 팀마다 무엇인가**와 **파서와 어긋나지 않는가.**
 *
 * 뒤엣것이 이 파일의 존재 이유다. 이 표와 `adapter-edit-team.ts`의 `STAGE_GROUPS`가 갈리면
 * 업로드로 만든 업무와 웹으로 만든 업무의 단계가 달라지고, 그 차이는 화면에서 「왜 이 업무만
 * 단계가 둘이지」로만 드러난다.
 */

import { describe, expect, it } from 'vitest';

import { EDIT_TEAM_STAGE_GROUPS } from '@/lib/sheet/adapter-edit-team';
import { stageTemplateFor, stageTemplateOf } from '@/lib/domain/team-stage-template';

describe('stageTemplateFor', () => {
  it('편집팀은 셋이고 순서가 곧 타임라인이다', () => {
    expect(stageTemplateFor('edit').map((stage) => stage.key)).toEqual([
      'concept',
      'production',
      'final',
    ]);
  });

  it('촬영·마케팅팀은 빈 배열이다 — 그 팀의 진행은 팀 전용 칸에 있다', () => {
    expect(stageTemplateFor('shoot')).toEqual([]);
    expect(stageTemplateFor('marketing')).toEqual([]);
  });

  it('SLA를 지어내지 않는다 — 시트 그룹 헤더의 `(+N일)`이 근거다', () => {
    expect(stageTemplateFor('edit').map((stage) => stage.slaDays)).toEqual([2, 5, 7]);
  });
});

describe('stageTemplateOf', () => {
  it('키로 한 줄을 찾는다', () => {
    expect(stageTemplateOf('edit', 'production')?.label).toBe('제작 진행');
  });

  it('모르는 키는 `null`이다 — 라우트가 400으로 옮긴다', () => {
    expect(stageTemplateOf('edit', 'unknown')).toBeNull();
    // 팀이 다르면 있는 키도 없는 키다
    expect(stageTemplateOf('shoot', 'concept')).toBeNull();
  });
});

/**
 * **파서가 이 표를 읽는다.** 두 벌이 되지 않게 방향을 한쪽으로 고정했고, 이 테스트가 그
 * 사실을 못박는다 — 파서가 다시 자기 상수를 갖게 되는 날 여기가 먼저 빨개진다.
 */
describe('파서와 한 벌이다', () => {
  it('편집팀 단계 그룹의 키·이름·SLA가 뼈대와 같다', () => {
    expect(
      EDIT_TEAM_STAGE_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        slaDays: group.slaDays,
      }))
    ).toEqual([...stageTemplateFor('edit')]);
  });

  it('그룹 헤더에는 SLA가 붙어 있다 — 시트 원문이라 뼈대의 이름과 다르다', () => {
    expect(EDIT_TEAM_STAGE_GROUPS[0]!.groupHeader).toBe('컨셉·레퍼런스 (+2일)');
    expect(stageTemplateFor('edit')[0]!.label).toBe('컨셉·레퍼런스');
  });
});
