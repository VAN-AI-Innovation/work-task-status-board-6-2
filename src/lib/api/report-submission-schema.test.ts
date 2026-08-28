/**
 * 보고 제출·검토 두 라우트의 계약. 재는 것은 셋이다 —
 * **모르는 키를 던지는가** · **반려에 사유를 요구하는가** · **RPC 행을 그대로 옮기는가.**
 */

import { describe, expect, it } from 'vitest';

import {
  reviewReportSchema,
  submitReportSchema,
  toReportSubmissionsResponse,
} from '@/lib/api/report-submission-schema';

const WEEK = '2026-08-24';

describe('submitReportSchema', () => {
  it('본문과 특이사항을 받는다', () => {
    expect(
      submitReportSchema.parse({ weekStart: WEEK, body: '# 보고', note: '장비 지연' })
    ).toEqual({ weekStart: WEEK, body: '# 보고', note: '장비 지연' });
  });

  it('특이사항은 없어도 된다 — 빈 문자열이 기본값이다', () => {
    expect(submitReportSchema.parse({ weekStart: WEEK, body: '# 보고' }).note).toBe('');
  });

  it('본문이 비면 거부한다 — 빈 보고를 올릴 이유가 없다', () => {
    expect(submitReportSchema.safeParse({ weekStart: WEEK, body: '   ' }).success).toBe(false);
  });

  it('주는 `YYYY-MM-DD`다', () => {
    expect(submitReportSchema.safeParse({ weekStart: '2026-8-24', body: 'x' }).success).toBe(false);
    expect(submitReportSchema.safeParse({ weekStart: 'this-week', body: 'x' }).success).toBe(false);
  });

  it('모르는 키는 던진다 — 특히 `status`가 조용히 무시되면 안 된다', () => {
    expect(
      submitReportSchema.safeParse({ weekStart: WEEK, body: 'x', status: 'accepted' }).success
    ).toBe(false);
    expect(submitReportSchema.safeParse({ weekStart: WEEK, body: 'x', teamId: 'edit' }).success)
      .toBe(false);
  });
});

describe('reviewReportSchema', () => {
  it('받아들일 때는 사유가 없다', () => {
    expect(
      reviewReportSchema.parse({ teamId: 'edit', weekStart: WEEK, decision: 'accepted' })
    ).toMatchObject({ decision: 'accepted' });
  });

  it('반려에는 사유가 필수다 — 없으면 팀장이 할 수 있는 것은 추측뿐이다', () => {
    expect(
      reviewReportSchema.safeParse({ teamId: 'edit', weekStart: WEEK, decision: 'rejected' })
        .success
    ).toBe(false);
    expect(
      reviewReportSchema.safeParse({
        teamId: 'edit',
        weekStart: WEEK,
        decision: 'rejected',
        reviewNote: '   ',
      }).success
    ).toBe(false);
    expect(
      reviewReportSchema.safeParse({
        teamId: 'edit',
        weekStart: WEEK,
        decision: 'rejected',
        reviewNote: '숫자가 지난주 것입니다',
      }).success
    ).toBe(true);
  });

  it('결정은 둘뿐이다 — 「제출됨」으로 되돌리는 것은 재보고뿐이다', () => {
    expect(
      reviewReportSchema.safeParse({ teamId: 'edit', weekStart: WEEK, decision: 'submitted' })
        .success
    ).toBe(false);
  });

  it('팀은 아는 셋뿐이다', () => {
    expect(
      reviewReportSchema.safeParse({ teamId: 'sales', weekStart: WEEK, decision: 'accepted' })
        .success
    ).toBe(false);
  });
});

describe('toReportSubmissionsResponse', () => {
  const row = {
    team_id: 'edit',
    week_start: '2026-08-24',
    body: '# 보고',
    note: '장비 지연',
    status: 'submitted',
    review_note: null,
    submitted_at: '2026-08-27T15:10:00Z',
    reviewed_at: null,
  };

  it('스네이크케이스 행을 그대로 옮긴다', () => {
    expect(toReportSubmissionsResponse([row]).submissions[0]).toMatchObject({
      teamId: 'edit',
      body: '# 보고',
      note: '장비 지연',
      status: 'submitted',
      reviewNote: null,
    });
  });

  it('제출 시각을 KST 날짜로 옮긴다 — UTC로 자르면 하루가 어긋난다', () => {
    // 2026-08-27T15:10Z는 KST로 8/28 00:10이다
    expect(toReportSubmissionsResponse([row]).submissions[0]?.submittedOn).toBe('2026-08-28');
  });

  it('읽을 수 없는 시각은 null이다 — 지어내지 않는다', () => {
    const broken = toReportSubmissionsResponse([{ ...row, submitted_at: 'nope' }]);

    expect(broken.submissions[0]?.submittedOn).toBeNull();
  });

  it('`null`(자격증명 없음)은 빈 목록이다 — 에러가 아니다', () => {
    expect(toReportSubmissionsResponse(null).submissions).toEqual([]);
  });

  it('칸이 늘거나 모양이 틀리면 던진다 — 조용히 지나가면 다음 사람이 모른다', () => {
    expect(() => toReportSubmissionsResponse([{ ...row, extra: 1 }])).toThrow();
    expect(() => toReportSubmissionsResponse([{ ...row, status: 'draft' }])).toThrow();
  });

  it('모르는 팀 행은 버린다 — 팀 표에 없는 키는 화면이 그릴 자리가 없다', () => {
    expect(toReportSubmissionsResponse([{ ...row, team_id: 'sales' }]).submissions).toEqual([]);
  });
});
