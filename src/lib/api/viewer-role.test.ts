import { describe, expect, it } from 'vitest';

import { resolveViewerRole } from '@/lib/api/viewer-role';
import type { StorageMode } from '@/lib/store/store-factory';

const dev = (mode: StorageMode = 'demo') => ({ nodeEnv: 'development', mode });
const prod = (mode: StorageMode) => ({ nodeEnv: 'production', mode });

describe('resolveViewerRole', () => {
  it('?as=가 없으면 가장 좁은 member다 — 기본값이 넓으면 연락처가 기본 노출된다 (S6)', () => {
    expect(resolveViewerRole(null, dev())).toBe('member');
  });

  it.each(['admin', 'lead', 'member'] as const)('알려진 값 %s은 그대로 쓴다', (as) => {
    expect(resolveViewerRole(as, dev())).toBe(as);
  });

  it.each(['ADMIN', 'owner', '', ' admin', 'admin,lead'])(
    '알 수 없는 값 %s은 member로 떨어진다',
    (as) => {
      expect(resolveViewerRole(as, dev())).toBe('member');
    }
  );

  it('프로덕션 + Supabase(live)에서는 ?as=admin을 무시한다 — 이 파일의 존재 이유다 (S4)', () => {
    expect(resolveViewerRole('admin', prod('live'))).toBe('member');
    expect(resolveViewerRole('lead', prod('live'))).toBe('member');
  });

  it('프로덕션 + 폴백(fallback)도 memory지만 의도된 데모가 아니라 사고이므로 무시한다', () => {
    expect(resolveViewerRole('admin', prod('fallback'))).toBe('member');
  });

  it('프로덕션 + 의도된 데모(demo)에서는 ?as=가 살아 있다 — 심사 시연 경로다 (ADR-013)', () => {
    expect(resolveViewerRole('admin', prod('demo'))).toBe('admin');
  });

  it('개발 환경에서는 live여도 ?as=가 동작한다', () => {
    expect(resolveViewerRole('admin', dev('live'))).toBe('admin');
  });

  it('nodeEnv가 undefined면 프로덕션이 아니다', () => {
    expect(resolveViewerRole('admin', { nodeEnv: undefined, mode: 'live' })).toBe('admin');
  });
});
