/**
 * **리더 이상이 쓰는 도구가 무엇인가**를 정한다 — 독스→배정표(`/extract`)와
 * 주간 보고(`/report`) 둘.
 *
 * `member-admin.ts`·`join-review.ts`와 나란한 자리이고 같은 규율을 따른다: 판정이라
 * `lib/domain`에 있고(`ADR-006`), 사이드바는 이 값으로 항목을 감추며 화면은 같은 값을
 * `notFound()`로 옮긴다. 두 곳이 각자 판단하면 메뉴에는 없는데 주소로는 열리는 날이 온다.
 *
 * ## 두 물음을 한 파일에 둔 근거
 *
 * 앞의 두 파일은 「받아들일 수 있는가」와 「명부를 볼 수 있는가」로 **묻는 것이 달라서**
 * 갈라 뒀다. 여기 둘은 같은 물음이다 — 「이것은 팀을 **끌고 가는 사람**의 도구인가」.
 * 배정표는 남에게 일을 나눠 주려고 뽑는 표이고(`UC-05`), 주간 보고는 회의에 들고 가는
 * 문서다(`UC-08`). 부원에게는 둘 다 쓸 자리가 없다.
 *
 * 함수를 둘로 둔 것은 답이 갈릴 날을 위해서다. 지금은 같은 값이고, 한쪽만 열어 달라는
 * 요구가 오면 그 함수 하나만 바뀐다.
 *
 * ## 세션이 없으면 좁히지 않는다
 *
 * `team-visibility.ts`가 못박은 규칙과 **같다** — 데모에서는 범위가 갈리지 않는다.
 * 로그인하지 않은 요청의 역할은 `resolveViewerRole`이 `member`로 두는데(`?as=` 없이는
 * 그것이 기본값이다), 그 값으로 좁히면 `.env` 없이 클론한 심사자에게 **두 화면이 통째로
 * 사라진다** (`PRD.md` 성공 기준 1). 그래서 `hasSession`이 인자다 — 역할만으로는 「부원이라
 * 못 본다」와 「아직 로그인이 없다」를 가를 수 없다.
 *
 * ## 감추는 것은 방어가 아니다
 *
 * 화면을 404로 두는 것은 **정보를 줄이는 것**이다 (`join-review.ts` 머리말과 같은 판단).
 * 진짜 문은 그 도구를 굴리는 라우트에 있다 — `POST /api/uploads/doc`·
 * `POST /api/export/assignment`·`GET /api/report/weekly`가 같은 함수로 403을 낸다.
 * 여기 값이 참이어도 데이터 범위는 그대로다: 보고서에 담기는 것은 `viewer-scope.ts`와
 * RLS가 이미 자른 목록이라, 팀장이 여는 보고서에는 자기 팀 업무만 들어 있다.
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

/** 독스 → 배정표를 쓸 수 있는가 (`/extract` · 배정표 xlsx) */
export function canUseDocExtract(role: ViewerRole, hasSession: boolean): boolean {
  if (!hasSession) return true;

  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}

/** 주간 보고 화면을 열 수 있는가 (`/report`) */
export function canReadWeeklyReport(role: ViewerRole, hasSession: boolean): boolean {
  if (!hasSession) return true;

  switch (role) {
    case 'admin':
    case 'lead':
      return true;
    case 'member':
      return false;
  }
}
