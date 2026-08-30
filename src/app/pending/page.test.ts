/**
 * 이 화면이 지는 판단은 셋이다 — **승인된 사람을 여기 붙잡아 두지 않는가** ·
 * **세 상태가 각각 다른 말을 하는가** · **재요청 폼이 반려된 사람에게만 있는가.**
 *
 * DOM 없이 서버 컴포넌트가 돌려준 엘리먼트 트리를 훑는다 (`src/app/report/page.test.ts`와
 * 같은 방식이고, 그 이유도 같다).
 *
 * 여기서 재지 **않는** 것: 어느 경로가 여기로 오는가(`pending-gate.test.ts`) ·
 * 재요청이 DB에 무엇을 넘기는가(`api/auth/rejoin/route.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { Viewer } from '@/types/auth';

let session: SessionOutcome;

const handle: StorageHandle = {
  repo: createMemoryTaskStore(),
  uploads: createMemoryUploadStore(),
  driver: 'memory',
  mode: 'live',
  readOnly: false,
};

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo: handle.repo, session, base: handle }),
}));

const PendingPage = (await import('./page')).default;

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

function waiting(overrides: Partial<Extract<SessionOutcome, { status: 'pending' }>> = {}) {
  return {
    status: 'pending' as const,
    userId: 'user-9',
    email: 'newbie@van.test',
    teamId: 'marketing' as const,
    displayName: '새내기',
    ...overrides,
  };
}

const VIEWER: Viewer = {
  userId: 'user-1',
  email: 'admin@van.test',
  role: 'admin',
  teamId: null,
  memberId: null,
  memberName: null,
};

beforeEach(() => {
  session = waiting();
});

describe('/pending — 나가는 문', () => {
  /*
   * 예전에는 승인된 사람을 `/`로 튕겼다. **지금은 붙잡아 「승인 완료」를 한 번 보여 준다** —
   * 대기 화면을 열어 두고 기다리던 사람에게 「됐다」를 말해 주는 자리가 없으면, 새로고침했더니
   * 갑자기 현황판이 떠 있는 것으로 끝난다. 나가는 문은 리다이렉트가 아니라 **버튼**이다.
   */
  it('승인된 사람에게는 「승인 완료」와 나갈 버튼을 보여 준다 — 튕기지 않는다', async () => {
    // 방금 승인된 사람은 팀이 있다. `VIEWER`(팀 없는 대표·실장)로는 그 갈래를 못 잰다
    session = {
      status: 'ok',
      viewer: { ...VIEWER, role: 'member', teamId: 'marketing', email: 'newbie@van.test' },
    };

    const tree = await PendingPage(props());
    const notice = findComponent(tree, 'ApprovedNotice');

    expect(notice).not.toBeNull();
    // 팀 이름은 `Viewer` 안에 있다 — 대기 갈래와 모양이 달라서 페이지가 한 번 고른다
    expect(notice?.props).toMatchObject({
      teamName: '마케팅·관리팀',
      email: 'newbie@van.test',
    });
    // 승인된 사람에게 대기·반려 문구를 함께 보여 주지 않는다
    expect(findComponent(tree, 'PendingNotice')).toBeNull();
    expect(findComponent(tree, 'RejectedNotice')).toBeNull();
  });

  it('미인증이면 로그인으로 보낸다 — 백지를 두지 않는다', async () => {
    session = { status: 'anonymous' };

    // `?next=`를 싣는다 — 로그인한 뒤 여기로 돌아와야 무엇을 기다리는지 알 수 있다
    await expect(PendingPage(props())).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/login?next=%2Fpending;307;',
    });
  });
});

describe('/pending — 세 갈래', () => {
  it('대기 중이면 어느 팀에 요청했는지 이름으로 말한다', async () => {
    const notice = findComponent(await PendingPage(props()), 'PendingNotice');

    expect(notice?.props).toMatchObject({
      // 팀 이름은 `teamLabel()`에서만 온다 — 화면이 다시 적지 않는다
      teamName: '마케팅·관리팀',
      displayName: '새내기',
      email: 'newbie@van.test',
    });
  });

  it('팀을 모르면 이름 없이 그린다 — 화면이 지어내지 않는다', async () => {
    session = waiting({ teamId: null, displayName: null });

    const notice = findComponent(await PendingPage(props()), 'PendingNotice');
    expect(notice?.props).toMatchObject({ teamName: null, displayName: null });
  });

  it('대기 중에는 재요청 폼을 주지 않는다 — `request_join`이 거절하는 상태다', async () => {
    const tree = await PendingPage(props());

    expect(findComponent(tree, 'RejectedNotice')).toBeNull();
    expect(findComponent(tree, 'MissingProfileNotice')).toBeNull();
  });

  it('반려된 사람에게만 재요청 폼이 있다', async () => {
    session = { ...waiting(), status: 'rejected' };

    const tree = await PendingPage(props());
    expect(findComponent(tree, 'RejectedNotice')).not.toBeNull();
    expect(findComponent(tree, 'PendingNotice')).toBeNull();
  });

  it('재요청 실패는 반려 화면에서 알린다', async () => {
    session = { ...waiting(), status: 'rejected' };

    const notice = findComponent(await PendingPage(props({ error: 'invalid' })), 'RejectedNotice');
    expect(notice?.props?.error).toBe('invalid');
  });

  it('프로필이 없는 계정에도 할 말이 있다 — 재요청 폼은 없다', async () => {
    session = { status: 'no_profile', userId: 'user-9', email: 'ghost@van.test' };

    const tree = await PendingPage(props());
    expect(findComponent(tree, 'MissingProfileNotice')?.props?.email).toBe('ghost@van.test');
    expect(findComponent(tree, 'RejectedNotice')).toBeNull();
  });
});
