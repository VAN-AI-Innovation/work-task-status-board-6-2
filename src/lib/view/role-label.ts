/**
 * 역할을 사람이 읽는 한글로 옮기는 **한 곳**.
 *
 * 원래 이 표는 `components/shell/role-switch.tsx` 안에 있었다. 상단 바가 로그인한 사람의
 * 역할을 말하게 되면서 같은 세 낱말이 두 곳에 있게 됐고, 그러면 한쪽만 고쳐지는 날이 온다 —
 * 역할 전환 버튼은 「팀장」인데 상단 바는 「리드」라고 부르는 화면은 같은 말을 두 번 하는 것이
 * 아니라 **다른 말을 하는 것**이다.
 *
 * `lib/view`에 있는 이유는 표시 규칙이기 때문이다. 판정이 아니다 — 여기서 「누가 무엇을 볼
 * 수 있나」를 정하지 않는다 (그것은 `lib/domain/viewer-scope.ts`와 RLS가 진다).
 */

import type { ViewerRole } from '@/lib/domain/extras-visibility';

/**
 * 순서가 곧 화면의 순서다 (`RoleSwitch`가 이 배열을 그대로 그린다). 넓은 것에서 좁은 것으로
 * 간다 — 역할 전환 버튼이 권한 크기 순으로 서야 무엇이 「더 많이 보는」 쪽인지 읽힌다.
 */
export const ROLE_LABELS: readonly { key: ViewerRole; label: string }[] = [
  { key: 'admin', label: '대표·실장' },
  { key: 'lead', label: '팀장' },
  { key: 'member', label: '부원' },
];

/**
 * 모르는 값이 올 수 없다 — 인자가 `ViewerRole`이고, 알 수 없는 문자열은 세션 해석
 * (`lib/auth/viewer-session.ts`)이 이미 `no_profile`로 세운다. 그래도 폴백을 두는 것은
 * 타입이 캐스팅으로 뚫렸을 때 화면이 빈 글자가 아니라 원문을 보여 주게 하기 위해서다.
 */
export function roleLabel(role: ViewerRole): string {
  return ROLE_LABELS.find((item) => item.key === role)?.label ?? role;
}
