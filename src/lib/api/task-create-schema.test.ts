/**
 * `POST /api/tasks`의 문 앞 검증. 패치 스키마와 **필드 정의를 공유**하고
 * (`TASK_EDITABLE_FIELDS`), 다른 것은 두 가지다.
 *
 * 1. **팀과 업무명이 필수다.** 둘 없이 만들어진 업무는 표에서 어느 줄인지 알 수 없다.
 * 2. **감사 칸을 받지 않는다.** `sourceKey`·`sourceSheetTab`·`raw`는 저장소가 채운다 —
 *    요청이 그것을 고를 수 있으면 웹에서 만든 업무가 시트 행인 척할 수 있다. `extras`(팀
 *    전용 칸)는 감사 칸이 아니라서 열려 있다.
 */

import { describe, expect, it } from 'vitest';

import { taskCreateSchema } from '@/lib/api/task-create-schema';

function parse(input: unknown): ReturnType<typeof taskCreateSchema.safeParse> {
  return taskCreateSchema.safeParse(input);
}

const MEMBER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** 최소 본문 — 이 둘이 없으면 통과하지 못한다 */
const MINIMAL = { teamId: 'edit', title: '새 업무' };

describe('taskCreateSchema — 통과하는 모양', () => {
  it('팀과 업무명만으로 만든다', () => {
    expect(parse(MINIMAL)).toMatchObject({
      success: true,
      data: { teamId: 'edit', title: '새 업무' },
    });
  });

  it('안 준 칸은 키가 없다 — 저장소가 기본값을 정한다', () => {
    const result = parse(MINIMAL);

    expect(result.success && 'dueAt' in result.data).toBe(false);
    expect(result.success && 'note' in result.data).toBe(false);
  });

  it('업무 내용 칸을 함께 받는다', () => {
    expect(
      parse({
        ...MINIMAL,
        status: '진행 중',
        progress: 30,
        priority: '높음',
        dueAt: '2026-09-01',
        nextAction: '레퍼런스 수집',
        note: '비고',
        ownerMemberId: MEMBER_ID,
        coOwnerMemberIds: [MEMBER_ID],
      })
    ).toMatchObject({
      success: true,
      data: { status: '진행 중', progress: 30, dueAt: '2026-09-01' },
    });
  });

  it('업무명의 앞뒤 공백은 떼고 담는다', () => {
    expect(parse({ ...MINIMAL, title: '  새 업무  ' })).toMatchObject({
      success: true,
      data: { title: '새 업무' },
    });
  });

  it('빈 문자열은 null로 접는다 — 폼의 안 채운 칸이 그대로 온다', () => {
    const result = parse({ ...MINIMAL, note: '', dueAt: '', priority: '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.note).toBeNull();
    expect(result.success && result.data.dueAt).toBeNull();
  });
});

describe('taskCreateSchema — 거부하는 모양', () => {
  it('팀이 없으면 거부한다', () => {
    expect(parse({ title: '새 업무' }).success).toBe(false);
  });

  it('모르는 팀은 거부한다 — 「어느 팀에 만들 수 있나」는 라우트가 또 본다', () => {
    expect(parse({ teamId: 'design', title: '새 업무' }).success).toBe(false);
  });

  it('업무명이 없거나 비면 거부한다', () => {
    expect(parse({ teamId: 'edit' }).success).toBe(false);
    expect(parse({ teamId: 'edit', title: '' }).success).toBe(false);
    expect(parse({ teamId: 'edit', title: '   ' }).success).toBe(false);
    expect(parse({ teamId: 'edit', title: null }).success).toBe(false);
  });

  it('감사 칸은 받지 않는다 (`.strict()`) — 시트 행인 척할 수 없다', () => {
    expect(parse({ ...MINIMAL, sourceKey: 'manual::x' }).success).toBe(false);
    expect(parse({ ...MINIMAL, sourceSheetTab: '01_편집팀' }).success).toBe(false);
    expect(parse({ ...MINIMAL, sourceRowIndex: 3 }).success).toBe(false);
    expect(parse({ ...MINIMAL, raw: {} }).success).toBe(false);
    expect(parse({ ...MINIMAL, id: MEMBER_ID }).success).toBe(false);
  });

  it('담당자 이름은 받지 않는다 — 이름은 id에서 유도한다', () => {
    expect(parse({ ...MINIMAL, ownerNameRaw: '남' }).success).toBe(false);
    expect(parse({ ...MINIMAL, coOwnerNames: ['남'] }).success).toBe(false);
  });

  it('날짜는 YYYY-MM-DD여야 한다', () => {
    expect(parse({ ...MINIMAL, dueAt: '2026/09/01' }).success).toBe(false);
  });

  it('진행률은 0~100 정수다', () => {
    expect(parse({ ...MINIMAL, progress: 101 }).success).toBe(false);
    expect(parse({ ...MINIMAL, progress: 0 }).success).toBe(true);
  });

  it('객체가 아닌 본문은 거부한다', () => {
    expect(parse(null).success).toBe(false);
    expect(parse([MINIMAL]).success).toBe(false);
  });
});

/**
 * 팀 전용 칸 (`extras`). 감사 칸이 아니라 **그 팀이 쓰는 칸**이라 만들 때도 열려 있다 —
 * 다만 민감 키는 패치와 **같은 정의**로 막힌다 (`EXTRAS_FIELD`).
 */
describe('taskCreateSchema — 팀 전용 칸', () => {
  it('받는다 — 만들 때 못 넣으면 절반만 담긴 업무가 만들어진다', () => {
    const parsed = parse({ ...MINIMAL, extras: { '콘텐츠 유형': '릴스' } });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.extras).toEqual({ '콘텐츠 유형': '릴스' });
  });

  it('연락처·계정이 든 칸은 여기서도 거부한다', () => {
    expect(parse({ ...MINIMAL, extras: { '출연자 연락처 (내부용)': '010' } }).success).toBe(false);
  });
});
