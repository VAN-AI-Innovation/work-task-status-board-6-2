/**
 * 가입 화면의 본문. **클라이언트 컴포넌트가 아니다** — 평범한 `<form method="post">`라
 * JS 없이도 가입이 된다 (`login-form.tsx`와 같은 결정, `ADR-027`).
 *
 * props를 받아 JSX만 뱉는다. 계산도 판정도 없다.
 *
 * 팀 이름을 여기 적지 않고 `lib/view/team-slug.ts`에서 가져오는 것이 요점이다. 같은 낱말이
 * 두 곳에 있으면 한쪽만 고쳐지고, 사이드바는 「마케팅·관리팀」인데 가입 폼은 「마케팅팀」이라고
 * 부르는 화면이 된다 (`role-label.ts` 머리말이 같은 사고를 기록하고 있다).
 *
 * 비밀번호 최소 길이도 마찬가지로 서버와 **같은 상수**를 읽는다. 두 곳에 숫자를 적으면
 * 폼은 통과하는데 서버가 거절하는 날이 온다.
 */

import { MIN_PASSWORD_LENGTH } from '@/lib/api/signup-schema';
import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { teamLabel } from '@/lib/view/team-slug';

/** `?error=`가 이 셋 중 하나일 때만 문구를 띄운다. 그 밖의 값은 무시한다 —
 *  URL로 넘어온 임의 문자열을 화면에 그리면 그것이 곧 낙서판이다 */
const FAILURE_MESSAGES = {
  invalid: '입력한 내용을 다시 확인해 주세요.',
  unavailable: '인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  weak: '이 비밀번호는 외부 유출 목록에 있습니다. 다른 것을 쓰세요.',
} as const;

type SignupFailure = keyof typeof FAILURE_MESSAGES;

function toFailure(value: string | null): SignupFailure | null {
  if (value === 'invalid' || value === 'unavailable' || value === 'weak') return value;
  return null;
}

const FIELD_CLASS =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

export function SignupForm({ error }: { error: string | null }) {
  const failure = toFailure(error);

  return (
    <form method="post" action="/api/auth/signup" className="flex flex-col gap-3">
      {failure !== null && (
        <p
          role="alert"
          className={
            /* `unavailable`만 앰버다 — 사용자가 고칠 수 있는 것이 아니라 운영 상태이고,
               그것은 「읽기 전용 — 저장소 연결 실패」 배너와 같은 종류의 사실이다 */
            failure === 'unavailable'
              ? 'border-warn-line bg-warn-bg text-warn rounded border px-3 py-2 text-sm'
              : 'border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm'
          }
        >
          {FAILURE_MESSAGES[failure]}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">이름</span>
        <input
          type="text"
          name="displayName"
          autoComplete="name"
          required
          maxLength={40}
          autoFocus
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">이메일</span>
        <input type="email" name="email" autoComplete="username" required className={FIELD_CLASS} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">비밀번호</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className={FIELD_CLASS}
        />
        <span className="text-ink-muted text-xs">{MIN_PASSWORD_LENGTH}자 이상</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">가입할 팀</span>
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
        className="bg-brand text-canvas hover:bg-brand-strong mt-1 rounded px-4 py-2 text-sm font-medium"
      >
        가입 요청
      </button>

      <p className="text-ink-muted text-xs">
        이미 계정이 있으신가요?{' '}
        <a href="/login" className="text-ink hover:text-brand underline-offset-4 hover:underline">
          로그인
        </a>
      </p>
    </form>
  );
}

/**
 * 확인 메일 갈래(`?sent=1`). Confirm email 설정이 켜져 있으면 `signUp`이 세션을 돌려주지
 * 않으므로 사용자가 할 일이 하나 더 있다 — **폼을 다시 보여 주지 않는다.** 보여 주면
 * 같은 이메일로 다시 눌러 보게 되고, 그 시도는 사용자에게 실패처럼 보인다.
 */
/**
 * **평소에는 뜨지 않는 화면이다.** 가입은 곧바로 세션을 얻어 `/pending`으로 가고, 이 갈래는
 * `signUp`이 세션을 주지 않을 때 — 즉 Supabase의 **Confirm email이 켜져 있을 때**만 선다
 * (`api/auth/signup/route.ts`). 그 설정을 끄기로 한 것이 지금의 결정이고, 이 갈래는 누군가
 * 다시 켰을 때 **사용자가 아무 말 없이 로그인 실패로 떨어지지 않게** 남겨 둔 안전망이다.
 *
 * 그래서 문구가 메일과 팀장 승인을 **둘 다** 말한다. 메일만 말하면 인증을 마친 사람이
 * 「이제 되겠지」 하고 기다리다 아무 일도 일어나지 않는 것을 보게 된다.
 */
export function SignupSentNotice() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-body text-sm">
        확인 메일을 보냈습니다. 메일의 링크를 눌러 인증을 마치면 승인 대기 상태가 되고, 그다음
        가입하신 팀의 팀장이 승인하면 이용하실 수 있습니다.
      </p>
      <a
        href="/login"
        className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-center text-sm"
      >
        로그인으로
      </a>
    </div>
  );
}
