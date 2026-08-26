import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { resolveSession } from '@/lib/auth/viewer-session';

interface ProfileRow {
  role: unknown;
  team_id: unknown;
}

interface FakeSpec {
  /** `auth.getUser()`가 돌려줄 것 */
  user?: { id: string; email?: string } | null;
  userError?: string;
  userThrows?: boolean;
  profile?: ProfileRow | null;
  profileError?: string;
  member?: { id: string } | null;
  memberError?: string;
}

/** 부른 쿼리를 기록한다 — 「무엇을 읽었나」가 이 파일에서 재는 것 중 하나다 */
interface FakeCalls {
  tables: string[];
  memberOrder: string[];
  memberLimit: number[];
  getSession: ReturnType<typeof vi.fn>;
}

/**
 * 손으로 지은 가짜 클라이언트. `vi.mock`으로 `@supabase/ssr`을 통째로 갈아끼우지 않는 이유는
 * 그러면 우리 코드가 아니라 mock을 재게 되기 때문이다.
 */
function fakeClient(spec: FakeSpec): { client: SupabaseClient; calls: FakeCalls } {
  const calls: FakeCalls = {
    tables: [],
    memberOrder: [],
    memberLimit: [],
    getSession: vi.fn(() => {
      throw new Error('getSession은 서명을 확인하지 않는다. 불려서는 안 된다');
    }),
  };

  const builder = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: (column: string) => {
        calls.memberOrder.push(column);
        return chain;
      },
      limit: (n: number) => {
        calls.memberLimit.push(n);
        return chain;
      },
      maybeSingle: async () => {
        if (table === 'profiles') {
          return spec.profileError
            ? { data: null, error: { message: spec.profileError } }
            : { data: spec.profile ?? null, error: null };
        }
        return spec.memberError
          ? { data: null, error: { message: spec.memberError } }
          : { data: spec.member ?? null, error: null };
      },
    };
    return chain;
  };

  const client = {
    auth: {
      getUser: async () => {
        if (spec.userThrows) throw new Error('network down');
        if (spec.userError) return { data: { user: null }, error: { message: spec.userError } };
        return { data: { user: spec.user ?? null }, error: null };
      },
      getSession: calls.getSession,
    },
    from: (table: string) => {
      calls.tables.push(table);
      return builder(table);
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const LEAD = { id: 'u-1', email: 'lead@example.com' };

describe('resolveSession — 미인증 갈래', () => {
  it('사용자가 없으면 anonymous다', async () => {
    const { client } = fakeClient({ user: null });
    await expect(resolveSession(client)).resolves.toEqual({ status: 'anonymous' });
  });

  it('getUser가 에러를 돌려줘도 던지지 않고 anonymous다 — 만료된 토큰은 흔하다', async () => {
    const { client } = fakeClient({ userError: 'invalid JWT' });
    await expect(resolveSession(client)).resolves.toEqual({ status: 'anonymous' });
  });

  it('getUser가 던져도 anonymous로 접는다', async () => {
    const { client } = fakeClient({ userThrows: true });
    await expect(resolveSession(client)).resolves.toEqual({ status: 'anonymous' });
  });

  it('사용자가 없으면 profiles를 읽으러 가지 않는다', async () => {
    const { client, calls } = fakeClient({ user: null });
    await resolveSession(client);
    expect(calls.tables).toEqual([]);
  });
});

describe('resolveSession — getSession을 부르지 않는다 (이 파일에서 가장 중요한 단언)', () => {
  it.each([
    ['미인증', { user: null } as FakeSpec],
    ['프로필 없음', { user: LEAD, profile: null } as FakeSpec],
    ['정상', { user: LEAD, profile: { role: 'lead', team_id: 'edit' }, member: { id: 'm-1' } } as FakeSpec],
  ])('%s 갈래에서도 getSession은 불리지 않는다', async (_label, spec) => {
    const { client, calls } = fakeClient(spec);
    await resolveSession(client);
    // getSession은 쿠키의 JWT를 **디코드만** 한다. 서명을 서버에서 확인하지 않으므로
    // 쿠키를 손으로 만든 사람이 admin이 된다. 권한 판정의 출발점이라 여기서 틀리면 전부 무의미하다.
    expect(calls.getSession).not.toHaveBeenCalled();
  });
});

describe('resolveSession — 프로필 갈래', () => {
  it('profiles 행이 없으면 no_profile이다 — 미인증과 다르다 (로그아웃 버튼이 필요하다)', async () => {
    const { client } = fakeClient({ user: LEAD, profile: null });
    await expect(resolveSession(client)).resolves.toEqual({
      status: 'no_profile',
      userId: 'u-1',
      email: 'lead@example.com',
    });
  });

  it('profiles 조회가 에러여도 던지지 않고 no_profile이다', async () => {
    const { client } = fakeClient({ user: LEAD, profileError: 'permission denied' });
    await expect(resolveSession(client)).resolves.toMatchObject({ status: 'no_profile' });
  });

  it.each(['owner', '', 'ADMIN', ' admin', null, undefined, 123])(
    '알 수 없는 역할 %s은 no_profile이다 — 흘려보내면 viewer-scope의 어느 갈래에도 안 걸려 「아무것도 안 보임」이 되고 원인이 화면에서 드러나지 않는다',
    async (role) => {
      const { client } = fakeClient({ user: LEAD, profile: { role, team_id: 'edit' } });
      await expect(resolveSession(client)).resolves.toMatchObject({
        status: 'no_profile',
        userId: 'u-1',
      });
    }
  );

  it('email이 없는 계정(전화 로그인 등)은 빈 문자열이다. 던지지 않는다', async () => {
    const { client } = fakeClient({ user: { id: 'u-9' }, profile: null });
    await expect(resolveSession(client)).resolves.toEqual({
      status: 'no_profile',
      userId: 'u-9',
      email: '',
    });
  });
});

describe('resolveSession — 정상 갈래', () => {
  it('lead + edit팀 + members 1행이면 Viewer가 선다', async () => {
    const { client } = fakeClient({
      user: LEAD,
      profile: { role: 'lead', team_id: 'edit' },
      member: { id: 'm-1' },
    });
    await expect(resolveSession(client)).resolves.toEqual({
      status: 'ok',
      viewer: {
        userId: 'u-1',
        email: 'lead@example.com',
        role: 'lead',
        teamId: 'edit',
        memberId: 'm-1',
      },
    });
  });

  it.each(['admin', 'lead', 'member'] as const)('알려진 역할 %s은 그대로 선다', async (role) => {
    const { client } = fakeClient({
      user: LEAD,
      profile: { role, team_id: 'shoot' },
      member: { id: 'm-2' },
    });
    await expect(resolveSession(client)).resolves.toMatchObject({
      status: 'ok',
      viewer: { role, teamId: 'shoot' },
    });
  });

  it('members 0행이면 memberId가 null이다 — unknown_owner이고, ok이긴 하다 (결정 D)', async () => {
    const { client } = fakeClient({
      user: LEAD,
      profile: { role: 'member', team_id: 'edit' },
      member: null,
    });
    await expect(resolveSession(client)).resolves.toMatchObject({
      status: 'ok',
      viewer: { role: 'member', memberId: null },
    });
  });

  it('members 조회가 에러여도 던지지 않고 memberId가 null이다', async () => {
    const { client } = fakeClient({
      user: LEAD,
      profile: { role: 'member', team_id: 'edit' },
      memberError: 'permission denied',
    });
    await expect(resolveSession(client)).resolves.toMatchObject({
      status: 'ok',
      viewer: { memberId: null },
    });
  });

  it.each(['', 'design', 'EDIT', null, undefined])(
    'team_id가 TeamKey 셋 중 하나가 아니면(%s) teamId는 null이고 역할은 산다',
    async (teamId) => {
      const { client } = fakeClient({
        user: LEAD,
        profile: { role: 'admin', team_id: teamId },
        member: { id: 'm-3' },
      });
      await expect(resolveSession(client)).resolves.toMatchObject({
        status: 'ok',
        viewer: { role: 'admin', teamId: null },
      });
    }
  );

  it('admin이고 team_id가 null이어도 정상이다', async () => {
    const { client } = fakeClient({
      user: LEAD,
      profile: { role: 'admin', team_id: null },
      member: null,
    });
    await expect(resolveSession(client)).resolves.toMatchObject({
      status: 'ok',
      viewer: { role: 'admin', teamId: null, memberId: null },
    });
  });
});

describe('resolveSession — 무엇을 읽는가', () => {
  const okSpec: FakeSpec = {
    user: LEAD,
    profile: { role: 'lead', team_id: 'edit' },
    member: { id: 'm-1' },
  };

  it('profiles와 members 둘만 읽는다. tasks를 읽지 않는다', async () => {
    const { client, calls } = fakeClient(okSpec);
    await resolveSession(client);
    expect(calls.tables).toEqual(['profiles', 'members']);
  });

  it('members는 order(id) + limit(1)이다 — my_member_id()와 같은 결정 규칙이어야 한다', async () => {
    const { client, calls } = fakeClient(okSpec);
    await resolveSession(client);
    // 다르면 화면과 DB가 서로 다른 구성원을 「나」로 본다.
    expect(calls.memberOrder).toEqual(['id']);
    expect(calls.memberLimit).toEqual([1]);
  });

  it('프로필이 없으면 members를 읽으러 가지 않는다', async () => {
    const { client, calls } = fakeClient({ user: LEAD, profile: null });
    await resolveSession(client);
    expect(calls.tables).toEqual(['profiles']);
  });
});
