import { describe, expect, it } from 'vitest';

import { resolveViewerRole } from '@/lib/api/viewer-role';
import type { SessionOutcome } from '@/lib/auth/viewer-session';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import type { StorageMode } from '@/lib/store/store-factory';

const dev = (mode: StorageMode = 'demo') => ({ nodeEnv: 'development', mode });
const prod = (mode: StorageMode) => ({ nodeEnv: 'production', mode });

/** 로그인하지 않은 상태. 기존 케이스는 전부 이 갈래를 지난다 */
const ANON: SessionOutcome = { status: 'anonymous' };

/** 로그인은 됐는데 `profiles` 행이 없다 — 역할을 알 수 없으므로 세션이 이기지 않는다 */
const NO_PROFILE: SessionOutcome = { status: 'no_profile', userId: 'u1', email: 'u1@example.com' };

const session = (role: ViewerRole): SessionOutcome => ({
  status: 'ok',
  viewer: { userId: 'u1', email: 'u1@example.com', role, teamId: 'edit', memberId: 'm1' },
});

describe('resolveViewerRole', () => {
  it('?as=가 없으면 가장 좁은 member다 — 기본값이 넓으면 연락처가 기본 노출된다 (S6)', () => {
    expect(resolveViewerRole(null, dev(), ANON)).toBe('member');
  });

  it.each(['admin', 'lead', 'member'] as const)('알려진 값 %s은 그대로 쓴다', (as) => {
    expect(resolveViewerRole(as, dev(), ANON)).toBe(as);
  });

  it.each(['ADMIN', 'owner', '', ' admin', 'admin,lead'])(
    '알 수 없는 값 %s은 member로 떨어진다',
    (as) => {
      expect(resolveViewerRole(as, dev(), ANON)).toBe('member');
    }
  );

  it('프로덕션 + Supabase(live)에서는 ?as=admin을 무시한다 — 이 파일의 존재 이유다 (S4)', () => {
    expect(resolveViewerRole('admin', prod('live'), ANON)).toBe('member');
    expect(resolveViewerRole('lead', prod('live'), ANON)).toBe('member');
  });

  it('프로덕션 + 폴백(fallback)도 memory지만 의도된 데모가 아니라 사고이므로 무시한다', () => {
    expect(resolveViewerRole('admin', prod('fallback'), ANON)).toBe('member');
  });

  it('프로덕션 + 의도된 데모(demo)에서는 ?as=가 살아 있다 — 심사 시연 경로다 (ADR-013)', () => {
    expect(resolveViewerRole('admin', prod('demo'), ANON)).toBe('admin');
  });

  it('개발 환경에서는 live여도 ?as=가 동작한다', () => {
    expect(resolveViewerRole('admin', dev('live'), ANON)).toBe('admin');
  });

  it('nodeEnv가 undefined면 프로덕션이 아니다', () => {
    expect(resolveViewerRole('admin', { nodeEnv: undefined, mode: 'live' }, ANON)).toBe('admin');
  });

  /*
   * 아래 넷이 T8에서 늘어난 규칙이다 (`ADR-026`·결정 E). **세션이 있는데 URL이 이기는 경우는
   * 없다** — 첫 케이스가 이 규칙의 존재 이유이고, 기존 규칙만 있으면 admin이 나온다.
   */
  it('개발 + live + 세션 member면 ?as=admin이 무시된다 — 이 규칙의 존재 이유다', () => {
    expect(resolveViewerRole('admin', dev('live'), session('member'))).toBe('member');
  });

  it('개발 + 데모 + 세션 member여도 세션이 이긴다 — 로그인했으면 URL이 지지 않는다', () => {
    expect(resolveViewerRole('admin', dev('demo'), session('member'))).toBe('member');
  });

  it('프로덕션 + live + 세션 admin이면 admin이다 — 세션은 프로덕션에서도 진다', () => {
    expect(resolveViewerRole(null, prod('live'), session('admin'))).toBe('admin');
    expect(resolveViewerRole('member', prod('live'), session('admin'))).toBe('admin');
  });

  it('프로필 없는 계정은 세션으로 치지 않는다 — 프로덕션+live에서 ?as=로 승격되지 않는다', () => {
    expect(resolveViewerRole('admin', prod('live'), NO_PROFILE)).toBe('member');
    // 데모에서는 기존 규칙 그대로 `?as=`가 산다
    expect(resolveViewerRole('admin', dev('demo'), NO_PROFILE)).toBe('admin');
  });
});
