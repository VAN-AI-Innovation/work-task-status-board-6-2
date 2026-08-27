/**
 * 승인 대기 화면의 본문. **클라이언트 컴포넌트가 아니다** — 재요청도 로그아웃도 평범한
 * `<form method="post">`라 JS 없이 동작한다 (`login-form.tsx`·`signup-form.tsx`와 같은 결정).
 *
 * props를 받아 JSX만 뱉는다. 어느 갈래를 그릴지는 페이지가 세션을 보고 정한다.
 *
 * 세 갈래 **모두 로그아웃 버튼을 둔다.** 이 화면은 다른 곳으로 갈 수 없는 막다른 길이고
 * (`pending-gate.ts`가 전부 여기로 보낸다), 나갈 문이 없으면 그 계정은 브라우저를 갈아타야
 * 빠져나온다. 로그아웃이 링크가 아니라 폼인 것은 `/api/auth/logout`이 `POST`만 받기
 * 때문이다 — 조회 메서드로 열어 두면 `<img>` 태그 하나로 남을 로그아웃시킬 수 있다.
 *
 * 팀 이름은 `lib/view/team-slug.ts`에서 온 값을 **받아서** 쓴다. 여기서 다시 적으면 같은
 * 낱말이 두 곳에 있게 되고, 한쪽만 고쳐지는 날이 온다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { teamLabel } from '@/lib/view/team-slug';

const FIELD_CLASS =
  'border-line bg-panel text-ink focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

/** 세 갈래가 공유한다. 문구만 다르고 나갈 문은 같다 */
function LogoutButton() {
  return (
    <form method="post" action="/api/auth/logout">
      <button
        type="submit"
        className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
      >
        로그아웃
      </button>
    </form>
  );
}

function AccountLine({ email }: { email: string }) {
  if (email.length === 0) return null;

  return <p className="text-ink-muted text-xs">로그인 계정: {email}</p>;
}

/**
 * 승인을 기다리는 중. **재요청 폼을 두지 않는다** — 이미 대기 줄에 서 있는 사람에게 다시
 * 요청할 자리를 주면 눌러 보게 되고, `request_join`은 `rejected`일 때만 통과하므로 그
 * 시도는 실패로 돌아온다. 사용자에게 그것은 고장이다.
 */
export function PendingNotice({
  teamName,
  displayName,
  email,
}: {
  teamName: string | null;
  displayName: string | null;
  email: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-body text-sm">
        {displayName === null ? '' : `${displayName}님, `}
        {teamName === null ? '' : `${teamName} `}
        합류를 요청했습니다. 팀장의 승인을 기다리는 중입니다.
      </p>
      <p className="text-ink-muted text-xs">
        승인되면 이 화면 대신 현황판이 열립니다. 잠시 후 다시 들어와 주세요.
      </p>
      <AccountLine email={email} />
      <LogoutButton />
    </div>
  );
}

/**
 * 반려됨. 여기에만 재요청 폼이 있다 — `request_join`이 통과하는 유일한 상태가 이것이다
 * (`0005` 4-6절).
 *
 * 반려 **사유를 보여 주지 않는다.** DB에 사유 칸이 없고, 화면이 지어내면 그것은 거짓말이다.
 */
export function RejectedNotice({
  teamName,
  email,
  error,
}: {
  teamName: string | null;
  email: string;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-body text-sm">
        {teamName === null ? '가입 요청이' : `${teamName} 합류 요청이`} 반려되었습니다. 다른 팀으로
        다시 요청할 수 있습니다.
      </p>

      {/* `?error=`가 `invalid`일 때만 문구를 띄운다. 그 밖의 값은 무시한다 —
          URL로 넘어온 임의 문자열을 화면에 그리면 그것이 곧 낙서판이다 */}
      {error === 'invalid' && (
        <p
          role="alert"
          className="border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm"
        >
          재요청을 처리하지 못했습니다. 팀을 다시 골라 주세요.
        </p>
      )}

      <form method="post" action="/api/auth/rejoin" className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted text-xs">다시 요청할 팀</span>
          <select name="teamId" required defaultValue="" className={FIELD_CLASS}>
            <option value="" disabled>
              팀을 고르세요
            </option>
            {TEAM_KEYS.map((teamKey) => (
              <option key={teamKey} value={teamKey}>
                {teamLabel(teamKey)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="bg-brand text-canvas hover:bg-brand-strong rounded px-4 py-2 text-sm font-medium"
        >
          다시 요청
        </button>
      </form>

      <AccountLine email={email} />
      <LogoutButton />
    </div>
  );
}

/**
 * 로그인은 됐는데 `profiles` 행이 없다. 트리거(`handle_new_user`)가 어떤 이유로 실패한
 * 계정이고, **재요청 폼을 주지 않는다** — 고칠 행 자체가 없어서 `request_join`이 통과할
 * 수 없다. 이 사람이 할 수 있는 일은 관리자에게 말하는 것뿐이다.
 */
export function MissingProfileNotice({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-body text-sm">
        프로필이 준비되지 않았습니다. 관리자에게 문의하세요.
      </p>
      <AccountLine email={email} />
      <LogoutButton />
    </div>
  );
}
