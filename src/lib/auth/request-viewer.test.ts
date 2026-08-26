/**
 * 이 파일이 재는 것은 **연결**이다 — 쿠키·자격증명·저장소를 이어 `ViewerContext` 하나를 낸다.
 * 갈래별 판정은 아래 계층이 이미 지고 있으므로(`viewer-storage.test.ts`·`viewer-session.test.ts`)
 * 여기서는 「이었나」와 「끊겨도 죽지 않나」만 본다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle, StorageMode } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';

let handle: StorageHandle;
/** `cookies()`가 던지는 갈래를 재현한다 — 요청 스코프 밖에서는 Next가 던진다 */
let cookiesThrows = false;
let cookieReads = 0;

vi.mock('next/headers', () => ({
  cookies: async () => {
    if (cookiesThrows) throw new Error('cookies outside request scope');
    cookieReads += 1;
    return {
      getAll: () => [{ name: 'sb-access-token', value: 'x' }],
      set: () => undefined,
    };
  },
}));

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

const { currentViewerContext } = await import('./request-viewer');

function makeHandle(mode: StorageMode): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: mode === 'live' ? 'supabase' : 'memory',
    mode,
    readOnly: mode === 'fallback',
  };
}

const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  handle = makeHandle('demo');
  cookiesThrows = false;
  cookieReads = 0;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
  if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_KEY;
});

describe('currentViewerContext', () => {
  it('자격증명이 없으면 익명이고 조회는 base 저장소로 한다 — 데모가 죽지 않는다', async () => {
    const view = await currentViewerContext();

    expect(view.session).toEqual({ status: 'anonymous' });
    expect(view.repo).toBe(handle.repo);
    expect(view.base).toBe(handle);
  });

  it('cookies()가 던져도 던지지 않는다 — 요청 스코프 밖에서도 화면이 백지가 되지 않는다', async () => {
    cookiesThrows = true;
    handle = makeHandle('live');

    const view = await currentViewerContext();

    expect(view.session).toEqual({ status: 'anonymous' });
    expect(view.repo).toBe(handle.repo);
  });

  it('데모에서는 자격증명이 있어도 세션을 보지 않는다 (결정 E)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const view = await currentViewerContext();

    expect(view.session).toEqual({ status: 'anonymous' });
    expect(view.repo).toBe(handle.repo);
    // 쿠키는 읽으러 갔다 — 모드 판단이 세션 클라이언트 생성 뒤에 오는 것이 아니라,
    // 세션을 **쓸지**를 `resolveViewerContext`가 정한다
    expect(cookieReads).toBe(1);
  });
});
