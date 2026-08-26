/**
 * 이 파일이 재는 것은 **어떤 본문이 자격증명으로 통과하는가**다. 통과 조건이 느슨하면
 * 빈 비밀번호가 Auth 서버까지 왕복하고, 던지면 폼이 아닌 본문 하나가 500이 된다.
 */

import { describe, expect, it } from 'vitest';

import { credentialsSchema, readCredentials } from './credentials-schema';

function formRequest(body: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

describe('credentialsSchema', () => {
  it('이메일 형식과 1자 이상 비밀번호를 통과시킨다', () => {
    expect(credentialsSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(
      true
    );
  });

  it('이메일 형식이 아니면 거부한다', () => {
    expect(credentialsSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(
      false
    );
    expect(credentialsSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
  });

  it('비밀번호가 비면 거부한다 — 빈 값으로 Auth 서버에 왕복할 이유가 없다', () => {
    expect(credentialsSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(
      false
    );
  });

  it('키가 빠지면 거부한다', () => {
    expect(credentialsSchema.safeParse({ email: 'a@example.com' }).success).toBe(false);
    expect(credentialsSchema.safeParse({ password: 'x' }).success).toBe(false);
    expect(credentialsSchema.safeParse({}).success).toBe(false);
  });
});

describe('readCredentials', () => {
  it('폼 본문을 읽어 돌려준다', async () => {
    await expect(
      readCredentials(formRequest({ email: 'a@example.com', password: 'pw' }))
    ).resolves.toEqual({ email: 'a@example.com', password: 'pw' });
  });

  it('모르는 필드는 버리고 둘만 남긴다', async () => {
    await expect(
      readCredentials(formRequest({ email: 'a@example.com', password: 'pw', role: 'admin' }))
    ).resolves.toEqual({ email: 'a@example.com', password: 'pw' });
  });

  it('검증에 걸리면 null이다', async () => {
    await expect(readCredentials(formRequest({ email: 'x', password: 'pw' }))).resolves.toBeNull();
  });

  /** 던지면 폼이 아닌 본문 하나가 500이 된다. 그것도 잘못된 입력일 뿐이다 */
  it('폼이 아닌 본문에도 던지지 않고 null이다', async () => {
    const json = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":"a@example.com"}',
    });

    await expect(readCredentials(json)).resolves.toBeNull();
  });
});
