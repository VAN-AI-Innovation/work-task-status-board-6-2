/**
 * 이 파일이 재는 것은 셋이다 — **어떤 본문이 가입 요청으로 통과하는가**,
 * **팀이 아닌 값이 새어 들어가는가**, **Auth로 나가는 payload에 `role`·`status`가 없는가**.
 *
 * 마지막 하나가 이 스위트에서 가장 중요하다. `user_metadata`는 사용자가 고칠 수 있는
 * 자리라 트리거(`handle_new_user`)가 두 값을 하드코딩하는데, 앱이 그 키를 실어 보내기
 * 시작하면 다음 사람이 「트리거도 그것을 읽는다」고 착각한다 (step 0 · `0005`의 3절).
 */

import { describe, expect, it } from 'vitest';

import {
  isBreachedSignup,
  MIN_PASSWORD_LENGTH,
  readSignup,
  signupSchema,
  toSignUpCredentials,
} from './signup-schema';

const VALID = {
  displayName: '홍길동',
  email: 'a@example.com',
  password: 'x'.repeat(MIN_PASSWORD_LENGTH),
  teamId: 'edit',
};

function formRequest(body: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

describe('signupSchema — 통과하는 것', () => {
  it('네 필드가 다 맞으면 통과한다', () => {
    expect(signupSchema.safeParse(VALID).success).toBe(true);
  });

  it('이름의 앞뒤 공백을 떨어뜨린다', () => {
    const parsed = signupSchema.safeParse({ ...VALID, displayName: '  홍길동  ' });
    expect(parsed.success && parsed.data.displayName).toBe('홍길동');
  });

  it('팀 셋을 전부 받는다', () => {
    for (const teamId of ['edit', 'shoot', 'marketing']) {
      expect(signupSchema.safeParse({ ...VALID, teamId }).success).toBe(true);
    }
  });

  it('길이 경계는 통과 쪽이다 — 이름 40자, 비밀번호 최소 길이 그대로', () => {
    expect(signupSchema.safeParse({ ...VALID, displayName: '가'.repeat(40) }).success).toBe(true);
    expect(
      signupSchema.safeParse({ ...VALID, password: 'a'.repeat(MIN_PASSWORD_LENGTH) }).success
    ).toBe(true);
  });
});

describe('signupSchema — 거부하는 것', () => {
  it('이름이 비거나 공백뿐이거나 41자면 거부한다', () => {
    expect(signupSchema.safeParse({ ...VALID, displayName: '' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...VALID, displayName: '   ' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...VALID, displayName: '가'.repeat(41) }).success).toBe(false);
  });

  it('이메일 형식이 아니면 거부한다', () => {
    expect(signupSchema.safeParse({ ...VALID, email: 'not-an-email' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...VALID, email: '' }).success).toBe(false);
  });

  it('최소 길이보다 짧은 비밀번호를 거부한다 — 화면과 서버가 같은 상수를 본다', () => {
    expect(
      signupSchema.safeParse({ ...VALID, password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) }).success
    ).toBe(false);
  });

  /**
   * 자유 문자열을 받으면 트리거가 `null`로 접어 **어느 리더에게도 보이지 않는 유령 계정**이
   * 생긴다. 대소문자도 받지 않는다 — 팀 키는 소문자 한 모양이다 (`team-slug.ts`).
   */
  it('모르는 팀·대소문자 변형·빈 값을 거부한다', () => {
    for (const teamId of ['sales', 'EDIT', 'Edit', '편집팀', '']) {
      expect(signupSchema.safeParse({ ...VALID, teamId }).success).toBe(false);
    }
  });

  it('키가 하나라도 빠지면 거부한다', () => {
    for (const key of ['displayName', 'email', 'password', 'teamId']) {
      const body: Record<string, unknown> = { ...VALID };
      delete body[key];
      expect(signupSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('readSignup', () => {
  it('폼 본문을 읽어 돌려준다', async () => {
    await expect(readSignup(formRequest(VALID))).resolves.toEqual(VALID);
  });

  /** `role=admin`을 끼워 넣어도 스키마 밖이라 남지 않는다 */
  it('모르는 필드는 버리고 넷만 남긴다', async () => {
    await expect(readSignup(formRequest({ ...VALID, role: 'admin', status: 'active' }))).resolves.toEqual(
      VALID
    );
  });

  it('검증에 걸리면 null이다', async () => {
    await expect(readSignup(formRequest({ ...VALID, email: 'x' }))).resolves.toBeNull();
  });

  /** 폼이 아닌 본문은 `formData()`가 던진다. 그것도 「잘못된 입력」이라 같은 갈래로 접힌다 */
  it('폼이 아닌 본문에도 던지지 않고 null이다', async () => {
    const request = new Request('http://localhost:3000/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":"a@example.com"}',
    });

    await expect(readSignup(request)).resolves.toBeNull();
  });
});

describe('toSignUpCredentials', () => {
  it('Auth가 받는 모양으로 옮긴다 — metadata는 트리거가 읽는 두 키다', () => {
    expect(toSignUpCredentials({ ...VALID, teamId: 'shoot' } as never)).toEqual({
      email: VALID.email,
      password: VALID.password,
      options: { data: { display_name: '홍길동', team_id: 'shoot' } },
    });
  });

  /**
   * **이 단언이 이 파일의 급소다.** `role`·`status`를 실어 보내면 다음 사람이 트리거도
   * 그것을 읽는다고 믿게 되고, 그 믿음이 권한 상승 경로를 만든다.
   */
  it('metadata에 role·status가 없다', () => {
    const data = toSignUpCredentials(VALID as never).options.data as Record<string, unknown>;

    expect(Object.keys(data).sort()).toEqual(['display_name', 'team_id']);
    expect('role' in data).toBe(false);
    expect('status' in data).toBe(false);
  });
});

/**
 * 라우트가 `signup.password`를 손으로 꺼내면 그 파일에 자격증명 필드 이름이 남는다
 * (`route.ts` 머리말의 grep 규칙). 그래서 꺼내는 일을 이 모듈이 대신 지고, 실제 대조는
 * `lib/auth/pwned-password.ts`가 한다 — 여기서는 **넘겨주는 것이 비밀번호인지**만 잰다.
 */
describe('isBreachedSignup', () => {
  it('유출 목록에 있으면 true다', async () => {
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha1').update(VALID.password, 'utf8').digest('hex').toUpperCase();
    const fetchStub = async () => new Response(`${digest.slice(5)}:42\r\n`, { status: 200 });

    await expect(isBreachedSignup(VALID as never, { fetch: fetchStub as never })).resolves.toBe(
      true
    );
  });

  it('목록에 없으면 false다', async () => {
    const fetchStub = async () => new Response('0000000000000000000000000000000000000:9', {
      status: 200,
    });

    await expect(isBreachedSignup(VALID as never, { fetch: fetchStub as never })).resolves.toBe(
      false
    );
  });
});
