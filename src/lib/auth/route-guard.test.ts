/**
 * 이 파일이 재는 것은 **어느 경로가 로그인 없이 열려 있는가**다. `src/proxy.ts`는 이 함수를
 * 부르고 응답만 만들므로, 판정이 틀리면 (a) 로그인 화면이 로그인을 요구해 고리에 갇히거나
 * (b) 대시보드가 그냥 열린다. 둘 다 화면에서는 조용히 일어난다 — 그래서 여기서 잰다.
 */

import { describe, expect, it } from 'vitest';

import { classifyRequest, type GuardEnv } from './route-guard';

/** 실제 저장소 + 자격증명이 있는 환경. 리다이렉트가 실제로 일어나는 유일한 조건이다 */
const LIVE: GuardEnv = {
  storageDriver: 'supabase',
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
};

describe('classifyRequest — 실제 저장소', () => {
  it('보호 대상 화면은 `page`다', () => {
    expect(classifyRequest('/', LIVE)).toBe('page');
    expect(classifyRequest('/teams/edit', LIVE)).toBe('page');
    expect(classifyRequest('/upload', LIVE)).toBe('page');
    expect(classifyRequest('/extract', LIVE)).toBe('page');
  });

  it('로그인 화면은 `public`이다 — 아니면 고리에 갇힌다', () => {
    expect(classifyRequest('/login', LIVE)).toBe('public');
  });

  it('인증 라우트는 `public`이다 — 로그인하려면 먼저 불러야 한다', () => {
    expect(classifyRequest('/api/auth/login', LIVE)).toBe('public');
    expect(classifyRequest('/api/auth/logout', LIVE)).toBe('public');
  });

  /** 헬스체크가 로그인을 요구하면 감시 도구가 죽는다 */
  it('`/api/health`는 `public`이다', () => {
    expect(classifyRequest('/api/health', LIVE)).toBe('public');
  });

  it('그 밖의 API는 `api`다 — 리다이렉트가 아니라 401을 받는다', () => {
    expect(classifyRequest('/api/tasks', LIVE)).toBe('api');
    expect(classifyRequest('/api/tasks/abc', LIVE)).toBe('api');
    expect(classifyRequest('/api/stats', LIVE)).toBe('api');
    expect(classifyRequest('/api/uploads/sheet', LIVE)).toBe('api');
  });

  it('정적 자산은 `public`이다', () => {
    expect(classifyRequest('/_next/static/x.js', LIVE)).toBe('public');
    expect(classifyRequest('/_next/image', LIVE)).toBe('public');
    expect(classifyRequest('/favicon.ico', LIVE)).toBe('public');
  });

  /** `/api/healthcheck`는 `/api/health`가 아니다 — 접두사 일치로 열면 아무 이름이나 뚫린다 */
  it('공개 경로는 정확히 일치하거나 그 아래여야 한다', () => {
    expect(classifyRequest('/api/healthz', LIVE)).toBe('api');
    expect(classifyRequest('/logins', LIVE)).toBe('page');
    expect(classifyRequest('/api/authorize', LIVE)).toBe('api');
  });
});

describe('classifyRequest — 데모 모드 (결정 E)', () => {
  /**
   * `.env` 없이 클론한 심사자의 경로가 여기 걸린다 (`PRD.md` 성공 기준 1번).
   * 로그인을 요구하면 그 사람은 아무것도 못 본다.
   */
  const cases = [
    '/',
    '/login',
    '/api/auth/login',
    '/api/health',
    '/api/tasks',
    '/teams/edit',
    '/upload',
    '/extract',
    '/_next/static/x.js',
  ];

  it('`STORAGE_DRIVER=memory`면 전부 `demo-open`이다', () => {
    const env: GuardEnv = { ...LIVE, storageDriver: 'memory' };
    for (const path of cases) expect(classifyRequest(path, env)).toBe('demo-open');
  });

  it('URL이 없으면 전부 `demo-open`이다', () => {
    const env: GuardEnv = { ...LIVE, supabaseUrl: undefined };
    for (const path of cases) expect(classifyRequest(path, env)).toBe('demo-open');
  });

  it('anon 키가 없으면 전부 `demo-open`이다', () => {
    const env: GuardEnv = { ...LIVE, supabaseAnonKey: undefined };
    for (const path of cases) expect(classifyRequest(path, env)).toBe('demo-open');
  });

  it('빈 문자열도 없는 것으로 본다', () => {
    const env: GuardEnv = { ...LIVE, supabaseUrl: '', supabaseAnonKey: '' };
    expect(classifyRequest('/', env)).toBe('demo-open');
  });
});
