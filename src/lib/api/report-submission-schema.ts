/**
 * 주간 보고 제출·검토의 계약 (`POST /api/report/submit` · `POST /api/report/review` ·
 * `list_reports()`).
 *
 * 요청 스키마를 `lib/api/`에 두는 것은 이 프로젝트의 규율이다 (`join-request-schema.ts`와
 * 같은 자리) — 라우트 핸들러는 **zod 검증 → RPC 호출 → 직렬화 3단계뿐**이고 판단을 들고
 * 있지 않는다.
 *
 * ## 「반려에는 사유가 필수」를 두 곳이 진다
 *
 * `review_report`도 빈 사유를 예외로 막는다 (`0010` 4절). 그런데도 앱에서 한 번 더 막는 것은
 * **답이 달라지기** 때문이다 — DB 예외는 라우트에서 403이 되고, 그것은 「당신은 이걸 못
 * 합니다」라는 거짓말이다. 잘못된 것은 권한이 아니라 요청의 모양이고, 사용자가 할 일은
 * 포기가 아니라 **사유를 적어 다시 보내는 것**이다 (`join-request-schema.ts`가 「정확히
 * 하나」에서 같은 판단을 한다).
 *
 * ## 팀을 제출 요청에서 받지 않는다
 *
 * `submit_report`는 `my_team()`으로 팀을 정한다. 그래서 이 스키마에도 `teamId`가 없고,
 * `.strict()`라 실어 보내면 **던진다** — 남의 팀 이름으로 보고를 올리려는 요청이 200을 받고
 * 조용히 자기 팀에 저장되는 것보다, 400으로 「그 키는 없다」고 말하는 편이 정직하다.
 * 반대로 검토 요청에는 `teamId`가 있다: 어드민은 남의 팀 보고를 대상으로 삼는 것이 정상이다.
 */

import { z } from 'zod';

import { kstDateOf } from '@/lib/domain/kst-today';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { ReportStatus } from '@/lib/domain/report-submission';
import { teamIdSchema } from '@/lib/api/signup-schema';
import type { TeamSubmission } from '@/lib/view/report-merge';
import type { TeamKey } from '@/types/task';

/** `resolveReportPeriod`가 내는 주 시작일과 같은 모양이다 */
const WEEK_START = /^\d{4}-\d{2}-\d{2}$/;

const weekStartSchema = z.string().regex(WEEK_START);

/**
 * 본문 상한. 보고서는 팀 업무 전량을 담을 수 있어 넉넉해야 하지만, 상한이 없으면 이 라우트가
 * 임의 크기 문자열의 저장소가 된다. 지금 가장 큰 팀의 보고가 10KB 언저리라 다섯 배를 둔다.
 */
export const REPORT_BODY_MAX_LENGTH = 50_000;
/** 특이사항은 사람이 손으로 적는 글이다 */
export const REPORT_NOTE_MAX_LENGTH = 5_000;
/** 반려 사유도 마찬가지다. 길게 쓰라고 만든 칸이 아니다 */
export const REVIEW_NOTE_MAX_LENGTH = 2_000;

/**
 * 제출. **본문이 비면 거부한다** — 빈 보고를 올릴 이유가 없고, DB도 `empty body`로 막는다.
 * `note`는 없으면 빈 문자열이다: 「안 적었다」와 「빈 문자열」을 가를 이유가 없다
 * (`report_submissions.note`가 `not null default ''`인 것과 같은 판단).
 */
export const submitReportSchema = z
  .object({
    weekStart: weekStartSchema,
    body: z.string().trim().min(1).max(REPORT_BODY_MAX_LENGTH),
    note: z.string().max(REPORT_NOTE_MAX_LENGTH).default(''),
  })
  .strict();

export type SubmitReportInput = z.infer<typeof submitReportSchema>;

/**
 * 검토. 결정은 둘뿐이다 — 「제출됨」으로 되돌리는 길은 **팀장의 재보고**뿐이고
 * (`submit_report`), 어드민이 그 상태를 만들 수 있으면 누가 다시 올렸는지 알 수 없게 된다.
 */
export const reviewReportSchema = z
  .object({
    teamId: teamIdSchema,
    weekStart: weekStartSchema,
    decision: z.enum(['accepted', 'rejected']),
    reviewNote: z.string().max(REVIEW_NOTE_MAX_LENGTH).optional(),
  })
  .strict()
  .refine(
    (input) => input.decision !== 'rejected' || (input.reviewNote ?? '').trim() !== '',
    { message: '반려 사유를 적어 주세요.' }
  );

export type ReviewReportInput = z.infer<typeof reviewReportSchema>;

/**
 * `list_reports()`가 내는 행. 키 이름이 스네이크케이스인 것은 SQL과 글자 그대로 같아야 하기
 * 때문이다 (`0010` 5절의 `returns table`).
 *
 * `.strict()`라 함수가 칸을 하나 늘리면 **여기서 던진다.** 조용히 지나가면 다음 사람은 새
 * 칸이 응답에 실리는지 아닌지를 코드만 보고 알 수 없다.
 *
 * ⚠ `team_id`만 `z.string()`이다. `teams`에 팀이 하나 늘어나는 것은 **정상적인 일**이고,
 *   그때 이 화면 전체가 던지면 안 된다 — 모르는 팀 행은 아래에서 조용히 뺀다
 *   (`member-tree.ts`가 모르는 팀 키를 `unassigned`로 보내는 것과 같은 결의 판단이다).
 */
const reportRowSchema = z
  .object({
    team_id: z.string(),
    week_start: z.string(),
    body: z.string(),
    note: z.string(),
    status: z.enum(['submitted', 'accepted', 'rejected']),
    review_note: z.string().nullable(),
    submitted_at: z.string(),
    reviewed_at: z.string().nullable(),
  })
  .strict();

export interface ReportSubmissionsResponse {
  submissions: TeamSubmission[];
}

const isKnownTeam = (value: string): value is TeamKey =>
  (TEAM_KEYS as readonly string[]).includes(value);

/**
 * DB 행 → 화면이 쓰는 모양. **거르지 않는다** — 범위는 `list_reports()`가 이미 좁혔고, 앱이
 * 한 번 더 걸면 규칙이 두 벌이 되어 어긋났을 때 어느 쪽이 진짜인지 알 수 없다.
 *
 * `rows`가 `null`인 것은 사고가 아니다. 자격증명이 없는 환경(데모)에는 부를 함수가 없고,
 * `rpc`가 행이 없을 때 `null`을 주는 클라이언트 갈래도 있어 둘을 같은 「빈 목록」으로 접는다.
 */
export function toReportSubmissionsResponse(rows: unknown): ReportSubmissionsResponse {
  const parsed = z.array(reportRowSchema).parse(rows ?? []);

  return {
    submissions: parsed.flatMap((row) => {
      if (!isKnownTeam(row.team_id)) return [];

      return [
        {
          teamId: row.team_id,
          body: row.body,
          note: row.note,
          status: row.status as ReportStatus,
          reviewNote: row.review_note,
          // 읽을 수 없는 시각은 `null`이다. 지어내지 않는다 (`join-request-rows.ts`와 같은 규칙)
          submittedOn: kstDateOf(row.submitted_at),
        },
      ];
    }),
  };
}
