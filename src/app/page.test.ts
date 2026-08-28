/**
 * 빈 상태는 **`STORAGE_DRIVER=memory`에서는 볼 수 없다** — 시드가 들어 있기 때문이다.
 * 실제로 빈 상태가 뜨는 경로는 Supabase에 붙었는데 테이블이 비어 있을 때이므로, 그 상황을
 * 시드 없는 메모리 핸들로 재현한다 (`X3`「데이터 없음」).
 *
 * DOM 없이 **서버 컴포넌트가 돌려준 엘리먼트 트리**를 훑는다. jsdom을 새로 들이지 않으려는
 * 것이고, 이 화면이 지는 판단(0건이냐 아니냐 · 읽기 전용이냐)은 트리 모양으로 전부 보인다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import { buildKpiStrip, type KpiTile, type TeamSummary } from '@/lib/domain/progress-stats';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { kstToday } from '@/lib/domain/kst-today';
import { buildSemanticIndex, STATUS_OPTIONS } from '@/lib/domain/task-semantic';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import { ALERT_LABELS, type AlertGroup, type WaitingItem } from '@/lib/view/alert-groups';
import { buildCompletionBars, type ChartSeries } from '@/lib/view/chart-series';
import type { GoalRow } from '@/lib/view/goal-view';
import type { ExtraCell } from '@/lib/view/extras-render';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import {
  COMPACT_KPI_KEYS,
  DASHBOARD_LAYOUT,
  layoutFor,
  SECTION_ORDER,
  sectionsFor,
} from '@/lib/view/role-layout';
import { sortTasks } from '@/lib/view/task-sort';
import { teamLabel } from '@/lib/view/team-slug';
import type { TaskResponse } from '@/types/api';
import type { Viewer } from '@/types/auth';
import type { TaskStage } from '@/types/task';

let handle: StorageHandle;
/**
 * **세션은 테스트가 쥔다.** 진짜 `currentViewerContext()`는 `cookies()`와 환경변수를 만지는데
 * (`lib/auth/request-viewer.ts`), 이 파일이 재려는 것은 「세션이 이러이러할 때 화면이 무엇을
 * 말하는가」이지 쿠키 파싱이 아니다. 기본값은 지금까지와 같은 「로그인하지 않음」이라
 * 기존 단언은 그대로 성립한다.
 */
let session: SessionOutcome;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo: handle.repo, session, base: handle }),
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

  /*
   * **배치 래퍼는 펼쳐서 본다.** 이 순회기는 자식 컴포넌트를 렌더하지 않으므로, 섹션을
   * `SectionGrid`가 `render` prop으로 만들어 주는 지금 구조에서는 트리에 `<SectionGrid>`
   * 하나만 남고 그 안의 KPI·표·알림이 보이지 않는다. 순수 함수라 여기서 한 번 불러도
   * 안전하며, 이렇게 해야 **페이지가 실제로 넘긴 props로** 그려진 결과를 검사하게 된다
   * (`TaskPanelSlot`을 `openSlot`으로 여는 것과 같은 이유다).
   */
  if (typeof element.type === 'function' && (element.type as { name?: string }).name === 'SectionGrid') {
    walk((element.type as (props: unknown) => unknown)(element.props), visit);
  }

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

    // `walk`과 같은 이유로 배치 래퍼는 펼쳐서 본다 — 섹션 글자가 그 안에 있다
    const element = node as Element;
    if (
      typeof element.type === 'function' &&
      (element.type as { name?: string }).name === 'SectionGrid'
    ) {
      collect((element.type as (props: unknown) => unknown)(element.props));
    }

    collect(element.props?.children);
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

/**
 * 순회 헬퍼는 자식 컴포넌트를 **렌더하지 않는다** — 트리에는 `<TaskPanelSlot>` 엘리먼트만
 * 남고 그 안의 패널은 보이지 않는다. 슬롯은 순수 함수이므로 **페이지가 실제로 넘긴 props로**
 * 한 번 불러 그 출력을 다시 훑는다. 페이지 → 슬롯 → 패널 배선이 그대로 검증된다.
 */
function openSlot(tree: unknown): unknown {
  const slot = findComponent(tree, 'TaskPanelSlot');
  if (slot === null) return null;

  const render = slot.type as (props: unknown) => unknown;
  return render(slot.props);
}

/**
 * **시드의 `id`는 저장되면서 새로 발급된다** (`upsertTasks`는 `sourceKey`가 자연키다).
 * 그래서 테스트가 `seed-edit-0001` 같은 원본 id를 그대로 쓰면 조용히 「없는 업무」가 된다.
 */
async function idOf(teamId: string, index = 0): Promise<string> {
  const tasks = await handle.repo.listTasks();
  const task = tasks.filter((item) => item.teamId === teamId)[index];
  if (task === undefined) throw new Error(`시드에 ${teamId} 업무가 없습니다.`);
  return task.id;
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

/** 섹션 키로 쓰이는 문자열 전부. 행 키(`kpi+charts`처럼 이어 붙인 것)와 가르는 데 쓴다 */
const ALL_SECTION_KEYS: readonly string[] = [...SECTION_ORDER.admin, 'kpi_compact'];

/**
 * 화면이 실제로 그린 **섹션 순서**. 페이지가 `layoutFor`의 행을 12열 그리드로 깔면서 칸마다
 * 섹션 키를 `key`로 달아 두므로 그 키를 순서대로 모으면 된다 (`ADR-019`) — 컴포넌트 이름으로
 * 찾으면 「그렸다」만 알 수 있고 「몇 번째냐」를 알 수 없는데, 완료 기준 7이 묻는 것은
 * **맨 위에 오는 것**이다.
 */
function sectionKeys(tree: unknown): string[] {
  const keys: string[] = [];
  walk(tree, (element) => {
    const key = (element as { key?: unknown }).key;
    if (typeof key === 'string' && ALL_SECTION_KEYS.includes(key)) keys.push(key);
  });
  return keys;
}

/** `layoutFor`가 정한 배치를 평평하게 편 것. 화면이 그려야 할 순서다 */
function placedKeys(role: 'admin' | 'lead' | 'member'): string[] {
  return layoutFor(role, DASHBOARD_LAYOUT).flatMap((row) =>
    row.cells.flatMap((cell) => cell.keys)
  );
}

async function seed(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });
}

/** 목표 지표는 업무와 다른 테이블이다 — 따로 넣어야 성과 섹션에 행이 생긴다 (`ADR-002`) */
async function seedGoals(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertGoalMetrics(payload.goalMetrics, {
    occurredAt: '2026-08-22T01:00:00.000Z',
  });
}

/** 로그인한 사람 하나. 갈래마다 필요한 칸만 덮어쓴다 */
function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: 'user-1',
    email: 'admin@example.com',
    role: 'admin',
    teamId: null,
    memberId: null,
    memberName: '담당자1',
    ...overrides,
  };
}

/** `PageShell`을 실제 props로 한 번 불러 상단 바가 무엇을 받는지 본다 (순수 함수다) */
function topbarProps(tree: unknown): Record<string, unknown> | null {
  const shell = findComponent(tree, 'PageShell');
  if (shell === null) return null;

  const rendered = (shell.type as (props: unknown) => unknown)(shell.props);
  return (findComponent(rendered, 'AppTopbar')?.props ?? null) as Record<string, unknown> | null;
}

beforeEach(() => {
  handle = emptyHandle();
  session = { status: 'anonymous' };
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
  // 10칸은 `admin`·`lead`의 화면이다. 기본 역할 `member`는 축약 3칸을 쓴다 (`role-layout.ts`)
  it('화면이 KPI를 발명하지 않는다 — 도메인 함수가 낸 10칸을 그대로 넘긴다', async () => {
    await seed();

    const tiles = findComponent(await Home(props({ as: 'admin' })), 'KpiStrip')?.props?.tiles as
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
  it('막대 값의 합이 조회된 업무 수와 같다 — 「무엇의 100%인가」가 성립한다', async () => {
    await seed();

    const series = findComponent(await Home(props()), 'StatusBars')?.props
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

    // 축 라벨은 한글이고(`teamLabel`), 빠진 팀은 `TeamKey`로 넘어가 컴포넌트가 이름을 붙인다
    expect(series.labels).toEqual([teamLabel('edit')]);
    expect(chart?.props?.unmeasurable).toEqual(['shoot', 'marketing']);
  });

  it('업무 배열 전량을 차트 컴포넌트에 넘기지 않는다', async () => {
    await seed();

    const bars = findComponent(await Home(props()), 'StatusBars');

    expect(Object.keys(bars?.props ?? {})).toEqual(['series']);
    expect(Object.keys((bars?.props?.series ?? {}) as object).sort()).toEqual([
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

describe('/ — 사이드 패널 (T6 완료 기준 4·6·13)', () => {
  it('`?task=`가 없으면 패널을 그리지 않는다', async () => {
    await seed();

    expect(openSlot(await Home(props()))).toBeNull();
  });

  /** **완료 기준 6의 검증면이다.** URL만으로 패널이 열려야 링크를 받은 사람도 같은 화면을 본다 */
  it('`?task=`가 있으면 그 업무의 패널이 열린다', async () => {
    await seed();
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');

    expect((panel?.props?.task as TaskResponse).id).toBe(id);
    // 닫기는 그 키만 지운 링크다 — 이동이지 상태 변화가 아니다
    expect(panel?.props?.closeHref).toBe('/');
  });

  it('닫기 링크가 다른 필터와 역할을 남긴다 — 닫으면 보던 목록으로 돌아온다', async () => {
    await seed();

    const tree = await Home(props({ task: await idOf('edit'), as: 'admin', sort: 'team' }));
    const closeHref = findComponent(openSlot(tree), 'TaskPanel')?.props?.closeHref as string;

    expect(closeHref).toContain('as=admin');
    expect(closeHref).toContain('sort=team');
    expect(closeHref).not.toContain('task=');
  });

  /**
   * **이 패널이 있는 이유다** (`ADR-002`·`UC-15`). 표는 공통 8칸만 뿌리므로 촬영팀 70컬럼은
   * 여기서만 보인다 — 개수를 자르면 그 팀 데이터가 화면에서 사라진다.
   */
  it('`extras`를 전량 넘긴다 — 개수를 자르지 않는다', async () => {
    await seed();

    const id = await idOf('shoot');
    const tree = await Home(props({ task: id, as: 'admin' }));
    const cells = findComponent(openSlot(tree), 'TaskPanel')?.props?.cells as ExtraCell[];

    const task = (await handle.repo.listTasks()).find((item) => item.id === id);
    expect(cells).toHaveLength(Object.keys(task?.extras ?? {}).length);
    expect(cells.length).toBeGreaterThan(50);
  });

  it('단계는 그 업무 것만 `seq` 순으로 간다', async () => {
    await seed();

    const id = await idOf('edit');
    const tree = await Home(props({ task: id }));
    const stages = findComponent(openSlot(tree), 'TaskPanel')?.props?.stages as TaskStage[];

    expect(stages.length).toBeGreaterThan(0);
    expect(stages.every((stage) => stage.taskId === id)).toBe(true);
    expect(stages.map((stage) => stage.seq)).toEqual([...stages.map((s) => s.seq)].sort((a, b) => a - b));
  });

  /** 완료 기준 13. 거르는 곳은 응답 계층 하나이고, 패널은 그 결과를 **표시**만 한다 (`S6`) */
  it('member에게 민감 키가 (비공개)로 보이고 admin에게는 값이 보인다', async () => {
    await seed();

    const id = await idOf('shoot');
    const cellsFor = async (as: string): Promise<ExtraCell[]> => {
      const tree = await Home(props({ task: id, as }));
      return findComponent(openSlot(tree), 'TaskPanel')?.props?.cells as ExtraCell[];
    };

    const label = '섭외 / 출연자 연락처 (내부용)';
    const asMember = (await cellsFor('member')).find((cell) => cell.label === label);
    const asAdmin = (await cellsFor('admin')).find((cell) => cell.label === label);

    expect(asMember).toMatchObject({ masked: true, text: '(비공개)' });
    expect(asAdmin?.masked).toBe(false);
    expect(asAdmin?.text).not.toBe('(비공개)');
    // 키는 양쪽 모두 남는다 — 무엇이 가려졌는지 보여야 한다
    expect((await cellsFor('member')).length).toBe((await cellsFor('admin')).length);
  });

  it('없는 id는 에러가 아니라 안내 한 줄이다 — 패널을 열지 않는다', async () => {
    await seed();

    const rendered = openSlot(await Home(props({ task: '없는-id' })));

    expect(findComponent(rendered, 'TaskPanel')).toBeNull();
    expect(textOf(rendered)).toContain('찾을 수 없습니다');
  });

  /** 필터에 걸려 빠진 경우에는 되돌릴 길을 함께 준다 — 아무 반응이 없으면 링크가 고장 나 보인다 */
  it('필터 밖으로 밀려난 업무는 초기화 링크와 함께 알린다', async () => {
    await seed();

    const rendered = openSlot(
      await Home(props({ task: await idOf('edit'), display: 'overdue' }))
    );
    const text = textOf(rendered);

    expect(findComponent(rendered, 'TaskPanel')).toBeNull();
    expect(text).toContain('필터 밖에 있습니다');
    expect(text).toContain('필터 초기화');
  });

  it('슬롯이 보는 목록은 표와 같다 — 칩으로 가린 업무의 패널이 열리지 않는다', async () => {
    await seed();

    const tree = await Home(props({ display: 'overdue' }));

    expect(findComponent(tree, 'TaskPanelSlot')?.props?.tasks).toBe(
      findComponent(tree, 'TaskTable')?.props?.tasks
    );
  });
});

describe('/ — 알림 패널 (요구 3번 · 완료 기준 2)', () => {
  /**
   * **0건인 묶음도 남는다.** 사라지면 「그 문제가 없는 것」과 「그 검사를 안 한 것」이 같은
   * 화면이 되고, 특히 `기한 미설정`은 마감 없는 업무의 유일한 노출 경로다.
   */
  it('묶음 4종 + 보조 1종이 항상 그려진다', async () => {
    await seed();

    const groups = findComponent(await Home(props()), 'AlertPanel')?.props
      ?.groups as AlertGroup[];

    expect(groups.map((group) => group.label)).toEqual(Object.values(ALERT_LABELS));
    expect(groups.map((group) => group.label)).toContain('기한 미설정');
    expect(groups.length).toBe(5);
  });

  /**
   * `Alert`에는 업무명이 없다 — 그 응답이 화면 밖으로도 나가기 때문이다 (`S6`).
   * 이름은 화면이 자기 목록에서 붙이고, 링크는 `?task=` 딥링크다.
   */
  it('이름과 링크를 화면이 붙인다 — 알림 객체에는 둘 다 없다', async () => {
    await seed();

    const tree = await Home(props());
    const panel = findComponent(tree, 'AlertPanel');
    const groups = panel?.props?.groups as AlertGroup[];
    const listed = findComponent(tree, 'TaskTable')?.props?.tasks as TaskResponse[];

    const alert = groups.flatMap((group) => group.items)[0];
    expect(alert).toBeDefined();
    expect(alert).not.toHaveProperty('title');

    const titleOf = panel?.props?.titleOf as (id: string) => string;
    const hrefOf = panel?.props?.hrefOf as (id: string) => string;
    const task = listed.find((item) => item.id === alert.taskId);

    expect(titleOf(alert.taskId)).toBe(task?.title);
    expect(hrefOf(alert.taskId)).toBe(`/?task=${encodeURIComponent(alert.taskId)}`);
  });

  /** 이름을 못 붙이는 항목은 클릭할 수 없는 줄이 된다 */
  it('표에 없는 업무의 알림은 남기지 않는다', async () => {
    await seed();

    const tree = await Home(props({ display: 'overdue' }));
    const visible = new Set(
      (findComponent(tree, 'TaskTable')?.props?.tasks as TaskResponse[]).map((task) => task.id)
    );
    const groups = findComponent(tree, 'AlertPanel')?.props?.groups as AlertGroup[];

    for (const item of groups.flatMap((group) => group.items)) {
      expect(visible.has(item.taskId)).toBe(true);
    }
  });

  /** 「승인 대기」 타일에 숫자만 있고 목록이 없어서 만든 화면이다 (`UC-09`) */
  it('승인 대기함 건수가 KPI 타일과 같다', async () => {
    await seed();

    // 「승인 대기」 타일은 10칸 쪽에만 있다 — 축약 3칸에는 없으므로 `admin`으로 연다
    const tree = await Home(props({ as: 'admin' }));
    const tiles = findComponent(tree, 'KpiStrip')?.props?.tiles as KpiTile[];
    const items = findComponent(tree, 'ApprovalQueue')?.props?.items as WaitingItem[];

    const tile = tiles.find((entry) => entry.key === 'approval_waiting');
    expect(items).toHaveLength(tile?.value ?? -1);
  });
});

describe('/ — 목표 대비 성과 (요구 4번 · 완료 기준 3)', () => {
  /** 섹션이 사라지면 요구 4번이 미구현으로 보인다 */
  it('지표가 0건이어도 섹션이 남는다', async () => {
    await seed();

    const section = findComponent(await Home(props()), 'GoalSection');

    expect(section).not.toBeNull();
    expect(section?.props?.rows).toEqual([]);
  });

  it('목표 → 실적 → 달성률이 한 행에 있고 직전 대비가 원문 그대로다', async () => {
    await seed();
    await seedGoals();

    const rows = findComponent(await Home(props()), 'GoalSection')?.props?.rows as GoalRow[];
    const row = rows.find((entry) => entry.rate === '120%');

    expect(rows.length).toBeGreaterThan(0);
    expect(row).toMatchObject({ target: '100', actual: '120', delta: '+18%' });
    // 120%는 이상값이 아니라 정상값이다 — 미달로 칠하지 않는다
    expect(row?.belowTarget).toBe(false);
  });

  /** 성과 지표는 업무가 아니라 목표값 대 실적값 축이라 같은 필터가 성립하지 않는다 (`ADR-002`) */
  it('업무 필터가 목표 섹션을 좁히지 않는다', async () => {
    await seed();
    await seedGoals();

    const all = findComponent(await Home(props()), 'GoalSection')?.props?.rows as GoalRow[];
    const filtered = findComponent(await Home(props({ display: 'overdue' })), 'GoalSection')?.props
      ?.rows as GoalRow[];

    expect(filtered).toEqual(all);
  });
});

describe('/ — 역할별 진입 화면 (완료 기준 7)', () => {
  /**
   * **이 테스트가 완료 기준 7의 실체다.** 세 역할이 같은 순서를 그리면 `?as=`는 배지만 바꾸는
   * 장식이 되고 `H7` 헤지가 성립하지 않는다.
   */
  /**
   * 첫 줄은 세 역할이 같다 — 업무 표다 (`TASKS_FIRST`). **차이는 그 다음 줄부터** 남고
   * 완료 기준 7이 재는 것은 거기 있다.
   */
  it('세 역할 모두 업무 표가 맨 위다', async () => {
    await seed();

    for (const as of ['admin', 'lead', 'member']) {
      expect(sectionKeys(await Home(props({ as })))[0]).toBe('tasks');
    }
  });

  it('업무 표 아래는 역할이 정한 순서 그대로다', async () => {
    await seed();

    const second = async (as: string): Promise<string> =>
      sectionKeys(await Home(props({ as })))[1];

    // 대표는 전체 그림부터, 나머지 둘은 지금 문제(알림)부터다
    expect(await second('admin')).toBe('kpi');
    expect(await second('lead')).toBe('alerts');
    expect(await second('member')).toBe('alerts');

    // 그 알림 행 안에서 갈린다 — 부원만 축약 KPI가 함께 선다 (`COMPACT_KPI_KEYS`)
    expect(sectionKeys(await Home(props({ as: 'member' })))).toContain('kpi_compact');
    expect(sectionKeys(await Home(props({ as: 'lead' })))).not.toContain('kpi_compact');
  });

  it('그린 순서가 `layoutFor`가 정한 그대로다 — 화면이 표를 다시 짜지 않는다', async () => {
    await seed();

    for (const role of ['admin', 'lead', 'member'] as const) {
      expect(sectionKeys(await Home(props({ as: role })))).toEqual(placedKeys(role));
    }
  });

  /** 배치는 zone으로 묶을 뿐 섹션을 버리지 않는다 — 버리는 것은 권한이고 권한은 T8이다 */
  it('배치를 거쳐도 역할이 가진 섹션이 그대로 다 나온다', async () => {
    await seed();

    for (const role of ['admin', 'lead', 'member'] as const) {
      expect(sectionKeys(await Home(props({ as: role }))).sort()).toEqual(
        [...sectionsFor(role)].sort()
      );
    }
  });

  /** 순서를 바꾸는 것은 헤지고 삭제는 권한이다. 권한은 T8이다 */
  it('어느 역할에서도 업무 표와 알림이 사라지지 않는다', async () => {
    await seed();

    for (const role of ['admin', 'lead', 'member'] as const) {
      const tree = await Home(props({ as: role }));
      expect(findComponent(tree, 'TaskTable')).not.toBeNull();
      expect(findComponent(tree, 'AlertPanel')).not.toBeNull();
      expect(findComponent(tree, 'GoalSection')).not.toBeNull();
    }
  });

  it('`?as=` 없이 들어가면 가장 좁은 `member` 화면이다', async () => {
    await seed();

    expect(sectionKeys(await Home(props()))).toEqual(placedKeys('member'));
  });

  it('`member`의 KPI는 축약 3칸이고, 그 값은 10칸에서 골라 온 것이다', async () => {
    await seed();

    const compact = findComponent(await Home(props({ as: 'member' })), 'KpiStrip')?.props;
    const full = findComponent(await Home(props({ as: 'admin' })), 'KpiStrip')?.props
      ?.tiles as KpiTile[];

    const tiles = compact?.tiles as KpiTile[];
    expect(compact?.compact).toBe(true);
    expect(tiles.map((tile) => tile.key)).toEqual([...COMPACT_KPI_KEYS]);
    // 화면이 따로 세지 않았다 — 같은 키의 값이 10칸과 같다
    for (const tile of tiles) {
      expect(tile.value).toBe(full.find((entry) => entry.key === tile.key)?.value);
    }
  });

  /** 그 사람이 누군지 우리는 모른다. 이름을 대신 채워 넣지 않고 **묻는다** (`UC-14`) */
  it('`member`가 담당자를 고르지 않았을 때만 안내가 뜬다', async () => {
    await seed();

    const owner = (await handle.repo.listTasks())[0]?.ownerNameRaw ?? '담당자1';

    expect(textOf(await Home(props({ as: 'member' })))).toContain('담당자를 지정하면');
    expect(textOf(await Home(props({ as: 'member', owner })))).not.toContain('담당자를 지정하면');
    expect(textOf(await Home(props({ as: 'admin' })))).not.toContain('담당자를 지정하면');
  });
});

describe('/ — 주간 브리핑 카드 (`UC-08` · 완료 기준 9)', () => {
  it('마크다운 문자열을 그대로 넘긴다 — 화면이 다시 만들지 않는다', async () => {
    await seed();
    await seedGoals();

    const tasks = await handle.repo.listTasks();
    const period = resolveReportPeriod(kstToday(new Date()), null);
    const markdown = findComponent(await Home(props({ as: 'admin' })), 'BriefingCard')?.props
      ?.markdown as string;

    expect(markdown).toBe(
      buildWeeklyReport({
        tasks,
        stages: await handle.repo.listStages(tasks.map((task) => task.id)),
        goals: await handle.repo.listGoalMetrics(),
        period,
        events: await handle.repo.listEvents({ since: period.since, until: period.until }),
        ctx: { today: kstToday(new Date()), semanticIndex: buildSemanticIndex(null) },
      })
    );
  });

  /** 이 문자열은 복사돼 회의록으로 나간다. `extras`가 한 값도 실리면 안 된다 (`S6`) */
  it('연락처·계정이 실리지 않는다', async () => {
    await seed();

    const markdown = findComponent(await Home(props({ as: 'admin' })), 'BriefingCard')?.props
      ?.markdown as string;

    expect(markdown).not.toContain('연락처');
    expect(markdown).not.toContain('계정');
  });

  /**
   * T9 step 4에서 이력 조회 경로(`listEvents`)가 생겨 **각주가 회수됐다.** 「집계되지 않음」은
   * 이제 저장소가 이력을 읽지 못한 경우에만 나오고, 0건은 0건이라고 말한다.
   */
  it('변경 건수를 실제로 세고, 「집계되지 않음」 각주를 달지 않는다', async () => {
    await seed();

    const card = findComponent(await Home(props({ as: 'admin' })), 'BriefingCard');

    expect(card?.props?.note).toBeUndefined();
    expect(card?.props?.markdown as string).toContain('- 이번 주 변경: 0건');
    expect(card?.props?.markdown as string).not.toContain('집계되지 않음');
  });
});


/**
 * T8이 더한 갈래들. 서버는 이미 막고 있고(`viewer-scope.ts`·RLS·`PATCH`), 여기서 재는 것은
 * **화면이 그 사실을 옳게 말하는가**다.
 */
describe('/ — 로그인 상태 (T8 완료 기준 1·6)', () => {
  it('세션이 없으면 역할 전환이 남는다 — 데모에서 `?as=`가 여전히 역할을 정한다', async () => {
    await seed();

    const topbar = topbarProps(await Home(props({ as: 'admin' })));
    expect(topbar?.account).toBeNull();
    expect(topbar?.showRoleSwitch).toBe(true);
  });

  it('로그인하면 계정이 상단 바에 실리고 역할 전환이 사라진다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer({ email: 'admin@van.test' }) };

    const topbar = topbarProps(await Home(props()));
    expect(topbar?.account).toEqual({ email: 'admin@van.test', role: 'admin' });
    // 눌러도 역할이 바뀌지 않는 버튼은 사용자에게 고장이다 (`ADR-026`)
    expect(topbar?.showRoleSwitch).toBe(false);
  });

  /**
   * **T11에서 갈래가 바뀌었다.** 예전에는 이 계정이 「아무것도 없는 대시보드 + 로그아웃
   * 버튼」을 봤는데, 그 화면은 원인을 한 글자도 말하지 않았다. 이제 `/pending`으로 보내고
   * 거기서 사유를 말한다 (`pending-gate.ts`). 상단 바가 여전히 이 계정을 「계정」으로 그린다는
   * 사실은 `toAccount`가 지고 `viewer-session.test.ts`가 잰다.
   */
  it.each([
    ['no_profile', { status: 'no_profile', userId: 'user-9', email: 'ghost@van.test' }],
    [
      'pending',
      {
        status: 'pending',
        userId: 'user-9',
        email: 'ghost@van.test',
        teamId: 'edit',
        displayName: '새내기',
      },
    ],
    [
      'rejected',
      {
        status: 'rejected',
        userId: 'user-9',
        email: 'ghost@van.test',
        teamId: 'edit',
        displayName: '새내기',
      },
    ],
  ] as [string, SessionOutcome][])(
    '%s 계정은 대시보드가 아니라 `/pending`으로 간다',
    async (_label, outcome) => {
      await seed();
      session = outcome;

      // `redirect()`는 던져서 렌더를 끊는다. 목적지는 에러의 `digest`에 실린다
      await expect(Home(props())).rejects.toMatchObject({
        digest: expect.stringContaining('/pending'),
      });
    }
  );

  it('`?as=`가 세션을 이기지 못한다 — URL은 사용자가 타이핑한 문자열이다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer({ role: 'member', memberId: 'm-1' }) };

    const tree = await Home(props({ as: 'admin' }));
    expect(findComponent(tree, 'PageShell')?.props?.role).toBe('member');
  });
});

describe('/ — 담당자 미연결 (`PLAN.md` 결정 D)', () => {
  it('계정이 담당자에 안 붙은 부원에게는 원인을 말하고 업로드로 보내지 않는다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer({ role: 'member', memberId: null }) };

    const tree = await Home(props());
    expect(findComponent(tree, 'EmptyState')?.props?.kind).toBe('unlinked-member');
    // 시트를 올려도 그 사람의 업무는 여전히 보이지 않는다 — 필요한 것은 계정 연결이다
    expect(findComponent(tree, 'SeedButton')).toBeNull();
  });

  it('로그인하지 않았으면 지금까지와 같은 빈 상태다 — 진입점 둘이 그대로 있다', async () => {
    const tree = await Home(props());

    expect(findComponent(tree, 'SeedButton')).not.toBeNull();
    expect(textOf(tree)).toContain('아직 데이터가 없습니다');
    // 이 갈래에는 `EmptyState`가 서지 않는다 — 진입점 둘이 붙은 블록을 페이지가 직접 쥔다
    expect(findComponent(tree, 'EmptyState')).toBeNull();
  });
});

describe('/ — 수정 폼 (`UC-16`)', () => {
  it('로그인하지 않았으면 패널에 수정 폼이 없다', async () => {
    await seed();
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');
    expect(panel?.props?.canEdit).toBe(false);
  });

  it('범위 안의 업무에는 수정 폼이 뜬다 — 판정은 화면이 아니라 `taskInScope`가 한다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer({ role: 'lead', teamId: 'edit' }) };
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');
    expect(panel?.props?.canEdit).toBe(true);
  });

  /**
   * 범위는 넓은데 폼은 없다. **권한이 아니라 화면 규칙이다** — 진행률을 손수 적는 것은 그
   * 업무를 들고 있는 사람의 일이고, 전사를 보는 자리에 그 폼이 있으면 남의 업무 숫자를
   * 대신 적게 된다 (`lib/domain/task-authoring.ts`).
   */
  /*
   * 예전에는 대표·실장에게 `canEdit`이 **거짓**이었다 (`canEditProgress`). 그 폼이 진행률 두
   * 칸이 아니라 업무 내용을 고치는 자리가 되면서 뒤집혔다 — 근거는 `task-authoring.ts`에 있다.
   * 삭제도 함께 열린다.
   */
  it('대표·실장에게는 수정·담당자 지정·삭제가 모두 뜬다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer() };
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');
    expect(panel?.props?.canEdit).toBe(true);
    expect(panel?.props?.canAssign).toBe(true);
    expect(panel?.props?.canDelete).toBe(true);
  });

  it('담당자 후보는 그 업무의 팀 사람만이다 — 좁히는 것은 `assignableMembers`다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer() };
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');
    const candidates = (panel?.props?.ownerCandidates ?? []) as { id: string; name: string }[];

    // 브라우저로 나가는 것은 `{id, name}` 둘뿐이다 — `authUserId`를 싣지 않는다 (`S6`)
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual(['id', 'name']);
    }
  });

  it('상태 목록을 화면이 다시 적지 않는다 — `STATUS_SEMANTIC_MAP`에서 온다 (`ADR-009`)', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer() };
    const id = await idOf('edit');

    const panel = findComponent(openSlot(await Home(props({ task: id }))), 'TaskPanel');
    expect(panel?.props?.statusOptions).toBe(STATUS_OPTIONS);
  });
});
