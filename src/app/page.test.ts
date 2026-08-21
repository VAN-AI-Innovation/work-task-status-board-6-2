/**
 * 빈 상태는 **`STORAGE_DRIVER=memory`에서는 볼 수 없다** — 시드가 들어 있기 때문이다.
 * 실제로 빈 상태가 뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때이므로, 그 상황을
 * 시드 없는 메모리 핸들로 재현한다 (`X3`「데이터 없음」).
 *
 * DOM 없이 **서버 컴포넌트가 돌려준 엘리먼트 트리**를 훑는다. jsdom을 새로 들이지 않으려는
 * 것이고, 이 화면이 지는 판단(0건이냐 아니냐 · 읽기 전용이냐)은 트리 모양으로 전부 보인다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import { buildKpiStrip, type KpiTile, type TeamSummary } from '@/lib/domain/progress-stats';
import { kstToday } from '@/lib/domain/kst-today';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import { buildCompletionBars, type ChartSeries } from '@/lib/view/chart-series';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import { sortTasks } from '@/lib/view/task-sort';
import type { TaskResponse } from '@/types/api';

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

describe('/ — 업무 표 (T6 완료 기준 2·5·14)', () => {
  /**
   * **화면이 판정하지 않는다는 것의 검증면이다.** 표에 넘어간 목록이 조회 응답
   * (`toTaskListResponse`)을 거친 것이어야 한다 — `read.tasks`(저장 모델)를 그냥 넘기면
   * 감사용 원본 행이 화면 트리에 들어오고, 그 안에 실명·연락처가 있다 (`S6`).
   */
  it('저장 모델이 아니라 조회 응답을 넘긴다 — 원본 행이 표에 없다', async () => {
    await seed();

    const tasks = findComponent(await Home(props()), 'TaskTable')?.props?.tasks as TaskResponse[];

    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task).not.toHaveProperty('raw');
      expect(task.displayStatus).toBeTypeOf('string');
      expect(task.statusLabel).toBe(DISPLAY_STATUS_LABELS[task.displayStatus]);
    }
  });

  it('정렬은 기본이 마감 임박순이고 `?sort=`가 그것을 바꾼다', async () => {
    await seed();

    const listed = (await Home(props())) as unknown;
    const byDue = findComponent(listed, 'TaskTable')?.props?.tasks as TaskResponse[];
    const byStatus = findComponent(await Home(props({ sort: 'status' })), 'TaskTable')?.props
      ?.tasks as TaskResponse[];

    expect(byDue).toEqual(sortTasks(byDue, 'due'));
    expect(byStatus).toEqual(sortTasks(byDue, 'status'));
  });

  /** 5색 칩은 저장소가 아니라 화면이 거른다 (`ADR-006`) — 그 경로가 실제로 도는지 본다 */
  it('`?display=` 칩이 표를 거른다', async () => {
    await seed();

    const all = findComponent(await Home(props()), 'TaskTable')?.props?.tasks as TaskResponse[];
    const overdue = findComponent(await Home(props({ display: 'overdue' })), 'TaskTable')?.props
      ?.tasks as TaskResponse[];

    expect(overdue.length).toBeGreaterThan(0);
    expect(overdue.length).toBeLessThan(all.length);
    expect(overdue.every((task) => task.displayStatus === 'overdue')).toBe(true);
  });

  /**
   * **완료 기준 14의 핵심.** 필터 0건에서 「데이터가 없습니다」가 뜨면 사용자는 멀쩡한
   * 데이터를 두고 업로드하러 간다. 표가 사라지고 초기화 링크가 대신 뜨는지를 본다.
   */
  it('필터 0건은 데이터 없음과 다른 화면이다 — 표 대신 초기화 링크', async () => {
    await seed();

    // 시드에 없는 담당자로 좁히면 조회가 0건이 된다
    const tree = await Home(props({ owner: '없는사람' }));
    const empty = findComponent(tree, 'EmptyState');

    expect(findComponent(tree, 'TaskTable')).toBeNull();
    expect(empty?.props?.kind).toBe('no-match');
    expect(empty?.props?.resetHref).toBe('/');
    expect(textOf(tree)).not.toContain('아직 데이터가 없습니다');
  });

  it('초기화 링크는 역할과 정렬을 남긴다 — 필터만 지운다', async () => {
    await seed();

    const tree = await Home(props({ owner: '없는사람', as: 'admin', sort: 'team' }));
    const resetHref = findComponent(tree, 'EmptyState')?.props?.resetHref as string;

    expect(resetHref).toContain('as=admin');
    expect(resetHref).toContain('sort=team');
    expect(resetHref).not.toContain('owner=');
  });

  it('필터 바가 표와 같은 쿼리를 본다 — 링크가 필터를 잃지 않는다', async () => {
    await seed();

    const tree = await Home(props({ team: 'marketing', display: 'overdue' }));
    const bar = findComponent(tree, 'FilterBar');

    expect(bar?.props?.pathname).toBe('/');
    expect((bar?.props?.query as DashboardQuery).team).toEqual(['marketing']);
    expect((bar?.props?.query as DashboardQuery).display).toEqual(['overdue']);
    expect(findComponent(tree, 'TaskTable')?.props?.query).toBe(bar?.props?.query);
  });
});
