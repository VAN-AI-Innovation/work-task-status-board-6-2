/**
 * 이 화면이 지는 판단은 셋이다 — **부원에게 없는 것처럼 보이는가** ·
 * **대기 계정이 여기 들어오지 못하는가** · **행을 서버가 준 그대로 그리는가.**
 *
 * DOM 없이 서버 컴포넌트가 돌려준 엘리먼트 트리를 훑는다 (`src/app/pending/page.test.ts`와
 * 같은 방식이고 이유도 같다).
 *
 * 여기서 재지 **않는** 것: 역할 판정 자체(`join-review.test.ts`) · 후보를 좁히는 규칙
 * (`join-request-rows.test.ts`) · 승인·거절이 DB에 무엇을 넘기는가(`api/team/requests/*`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { MemberRecord } from '@/types/auth';
import type { Viewer } from '@/types/auth';

let session: SessionOutcome;
/** `pending_requests()`가 돌려줄 것. `null`이면 rpc가 실패한 갈래다 */
let rpcRows: unknown[] | null;
let members: MemberRecord[];
let rpcCalls: string[];

const handle: StorageHandle = {
  repo: createMemoryTaskStore(),
  uploads: createMemoryUploadStore(),
  driver: 'supabase',
  mode: 'live',
  readOnly: false,
};

const repo = {
  ...handle.repo,
  listMembers: async () => members,
  getLastSyncedAt: async () => null,
};

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

const TeamRequestsPage = (await import('./page')).default;

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

/** `user_id`는 실제 `auth.users.id`라 **UUID다** — 응답 스키마가 그것을 강제한다 */
const REQUESTER_ID = '3f1b2c4d-5e6a-4b7c-8d9e-0a1b2c3d4e5f';

const ROW = {
  user_id: REQUESTER_ID,
  display_name: '새내기',
  email: 'newbie@van.test',
  team_id: 'edit',
  status: 'pending',
  created_at: '2026-08-25T15:10:00Z',
};

beforeEach(() => {
  session = viewer('admin');
  rpcRows = [ROW];
  members = [];
  rpcCalls = [];
});

describe('/team/requests — 누가 여는가', () => {
  it('부원에게는 없는 것처럼 보인다 — 403이 아니라 404다', async () => {
    session = viewer('member');

    // 403 화면은 「팀장 전용 기능이 존재한다」를 알려 준다 (`page.tsx` 머리말)
    await expect(TeamRequestsPage(props())).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  it('404를 내기 전에는 목록을 부르지도 않는다', async () => {
    session = viewer('member');

    await expect(TeamRequestsPage(props())).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });

  it('팀장은 연다', async () => {
    session = viewer('lead', 'edit');

    expect(findComponent(await TeamRequestsPage(props()), 'JoinRequestList')).not.toBeNull();
  });

  it('로그인한 부원은 `?as=admin`으로도 못 연다 — 세션이 이긴다', async () => {
    session = viewer('member');

    await expect(TeamRequestsPage(props({ as: 'admin' }))).rejects.toMatchObject({
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

    await expect(TeamRequestsPage(props())).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/pending;307;',
    });
  });
});

describe('/team/requests — 목록', () => {
  it('행을 그대로 그린다 — 화면이 거르지 않는다', async () => {
    members = [{ id: 'm-1', teamId: 'edit', name: '편집1', authUserId: null }];

    const list = findComponent(await TeamRequestsPage(props()), 'JoinRequestList');

    expect(list?.props?.rows).toEqual([
      {
        userId: REQUESTER_ID,
        displayName: '새내기',
        email: 'newbie@van.test',
        teamName: '편집팀',
        status: 'pending',
        requestedOn: '2026-08-26',
        candidates: [{ id: 'm-1', name: '편집1' }],
      },
    ]);
  });

  it('요청이 없으면 빈 목록을 넘긴다 — 에러가 아니다', async () => {
    rpcRows = [];

    const list = findComponent(await TeamRequestsPage(props()), 'JoinRequestList');
    expect(list?.props?.rows).toEqual([]);
  });

  it('읽지 못한 것은 빈 목록으로 접지 않는다 — `error.tsx`로 올린다', async () => {
    rpcRows = null;

    // 「요청이 없다」와 「읽지 못했다」가 화면에서 같아 보이면 안 된다 (`X3`)
    await expect(TeamRequestsPage(props())).rejects.toThrow();
  });
});
