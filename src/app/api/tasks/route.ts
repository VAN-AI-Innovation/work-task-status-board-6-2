/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext, parseTaskQuery } from '@/lib/api/read-context';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import { taskCreateSchema } from '@/lib/api/task-create-schema';
import { toTaskListResponse, toTaskResponse } from '@/lib/api/task-response';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { assignableMembers, creatableTeams } from '@/lib/domain/task-authoring';
import { deriveTaskFlags } from '@/lib/domain/task-derive';
import { manualSourceKey, type TaskCreateInput } from '@/lib/store/task-repository';

/**
 * 업무 목록. **초기 렌더는 서버 컴포넌트가 `lib/`를 직접 부르므로 이 라우트를 쓰지 않는다**
 * (`ADR-007`). 여기가 지는 것은 셋이다 — 클라이언트의 필터·리프레시(T6), 외부 소비(`curl`),
 * 그리고 **완료 기준 9의 검증면**이다: `curl /api/tasks | grep raw`가 비어야 한다
 * (`PLAN.md`「검증 방법」 21번).
 *
 * 이 파일에 계산이 없다. 거르기는 `buildReadContext`, 판정은 `lib/domain/`,
 * 마스킹과 원본 배제는 `toTaskListResponse`가 진다 (T5 완료 기준 1).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  try {
    const view = await currentViewerContext();
    /*
     * **승인을 기다리는 계정은 403이다** (T11). 401이 아닌 이유는 이 사람이 **이미
     * 로그인했다**는 것이고, 리다이렉트가 아닌 이유는 `fetch`가 302를 따라가면 HTML을
     * JSON으로 파싱하려 들기 때문이다 (`ADR-027`). 판정은 `pending-gate.ts`가 진다.
     */
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');

    const query = parseTaskQuery(url.searchParams);
    const read = await buildReadContext(view, new Date(), {
      as: url.searchParams.get('as'),
      ...query,
    });

    return Response.json({
      // `read.ctx.flags`는 이미 만들어져 있다. 다시 판정하면 화면과 갈라진다
      tasks: toTaskListResponse(read.tasks, read.ctx.flags, read.role),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}


/**
 * 업무 **한 건 만들기** (대시보드의 「업무 생성」 패널). 시트 업로드가 아니라 사람이 회의
 * 자리에서 새 일감을 거는 경로다.
 *
 * ## 어느 팀에 만들 수 있는지를 **목록으로** 본다
 *
 * `creatableTeams(role, teamId)`가 낸 목록에 없으면 403이다 — 어드민은 전 팀, 팀장은 자기
 * 팀 하나, 부원은 빈 목록이다. 역할 검사(`canCreateTask`)를 따로 부르지 않는 것은 그 함수가
 * 이미 이 목록 안에 있기 때문이다: 못 만드는 역할의 목록은 비어 있어 어떤 팀도 통과하지
 * 못한다. 검사가 하나면 둘이 어긋날 자리가 없다.
 *
 * DB도 같은 자리를 막는다 (`tasks_insert_scope`의 `with check`, `0013` 4절). 데모·폴백에는
 * RLS가 없어 이 줄이 유일한 층이다.
 *
 * ## 자연키는 서버가 짓는다
 *
 * `manualSourceKey(crypto.randomUUID())`다. 클라이언트가 정하면 **시트에서 온 행의 자연키를
 * 흉내 낼 수 있고**, 그때 다음 업로드가 그 행을 덮는다. 무작위 값을 `lib` 안이 아니라 여기서
 * 읽는 것은 시계를 라우트가 읽어 넘기는 규율과 같다 (`CLAUDE.md` CRITICAL).
 *
 * ## 이름은 클라이언트가 정하지 않는다
 *
 * `PATCH`와 **같은 규칙**이다 — `ownerMemberId`·`coOwnerMemberIds`에서 명부의 이름을 찾아
 * 채운다. 후보를 `assignableMembers`로 좁히므로 팀 밖 구성원은 403이고, 「없는 id」와
 * 「팀 밖 id」를 갈라 답하지 않는다 (`S6`).
 */
export async function POST(request: Request): Promise<Response> {
  // 남의 페이지에 숨긴 폼이 로그인한 팀장의 쿠키로 업무를 밀어 넣는 것을 막는다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  const url = new URL(request.url);

  try {
    const view = await currentViewerContext();

    // 순서가 곧 문구다 — 대기 계정에 「로그인하세요」라고 답하지 않는다 (`PATCH`와 같다)
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');
    if (view.session.status !== 'ok') return errorResponse('UNAUTHENTICATED');
    const viewer = view.session.viewer;

    // 저장소를 건드리기 **전에** 읽기 전용을 판정한다 (`ADR-005`)
    if (view.base.readOnly) return errorResponse('STORAGE_READONLY');

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const body = taskCreateSchema.parse(raw);

    if (!creatableTeams(viewer.role, viewer.teamId).includes(body.teamId)) {
      return errorResponse('FORBIDDEN');
    }

    /*
     * 담당자 이름을 붙인다. 명부는 **한 번만** 읽는다 — 주 담당과 공동 담당이 같은 목록에서
     * 나와야 한다 (`PATCH`의 같은 자리와 글자까지 같은 규율이다).
     */
    const roster = assignableMembers(await view.repo.listMembers(), body.teamId);
    const nameOf = (id: string): string | undefined =>
      roster.find((member) => member.id === id)?.name;

    let ownerMemberId: string | null = null;
    let ownerNameRaw: string | null = null;
    if (body.ownerMemberId !== undefined && body.ownerMemberId !== null) {
      const name = nameOf(body.ownerMemberId);
      if (name === undefined) return errorResponse('FORBIDDEN');
      ownerMemberId = body.ownerMemberId;
      ownerNameRaw = name;
    }

    // 주 담당과 겹치는 id와 중복은 **지운다** (거부하지 않는다 — `PATCH`의 근거와 같다)
    const seen = new Set<string>();
    const coOwnerNames: string[] = [];
    for (const id of body.coOwnerMemberIds ?? []) {
      if (id === ownerMemberId || seen.has(id)) continue;
      const name = nameOf(id);
      if (name === undefined) return errorResponse('FORBIDDEN');
      seen.add(id);
      coOwnerNames.push(name);
    }

    const input: TaskCreateInput = {
      sourceKey: manualSourceKey(crypto.randomUUID()),
      teamId: body.teamId,
      title: body.title,
      status: body.status ?? null,
      progress: body.progress ?? null,
      priority: body.priority ?? null,
      riskStatus: body.riskStatus ?? null,
      approvalStatus: body.approvalStatus ?? null,
      // 팀 전용 칸. 만들 때는 합칠 기존 값이 없어서 그대로 싣는다 (`PATCH`는 합친다)
      extras: body.extras ?? {},
      assignedAt: body.assignedAt ?? null,
      dueAt: body.dueAt ?? null,
      nextAction: body.nextAction ?? null,
      nextActionOwner: body.nextActionOwner ?? null,
      nextActionDue: body.nextActionDue ?? null,
      note: body.note ?? null,
      ownerMemberId,
      ownerNameRaw,
      coOwnerNames,
    };

    // 시계는 라우트가 읽어 넘긴다 — `lib` 안에서 시간을 읽지 않는다 (CLAUDE.md CRITICAL)
    const now = new Date();
    const created = await view.repo.createTask(input, now.toISOString());

    // 응답 모양은 `GET /api/tasks/[id]`·`PATCH`와 같다 — 화면이 세 응답을 같은 코드로 다룬다
    const read = await buildReadContext(view, now, { as: url.searchParams.get('as'), filter: {} });

    return Response.json(
      {
        task: toTaskResponse(created, deriveTaskFlags(created, read.ctx), read.role),
        meta: read.meta,
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
