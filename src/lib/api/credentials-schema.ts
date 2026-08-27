/**
 * `POST /api/auth/login`의 문 앞 검증. 요청 스키마를 `lib/api/`에 두는 것은 이 프로젝트의
 * 규율이다 (`task-patch-schema.ts`·`assignment-schema.ts`와 같은 자리) — 라우트 핸들러는
 * **zod 검증 → lib 호출 → 직렬화 3단계뿐**이고 판단을 들고 있지 않는다.
 *
 * 여기 있으면 부수 효과가 하나 더 있다: `route.ts`에 자격증명 필드 이름이 한 번도 나오지
 * 않는다. 로그·에러 메시지에 그 값이 섞이지 않는 것을 **grep으로** 확인할 수 있고,
 * 규칙을 사람의 주의력에 맡기지 않는다 (`S6`).
 *
 * **본문은 폼이다.** JSON도 받도록 넓히지 않았다 — 이 엔드포인트를 부르는 것은 브라우저의
 * `<form method="post">`와 `curl --data-urlencode` 둘뿐이고, 둘 다 폼이다. 분기를 미리
 * 만들면 쓰이지 않는 갈래가 테스트만 늘린다.
 */

import { z } from 'zod';

/** zod v4다 — `z.string().email()`이 아니라 `z.email()` (`PLAN.md` `A5`) */
export const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * 폼 본문을 자격증명으로 읽는다. **던지지 않는다** — 폼이 아닌 본문(JSON·빈 몸통)은
 * `formData()`가 던지는데, 그것도 「잘못된 입력」이라 호출부에서 같은 갈래로 접혀야 한다.
 * `null`이면 검증 실패와 구분 없이 `?error=invalid`다.
 */
export async function readCredentials(request: Request): Promise<Credentials | null> {
  let entries: Record<string, unknown>;

  try {
    entries = Object.fromEntries((await request.formData()).entries());
  } catch {
    return null;
  }

  const parsed = credentialsSchema.safeParse(entries);
  return parsed.success ? parsed.data : null;
}
