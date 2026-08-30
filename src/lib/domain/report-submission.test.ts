/**
 * 보고 흐름의 **판정 셋**을 잰다 — 누가 올리는가, 누가 반려하는가, 그리고 지금 팀이
 * 무엇을 할 수 있는 상태인가.
 */

import { describe, expect, it } from 'vitest';

import {
  canReviewReport,
  canSubmitReport,
  submissionStage,
  type ReportStatus,
} from '@/lib/domain/report-submission';

describe('canSubmitReport', () => {
  it('팀장이 올린다', () => {
    expect(canSubmitReport('lead')).toBe(true);
  });

  it('대표·실장도 올릴 수 있다 — 팀을 겸하는 조직이 있다 (`submit_report`가 팀으로 막는다)', () => {
    expect(canSubmitReport('admin')).toBe(true);
  });

  it('부원은 못 올린다', () => {
    expect(canSubmitReport('member')).toBe(false);
  });
});

describe('canReviewReport', () => {
  it('대표·실장만 받거나 돌려보낸다', () => {
    expect(canReviewReport('admin')).toBe(true);
    expect(canReviewReport('lead')).toBe(false);
    expect(canReviewReport('member')).toBe(false);
  });

  it('올리는 사람과 받는 사람이 갈린다 — 팀장이 자기 보고를 승인하지 못한다', () => {
    expect(canSubmitReport('lead')).toBe(true);
    expect(canReviewReport('lead')).toBe(false);
  });
});

/**
 * 화면이 「지금 무엇을 보여 줄까」를 `if`로 세 번 묻지 않게 한 칸으로 접는다.
 * **「아직 안 올렸다」와 「올렸는데 반려됐다」가 같아 보이면 안 된다.**
 */
describe('submissionStage', () => {
  const stage = (status: ReportStatus | null): string => submissionStage(status);

  it('제출 전이면 `draft`다', () => {
    expect(stage(null)).toBe('draft');
  });

  it('올렸고 아직 안 봤으면 `waiting`이다', () => {
    expect(stage('submitted')).toBe('waiting');
  });

  it('받아들여졌으면 `accepted`다', () => {
    expect(stage('accepted')).toBe('accepted');
  });

  it('반려됐으면 `rejected`다 — 고쳐서 다시 올리는 자리다', () => {
    expect(stage('rejected')).toBe('rejected');
  });
});
