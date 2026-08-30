/**
 * 로그인 화면의 본문. **클라이언트 컴포넌트가 아니다** — 평범한 `<form method="post">`라
 * JS 없이도 로그인이 된다. 그것이 `/api/auth/login`을 서버 액션이 아니라 라우트 핸들러로
 * 만든 결정의 부수 효과다.
 *
 * props를 받아 JSX만 뱉는다. 「이미 로그인했는가」·「프로필이 있는가」는 페이지가 판정한다.
 *
 * 색은 `UI_GUIDE.md`의 토큰만 부른다. 두 문구의 색이 다른 것은 의도다 — `invalid`는
 * **사용자가 고칠 수 있는 것**이고 `unavailable`은 **운영 상태**라, 뒤쪽은 「읽기 전용 —
 * 저장소 연결 실패」 배너와 같은 앰버를 쓴다(같은 종류의 사실이다).
 */

/** `?error=`가 이 둘 중 하나일 때만 문구를 띄운다. 그 밖의 값은 무시한다 —
 *  URL로 넘어온 임의 문자열을 화면에 그리면 그것이 곧 낙서판이다 */
const FAILURE_MESSAGES = {
  invalid: '이메일 또는 비밀번호가 올바르지 않습니다.',
  unavailable: '인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
} as const;

type LoginFailure = keyof typeof FAILURE_MESSAGES;

function toFailure(value: string | null): LoginFailure | null {
  if (value === 'invalid' || value === 'unavailable') return value;
  return null;
}

const FIELD_CLASS =
  'border-line bg-panel text-ink placeholder:text-ink-faint focus:border-brand w-full rounded border px-3 py-2 text-sm focus:outline-none';

export function LoginForm({ error, next }: { error: string | null; next: string }) {
  const failure = toFailure(error);

  return (
    <form
      method="post"
      /* `next`는 페이지가 `safeRedirectPath`로 이미 접은 값이다 — 여기서 다시 판정하지 않는다 */
      action={`/api/auth/login?next=${encodeURIComponent(next)}`}
      className="flex flex-col gap-3"
    >
      {failure !== null && (
        <p
          role="alert"
          className={
            failure === 'invalid'
              ? 'border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm'
              : 'border-warn-line bg-warn-bg text-warn rounded border px-3 py-2 text-sm'
          }
        >
          {FAILURE_MESSAGES[failure]}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">이메일</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-muted text-xs">비밀번호</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={FIELD_CLASS}
        />
      </label>

      <button
        type="submit"
        className="bg-brand text-canvas hover:bg-brand-strong mt-1 rounded px-4 py-2 text-sm font-medium"
      >
        로그인
      </button>

      {/* 계정이 없는 사람에게 이 화면은 막다른 길이다 — 가입 화면으로 나가는 문을 둔다 (T11) */}
      <p className="text-ink-muted text-xs">
        계정이 없으신가요?{' '}
        <a href="/signup" className="text-ink hover:text-brand underline-offset-4 hover:underline">
          회원가입
        </a>
      </p>
    </form>
  );
}

/**
 * 로그인은 됐는데 `profiles` 행이 없는 계정. **이 갈래가 없으면 그 계정은 고리에 갇힌다** —
 * 세션이 있으니 `/login`은 대시보드로 보내고, 역할이 없으니 화면에는 아무것도 안 보인다.
 *
 * 로그아웃이 링크가 아니라 폼인 것은 `/api/auth/logout`이 `POST`만 받기 때문이다 —
 * 조회 메서드로 열어 두면 `<img>` 태그 하나로 남을 로그아웃시킬 수 있다.
 */
export function NoProfileNotice({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-body text-sm">
        이 계정에는 권한이 지정되지 않았습니다. 관리자에게 문의해 주세요.
      </p>
      {email.length > 0 && <p className="text-ink-muted text-xs">로그인 계정: {email}</p>}
      <form method="post" action="/api/auth/logout">
        <button
          type="submit"
          className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
