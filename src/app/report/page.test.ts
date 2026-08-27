/**
 * 주간 보고 화면이 지는 판단은 셋이다 — **어느 주를 보는가** · **본문을 어디서 받는가** ·
 * **비었을 때 무엇을 말하는가.** DOM 없이 서버 컴포넌트가 돌려준 엘리먼트 트리를 훑는다
 * (`src/app/page.test.ts`와 같은 방식이고, 그 이유도 같다).
 *
 * 여기서 재지 **않는** 것: 마크다운의 내용(`weekly-report.test.ts`) · 기간 판정
 * (`report-period.test.ts`) · 링크 규칙(`report-nav.test.ts`). 이 파일이 재는 것은
 * 페이지가 그 셋을 **제대로 이어 붙였는가**다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import type { Viewer } from '@/types/auth';

let handle: StorageHandle;
let session: SessionOutcome;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo: handle.repo, session, base: handle }),
}));

const ReportPage = (await import('./page')).default;

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

/** 트리에 남은 글자 전부. `<a href>`는 여기 없으므로 링크는 props로 따로 본다 */
function textOf(tree: unknown): string {
  const parts: string[] = [];
  const collect = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) collect(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    collect((node as Element).props?.children);
  };
  collect(tree);
  return parts.join(' ');
}

function props(searchParams: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

function emptyHandle(): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'live',
    readOnly: false,
  };
}

async function seed(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });
}

beforeEach(() => {
  handle = emptyHandle();
  session = { status: 'anonymous' };
});

describe('/report', () => {
  it('보고 본문을 마크다운 문자열 그대로 넘긴다 — 렌더하지 않는다', async () => {
    await seed();

    const doc = findComponent(await ReportPage(props()), 'ReportDocument');
    expect(doc).not.toBeNull();
    expect(typeof doc?.props?.markdown).toBe('string');
    // 제목 한 줄이 마크다운 원문 그대로여야 한다. HTML로 바뀌면 `#`이 사라진다 (`S7`)
    expect(String(doc?.props?.markdown)).toContain('# 주간 업무 보고');
  });

  it('내려받을 파일 이름에 기간이 들어간다', async () => {
    await seed();

    const doc = findComponent(await ReportPage(props({ week: '2026-08-17' })), 'ReportDocument');
    expect(doc?.props?.filename).toBe('weekly-2026-08-17.md');
  });

  it('`?week=`이 가리키는 주의 보고서가 나온다', async () => {
    await seed();

    const tree = await ReportPage(props({ week: '2026-08-17' }));
    const doc = findComponent(tree, 'ReportDocument');
    expect(String(doc?.props?.markdown)).toContain('2026-08-17 ~ 2026-08-23');

    const nav = findComponent(tree, 'ReportPeriodNav');
    expect(nav?.props?.nav).toMatchObject({ rangeLabel: '2026-08-17 ~ 2026-08-23' });
  });

  it('형식이 틀린 기간은 400이 아니라 이번 주로 되돌아오고 그 사실을 알린다', async () => {
    await seed();

    const nav = findComponent(await ReportPage(props({ week: '어제' })), 'ReportPeriodNav');
    // 되돌린 것을 말하지 않으면 사용자는 요청한 주를 보고 있다고 믿는다 (결정 M)
    expect(nav?.props?.fellBack).toBe(true);
  });

  it('요청이 없으면 되돌린 것이 아니다', async () => {
    await seed();

    const nav = findComponent(await ReportPage(props()), 'ReportPeriodNav');
    expect(nav?.props?.fellBack).toBe(false);
  });

  it('업무가 0건이면 본문 대신 사유를 말한다', async () => {
    const tree = await ReportPage(props());

    expect(findComponent(tree, 'ReportDocument')).toBeNull();
    expect(findComponent(tree, 'EmptyState')?.props?.kind).toBe('no-data');
  });

  it('담당자로 이어지지 않은 부원에게는 다른 사유를 말한다', async () => {
    const viewer: Viewer = {
      userId: 'u1',
      email: 'member@example.com',
      role: 'member',
      teamId: 'edit',
      memberId: null,
    };
    session = { status: 'ok', viewer };
    await seed();

    // 「저장소가 비었다」가 아니다 — 시트를 올려도 이 사람의 화면은 달라지지 않는다
    const tree = await ReportPage(props());
    expect(findComponent(tree, 'EmptyState')?.props?.kind).toBe('unlinked-member');
  });

  it('역할로 막지 않는다 — 부원도 자기 범위의 보고서를 받는다', async () => {
    const viewer: Viewer = {
      userId: 'u1',
      email: 'member@example.com',
      role: 'member',
      teamId: 'edit',
      memberId: 'm1',
    };
    session = { status: 'ok', viewer };
    await seed();
    // 시드에는 `memberId`가 붙은 업무가 없으므로 부원의 범위는 0건이다. 그래도 **403이나
    // 리다이렉트가 아니라** 화면이 뜨고 사유를 말한다 (결정 N)
    const tree = await ReportPage(props());
    expect(findComponent(tree, 'PageShell')).not.toBeNull();
    expect(textOf(tree)).toContain('주간 보고');
  });

  it('기간 줄과 본문이 같은 화면에 함께 선다', async () => {
    await seed();

    const tree = await ReportPage(props());
    expect(findComponent(tree, 'ReportPeriodNav')).not.toBeNull();
    expect(findComponent(tree, 'ReportDocument')).not.toBeNull();
  });
});
