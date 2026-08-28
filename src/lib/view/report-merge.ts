/**
 * 팀별 제출을 **한 장짜리 전사 보고**로 잇는다 (`/report`의 어드민 화면).
 *
 * ## 세지 않는다. 잇기만 한다
 *
 * 숫자는 전부 팀장이 제출한 본문 안에 이미 있다 — 그 문자열은 `buildWeeklyReport`가 만들어
 * 팀장이 확인(하고 필요하면 고쳐)서 올린 것이다. 여기서 다시 세면 어드민이 보는 숫자와
 * 팀장이 올린 숫자가 갈리고, **그 순간 이 보고 체계가 성립하지 않는다** (`ADR-006`).
 *
 * 그래서 이 파일이 하는 일은 셋뿐이다: 제출 현황을 앞에 세우고, 팀마다 특이사항과 본문을
 * 붙이고, 안 낸 팀을 남긴다.
 *
 * ## 제목 단수를 맞춘다
 *
 * 팀 본문은 `# 주간 업무 보고 — …`로 시작한다. 그대로 이어 붙이면 1단 제목이 문서에 넷
 * 생긴다. 그래서 **본문의 첫 제목 줄만 뺀다** — 남은 `## 섹션`들은 팀(`# 편집팀`) 아래
 * 2단으로 정확히 들어맞는다. 본문을 정규식으로 한 단씩 밀지 않는 것은 `toReportBlocks`가
 * 아는 단수가 둘뿐이라 3단이 문단으로 떨어지기 때문이고, 무엇보다 **제출된 문자열을
 * 고치지 않는다**는 규칙이 더 중요하다.
 *
 * ## 안 낸 팀을 지우지 않는다
 *
 * 「제출되지 않았습니다」라고 적는다. 빼 버리면 **어드민이 그 팀을 잊는다** — 이 문서의 첫
 * 정보는 「누가 안 냈는가」이고, 그래서 제출 현황이 본문보다 먼저 선다. 알림 패널이 0건
 * 묶음을 남기는 것과 같은 규칙이다 (`UI_GUIDE.md`).
 *
 * **반려된 팀의 본문은 싣지 않는다.** 돌려보낸 내용을 전사 보고에 넣으면 반려가 아무 뜻도
 * 갖지 않는다. 대신 사유를 적는다 — 어드민이 「내가 왜 돌려보냈지」를 다시 찾지 않아도 된다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import type { ReportStatus } from '@/lib/domain/report-submission';
import { teamLabel } from '@/lib/view/team-slug';
import type { TeamKey } from '@/types/task';

export interface TeamSubmission {
  teamId: TeamKey;
  /** 제출 시점의 보고 본문. 팀장이 고쳤을 수 있다 */
  body: string;
  /** 특이사항. 안 적었으면 빈 문자열이다 (`0010`의 `not null default ''`) */
  note: string;
  status: ReportStatus;
  /** 반려 사유. 반려가 아니면 `null` */
  reviewNote: string | null;
  /** KST `YYYY-MM-DD`. 읽을 수 없으면 `null` */
  submittedOn: string | null;
}

export interface MergePeriod {
  weekStart: string;
  weekEnd: string;
}

/** 제출 현황 한 줄에 적는 말. 상태가 늘어나면 여기서 타입 에러가 난다 */
const STATUS_LABEL: Readonly<Record<ReportStatus, string>> = {
  submitted: '제출',
  accepted: '승인',
  rejected: '반려',
};

/** 본문의 첫 1단 제목 줄만 뺀다. 나머지는 한 글자도 건드리지 않는다 (머리말) */
function withoutTitle(body: string): string {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.trim() !== '');

  return index >= 0 && (lines[index] ?? '').startsWith('# ')
    ? lines.slice(index + 1).join('\n').trim()
    : body.trim();
}

function statusLine(teamId: TeamKey, found: TeamSubmission | undefined): string {
  if (found === undefined) return `- ${teamLabel(teamId)} — 미제출`;

  const when = found.submittedOn === null ? '' : ` (${found.submittedOn})`;
  return `- ${teamLabel(teamId)} — ${STATUS_LABEL[found.status]}${when}`;
}

function teamSection(teamId: TeamKey, found: TeamSubmission | undefined): string {
  const head = `# ${teamLabel(teamId)}`;

  if (found === undefined) {
    return [head, '', '이 팀의 보고가 아직 제출되지 않았습니다.'].join('\n');
  }

  if (found.status === 'rejected') {
    return [
      head,
      '',
      '## 반려됨',
      '',
      // 사유는 반려일 때 반드시 있다 (`review_report`가 빈 사유를 막는다). 그래도 없는
      // 값을 지어내지 않는다 — 옛 행이나 손으로 넣은 행이 있을 수 있다
      found.reviewNote ?? '사유가 기록되지 않았습니다.',
    ].join('\n');
  }

  return [
    head,
    '',
    '## 특이사항',
    '',
    // 빈 줄로 두면 「안 적었다」와 「못 읽었다」가 화면에서 같아 보인다
    found.note.trim() === '' ? '없음' : found.note.trim(),
    '',
    withoutTitle(found.body),
  ].join('\n');
}

export function mergeTeamReports(
  period: MergePeriod,
  submissions: readonly TeamSubmission[]
): string {
  /*
   * 팀 순서는 **`TEAM_KEYS`가 정한다.** 제출 순서를 쓰면 같은 주의 문서가 누가 먼저 냈느냐에
   * 따라 매번 다른 차례로 서고, 그 변화는 아무도 알아채지 못한다 (`member-tree.ts`가 같은
   * 판단을 한다).
   */
  const byTeam = new Map(submissions.map((item) => [item.teamId, item]));

  return [
    `# 주간 업무 보고 (전사) — ${period.weekStart} ~ ${period.weekEnd}`,
    '',
    '## 제출 현황',
    '',
    ...TEAM_KEYS.map((teamId) => statusLine(teamId, byTeam.get(teamId))),
    '',
    ...TEAM_KEYS.flatMap((teamId) => [teamSection(teamId, byTeam.get(teamId)), '']),
  ].join('\n');
}
