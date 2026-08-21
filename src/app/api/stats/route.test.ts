/**
 * KPI 10종은 시트 `00_통합 대시보드` 5행과 1:1이다 (`UC-07`). **개수와 순서가 계약**이고
 * 화면이 `grid-cols-5` 2행으로 그린다 — 여기서 개수를 지키지 않으면 그 격자가 깨진다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import { resetStorage } from '@/lib/store/store-factory';

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
