/**
 * 이 스키마가 지는 계약은 셋이다.
 *
 * 1. **허용 필드는 둘뿐이다** (`PLAN.md`「T8 착수 시 확정」 결정 F). 시트가 진실의 원천이라
 *    재업로드가 덮어쓸 필드를 화면에서 고치게 하면 사용자는 자기 수정이 사라지는 것을 본다.
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
});

describe('taskPatchSchema — 거부하는 모양', () => {
  it('모르는 키는 던진다 (`.strict()`)', () => {
    expect(parse({ status: '완료', titel: '오타' }).success).toBe(false);
    expect(parse({ note: '메모' }).success).toBe(false);
    expect(parse({ dueAt: '2026-09-01' }).success).toBe(false);
    expect(parse({ ownerNameRaw: '남' }).success).toBe(false);
    expect(parse({ extras: {} }).success).toBe(false);
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
