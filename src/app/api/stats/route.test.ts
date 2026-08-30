/**
 * KPI 10종은 시트 `00_통합 대시보드` 5행과 1:1이다 (`UC-07`). **개수와 순서가 계약**이고
 * 화면이 `grid-cols-5` 2행으로 그린다 — 여기서 개수를 지키지 않으면 그 격자가 깨진다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerContext } from '@/lib/store/viewer-storage';

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { resetStorage } from '@/lib/store/store-factory';

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

interface StatsBody {
  kpis: { key: string; label: string; value: number | null; unit: string }[];
  teams: { teamKey: string; total: number; completionRate: number | null }[];
  meta: { today: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/stats${query}`));
}

async function body(query = ''): Promise<StatsBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as StatsBody;
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

describe('GET /api/stats', () => {
  it('KPI가 10종이고 라벨·단위가 채워져 있다', async () => {
    const parsed = await body();

    expect(parsed.kpis).toHaveLength(10);
    expect(parsed.kpis.every((kpi) => kpi.label.length > 0)).toBe(true);
    expect(parsed.kpis.every((kpi) => kpi.unit === 'count' || kpi.unit === 'percent')).toBe(true);
  });

  it('팀 요약이 TEAM_KEYS 순서 그대로 나온다 — 표와 차트의 팀 순서가 여기서 정해진다', async () => {
    const parsed = await body();

    expect(parsed.teams.map((team) => team.teamKey)).toEqual([...TEAM_KEYS]);
  });

  it('필터를 걸어도 같은 모양이다 — 모수만 좁아진다', async () => {
    const all = await body();
    const editOnly = await body('?team=edit');

    expect(editOnly.kpis).toHaveLength(10);
    expect(editOnly.teams).toHaveLength(all.teams.length);
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
describe('GET /api/stats — 승인 대기 (공격 #2)', () => {
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
