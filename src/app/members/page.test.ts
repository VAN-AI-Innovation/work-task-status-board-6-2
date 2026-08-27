/**
 * 이 화면이 지는 판단은 넷이다 — **팀장·부원에게 없는 것처럼 보이는가** · **대기 계정이
 * 여기 들어오지 못하는가** · **트리를 순수 함수에서 받아 오는가**(화면이 다시 묶지 않는다) ·
 * **읽지 못한 것을 빈 트리로 접지 않는가.**
 *
 * DOM 없이 서버 컴포넌트가 돌려준 엘리먼트 트리를 훑는다 (`src/app/team/requests/page.test.ts`와
 * 같은 방식이고 이유도 같다).
 *
 * 여기서 재지 **않는** 것: 역할 판정 자체(`member-admin.test.ts`) · 트리 구성 규칙
 * (`member-tree.test.ts`) · 승격이 DB에 무엇을 넘기는가(`api/members/role/route.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMemberTree } from '@/lib/domain/member-tree';
import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { Viewer } from '@/types/auth';

let session: SessionOutcome;
/** `member_directory()`가 돌려줄 것. `null`이면 rpc가 실패한 갈래다 */
let rpcRows: unknown[] | null;
let rpcCalls: string[];

const handle: StorageHandle = {
  repo: createMemoryTaskStore(),
  uploads: createMemoryUploadStore(),
  driver: 'supabase',
  mode: 'live',
  readOnly: false,
};

const repo = { ...handle.repo, getLastSyncedAt: async () => null };

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo, session, base: handle }),
  currentSessionClient: async () => ({
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return rpcRows === null
        ? { data: null, error: { message: 'boom' } }
        : { data: rpcRows, error: null };
    },
  }),
}));

const MembersPage = (await import('./page')).default;

interface Element {
  type?: unknown;
  props?: { children?: unknown; [key: string]: unknown };
}

function walk(node: unknown, visit: (element: Element) => void): void {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object') return;

  const element = node as Element;
  visit(element);
  walk(element.props?.children, visit);
}

function findComponent(tree: unknown, name: string): Element | null {
  let found: Element | null = null;
  walk(tree, (element) => {
    if (found !== null) return;
    if (typeof element.type === 'function' && (element.type as { name?: string }).name === name) {
      found = element;
    }
  });
  return found;
}

function props(searchParams: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

function viewer(role: Viewer['role'], teamId: Viewer['teamId'] = null): SessionOutcome {
  return {
    status: 'ok',
    viewer: { userId: 'user-1', email: `${role}@van.test`, role, teamId, memberId: null },
  };
}

const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';

const ROWS = [
  {
    user_id: LEAD_ID,
    member_id: null,
    display_name: '김편집',
    member_name: null,
    email: 'lead@van.test',
    role: 'lead',
    status: 'active',
    team_id: 'edit',
  },
  {
    user_id: MEMBER_ID,
    member_id: null,
    display_name: '박신입',
    member_name: null,
    email: 'newbie@van.test',
    role: 'member',
    status: 'pending',
    team_id: 'edit',
  },
];

beforeEach(() => {
  session = viewer('admin');
  rpcRows = ROWS;
  rpcCalls = [];
});

describe('/members — 누가 여는가', () => {
  it('부원에게는 없는 것처럼 보인다 — 403이 아니라 404다', async () => {
    session = viewer('member');

    await expect(MembersPage(props())).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('팀장에게도 없는 것처럼 보인다 — 「팀원 요청」과 다르다', async () => {
    session = viewer('lead', 'edit');

    await expect(MembersPage(props())).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('404를 내기 전에는 명부를 부르지도 않는다', async () => {
    session = viewer('lead', 'edit');

    await expect(MembersPage(props())).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });

  it('로그인한 부원은 `?as=admin`으로도 못 연다 — 세션이 이긴다', async () => {
    session = viewer('member');

    await expect(MembersPage(props({ as: 'admin' }))).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('승인을 기다리는 계정은 `/pending`으로 간다', async () => {
    session = {
      status: 'pending',
      userId: 'user-9',
      email: 'newbie@van.test',
      teamId: 'edit',
      displayName: '새내기',
    };

    await expect(MembersPage(props())).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/pending;307;',
    });
  });
});

describe('/members — 트리', () => {
  it('화면이 다시 묶지 않는다 — 순수 함수가 낸 것과 같다', async () => {
    const view = findComponent(await MembersPage(props()), 'MemberTreeView');

    expect(view?.props?.tree).toEqual(
      buildMemberTree([
        {
          userId: LEAD_ID,
          memberId: null,
          displayName: '김편집',
          memberName: null,
          email: 'lead@van.test',
          role: 'lead',
          status: 'active',
          teamId: 'edit',
        },
        {
          userId: MEMBER_ID,
          memberId: null,
          displayName: '박신입',
          memberName: null,
          email: 'newbie@van.test',
          role: 'member',
          status: 'pending',
          teamId: 'edit',
        },
      ])
    );
  });

  it('명부가 비어도 팀 가지는 남는다 — 에러가 아니다', async () => {
    rpcRows = [];

    const view = findComponent(await MembersPage(props()), 'MemberTreeView');

    // 「그 팀이 없다」와 「그 팀에 사람이 없다」가 같아 보이면 안 된다 (`member-tree.ts`)
    expect(view?.props?.tree).toEqual({
      teams: [
        { teamId: 'edit', leads: [], members: [] },
        { teamId: 'shoot', leads: [], members: [] },
        { teamId: 'marketing', leads: [], members: [] },
      ],
      unassigned: [],
    });
  });

  it('읽지 못한 것은 빈 트리로 접지 않는다 — `error.tsx`로 올린다', async () => {
    rpcRows = null;

    await expect(MembersPage(props())).rejects.toThrow();
  });
});
