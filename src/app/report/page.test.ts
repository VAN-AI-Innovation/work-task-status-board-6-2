/**
 * 주간 보고 화면이 지는 판단은 셋이다 — **어느 주를 보는가** · **본문을 어디서 받는가** ·
 * **비었을 때 무엇을 말하는가.** DOM 없이 서버 컴포넌트가 돌려준 엘리먼트 트리를 훑는다
 * (`src/app/page.test.ts`와 같은 방식이고, 그 이유도 같다).
 *
 * 여기서 재지 **않는** 것: 마크다운의 내용(`weekly-report.test.ts`) · 기간 판정
 * (`report-period.test.ts`) · 링크 규칙(`report-nav.test.ts`). 이 파일이 재는 것은
 * 페이지가 그 셋을 **제대로 이어 붙였는가**다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionOutcome } from '@/lib/auth/viewer-session';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import type { StorageHandle } from '@/lib/store/store-factory';
import { createMemoryUploadStore } from '@/lib/store/upload-record-store';
import { buildSeedPayload } from '@/lib/upload/seed-loader';
import type { Viewer } from '@/types/auth';

let handle: StorageHandle;
let session: SessionOutcome;

vi.mock('@/lib/store/store-factory', () => ({
  getStorage: async () => handle,
}));

/**
 * `list_reports()`는 `security definer` 함수라 저장소가 아니라 raw 클라이언트로 나간다
 * (`ADR-024`). 여기서는 그 왕복을 세거나 결과를 갈아 끼우지 않고 **빈 목록**으로 둔다 —
 * 이 파일이 재는 것은 보고 화면의 갈래(권한·기간·빈 상태)이고, 제출 흐름은 라우트 테스트와
 * `report-merge` 테스트가 각각 진다.
 */
let reportRows: unknown[] = [];

vi.mock('@/lib/auth/request-viewer', () => ({
  currentViewerContext: async () => ({ repo: handle.repo, session, base: handle }),
  currentSessionClient: async () => ({ rpc: async () => ({ data: reportRows, error: null }) }),
}));

const ReportPage = (await import('./page')).default;

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

function lead(teamId: Viewer['teamId']): Viewer {
  return {
    userId: 'u1',
    email: 'lead@example.com',
    role: 'lead',
    teamId,
    memberId: 'm1',
    memberName: null,
  };
}

function props(searchParams: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) };
}

function emptyHandle(): StorageHandle {
  return {
    repo: createMemoryTaskStore(),
    uploads: createMemoryUploadStore(),
    driver: 'memory',
    mode: 'live',
    readOnly: false,
  };
}

async function seed(): Promise<void> {
  const payload = buildSeedPayload();
  await handle.repo.upsertTasks(payload.tasks, { occurredAt: '2026-08-22T01:00:00.000Z' });
}

beforeEach(() => {
  handle = emptyHandle();
  session = { status: 'anonymous' };
  reportRows = [];
});

describe('/report', () => {
  it('보고 본문을 마크다운 문자열 그대로 넘긴다 — 렌더하지 않는다', async () => {
    await seed();

    const doc = findComponent(await ReportPage(props()), 'ReportDocument');
    expect(doc).not.toBeNull();
    expect(typeof doc?.props?.markdown).toBe('string');
    // 제목 한 줄이 마크다운 원문 그대로여야 한다. HTML로 바뀌면 `#`이 사라진다 (`S7`)
    expect(String(doc?.props?.markdown)).toContain('# 주간 업무 보고');
  });

  it('내려받을 파일 이름에 기간이 들어간다', async () => {
    await seed();

    const doc = findComponent(await ReportPage(props({ week: '2026-08-17' })), 'ReportDocument');
    expect(doc?.props?.filename).toBe('weekly-2026-08-17.md');
  });

  it('`?week=`이 가리키는 주의 보고서가 나온다', async () => {
    await seed();

    const tree = await ReportPage(props({ week: '2026-08-17' }));
    const doc = findComponent(tree, 'ReportDocument');
    expect(String(doc?.props?.markdown)).toContain('2026-08-17 ~ 2026-08-23');

    const nav = findComponent(tree, 'ReportPeriodNav');
    expect(nav?.props?.nav).toMatchObject({ rangeLabel: '2026-08-17 ~ 2026-08-23' });
  });

  it('형식이 틀린 기간은 400이 아니라 이번 주로 되돌아오고 그 사실을 알린다', async () => {
    await seed();

    const nav = findComponent(await ReportPage(props({ week: '어제' })), 'ReportPeriodNav');
    // 되돌린 것을 말하지 않으면 사용자는 요청한 주를 보고 있다고 믿는다 (결정 M)
    expect(nav?.props?.fellBack).toBe(true);
  });

  it('요청이 없으면 되돌린 것이 아니다', async () => {
    await seed();

    const nav = findComponent(await ReportPage(props()), 'ReportPeriodNav');
    expect(nav?.props?.fellBack).toBe(false);
  });

  it('업무가 0건이면 본문 대신 사유를 말한다', async () => {
    const tree = await ReportPage(props());

    expect(findComponent(tree, 'ReportDocument')).toBeNull();
    expect(findComponent(tree, 'EmptyState')?.props?.kind).toBe('no-data');
  });

  /**
   * T9 결정 N(「역할로 막지 않는다」)을 뒤집은 자리다. 근거는 범위가 아니라 **쓰임**이다 —
   * 주간 보고는 회의에 들고 가는 문서이고 부원에게는 그 자리가 없다 (`staff-tools.ts`).
   * 403이 아니라 404인 것은 `/members`·`/team/requests`와 같은 판단이다.
   */
  it('부원에게는 이 화면이 없다', async () => {
    const viewer: Viewer = {
      userId: 'u1',
      email: 'member@example.com',
      role: 'member',
      teamId: 'edit',
      memberId: 'm1',
      memberName: null,
    };
    session = { status: 'ok', viewer };
    await seed();

    await expect(ReportPage(props())).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
  });

  /**
   * **보는 범위와 보고 범위가 다르다.** 팀장의 열람은 `0012` 이후 전사인데, 그 사람 이름으로
   * 나가는 문서에는 자기 팀만 담긴다 (`report-scope.ts`) — 남의 팀 숫자가 섞이면 어드민이
   * 병합할 때 같은 업무를 두 번 센다.
   *
   * 재는 자리는 **팀 요약 절**이다. 보고 본문이 팀별 줄을 세우므로(`weekly-report.ts`),
   * 거기 남의 팀 이름이 있으면 범위가 안 좁혀진 것이다.
   */
  it('팀장의 보고서에는 자기 팀만 담긴다', async () => {
    session = { status: 'ok', viewer: lead('edit') };
    await seed();

    const body = String(findComponent(await ReportPage(props()), 'ReportComposer')?.props?.computed);

    expect(body).toContain('편집팀');
    expect(body).not.toContain('촬영·기획팀');
    expect(body).not.toContain('마케팅·관리팀');
  });

  it('팀이 바뀌면 담기는 팀도 바뀐다 — 팀을 못박아 두지 않았다', async () => {
    session = { status: 'ok', viewer: lead('shoot') };
    await seed();

    const body = String(findComponent(await ReportPage(props()), 'ReportComposer')?.props?.computed);

    expect(body).toContain('촬영·기획팀');
    expect(body).not.toContain('편집팀');
  });

  /*
   * 어드민이 좁혀지지 않는 것은 여기서 재지 않는다 — 그 화면의 본문은 계산본이 아니라
   * **제출 병합 문서**라(`mergeTeamReports`) 팀 요약 절이 애초에 없다. 그 갈래는
   * `report-scope.test.ts`(판정)와 `api/report/weekly`(계산본)가 진다.
   */

  /** 데모(세션 없음)에서는 좁히지 않는다 — `.env` 없이 클론한 심사자가 이 화면을 본다 */
  it('로그인 전에는 막지 않는다', async () => {
    await seed();

    expect(findComponent(await ReportPage(props()), 'PageShell')).not.toBeNull();
  });

  it('기간 줄과 본문이 같은 화면에 함께 선다', async () => {
    await seed();

    const tree = await ReportPage(props());
    expect(findComponent(tree, 'ReportPeriodNav')).not.toBeNull();
    expect(findComponent(tree, 'ReportDocument')).not.toBeNull();
  });
});

/**
 * 보고 흐름의 **배선**만 잰다 — 누구에게 어떤 패널이 서고, 어드민의 본문이 병합 문서인가.
 * 병합 규칙 자체는 `report-merge.test.ts`가, 제출·검토의 계약은 두 라우트 테스트가 진다.
 */
describe('/report — 제출과 검토', () => {
  const lead: Viewer = {
    userId: 'u1',
    email: 'lead@example.com',
    role: 'lead',
    teamId: 'edit',
    memberId: 'm1',
    memberName: null,
  };
  const admin: Viewer = {
    userId: 'u2',
    email: 'admin@example.com',
    role: 'admin',
    teamId: null,
    memberId: null,
    memberName: null,
  };

  const submittedRow = {
    team_id: 'edit',
    week_start: '2026-08-24',
    body: '# 주간 업무 보고 — 2026-08-24 ~ 2026-08-30\n\n## 요약\n\n- 전체 활성 업무: 6건',
    note: '장비 대여가 하루 밀렸습니다',
    status: 'submitted',
    review_note: null,
    submitted_at: '2026-08-27T15:10:00Z',
    reviewed_at: null,
  };

  /*
   * 팀장의 제출 칸은 이제 `ReportComposer` 안에 있다 — 그 컴포넌트가 본문 상태를 들고
   * 제출 패널과 보고 본문을 함께 그린다. 서버 트리에서 보이는 것은 바깥의 `ReportComposer`
   * 하나뿐이다 (안쪽은 클라이언트에서 마운트된다).
   */
  it('팀장에게는 제출 칸이, 어드민에게는 검토 칸이 뜬다', async () => {
    await seed();

    session = { status: 'ok', viewer: lead };
    const leadTree = await ReportPage(props({ week: '2026-08-24' }));
    expect(findComponent(leadTree, 'ReportComposer')).not.toBeNull();
    expect(findComponent(leadTree, 'ReportReviewPanel')).toBeNull();

    session = { status: 'ok', viewer: admin };
    const adminTree = await ReportPage(props({ week: '2026-08-24' }));
    expect(findComponent(adminTree, 'ReportReviewPanel')).not.toBeNull();
    expect(findComponent(adminTree, 'ReportComposer')).toBeNull();
  });

  it('로그인 전(데모)에는 둘 다 없다 — 부를 함수가 없다', async () => {
    await seed();

    const tree = await ReportPage(props());
    expect(findComponent(tree, 'ReportComposer')).toBeNull();
    expect(findComponent(tree, 'ReportReviewPanel')).toBeNull();
  });

  it('검토 칸에는 미제출 팀도 줄로 선다 — 첫 정보가 「누가 안 냈는가」다', async () => {
    await seed();
    session = { status: 'ok', viewer: admin };
    reportRows = [submittedRow];

    const panel = findComponent(await ReportPage(props({ week: '2026-08-24' })), 'ReportReviewPanel');
    const rows = panel?.props?.rows as { teamId: string; status: string | null }[];

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.teamId === 'edit')?.status).toBe('submitted');
    expect(rows.find((row) => row.teamId === 'shoot')?.status).toBeNull();
  });

  it('팀장이 이미 올린 본문·특이사항이 그대로 열린다 — 계산본으로 덮지 않는다', async () => {
    await seed();
    session = { status: 'ok', viewer: lead };
    reportRows = [submittedRow];

    const panel = findComponent(await ReportPage(props({ week: '2026-08-24' })), 'ReportComposer');

    expect(panel?.props?.submittedBody).toBe(submittedRow.body);
    expect(panel?.props?.submittedNote).toBe('장비 대여가 하루 밀렸습니다');
    expect(panel?.props?.status).toBe('submitted');
  });

  it('어드민의 본문은 병합 문서다 — 팀별 특이사항이 들어 있다', async () => {
    await seed();
    session = { status: 'ok', viewer: admin };
    reportRows = [submittedRow];

    const doc = findComponent(await ReportPage(props({ week: '2026-08-24' })), 'ReportDocument');

    expect(String(doc?.props?.markdown)).toContain('# 주간 업무 보고 (전사)');
    expect(String(doc?.props?.markdown)).toContain('장비 대여가 하루 밀렸습니다');
    expect(doc?.props?.filename).toBe('weekly-2026-08-24-all.md');
  });

  /*
   * **팀장에게는 문서가 따로 서지 않는다.** 제출 칸이 들고 있는 본문을 `ReportComposer`가
   * 그대로 아래에 그리므로, 한 줄을 고치면 문서도 그 자리에서 바뀐다 — 예전에는 둘이
   * 갈려서 「올린 것」과 「PDF로 저장한 것」이 달랐다.
   */
  it('팀장 화면에는 별도 문서가 없다 — 제출 칸과 한 문자열이다', async () => {
    await seed();
    session = { status: 'ok', viewer: lead };
    reportRows = [submittedRow];

    const tree = await ReportPage(props({ week: '2026-08-24' }));
    expect(findComponent(tree, 'ReportDocument')).toBeNull();

    const composer = findComponent(tree, 'ReportComposer');
    // 계산본은 「되돌리기」의 목적지로 넘어간다. 병합 문서(전사)는 어드민의 것이다
    expect(String(composer?.props?.computed)).toContain('# 주간 업무 보고 —');
    expect(String(composer?.props?.computed)).not.toContain('(전사)');
    expect(composer?.props?.filename).toBe('weekly-2026-08-24.md');
  });

  it('업무가 0건인 어드민도 검토 칸과 병합 문서를 본다 — 미제출을 봐야 한다', async () => {
    session = { status: 'ok', viewer: admin };

    const tree = await ReportPage(props({ week: '2026-08-24' }));
    expect(findComponent(tree, 'ReportReviewPanel')).not.toBeNull();
    expect(findComponent(tree, 'ReportDocument')).not.toBeNull();
  });
});
