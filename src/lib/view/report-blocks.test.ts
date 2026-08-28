/**
 * 재는 것은 하나다 — **`buildWeeklyReport`가 낸 마크다운을 한 글자도 잃지 않고 블록으로
 * 옮기는가.**
 *
 * 그래서 손으로 지은 문자열이 아니라 **실제 보고서**를 넣어 본다. 이 파서는 우리가 만든
 * 마크다운만 상대하므로(범용 파서가 아니다), 생산자가 모양을 바꾸면 여기서 깨져야 한다.
 */

import { describe, expect, it } from 'vitest';

import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { toReportBlocks } from '@/lib/view/report-blocks';

const ctx = { today: '2026-08-22', semanticIndex: buildSemanticIndex(null) };

/** 업무가 0건이어도 제목·섹션 여섯은 그대로 나온다 */
const MARKDOWN = buildWeeklyReport({
  tasks: [],
  stages: [],
  goals: [],
  period: resolveReportPeriod(ctx.today, null),
  events: null,
  ctx,
});

describe('toReportBlocks — 실제 보고서', () => {
  it('첫 블록이 제목이다', () => {
    expect(toReportBlocks(MARKDOWN)[0]).toMatchObject({ kind: 'heading', level: 1 });
  });

  it('섹션 제목 여섯을 모두 찾는다', () => {
    const headings = toReportBlocks(MARKDOWN)
      .filter((block) => block.kind === 'heading' && block.level === 2)
      .map((block) => (block.kind === 'heading' ? block.text : ''));

    expect(headings).toEqual([
      '요약',
      '팀별 현황',
      '지연 업무 (0건)',
      '이번 주 마감 (0건)',
      '목표 대비 성과',
      '확인 필요',
    ]);
  });

  it('팀별 현황을 표로 읽는다 — 머리글 여덟 칸과 팀 세 줄', () => {
    const table = toReportBlocks(MARKDOWN).find((block) => block.kind === 'table');

    expect(table?.kind === 'table' && table.header).toEqual([
      '팀',
      '전체',
      '진행',
      '승인 대기',
      '지연',
      '완료',
      '완료율',
      '가장 가까운 마감',
    ]);
    expect(table?.kind === 'table' && table.rows).toHaveLength(3);
  });

  it('구분선의 `---:`를 오른쪽 정렬로 옮긴다 — 숫자 칸이 왼쪽으로 붙으면 못 읽는다', () => {
    const table = toReportBlocks(MARKDOWN).find((block) => block.kind === 'table');

    expect(table?.kind === 'table' && table.align).toEqual([
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'left',
    ]);
  });

  it('구분선 자체는 행이 되지 않는다', () => {
    const table = toReportBlocks(MARKDOWN).find((block) => block.kind === 'table');

    expect(table?.kind === 'table' && table.rows.some((row) => row[0] === '---')).toBe(false);
  });

  it('`-` 목록은 한 블록으로 묶인다', () => {
    const list = toReportBlocks(MARKDOWN).find((block) => block.kind === 'list');

    // 요약 섹션의 두 줄이다. 글머리 기호는 떼고 담는다
    expect(list?.kind === 'list' && list.items).toHaveLength(2);
    expect(list?.kind === 'list' && list.items[0]?.startsWith('-')).toBe(false);
  });

  it('「해당 없음」 같은 맨 줄은 문단이다 — 버리지 않는다', () => {
    const blocks = toReportBlocks(MARKDOWN);
    const texts = blocks.flatMap((block) => (block.kind === 'paragraph' ? [block.text] : []));

    expect(texts).toContain('해당 없음');
  });

  it('빈 줄은 블록이 되지 않는다', () => {
    for (const block of toReportBlocks(MARKDOWN)) {
      if (block.kind === 'paragraph') expect(block.text).not.toBe('');
    }
  });
});

describe('toReportBlocks — 낱개 규칙', () => {
  it('셀 안의 이스케이프된 파이프를 되돌린다 — `cell()`이 `\\|`로 넣는다', () => {
    const blocks = toReportBlocks('| 이름 | 값 |\n| --- | --- |\n| a\\|b | 1 |');
    const table = blocks[0];

    expect(table?.kind === 'table' && table.rows[0]).toEqual(['a|b', '1']);
  });

  it('연속한 목록 줄만 한 블록이다 — 사이에 다른 줄이 오면 갈린다', () => {
    const blocks = toReportBlocks('- 하나\n- 둘\n문단\n- 셋');

    expect(blocks.map((block) => block.kind)).toEqual(['list', 'paragraph', 'list']);
  });

  it('빈 문자열은 블록이 하나도 없다', () => {
    expect(toReportBlocks('')).toEqual([]);
  });

  it('표 머리글만 있고 구분선이 없으면 표로 보지 않는다 — 우리 생산자는 늘 같이 낸다', () => {
    const blocks = toReportBlocks('| 이름 | 값 |');

    expect(blocks[0]?.kind).toBe('paragraph');
  });
});
