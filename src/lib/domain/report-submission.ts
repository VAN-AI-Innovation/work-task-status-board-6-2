/**
 * 주간 보고를 **올리고 받는** 흐름의 판정 (`/report`).
 *
 * ```
 * 팀장  ─[특이사항 + 본문 수정]→ 제출 ─→ 대기 ─→ 어드민이 받음(accepted)
 *   ↑                                        └→ 어드민이 돌려보냄(rejected) + 사유
 *   └──────────────── 고쳐서 재보고 ─────────────────┘
 * ```
 *
 * `staff-tools.ts`와 나란한 자리다. 저쪽이 「이 화면이 존재하는가」를 정하고 여기는 **그
 * 화면 안에서 무엇을 할 수 있는가**를 정한다. 판정이라 `lib/domain`에 있고(`ADR-006`),
 * 실제 허용은 `submit_report`·`review_report`가 진다 (`0010`).
 *
 * ## 올리는 사람과 받는 사람이 갈린다
 *
 * 두 함수를 나눈 이유가 그것이다. 팀장이 자기 보고를 스스로 승인할 수 있으면 반려라는 절차
 * 자체가 성립하지 않는다. `admin`이 `canSubmitReport`에서도 참인 것은 **팀을 겸하는 대표**가
 * 있는 조직 때문이고, 그때도 팀이 없으면 `submit_report`가 `no team`으로 막는다 — 팀 판정을
 * 여기서 하지 않는 것은 「내 팀이 무엇인가」를 아는 곳이 DB뿐이기 때문이다.
 *
 * ## 상태 넷을 한 낱말로 접는다
 *
 * 화면이 「제출 안 함 / 대기 / 승인 / 반려」를 `status === null`과 세 문자열로 매번 다시
 * 물으면, 그 네 갈래가 화면마다 조금씩 달라진다. **가장 위험한 것은 `null`과 `rejected`를
 * 같이 그리는 것**이다 — 둘 다 「아직 안 끝났다」이지만 앞은 처음 쓰는 것이고 뒤는 사유를
 * 읽고 고치는 것이다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

/** `report_submissions.status`. DB의 `check` 제약과 같은 셋이다 (`0010` 1절) */
export type ReportStatus = 'submitted' | 'accepted' | 'rejected';

/** 화면이 그리는 단계. 제출 이력이 없는 상태(`draft`)가 하나 더 있다 */
export type ReportStage = 'draft' | 'waiting' | 'accepted' | 'rejected';

/** 보고를 올릴 수 있는가 (`submit_report`) */
export function canSubmitReport(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}

/** 받거나 돌려보낼 수 있는가 (`review_report`) */
export function canReviewReport(role: ViewerRole): boolean {
  switch (role) {
    case 'admin':
      return true;
    case 'lead':
    case 'member':
      return false;
  }
}

/** 제출 이력이 없으면 `null`이 들어온다 — 그것이 `draft`다 */
export function submissionStage(status: ReportStatus | null): ReportStage {
  switch (status) {
    case null:
      return 'draft';
    case 'submitted':
      return 'waiting';
    case 'accepted':
      return 'accepted';
    case 'rejected':
      return 'rejected';
  }
}
