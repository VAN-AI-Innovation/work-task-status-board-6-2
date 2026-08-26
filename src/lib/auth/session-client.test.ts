import { describe, expect, it, vi } from 'vitest';

import { createSessionClient, type CookieAdapter } from '@/lib/auth/session-client';

const emptyCookies = (): CookieAdapter => ({ getAll: () => [], setAll: () => {} });

const CREDENTIALS = { url: 'https://example.supabase.co', anonKey: 'anon-key' };

describe('createSessionClient', () => {
  it('자격증명이 둘 다 있으면 클라이언트를 만든다', () => {
    const client = createSessionClient(emptyCookies(), CREDENTIALS);
    expect(client).not.toBeNull();
    expect(client?.auth).toBeDefined();
    expect(typeof client?.from).toBe('function');
  });

  it.each([
    ['url이 없으면', { anonKey: 'anon-key' }],
    ['anonKey가 없으면', { url: 'https://example.supabase.co' }],
    ['둘 다 없으면', {}],
    ['url이 빈 문자열이면', { url: '', anonKey: 'anon-key' }],
    ['anonKey가 빈 문자열이면', { url: 'https://example.supabase.co', anonKey: '' }],
  ])('%s null이다 — 데모 모드다. 던지면 키 없는 클론이 죽는다', (_label, env) => {
    expect(createSessionClient(emptyCookies(), env)).toBeNull();
  });

  it('URL 형식이 깨져 있어도 던지지 않고 null이다 (store-factory의 createClientFrom과 같은 결)', () => {
    expect(createSessionClient(emptyCookies(), { url: 'not-a-url', anonKey: 'anon-key' })).toBeNull();
  });

  it('쿠키를 읽는 것은 어댑터다 — 생성 시점에 우리가 훔쳐 읽지 않는다', () => {
    const getAll = vi.fn(() => []);
    createSessionClient({ getAll, setAll: () => {} }, CREDENTIALS);
    expect(getAll).not.toHaveBeenCalled();
  });

  it('setAll이 던져도 생성이 죽지 않는다 — 서버 컴포넌트에서는 쿠키를 쓸 수 없다', () => {
    const throwing: CookieAdapter = {
      getAll: () => [],
      setAll: () => {
        throw new Error('Cookies can only be modified in a Server Action or Route Handler');
      },
    };
    expect(() => createSessionClient(throwing, CREDENTIALS)).not.toThrow();
  });
});
