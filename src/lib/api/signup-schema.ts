/**
 * `POST /api/auth/signup`의 문 앞. 요청 스키마를 `lib/api/`에 두는 것은 이 프로젝트의
 * 규율이다 (`credentials-schema.ts`·`task-patch-schema.ts`와 같은 자리) — 라우트 핸들러는
 * **zod 검증 → lib 호출 → 직렬화 3단계뿐**이고 판단을 들고 있지 않는다.
 *
 * 이 모듈이 지는 것은 **가입 요청 본문에 관한 전부**다. 읽고(`readSignup`), 거르고
 * (`isBreachedSignup`), Auth가 받는 모양으로 옮긴다(`toSignUpCredentials`). 셋을 한 곳에
 * 모은 이유는 `credentials-schema.ts`와 같다: 이렇게 두면 **`route.ts`에 자격증명 필드
 * 이름이 한 번도 나오지 않는다.** 값이 로그·에러 메시지에 섞이지 않는 것을 **grep으로**
 * 확인할 수 있고, 규칙을 사람의 주의력에 맡기지 않는다 (`S6`).
 *
 * **본문은 폼이다.** JSON도 받도록 넓히지 않았다 — 이 엔드포인트를 부르는 것은 브라우저의
 * `<form method="post">`와 `curl --data-urlencode` 둘뿐이다.
 */

import { z } from 'zod';

import { isPwnedPassword, type PwnedCheckDeps } from '@/lib/auth/pwned-password';
import type { TeamKey } from '@/types/task';

/**
 * **화면과 서버가 보는 한 곳.** 두 곳에 숫자를 적으면 한쪽만 고쳐지는 날 폼은 통과하는데
 * 서버가 거절하고, 사용자는 무엇이 틀렸는지 모른 채 같은 값을 다시 친다.
 *
 * 10인 이유: NIST SP 800-63B의 바닥이 8이고, 이 앱은 그 위에 **복잡도 규칙도 MFA도 두지
 * 않는다**(둘 다 사용자를 규칙 우회로 몰거나 계정 셋업을 무겁게 만든다). 대신 길이를 두 칸
 * 올리고 유출 목록 대조(`lib/auth/pwned-password.ts`)를 붙였다.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * 팀 키는 시트 탭에서 오는 **고정된 소수 집합**이다 (`0001_init.sql`·`team-slug.ts`).
 * 자유 문자열을 받으면 트리거가 `null`로 접어 **어느 리더에게도 보이지 않는 유령 계정**이
 * 생긴다 — 여기서 400으로 돌려주는 편이 낫다.
 *
 * `satisfies`가 `TeamKey`와의 어긋남을 컴파일 시각에 잡는다. 팀 이름이 바뀌면 여기가 먼저
 * 빨개진다.
 */
const TEAM_IDS = ['edit', 'shoot', 'marketing'] as const satisfies readonly TeamKey[];

/** zod v4다 — `z.string().email()`이 아니라 `z.email()` (`PLAN.md` `A5`) */
export const signupSchema = z.object({
  /** `profiles.display_name`의 제약과 같은 40자다 (`0005` 1절) */
  displayName: z.string().trim().min(1).max(40),
  email: z.email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  teamId: z.enum(TEAM_IDS),
});

export type Signup = z.infer<typeof signupSchema>;

/**
 * 폼 본문을 가입 요청으로 읽는다. **던지지 않는다** — 폼이 아닌 본문(JSON·빈 몸통)은
 * `formData()`가 던지는데, 그것도 「잘못된 입력」이라 호출부에서 같은 갈래로 접혀야 한다.
 */
export async function readSignup(request: Request): Promise<Signup | null> {
  let entries: Record<string, unknown>;

  try {
    entries = Object.fromEntries((await request.formData()).entries());
  } catch {
    return null;
  }

  const parsed = signupSchema.safeParse(entries);
  return parsed.success ? parsed.data : null;
}

/**
 * 유출 목록 대조. 대조 자체는 `lib/auth/pwned-password.ts`가 하고 여기서는 **꺼내 주기만**
 * 한다 — 라우트가 직접 꺼내면 그 파일에 자격증명 필드 이름이 남는다(머리말의 grep 규칙).
 */
export async function isBreachedSignup(signup: Signup, deps: PwnedCheckDeps): Promise<boolean> {
  return isPwnedPassword(signup.password, deps);
}

/**
 * Supabase Auth의 `signUp()`이 받는 모양으로 옮긴다.
 *
 * ⚠ **`role`·`status`를 싣지 않는다.** `user_metadata`는 사용자가 고칠 수 있는 자리라
 * 트리거(`handle_new_user`)가 두 값을 `'member'`·`'pending'`으로 **하드코딩**한다
 * (`0005` 3절). 실어 보내 봐야 무시되지만, 코드에 있으면 다음 사람이 「트리거도 그것을
 * 읽는다」고 착각하고 그 착각이 곧 권한 상승 경로다.
 *
 * 키 이름이 snake_case인 것은 트리거가 `raw_user_meta_data->>'display_name'`으로 읽기
 * 때문이다 — SQL과 글자 그대로 같아야 한다.
 */
export function toSignUpCredentials(signup: Signup) {
  return {
    email: signup.email,
    password: signup.password,
    options: { data: { display_name: signup.displayName, team_id: signup.teamId } },
  };
}
