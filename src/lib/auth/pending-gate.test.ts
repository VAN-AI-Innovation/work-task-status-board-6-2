/**
 * 이 파일이 재는 것은 **승인을 기다리는 계정이 어디까지 갈 수 있는가**다.
 *
 * 셋 중 하나라도 틀리면 화면에서 조용히 일어난다 — (a) 대기 계정이 대시보드를 그대로 보거나,
 * (b) `/pending`이 자기 자신으로 리다이렉트해 `ERR_TOO_MANY_REDIRECTS`가 되거나,
 * (c) 로그아웃 라우트가 막혀 그 계정이 영영 나가지 못한다. (b)가 이 step의 유일한 치명적
 * 실수 경로라 맨 앞에 둔다.
 */

import { describe, expect, it } from 'vitest';

import { gateForSession } from './pending-gate';
import type { SessionOutcome } from './viewer-session';

const PENDING: SessionOutcome = {
  status: 'pending',
  userId: 'u1',
  email: 'a@van.test',
  teamId: 'edit',
  displayName: '홍길동',
};

const REJECTED: SessionOutcome = { ...PENDING, status: 'rejected' };

const NO_PROFILE: SessionOutcome = { status: 'no_profile', userId: 'u1', email: 'a@van.test' };

/** 막히는 세 상태. 셋 다 「로그인은 됐는데 아직 아무 범위도 없다」로 같은 자리에 선다 */
const BLOCKED: readonly [string, SessionOutcome][] = [
  ['pending', PENDING],
  ['rejected', REJECTED],
  ['no_profile', NO_PROFILE],
];

describe('gateForSession — 리다이렉트 고리 방지', () => {
  it.each(BLOCKED)('%s여도 `/pending` 자신은 통과시킨다', (_label, outcome) => {
    expect(gateForSession(outcome, '/pending')).toEqual({ kind: 'allow' });
  });

  it.each(BLOCKED)('%s여도 `/pending` 아래는 통과시킨다', (_label, outcome) => {
    expect(gateForSession(outcome, '/pending/team')).toEqual({ kind: 'allow' });
  });

  /** 나갈 문이 막히면 그 계정은 로그아웃도 못 하고 갇힌다 */
  it.each(BLOCKED)('%s여도 인증 라우트는 통과시킨다', (_label, outcome) => {
    expect(gateForSession(outcome, '/api/auth/logout')).toEqual({ kind: 'allow' });
    expect(gateForSession(outcome, '/api/auth/signup')).toEqual({ kind: 'allow' });
  });
});

describe('gateForSession — 막는다', () => {
  it.each(BLOCKED)('%s는 화면에서 `/pending`으로 간다', (_label, outcome) => {
    expect(gateForSession(outcome, '/')).toEqual({ kind: 'redirect', to: '/pending' });
    expect(gateForSession(outcome, '/teams/edit')).toEqual({ kind: 'redirect', to: '/pending' });
    expect(gateForSession(outcome, '/upload')).toEqual({ kind: 'redirect', to: '/pending' });
    expect(gateForSession(outcome, '/extract')).toEqual({ kind: 'redirect', to: '/pending' });
    expect(gateForSession(outcome, '/report')).toEqual({ kind: 'redirect', to: '/pending' });
  });

  /**
   * API에 리다이렉트를 주면 `fetch`가 따라가서 **HTML을 JSON으로 파싱하려 든다** —
   * `proxy.ts`가 401에서 이미 한 판단과 같다 (`ADR-027`).
   */
  it.each(BLOCKED)('%s는 API에서 `deny`다 — 리다이렉트가 아니다', (_label, outcome) => {
    expect(gateForSession(outcome, '/api/tasks')).toEqual({ kind: 'deny' });
    expect(gateForSession(outcome, '/api/tasks/abc')).toEqual({ kind: 'deny' });
    expect(gateForSession(outcome, '/api')).toEqual({ kind: 'deny' });
  });

  /** `/api/authorize`는 `/api/auth`가 아니다 — 접두사만 보면 아무 이름이나 뚫린다 */
  it('통과 목록은 정확히 일치하거나 그 아래여야 한다', () => {
    expect(gateForSession(PENDING, '/api/authorize')).toEqual({ kind: 'deny' });
    expect(gateForSession(PENDING, '/pendings')).toEqual({ kind: 'redirect', to: '/pending' });
  });
});

describe('gateForSession — 지나가는 상태', () => {
  it('승인된 계정은 무엇이든 통과한다', () => {
    const ok: SessionOutcome = {
      status: 'ok',
      viewer: {
        userId: 'u1',
        email: 'a@van.test',
        role: 'member',
        teamId: 'edit',
        memberId: 'm-1',
      },
    };

    expect(gateForSession(ok, '/')).toEqual({ kind: 'allow' });
    expect(gateForSession(ok, '/api/tasks')).toEqual({ kind: 'allow' });
  });

  /**
   * **미인증은 여기가 아니라 앞단이 진다** (`proxy.ts` → `/login` 또는 401). 여기서 또
   * 막으면 데모 모드가 죽는다 — 거기서는 세션이 언제나 `anonymous`다 (`ADR-026`).
   */
  it('익명은 통과한다 — 데모가 죽지 않는다', () => {
    const anon: SessionOutcome = { status: 'anonymous' };

    expect(gateForSession(anon, '/')).toEqual({ kind: 'allow' });
    expect(gateForSession(anon, '/api/tasks')).toEqual({ kind: 'allow' });
  });
});
