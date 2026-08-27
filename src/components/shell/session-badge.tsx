/**
 * 로그인한 사람이 상단 바에서 보는 것 — **누구로 보고 있는가**와 [로그아웃].
 *
 * T8까지 이 자리에는 `?as=` 역할 전환 버튼이 있었다. 로그인한 사람에게 그 버튼은 눌러도
 * 역할이 바뀌지 않는 **거짓말**이라(`ADR-026`), 세션이 있으면 그것을 이 배지로 갈아 끼운다.
 * 화면이 「막았다」고 말하는 것이 아니라 **사실을 말하는 것**이 요점이다: 범위는 이미
 * 서버(`viewer-scope.ts`)와 DB(RLS)가 갈랐고, 여기서는 그 결과가 누구 것인지만 밝힌다.
 *
 * props를 받아 JSX만 뱉는다. 「로그인했는가」·「역할이 무엇인가」는 페이지가 판정해 넘긴다.
 *
 * 로그아웃이 링크가 아니라 **폼**인 것은 `/api/auth/logout`이 `POST`만 받기 때문이다 —
 * 조회 메서드로 열어 두면 `<img>` 태그 하나로, 혹은 프리페치 한 번으로 남을 로그아웃시킬 수
 * 있다 (`login-form.tsx`의 `NoProfileNotice`가 같은 이유로 폼이다).
 */

import { roleLabel } from '@/lib/view/role-label';
import type { ViewerRole } from '@/lib/domain/extras-visibility';

/** 프로필 행이 없는 계정. 세션은 있으므로 로그아웃은 되어야 한다 (step 10의 갇힘 방지) */
const NO_ROLE_LABEL = '권한 미지정';

export function SessionBadge({
  email,
  role,
}: {
  email: string;
  /** `null`이면 로그인은 됐는데 `profiles` 행이 없는 상태다 */
  role: ViewerRole | null;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {/*
       * **값을 자르지 않는다.** 긴 이메일은 CSS로 다루고(`truncate`), `title`·`data-*`에
       * 전체를 심지 않는다 — 툴팁도 화면 캡처에 남는다 (`S6`).
       */}
      <span className="text-ink-muted max-w-[180px] truncate text-xs">{email}</span>
      <span className="border-line text-ink-muted rounded-full border px-2 py-0.5 text-xs">
        {role === null ? NO_ROLE_LABEL : roleLabel(role)}
      </span>
      <form method="post" action="/api/auth/logout">
        <button
          type="submit"
          className="border-line text-ink-muted hover:border-brand hover:text-brand rounded border px-2 py-1 text-xs"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
