/**
 * 이 스키마가 지는 계약은 셋이다.
 *
 * 1. **허용 필드는 셋뿐이다** (`PLAN.md`「T8 착수 시 확정」 결정 F에 담당자 한 칸을 더했다).
 *    시트가 진실의 원천이라 재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 자기
 *    수정이 사라지는 것을 본다.
 * 2. **모르는 키는 던진다.** 조용히 버리면 `{"titel": "..."}` 오타가 200으로 돌아와
 *    「저장됐다」로 보인다.
 * 3. **`null`(값을 지운다)과 키 없음(안 건드린다)이 다르다.** 둘을 뭉개면 빈 셀과 0의
 *    구분이 무너진다 (`types/task.ts`).
 */

import { describe, expect, it } from 'vitest';

import { taskPatchSchema } from '@/lib/api/task-patch-schema';

function parse(input: unknown): ReturnType<typeof taskPatchSchema.safeParse> {
  return taskPatchSchema.safeParse(input);
}

/** `members.id` 한 개. uuid 모양이면 되고 실재 여부는 라우트가 본다 */
const MEMBER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('taskPatchSchema — 통과하는 모양', () => {
  it('상태만', () => {
    expect(parse({ status: '진행 중' })).toMatchObject({
      success: true,
      data: { status: '진행 중' },
    });
  });

  it('진행률만', () => {
    expect(parse({ progress: 0 })).toMatchObject({ success: true, data: { progress: 0 } });
    expect(parse({ progress: 100 })).toMatchObject({ success: true, data: { progress: 100 } });
  });

  it('둘 다', () => {
    expect(parse({ status: '완료', progress: 100 })).toMatchObject({
      success: true,
      data: { status: '완료', progress: 100 },
    });
  });

  it('progress: null은 「값을 지운다」이므로 통과한다 — 키 없음과 다르다', () => {
    const result = parse({ progress: null });

    expect(result.success).toBe(true);
    expect(result.success && 'progress' in result.data).toBe(true);
    expect(result.success && result.data.progress).toBeNull();
  });

  it('상태의 앞뒤 공백은 떼고 담는다', () => {
    expect(parse({ status: '  검토 요청  ' })).toMatchObject({
      success: true,
      data: { status: '검토 요청' },
    });
  });

  it('상태를 enum으로 좁히지 않는다 — 시트 값은 설정 탭에서 오고 늘어난다 (`ADR-009`)', () => {
    expect(parse({ status: '아직 등록되지 않은 단계' }).success).toBe(true);
  });

  it('담당자 id만', () => {
    expect(parse({ ownerMemberId: MEMBER_ID })).toMatchObject({
      success: true,
      data: { ownerMemberId: MEMBER_ID },
    });
  });

  it('공동 담당 id 목록', () => {
    expect(parse({ coOwnerMemberIds: [MEMBER_ID] })).toMatchObject({
      success: true,
      data: { coOwnerMemberIds: [MEMBER_ID] },
    });
  });

  it('빈 배열은 「공동 담당을 비운다」이므로 통과한다 — 키 없음과 다르다', () => {
    const result = parse({ coOwnerMemberIds: [] });

    expect(result.success).toBe(true);
    expect(result.success && 'coOwnerMemberIds' in result.data).toBe(true);
  });

  it('주 담당과 공동 담당을 함께 보낸다 — 화면이 한 번에 저장한다', () => {
    expect(parse({ ownerMemberId: MEMBER_ID, coOwnerMemberIds: [] }).success).toBe(true);
  });

  it('ownerMemberId: null은 「담당자를 비운다」이므로 통과한다', () => {
    const result = parse({ ownerMemberId: null });

    expect(result.success).toBe(true);
    expect(result.success && 'ownerMemberId' in result.data).toBe(true);
    expect(result.success && result.data.ownerMemberId).toBeNull();
  });
});

describe('taskPatchSchema — 거부하는 모양', () => {
  it('모르는 키는 던진다 (`.strict()`)', () => {
    expect(parse({ status: '완료', titel: '오타' }).success).toBe(false);
    expect(parse({ note: '메모' }).success).toBe(false);
    expect(parse({ dueAt: '2026-09-01' }).success).toBe(false);
    expect(parse({ extras: {} }).success).toBe(false);
  });

  /**
   * 담당자 **이름**은 클라이언트가 정하지 않는다. 라우트가 `ownerMemberId`에서 유도해 채운다 —
   * 둘을 따로 받으면 「담당자는 A인데 이름은 B」인 행이 만들어진다 (`types/auth.ts`).
   */
  it('ownerNameRaw는 받지 않는다 — 이름은 id에서 유도한다', () => {
    expect(parse({ ownerNameRaw: '남' }).success).toBe(false);
    expect(parse({ ownerMemberId: null, ownerNameRaw: null }).success).toBe(false);
  });

  it('담당자 id는 uuid여야 한다 — 아니면 저장소가 타입 오류를 낸다', () => {
    expect(parse({ ownerMemberId: '담당자2' }).success).toBe(false);
    expect(parse({ ownerMemberId: '' }).success).toBe(false);
  });

  it('공동 담당도 uuid 배열이다', () => {
    expect(parse({ coOwnerMemberIds: ['담당자2'] }).success).toBe(false);
    expect(parse({ coOwnerMemberIds: MEMBER_ID }).success).toBe(false);
    expect(parse({ coOwnerMemberIds: null }).success).toBe(false);
  });

  /** 한 업무에 명부 전체를 실어 보내는 요청을 문 앞에서 자른다 */
  it('공동 담당은 20명을 넘을 수 없다', () => {
    const many = (count: number): string[] =>
      Array.from({ length: count }, (_, index) =>
        `3f2504e0-4f89-11d3-9a0c-${String(index).padStart(12, '0')}`
      );

    expect(parse({ coOwnerMemberIds: many(20) }).success).toBe(true);
    expect(parse({ coOwnerMemberIds: many(21) }).success).toBe(false);
  });

  it('공동 담당 이름은 받지 않는다 — 이름은 id에서 유도한다', () => {
    expect(parse({ coOwnerNames: ['남'] }).success).toBe(false);
  });

  it('빈 객체는 거부한다 — 아무것도 안 바꾸는 요청이 200이면 클라이언트 버그가 성공으로 보인다', () => {
    expect(parse({}).success).toBe(false);
  });

  it('진행률은 0~100 정수다', () => {
    expect(parse({ progress: 101 }).success).toBe(false);
    expect(parse({ progress: -1 }).success).toBe(false);
    expect(parse({ progress: 1.5 }).success).toBe(false);
    expect(parse({ progress: '50' }).success).toBe(false);
    expect(parse({ progress: Number.NaN }).success).toBe(false);
  });

  it('상태는 비어 있을 수 없고 100자를 넘을 수 없다', () => {
    expect(parse({ status: '' }).success).toBe(false);
    expect(parse({ status: '   ' }).success).toBe(false);
    expect(parse({ status: 'ㄱ'.repeat(101) }).success).toBe(false);
    expect(parse({ status: 'ㄱ'.repeat(100) }).success).toBe(true);
  });

  it('상태를 null로 지울 수는 없다 — 상태 없는 업무를 화면이 만들지 않는다', () => {
    expect(parse({ status: null }).success).toBe(false);
  });

  it('객체가 아닌 본문은 거부한다', () => {
    expect(parse(null).success).toBe(false);
    expect(parse('진행 중').success).toBe(false);
    expect(parse([{ status: '완료' }]).success).toBe(false);
  });
});
