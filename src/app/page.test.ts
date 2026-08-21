/**
 * 빈 상태는 **`STORAGE_DRIVER=memory`에서는 볼 수 없다** — 시드가 들어 있기 때문이다.
 * 실제로 빈 상태가 뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때이므로, 그 상황을
 * 시드 없는 메모리 핸들로 재현한다 (`X3`「데이터 없음」).
 *
 * DOM 없이 **서버 컴포넌트가 돌려준 엘리먼트 트리**를 훑는다. jsdom을 새로 들이지 않으려는
 * 것이고, 이 화면이 지는 판단(0건이냐 아니냐 · 읽기 전용이냐)은 트리 모양으로 전부 보인다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildKpiStrip, type KpiTile, type TeamSummary } from '@/lib/domain/progress-stats';
import { kstToday } from '@/lib/domain/kst-today';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import { buildCompletionBars, type ChartSeries } from '@/lib/view/chart-series';

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

/** Next 16에서 `searchParams`는 Promise다. 테스트도 진짜 모양으로 넘긴다 */
function props(searchParams: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
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

async function seed(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });
}

beforeEach(() => {
  handle = emptyHandle();
});

describe('/ — 빈 상태와 최소 화면 (X3)', () => {
  it('0건이면 빈 상태와 두 진입점이 뜬다', async () => {
    const tree = await Home(props());
    const text = textOf(tree);

    expect(text).toContain('아직 데이터가 없습니다');
    expect(text).toContain('시트 업로드하기');
    expect(findComponent(tree, 'SeedButton')).not.toBeNull();
  });

  // 건수는 이제 자식 컴포넌트 **안쪽**에 있고 이 순회 헬퍼는 거기까지 렌더하지 않는다.
  // 그래서 화면 글자가 아니라 **표에 넘어간 값**으로 본다 — 단언의 뜻(1건 이상이면 건수를
  // 보여 주고 빈 상태가 사라진다)은 그대로다
  it('1건 이상이면 건수를 보여 주고 빈 상태 문구가 사라진다', async () => {
    const payload = buildSeedPayload();
    await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });

    const tree = await Home(props());
    const teams = findComponent(tree, 'TeamSummaryTable')?.props?.teams as TeamSummary[];

    expect(textOf(tree)).not.toContain('아직 데이터가 없습니다');
    expect(teams.reduce((acc, team) => acc + team.total, 0)).toBe(payload.tasks.length);
    expect(findComponent(tree, 'SeedButton')).toBeNull();
  });

  it('읽기 전용이면 샘플 버튼이 비활성이다 — 다만 방어는 서버가 한다', async () => {
    handle = emptyHandle({ mode: 'fallback', readOnly: true });

    const button = findComponent(await Home(props()), 'SeedButton');
    expect(button?.props?.disabled).toBe(true);
  });

  // 배너를 그리는 것은 이제 `PageShell`이다(모든 페이지가 같은 문구를 쓰게 하려고 한 곳으로
  // 모았다). 트리를 렌더하지 않고 훑는 검사라 래퍼 **안쪽**은 보이지 않으므로, 화면이 모드를
  // 섞지 않고 그대로 넘기는지는 셸에 실린 prop으로 본다 — 단언의 뜻은 그대로다
  it('폴백과 데모의 배너를 섞지 않는다 — 모드를 그대로 넘긴다', async () => {
    handle = emptyHandle({ mode: 'fallback', readOnly: true });
    expect(findComponent(await Home(props()), 'PageShell')?.props?.mode).toBe('fallback');

    handle = emptyHandle({ mode: 'demo' });
    expect(findComponent(await Home(props()), 'PageShell')?.props?.mode).toBe('demo');
  });

  it('1건 이상이면 KPI 스트립과 팀별 요약표가 뜨고 「준비 중」이 사라진다', async () => {
    await seed();

    const tree = await Home(props());

    expect(findComponent(tree, 'KpiStrip')).not.toBeNull();
    expect(findComponent(tree, 'TeamSummaryTable')).not.toBeNull();
    expect(textOf(tree)).not.toContain('준비 중');
  });
});

describe('/ — KPI 10칸 (T6 완료 기준 1)', () => {
  /**
   * **완료 기준 1의 검증면이다.** 시트 `00_통합 대시보드` 5행과의 1:1 대응은 `buildKpiStrip`이
   * 지고, 화면은 그 배열을 그대로 옮기기만 해야 한다. 화면이 칸을 더하거나 라벨을 다시 지으면
   * 시트와 대조할 수 없으므로, **도메인 함수가 낸 것과 같은지**를 단언한다.
   */
  it('화면이 KPI를 발명하지 않는다 — 도메인 함수가 낸 10칸을 그대로 넘긴다', async () => {
    await seed();

    const tiles = findComponent(await Home(props()), 'KpiStrip')?.props?.tiles as
      | KpiTile[]
      | undefined;

    const tasks = await handle.repo.listTasks();
    const expected = buildKpiStrip(tasks, {
      today: kstToday(new Date()),
      semanticIndex: buildSemanticIndex(null),
    });

    expect(tiles).toHaveLength(10);
    expect(tiles?.map((tile) => tile.label)).toEqual(expected.map((tile) => tile.label));
    expect(tiles?.map((tile) => tile.key)).toEqual(expected.map((tile) => tile.key));
  });

  it('팀이 3개 다 표에 있다 — 건수가 0인 팀도 숨기지 않는다', async () => {
    // 편집팀 것만 넣는다. 「우리 팀이 안 보인다」가 「데이터가 없다」보다 나쁜 화면이다
    const payload = buildSeedPayload();
    await handle.repo.upsertTasks(
      payload.tasks.filter((task) => task.teamId === 'edit'),
      { occurredAt: '2026-08-22T01:00:00.000Z' }
    );

    const teams = findComponent(await Home(props()), 'TeamSummaryTable')?.props
      ?.teams as TeamSummary[];

    expect(teams.map((team) => team.teamKey)).toEqual(['edit', 'shoot', 'marketing']);
    expect(teams.filter((team) => team.total === 0)).toHaveLength(2);
  });
});

describe('/ — 역할 (ADR-013)', () => {
  it('?as=admin이 셸까지 전해지고, 없으면 가장 좁은 member다', async () => {
    await seed();

    expect(findComponent(await Home(props({ as: 'admin' })), 'PageShell')?.props?.role).toBe(
      'admin'
    );
    expect(findComponent(await Home(props()), 'PageShell')?.props?.role).toBe('member');
  });
});

describe('/ — 차트 (T6 범위 In「Chart.js 도넛·바」)', () => {
  /**
   * 차트가 지는 위험은 「그림이 안 예쁘다」가 아니라 **「표와 다른 숫자를 말한다」**다.
   * 그래서 조각 합이 조회 건수와 같은지, 막대가 팀 요약표와 같은 값인지를 단언한다.
   */
  it('도넛 조각의 합이 조회된 업무 수와 같다 — 「무엇의 100%인가」가 성립한다', async () => {
    await seed();

    const series = findComponent(await Home(props()), 'StatusDonut')?.props
      ?.series as ChartSeries;
    const tasks = await handle.repo.listTasks();

    expect(series.values).toHaveLength(6);
    expect(series.values.reduce((acc, value) => acc + value, 0)).toBe(tasks.length);
  });

  it('완료율 막대가 팀 요약표와 같은 숫자다 — 두 곳에서 세면 갈라진다', async () => {
    await seed();

    const tree = await Home(props());
    const teams = findComponent(tree, 'TeamSummaryTable')?.props?.teams as TeamSummary[];
    const bars = findComponent(tree, 'CompletionBars')?.props?.series as ChartSeries;

    expect(bars).toEqual(buildCompletionBars(teams));
  });

  it('완료율이 null인 팀은 0%로 그려지지 않고 「—」 목록으로 빠진다', async () => {
    // 편집팀 것만 넣으면 나머지 두 팀은 모수가 0이라 완료율을 잴 수 없다
    const payload = buildSeedPayload();
    await handle.repo.upsertTasks(
      payload.tasks.filter((task) => task.teamId === 'edit'),
      { occurredAt: '2026-08-22T01:00:00.000Z' }
    );

    const chart = findComponent(await Home(props()), 'CompletionBars');
    const series = chart?.props?.series as ChartSeries;

    expect(series.labels).toEqual(['edit']);
    expect(chart?.props?.unmeasurable).toEqual(['shoot', 'marketing']);
  });

  it('업무 배열 전량을 클라이언트 컴포넌트에 넘기지 않는다', async () => {
    await seed();

    const donut = findComponent(await Home(props()), 'StatusDonut');

    expect(Object.keys(donut?.props ?? {})).toEqual(['series']);
    expect(Object.keys((donut?.props?.series ?? {}) as object).sort()).toEqual([
      'colors',
      'labels',
      'values',
    ]);
  });
});
