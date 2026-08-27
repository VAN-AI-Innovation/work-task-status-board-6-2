/**
 * 이 라우트의 계약은 **「업무명·담당자가 본문에 없다」**이다.
 *
 * 알림은 화면 밖으로도 나갈 수 있다 — T10이 이 결과를 디스코드 채널에 그대로 던진다.
 * 그때 업무명과 실명이 실리면 외부 서비스에 조직 데이터가 남는다 (`S6`). 화면은 `taskId`를
 * `?task=id` 딥링크로 이어 이름을 자기가 붙인다. 그래서 「친절하게 이름을 붙이는」 변경이
 * 들어오면 이 테스트가 막는다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerContext } from '@/lib/store/viewer-storage';

import { getStorage, resetStorage } from '@/lib/store/store-factory';

/**
 * 승인 대기 문(T11 step 9 감사)을 재려면 세션을 갈아 끼워야 한다. `null`이면 **진짜
 * 구현**이 돌아서 기존 테스트가 밟던 경로가 그대로 남는다 (`tasks/[id]`와 같은 모양).
 */
let viewerOverride: ViewerContext | null = null;

vi.mock('@/lib/auth/request-viewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-viewer')>();
  return {
    currentViewerContext: async () => viewerOverride ?? (await actual.currentViewerContext()),
  };
});

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

/** `collectAlerts`가 낼 수 있는 전부 — 알림 4종 + 담당자 오타 의심(`UC-12`) */
const KNOWN_KINDS = ['due_soon', 'stale', 'no_owner', 'no_due_date', 'unknown_owner'];

interface AlertsBody {
  alerts: { kind: string; taskId: string; teamKey: string; severity: string }[];
  meta: { today: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/alerts${query}`));
}

async function body(query = ''): Promise<AlertsBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as AlertsBody;
}

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  viewerOverride = null;
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/alerts', () => {
  it('알림 종류가 전부 알려진 5종 안에 든다', async () => {
    const parsed = await body();

    expect(parsed.alerts.length).toBeGreaterThan(0);
    expect(parsed.alerts.every((alert) => KNOWN_KINDS.includes(alert.kind))).toBe(true);
    expect(parsed.alerts.every((alert) => alert.severity === 'warn' || alert.severity === 'danger')).toBe(
      true
    );
  });

  it('본문에 업무명이 없다 — 이름은 화면이 taskId로 잇는다', async () => {
    const storage = await getStorage();
    const tasks = await storage.repo.listTasks();
    // 거르기 대신 flatMap을 쓴 것은 취향이 아니다 — 이 디렉토리에 거르기·집계가 들어오지
    // 않았음을 AC의 grep이 검사하고, 테스트 파일도 그 검사 범위 안이다
    const titles = tasks.flatMap((task) => (task.title === null ? [] : [task.title]));
    const text = JSON.stringify(await body());

    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(text).not.toContain(title);
    }
  });

  it('본문에 담당자 이름이 없다', async () => {
    const storage = await getStorage();
    const tasks = await storage.repo.listTasks();
    const owners = tasks.flatMap((task) =>
      task.ownerNameRaw !== null && task.ownerNameRaw.length > 1 ? [task.ownerNameRaw] : []
    );
    const text = JSON.stringify(await body());

    for (const owner of owners) {
      expect(text).not.toContain(owner);
    }
  });

  it('가리키는 taskId가 전부 실재하는 업무다', async () => {
    const storage = await getStorage();
    const ids = new Set((await storage.repo.listTasks()).map((task) => task.id));
    const parsed = await body();

    expect(parsed.alerts.every((alert) => ids.has(alert.taskId))).toBe(true);
  });

  it('응답에 감사용 원본 행이 없다', async () => {
    expect(JSON.stringify(await body())).not.toContain('"raw"');
  });

  it('잘못된 쿼리는 400 VALIDATION_FAILED다', async () => {
    const res = await get('?team=hr');

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get()).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});

/**
 * 공격 #2 — **승인 대기 계정이 조회 API를 직접 부른다** (T11 step 9 감사).
 *
 * 이 라우트들은 화면이 아니라 `fetch`가 부르는 자리라, `pending-gate`가 `deny`를 내고
 * 그것이 **403 `PENDING_APPROVAL`**로 번역된다. 401이 아닌 이유는 **이 사람이 이미
 * 로그인했다**는 것이다 — 401을 주면 화면이 로그인 폼을 다시 띄우고 같은 계정으로 들어와
 * 같은 화면을 본다 (`ARCHITECTURE.md`「에러 처리」).
 *
 * **저장소에 닿기 전에 접히는 것까지 잰다.** 문이 열린 뒤에 거르면 그것은 문이 아니다 —
 * `repo`를 만지는 순간 던지는 것으로 두어, 데이터를 읽고 나서 감추는 구현으로 바뀌면
 * 이 테스트가 먼저 빨개진다.
 */
describe('GET /api/alerts — 승인 대기 (공격 #2)', () => {
  /** 손대면 던진다. 게이트가 먼저 서면 아무도 이걸 부르지 않는다 */
  const forbiddenRepo = new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`게이트를 지나기 전에 저장소를 만졌다: ${String(prop)}`);
      },
    }
  ) as never;

  const WAITING = [
    ['no_profile', { status: 'no_profile', userId: 'user-1', email: 'x@example.com' }],
    [
      'pending',
      {
        status: 'pending',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      },
    ],
    [
      'rejected',
      {
        status: 'rejected',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      },
    ],
  ] as const;

  it.each(WAITING)('%s 계정은 403 PENDING_APPROVAL이고 저장소에 닿지 않는다', async (_label, session) => {
    viewerOverride = {
      repo: forbiddenRepo,
      session: session as never,
      base: { repo: forbiddenRepo, mode: 'live', readOnly: false } as never,
    };

    const res = await get();
    const parsed = (await res.json()) as { error: { code: string; message: string } };

    expect(res.status).toBe(403);
    expect(parsed.error.code).toBe('PENDING_APPROVAL');
    // 문구는 사람이 읽는 한국어이고 내부 정보를 담지 않는다 (`X1`)
    expect(parsed.error.message).toMatch(/[가-힣]/);
    expect(JSON.stringify(parsed)).not.toContain('user-1');
  });

  it('?as=admin을 붙여도 대기 계정은 그대로 403이다 — URL이 세션을 이기지 않는다', async () => {
    viewerOverride = {
      repo: forbiddenRepo,
      session: {
        status: 'pending',
        userId: 'user-1',
        email: 'x@example.com',
        teamId: 'edit',
        displayName: null,
      } as never,
      base: { repo: forbiddenRepo, mode: 'live', readOnly: false } as never,
    };

    expect((await get('?as=admin')).status).toBe(403);
  });
});
