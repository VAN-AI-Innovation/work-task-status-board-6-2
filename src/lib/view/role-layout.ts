/**
 * 역할별 진입 화면의 **섹션 순서**를 정한다 (T6 완료 기준 7, `H7` 헤지).
 *
 * ## 순서만 바꾼다. 삭제하지 않는다
 *
 * 세 역할이 보는 것은 **같은 데이터이고 같은 섹션**이다. 다른 것은 무엇이 맨 위에 오느냐뿐이고,
 * 필요한 사람이 스크롤하면 나머지도 다 있다. 삭제는 「권한」이고 그것은 T8이다 — 지금 화면에서
 * 섹션을 빼면 권한을 구현한 것처럼 보이지만 서버는 아무것도 막지 않아 URL 하나로 뚫린다.
 *
 * 그래서 이 파일이 지는 불변식이 둘이다. 테스트가 둘 다 지킨다.
 * - 세 배열이 **서로 다르다** (같으면 이 기능이 존재하지 않는 것이다)
 * - `kpi` ↔ `kpi_compact`를 뺀 나머지 **집합이 같다** (어느 역할도 섹션을 잃지 않는다)
 *
 * T8에서 진짜 인증이 붙으면 바뀌는 것은 「누가 admin인가」뿐이고 이 표는 그대로다.
 *
 * ## 역할을 여기서 판정하지 않는다
 *
 * 인자로 받는 `role`은 `resolveViewerRole`이 판정한 결과다 (`S4`·`ADR-013`). 이 파일이
 * `?as=`를 다시 읽으면 「프로덕션에서 `?as=`를 무시한다」는 규칙이 두 곳이 되고, 그중 한 곳만
 * 고쳐지는 날 인증 우회가 생긴다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

export type SectionKey =
  | 'kpi'
  | 'kpi_compact'
  | 'goals'
  | 'briefing'
  | 'teams'
  | 'charts'
  | 'alerts'
  | 'approvals'
  | 'tasks';

/**
 * 근거는 페르소나의 첫 질문이다 (`PLAN.md`「사용자 여정」).
 *
 * - `admin` — 「전사가 잘 돌고 있나」. KPI·목표·브리핑이 회의 직전 5분에 쓰이는 것이다
 *   (`UC-07`·`UC-08`·`UC-10`).
 * - `lead` — 「지금 손대야 할 것」. 알림과 승인 대기가 먼저다 (`UC-12`·`UC-13`).
 * - `member` — 「내 마감」. 진입 3초 안에 자기 업무가 보여야 한다 (`UC-14`).
 */
export const SECTION_ORDER: Readonly<Record<ViewerRole, readonly SectionKey[]>> = {
  admin: ['kpi', 'goals', 'briefing', 'teams', 'charts', 'alerts', 'approvals', 'tasks'],
  lead: ['alerts', 'approvals', 'kpi', 'teams', 'charts', 'tasks', 'goals', 'briefing'],
  member: ['tasks', 'kpi_compact', 'alerts', 'teams', 'charts', 'goals', 'briefing', 'approvals'],
};

export function sectionsFor(role: ViewerRole): readonly SectionKey[] {
  return SECTION_ORDER[role];
}

/**
 * `member`의 축약 KPI에 쓸 타일 키 3개. **여기서 세지 않는다** — `buildKpiStrip`이 낸 배열에서
 * 이 키로 골라 쓴다. 화면이 따로 세면 같은 라벨이 두 값을 갖게 된다 (`ADR-006`).
 *
 * 10칸을 다 보여줘도 부원이 쓰는 것은 이 셋이다. 키가 틀리면 화면에 빈 칸 3개가 뜨므로
 * 테스트가 `buildKpiStrip`의 실제 `key` 값과 대조한다.
 */
export const COMPACT_KPI_KEYS: readonly string[] = ['active_total', 'due_soon', 'overdue'];
