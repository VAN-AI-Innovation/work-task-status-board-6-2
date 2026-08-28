/**
 * 어드민이 받아 보는 **한 장짜리 전사 보고**를 만드는 규칙.
 *
 * 재는 것은 셋이다 — **제출 현황이 먼저 선다**(누가 안 냈는지가 이 문서의 첫 정보다),
 * **본문을 고치지 않는다**(팀장이 올린 문자열 그대로), **미제출 팀을 지우지 않는다**.
 */

import { describe, expect, it } from 'vitest';

import { toReportBlocks } from '@/lib/view/report-blocks';
import { mergeTeamReports, type TeamSubmission } from '@/lib/view/report-merge';

const PERIOD = { weekStart: '2026-08-24', weekEnd: '2026-08-30' };

const submission = (overrides: Partial<TeamSubmission> = {}): TeamSubmission => ({
  teamId: 'edit',
  body: '# 주간 업무 보고 — 2026-08-24 ~ 2026-08-30\n\n## 요약\n\n- 전체 활성 업무: 6건',
  note: '촬영 장비 대여가 하루 밀렸습니다.',
  status: 'submitted',
  reviewNote: null,
  submittedOn: '2026-08-28',
  ...overrides,
});

describe('mergeTeamReports — 뼈대', () => {
  it('문서 제목에 기간이 들어간다', () => {
    const blocks = toReportBlocks(mergeTeamReports(PERIOD, []));

    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[0]?.kind === 'heading' && blocks[0].text).toContain('2026-08-24');
  });

  it('제출 현황이 팀 본문보다 먼저 온다 — 누가 안 냈는지가 첫 정보다', () => {
    const merged = mergeTeamReports(PERIOD, [submission()]);

    expect(merged.indexOf('제출 현황')).toBeLessThan(merged.indexOf('# 편집팀'));
  });

  it('제출이 하나도 없어도 현황은 나온다 — 세 팀이 전부 미제출로 선다', () => {
    const merged = mergeTeamReports(PERIOD, []);

    expect(merged).toContain('편집팀');
    expect(merged).toContain('촬영·기획팀');
    expect(merged).toContain('마케팅·관리팀');
    expect(merged).toContain('미제출');
  });

  it('팀 순서는 제출 순서가 아니라 팀 표의 순서다', () => {
    const merged = mergeTeamReports(PERIOD, [
      submission({ teamId: 'marketing' }),
      submission({ teamId: 'edit' }),
    ]);

    expect(merged.indexOf('# 편집팀')).toBeLessThan(merged.indexOf('# 마케팅·관리팀'));
  });
});

describe('mergeTeamReports — 팀 한 덩어리', () => {
  it('팀 이름이 1단 제목이고 그 아래 섹션이 2단이다 — 블록 파서가 그대로 읽는다', () => {
    const blocks = toReportBlocks(mergeTeamReports(PERIOD, [submission()]));
    const teamHeading = blocks.find(
      (block) => block.kind === 'heading' && block.level === 1 && block.text === '편집팀'
    );

    expect(teamHeading).toBeDefined();
  });

  it('팀 본문의 제목 줄은 뺀다 — 안 빼면 1단 제목이 팀 안에서 또 뜬다', () => {
    const merged = mergeTeamReports(PERIOD, [submission()]);

    expect(merged).not.toContain('# 주간 업무 보고 — 2026-08-24');
    // 본문의 섹션은 그대로 남는다
    expect(merged).toContain('## 요약');
    expect(merged).toContain('- 전체 활성 업무: 6건');
  });

  it('특이사항이 계산된 본문보다 먼저다 — 어드민이 모르는 것이 그쪽이다', () => {
    const merged = mergeTeamReports(PERIOD, [submission()]);

    expect(merged.indexOf('촬영 장비 대여')).toBeLessThan(merged.indexOf('전체 활성 업무'));
  });

  it('특이사항이 비면 「없음」이라 적는다 — 빈 줄로 두면 안 적은 것과 못 읽은 것이 같아진다', () => {
    const merged = mergeTeamReports(PERIOD, [submission({ note: '   ' })]);

    expect(merged).toContain('없음');
  });

  it('반려된 팀은 본문을 싣지 않는다 — 돌려보낸 내용을 전사 보고에 넣지 않는다', () => {
    const merged = mergeTeamReports(PERIOD, [
      submission({ status: 'rejected', reviewNote: '숫자가 지난주 것입니다' }),
    ]);

    expect(merged).not.toContain('전체 활성 업무');
    expect(merged).toContain('숫자가 지난주 것입니다');
  });

  it('미제출 팀은 본문 자리에 그 사실만 남는다', () => {
    const merged = mergeTeamReports(PERIOD, [submission()]);

    expect(merged).toContain('# 촬영·기획팀');
    expect(merged.slice(merged.indexOf('# 촬영·기획팀'))).toContain('아직 제출되지 않았습니다');
  });
});

describe('mergeTeamReports — 지어내지 않는다', () => {
  it('본문을 한 글자도 고치지 않는다 (제목 줄만 뺀다)', () => {
    const body = '# 제목\n\n## 요약\n\n- a | b\n\n| 팀 | 값 |\n| --- | ---: |\n| 편집팀 | 3 |';
    const merged = mergeTeamReports(PERIOD, [submission({ body })]);

    expect(merged).toContain('| 편집팀 | 3 |');
    expect(merged).toContain('- a | b');
  });

  it('제출일이 없으면 없는 대로 둔다', () => {
    const merged = mergeTeamReports(PERIOD, [submission({ submittedOn: null })]);

    expect(merged).not.toContain('null');
  });

  it('결과가 다시 블록으로 읽힌다 — 화면이 이 문자열을 그대로 그린다', () => {
    const blocks = toReportBlocks(mergeTeamReports(PERIOD, [submission()]));

    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.every((block) => block.kind !== 'paragraph' || block.text !== '')).toBe(true);
  });
});
