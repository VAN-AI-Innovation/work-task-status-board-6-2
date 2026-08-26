/**
 * 부서별 탭이 지는 판단은 셋이다 — **경로가 팀을 정하는가**, 모르는 슬러그를 404로 막는가,
 * 팀 하나짜리 화면에 쓸모없는 그림(행 하나짜리 표·막대 하나짜리 차트)을 넣지 않았는가.
 *
 * `/`와 같은 방식으로 서버 컴포넌트가 돌려준 트리를 훑는다 (`app/page.test.ts` 머리말).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import type { AlertGroup } from '@/lib/view/alert-groups';
import type { DashboardQuery } from '@/lib/view/dashboard-query';
import type { GoalRow } from '@/lib/view/goal-view';
import {
  COMPACT_KPI_KEYS,
  layoutFor,
  SECTION_ORDER,
  sectionsFor,
  TEAM_PAGE_LAYOUT,
  type SectionKey,
} from '@/lib/view/role-layout';
import { teamLabel } from '@/lib/view/team-slug';
import type { ExtraCell } from '@/lib/view/extras-render';
import type { TaskResponse } from '@/types/api';
import type { Viewer } from '@/types/auth';

let handle: StorageHandle;
/** `app/page.test.ts`와 같은 이유로 세션을 테스트가 쥔다 — 기본값은 「로그인하지 않음」이다 */
let session: SessionOutcome;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo: handle.repo, session, base: handle }),
}));

const TeamPage = (await import('./page')).default;

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

/** `params`·`searchParams` **둘 다** Promise다 (Next 16) */
function props(teamSlug: string, searchParams: Record<string, string | string[]> = {}) {
  return {
    params: Promise.resolve({ teamSlug }),
    searchParams: Promise.resolve(searchParams),
  };
}

/**
 * 순회 헬퍼는 자식을 렌더하지 않으므로 슬롯을 **페이지가 넘긴 props로** 한 번 부른다
 * (`app/page.test.ts`와 같은 방식).
 */
function openSlot(tree: unknown): unknown {
  const slot = findComponent(tree, 'TaskPanelSlot');
  if (slot === null) return null;

  return (slot.type as (props: unknown) => unknown)(slot.props);
}

/** 시드의 `id`는 저장되며 새로 발급된다 — 원본 id를 그대로 쓰면 「없는 업무」가 된다 */
async function idOf(teamId: string): Promise<string> {
  const task = (await handle.repo.listTasks()).find((item) => item.teamId === teamId);
  if (task === undefined) throw new Error(`시드에 ${teamId} 업무가 없습니다.`);
  return task.id;
}

/** 섹션 키로 쓰이는 문자열 전부. 행 키(`kpi+charts`처럼 이어 붙인 것)와 가르는 데 쓴다 */
const ALL_SECTION_KEYS: readonly string[] = [...SECTION_ORDER.admin, 'kpi_compact'];

/** `/`와 같은 방식이다 — `SectionGrid`가 칸마다 섹션 키를 `key`로 달아 두므로 키가 곧 순서다 */
function sectionKeys(tree: unknown): string[] {
  const keys: string[] = [];
  walk(tree, (element) => {
    const key = (element as { key?: unknown }).key;
    if (typeof key === 'string' && ALL_SECTION_KEYS.includes(key)) keys.push(key);
  });
  return keys;
}

/** `layoutFor`가 이 화면에 대해 정한 배치를 평평하게 편 것 */
function placedKeys(role: 'admin' | 'lead' | 'member'): string[] {
  return layoutFor(role, TEAM_PAGE_LAYOUT).flatMap((row) =>
    row.cells.flatMap((cell) => cell.keys)
  );
}

async function seed(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });
  await handle.repo.upsertGoalMetrics(payload.goalMetrics, {
    occurredAt: '2026-08-22T01:00:00.000Z',
  });
}

/** 로그인한 사람 하나. 갈래마다 필요한 칸만 덮어쓴다 */
function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: 'user-1',
    email: 'lead@van.test',
    role: 'lead',
    teamId: 'edit',
    memberId: null,
    ...overrides,
  };
}

beforeEach(() => {
  session = { status: 'anonymous' };
  handle = {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'live',
    readOnly: false,
  };
});

/** 이 화면이 실제로 그리는 섹션. 나머지는 `null`이라 순서 배열에서 조용히 빠진다 */
const SUPPORTED: readonly SectionKey[] = ['kpi', 'kpi_compact', 'charts', 'goals', 'alerts', 'tasks'];

describe('/teams/[teamSlug] — 슬러그', () => {
  it('세 팀이 각각 자기 이름으로 뜬다', async () => {
    await seed();

    for (const slug of ['edit', 'shoot', 'marketing'] as const) {
      expect(textOf(await TeamPage(props(slug)))).toContain(teamLabel(slug));
    }
  });

  /**
   * 오타 링크가 조용히 다른 화면을 보여 주면 「우리 팀 데이터가 이상하다」는 오해가 된다.
   * 전사 대시보드로 넘기지 않고 404로 막는다.
   */
  it('모르는 슬러그는 404다 — 빈 화면도 대시보드도 아니다', async () => {
    await seed();

    await expect(TeamPage(props('nope'))).rejects.toThrow();
    await expect(TeamPage(props('편집팀'))).rejects.toThrow();
    await expect(TeamPage(props('EDIT'))).rejects.toThrow();
  });
});

describe('/teams/[teamSlug] — 경로가 팀을 정한다', () => {
  it('업무가 그 팀 것만 남는다', async () => {
    await seed();

    const tasks = findComponent(await TeamPage(props('edit')), 'TaskTable')?.props
      ?.tasks as TaskResponse[];

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => task.teamId === 'edit')).toBe(true);
  });

  /** `/teams/edit`이 촬영팀을 보여 주는 링크는 거짓말이다 */
  it('`?team=`이 경로를 덮지 못한다', async () => {
    await seed();

    const tasks = findComponent(await TeamPage(props('edit', { team: 'shoot' })), 'TaskTable')
      ?.props?.tasks as TaskResponse[];

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => task.teamId === 'edit')).toBe(true);
  });

  it('링크가 `?team=`을 다시 싣지 않는다 — 경로에 이미 있다', async () => {
    await seed();

    const query = findComponent(await TeamPage(props('edit', { team: 'shoot' })), 'PageShell')
      ?.props?.query as DashboardQuery;

    expect(query.team).toEqual([]);
  });

  it('팀 칩을 숨긴다 — 경로가 정한 것을 칩이 다시 묻지 않는다', async () => {
    await seed();

    const filter = findComponent(await TeamPage(props('edit')), 'FilterBar');

    expect(filter?.props?.showTeamChips).toBe(false);
    expect(filter?.props?.pathname).toBe('/teams/edit');
  });
});

describe('/teams/[teamSlug] — 화면 구성', () => {
  it('KPI·도넛·표는 있고, 행 하나짜리 요약표와 막대 하나짜리 차트는 없다', async () => {
    await seed();

    const tree = await TeamPage(props('edit'));

    expect(findComponent(tree, 'KpiStrip')).not.toBeNull();
    expect(findComponent(tree, 'StatusBars')).not.toBeNull();
    expect(findComponent(tree, 'TaskTable')).not.toBeNull();
    expect(findComponent(tree, 'TeamSummaryTable')).toBeNull();
    expect(findComponent(tree, 'CompletionBars')).toBeNull();
  });

  /** 완료 기준 8은 **모든** 페이지다 — 셸을 거치면 「마지막 반영」이 따라온다 */
  it('셸을 거쳐 그린다 — 배너·마지막 반영·역할이 대시보드와 같다', async () => {
    await seed();

    const shell = findComponent(await TeamPage(props('edit', { as: 'admin' })), 'PageShell');

    expect(shell).not.toBeNull();
    expect(shell?.props?.role).toBe('admin');
    expect(shell?.props?.freshness).toBeTypeOf('object');
  });

  /**
   * 「필터 0건」과 「이 팀에 업무가 없음」은 다른 사실이다. 뒤엣것에 [필터 초기화]를 붙이면
   * 누를 것이 없는 버튼이 되고, 앞엣것에 안 붙이면 사용자가 필터를 못 푼다 (`X3`).
   */
  it('필터 0건은 초기화 링크가 붙는다', async () => {
    await seed();

    // 시드에 없는 담당자로 좁히면 조회가 0건이 된다
    const empty = findComponent(await TeamPage(props('edit', { owner: '없는사람' })), 'EmptyState');

    expect(empty?.props?.kind).toBe('no-match');
    expect(empty?.props?.resetHref).toBeTypeOf('string');
  });

  it('팀에 업무가 없으면 초기화할 필터도 없다', async () => {
    const empty = findComponent(await TeamPage(props('edit')), 'EmptyState');

    expect(empty?.props?.kind).toBe('no-data');
    expect(empty?.props?.resetHref).toBeUndefined();
  });

  /*
   * 세 번째 갈래 (`PLAN.md` 결정 D). 이 사람에게는 필터를 지워도 결과가 같으므로
   * 초기화 링크를 주지 않는다 — 필요한 것은 계정 연결이다.
   */
  it('계정이 담당자에 안 붙은 부원에게는 원인을 말하고 초기화 링크를 주지 않는다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer({ role: 'member', memberId: null }) };

    const empty = findComponent(await TeamPage(props('edit')), 'EmptyState');

    expect(empty?.props?.kind).toBe('unlinked-member');
    expect(empty?.props?.resetHref).toBeUndefined();
  });
});

describe('/teams/[teamSlug] — 로그인 상태 (T8 완료 기준 1·6)', () => {
  it('세션이 상단 바까지 전해지고 `?as=`를 이긴다', async () => {
    await seed();
    session = { status: 'ok', viewer: viewer() };

    const shell = findComponent(await TeamPage(props('edit', { as: 'admin' })), 'PageShell');

    expect(shell?.props?.role).toBe('lead');
    expect(shell?.props?.account).toEqual({ email: 'lead@van.test', role: 'lead' });
  });

  it('로그인하지 않았으면 계정이 없다 — 데모의 역할 전환이 그대로 남는다', async () => {
    await seed();

    expect(findComponent(await TeamPage(props('edit')), 'PageShell')?.props?.account).toBeNull();
  });

  it('범위 안의 업무에만 수정 폼이 뜬다 — 판정은 `taskInScope`가 한다', async () => {
    await seed();
    const id = await idOf('edit');

    expect(
      findComponent(openSlot(await TeamPage(props('edit', { task: id }))), 'TaskPanel')?.props
        ?.canEdit
    ).toBe(false);

    session = { status: 'ok', viewer: viewer({ role: 'admin', teamId: null }) };
    expect(
      findComponent(openSlot(await TeamPage(props('edit', { task: id }))), 'TaskPanel')?.props
        ?.canEdit
    ).toBe(true);
  });
});

describe('/teams/[teamSlug] — 사이드 패널 (T6 완료 기준 4·6)', () => {
  /**
   * **70컬럼 팀이 이 패널의 존재 이유다** (`ADR-002`·`UC-15`). 표는 공통 8칸만 뿌리므로
   * 촬영·기획팀의 나머지 필드는 여기서만 보인다.
   */
  it('촬영·기획팀 업무를 열면 `extras`가 전량 온다', async () => {
    await seed();
    const id = await idOf('shoot');

    const panel = findComponent(openSlot(await TeamPage(props('shoot', { task: id }))), 'TaskPanel');
    const cells = panel?.props?.cells as ExtraCell[];

    expect((panel?.props?.task as TaskResponse).id).toBe(id);
    expect(cells.length).toBeGreaterThan(50);
  });

  it('닫기 링크가 이 팀 경로로 돌아온다 — `?team=`을 다시 싣지 않는다', async () => {
    await seed();

    const tree = await TeamPage(props('shoot', { task: await idOf('shoot') }));
    const closeHref = findComponent(openSlot(tree), 'TaskPanel')?.props?.closeHref as string;

    expect(closeHref).toBe('/teams/shoot');
  });

  it('다른 팀 업무의 `?task=`는 열리지 않는다 — 경로가 팀을 정했다', async () => {
    await seed();

    const rendered = openSlot(await TeamPage(props('edit', { task: await idOf('shoot') })));

    expect(findComponent(rendered, 'TaskPanel')).toBeNull();
    expect(textOf(rendered)).not.toBe('');
  });
});

describe('/teams/[teamSlug] — 알림·목표 (완료 기준 2·3)', () => {
  /** 승인 대기함은 `/`가 진다 — 팀 화면에는 알림 패널만 둔다 */
  it('알림 패널은 있고 승인 대기함은 없다', async () => {
    await seed();

    const tree = await TeamPage(props('edit'));

    expect(findComponent(tree, 'AlertPanel')).not.toBeNull();
    expect(findComponent(tree, 'ApprovalQueue')).toBeNull();
  });

  it('알림이 그 팀 업무만 가리킨다', async () => {
    await seed();

    const tree = await TeamPage(props('shoot'));
    const visible = new Set(
      (findComponent(tree, 'TaskTable')?.props?.tasks as TaskResponse[]).map((task) => task.id)
    );
    const groups = findComponent(tree, 'AlertPanel')?.props?.groups as AlertGroup[];

    for (const item of groups.flatMap((group) => group.items)) {
      expect(visible.has(item.taskId)).toBe(true);
      expect(item.teamKey).toBe('shoot');
    }
  });

  /** 전사 섹션을 그대로 옮기면 「우리 팀 화면」이 다른 팀 성과를 말한다 */
  it('목표 섹션이 그 팀 행만 보여 준다 — 지표가 없는 팀도 섹션은 남는다', async () => {
    await seed();

    const marketing = findComponent(await TeamPage(props('marketing')), 'GoalSection');
    const edit = findComponent(await TeamPage(props('edit')), 'GoalSection');

    const rows = marketing?.props?.rows as GoalRow[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.teamKey === 'marketing')).toBe(true);

    expect(edit).not.toBeNull();
    expect(edit?.props?.rows).toEqual([]);
  });
});

describe('/teams/[teamSlug] — 역할별 진입 화면 (완료 기준 7)', () => {
  /** 순서 표는 `/`와 **같은 것**이다. 팀 화면용을 따로 만들면 역할 규칙이 갈라진다 */
  it('그린 순서가 `sectionsFor`의 순서를 따른다', async () => {
    await seed();

    for (const role of ['admin', 'lead', 'member'] as const) {
      // `/`가 지는 섹션은 `TEAM_PAGE_LAYOUT.only`가 걸러 낸다 — 자리도 남지 않는다
      expect(sectionKeys(await TeamPage(props('edit', { as: role })))).toEqual(placedKeys(role));
      // 걸러 내되 이 화면에 있는 섹션은 역할 순서를 그대로 따른다
      expect(placedKeys(role).sort()).toEqual(
        sectionsFor(role)
          .filter((key) => SUPPORTED.includes(key))
          .sort()
      );
      expect(sectionsFor(role).some((key) => !SUPPORTED.includes(key))).toBe(true);
    }
  });

  it('맨 위에 오는 것이 역할마다 다르다', async () => {
    await seed();

    expect(sectionKeys(await TeamPage(props('edit', { as: 'admin' })))[0]).toBe('kpi');
    expect(sectionKeys(await TeamPage(props('edit', { as: 'lead' })))[0]).toBe('alerts');
    expect(sectionKeys(await TeamPage(props('edit', { as: 'member' })))[0]).toBe('tasks');
  });

  /** `/`가 지기로 한 섹션은 여기에 없다 — 행 하나짜리 표와 승인 대기함은 전사 화면의 것이다 */
  it('팀 요약표·승인 대기함·브리핑은 그리지 않는다', async () => {
    await seed();

    const tree = await TeamPage(props('edit', { as: 'admin' }));

    expect(findComponent(tree, 'TeamSummaryTable')).toBeNull();
    expect(findComponent(tree, 'ApprovalQueue')).toBeNull();
    expect(findComponent(tree, 'BriefingCard')).toBeNull();
  });

  it('`member`의 KPI는 축약 3칸이다', async () => {
    await seed();

    const strip = findComponent(await TeamPage(props('edit', { as: 'member' })), 'KpiStrip')?.props;

    expect(strip?.compact).toBe(true);
    expect((strip?.tiles as { key: string }[]).map((tile) => tile.key)).toEqual([
      ...COMPACT_KPI_KEYS,
    ]);
  });
});
