/**
 * 과제 요구 4번(부서별 목표와 실제 성과 비교)의 데이터면 (`UC-10`).
 *
 * 여기서 지키는 것 둘 — **팀별로 접힌 요약이 나온다**와 **성과 행의 `extras`도 마스킹을
 * 거친다**(`S6`)이다. 뒤엣것이 이 라우트에서 놓치기 쉬운 지점이다: 「업무가 아니라 지표니까
 * 개인정보가 없겠지」가 근거 없는 가정이고, 실제로 B섹션에는 문의자 계정·담당자가 섞여 있다.
 *
 * 시드의 목표 지표에는 민감 키가 없어서 **테스트가 저장소에 하나 넣고** 확인한다.
 * 없는 데이터를 두고 "다를 것"이라고 단정하면 그것은 검증이 아니다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getStorage, resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

const CONTACT_KEY = '문의자 계정';
const CONTACT_VALUE = '@anon-handle';

interface GoalsBody {
  items: {
    metric: { teamId: string; extras: Record<string, unknown> };
    computedRate: number | null;
    rateMismatch: boolean;
  }[];
  byTeam: { teamKey: string; metricCount: number; avgAchievement: number | null }[];
  warnings: { code: string; sheet: string }[];
  meta: { role: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/goals${query}`));
}

async function body(query = ''): Promise<GoalsBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as GoalsBody;
}

/** 시드 지표 하나에 민감 키를 얹어 다시 넣는다. 저장소는 마스킹을 모른다 — 그게 설계다 */
async function seedSensitiveMetric(): Promise<void> {
  const storage = await getStorage();
  const [first] = await storage.repo.listGoalMetrics();
  expect(first).toBeDefined();

  // `id`는 저장소가 (팀·기간·과제명)으로 다시 찾으므로 입력에서 뗀다
  const { id, ...rest } = first;
  expect(id).toBeTruthy();
  await storage.repo.upsertGoalMetrics(
    [{ ...rest, extras: { ...rest.extras, [CONTACT_KEY]: CONTACT_VALUE } }],
    { occurredAt: '2026-08-21T00:00:00.000Z' }
  );
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

describe('GET /api/goals', () => {
  it('지표와 팀별 요약이 함께 나온다', async () => {
    const parsed = await body();

    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.byTeam.length).toBeGreaterThan(0);
    expect(parsed.byTeam.every((team) => typeof team.metricCount === 'number')).toBe(true);
  });

  it('byTeam이 팀별로 나뉘고 지표가 있는 팀이 들어 있다', async () => {
    const parsed = await body();
    const teamKeys = parsed.byTeam.map((team) => team.teamKey);

    expect(new Set(teamKeys).size).toBe(teamKeys.length);
    expect(teamKeys).toContain('marketing');
  });

  it('달성률은 시트 값이 아니라 재계산 값이 함께 실린다 (요구 4번)', async () => {
    const parsed = await body();

    expect(parsed.items.every((item) => 'computedRate' in item && 'rateMismatch' in item)).toBe(true);
  });

  it('items[].metric.extras가 역할에 따라 다르다 (S6)', async () => {
    await seedSensitiveMetric();

    const asMember = await body();
    const asAdmin = await body('?as=admin');

    const memberItem = asMember.items.find((item) => CONTACT_KEY in item.metric.extras);
    const adminItem = asAdmin.items.find((item) => CONTACT_KEY in item.metric.extras);

    expect(memberItem?.metric.extras[CONTACT_KEY]).toBeNull();
    expect(adminItem?.metric.extras[CONTACT_KEY]).toBe(CONTACT_VALUE);
  });

  it('member 응답을 직렬화해도 민감 값이 문자열에 없다', async () => {
    await seedSensitiveMetric();

    expect(JSON.stringify(await body())).not.toContain(CONTACT_VALUE);
  });

  it('경고는 좌표와 사유만 담는다 — 목표 수치·과제명을 담지 않는다', async () => {
    const parsed = await body();

    for (const warning of parsed.warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'row', 'sheet']);
    }
  });

  it('본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get()).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});
