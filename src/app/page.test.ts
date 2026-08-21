/**
 * 빈 상태는 **`STORAGE_DRIVER=memory`에서는 볼 수 없다** — 시드가 들어 있기 때문이다.
 * 실제로 빈 상태가 뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때이므로, 그 상황을
 * 시드 없는 메모리 핸들로 재현한다 (`X3`「데이터 없음」).
 *
 * DOM 없이 **서버 컴포넌트가 돌려준 엘리먼트 트리**를 훑는다. jsdom을 새로 들이지 않으려는
 * 것이고, 이 화면이 지는 판단(0건이냐 아니냐 · 읽기 전용이냐)은 트리 모양으로 전부 보인다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { buildSeedPayload } from '@/lib/upload/seed-loader';

let handle: StorageHandle;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

const Home = (await import('./page')).default;

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

/** 컴포넌트 이름으로 엘리먼트를 찾는다 — 자식 컴포넌트는 렌더되지 않고 트리에 그대로 남는다 */
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

function emptyHandle(overrides: Partial<StorageHandle> = {}): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'live',
    readOnly: false,
    ...overrides,
  };
}

beforeEach(() => {
  handle = emptyHandle();
});

describe('/ — 빈 상태와 최소 화면 (X3)', () => {
  it('0건이면 빈 상태와 두 진입점이 뜬다', async () => {
    const tree = await Home();
    const text = textOf(tree);

    expect(text).toContain('아직 데이터가 없습니다');
    expect(text).toContain('시트 업로드하기');
    expect(findComponent(tree, 'SeedButton')).not.toBeNull();
  });

  it('1건 이상이면 건수를 보여 주고 빈 상태 문구가 사라진다', async () => {
    const payload = buildSeedPayload();
    await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });

    const tree = await Home();
    const text = textOf(tree);

    expect(text).not.toContain('아직 데이터가 없습니다');
    expect(text).toContain(String(payload.tasks.length));
    expect(findComponent(tree, 'SeedButton')).toBeNull();
  });

  it('읽기 전용이면 샘플 버튼이 비활성이다 — 다만 방어는 서버가 한다', async () => {
    handle = emptyHandle({ mode: 'fallback', readOnly: true });

    const button = findComponent(await Home(), 'SeedButton');
    expect(button?.props?.disabled).toBe(true);
  });

  it('폴백과 데모의 배너를 섞지 않는다 — 모드를 그대로 넘긴다', async () => {
    handle = emptyHandle({ mode: 'fallback', readOnly: true });
    expect(findComponent(await Home(), 'StorageBanner')?.props?.mode).toBe('fallback');

    handle = emptyHandle({ mode: 'demo' });
    expect(findComponent(await Home(), 'StorageBanner')?.props?.mode).toBe('demo');
  });

  it('대시보드를 만들지 않았다 — 화면에 KPI·차트가 없다', async () => {
    const payload = buildSeedPayload();
    await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });

    const text = textOf(await Home());
    expect(text).toContain('준비 중');
  });
});
