/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { taskPatchSchema } from '@/lib/api/task-patch-schema';
import { toTaskResponse } from '@/lib/api/task-response';
import { gateForSession } from '@/lib/auth/pending-gate';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { deriveTaskFlags } from '@/lib/domain/task-derive';
import { requestIsSameOrigin } from '@/lib/api/same-origin';
import {
  assignableMembers,
  canAssignOwner,
  canDeleteTask,
  lockedTaskFields,
} from '@/lib/domain/task-authoring';
import { taskEditable } from '@/lib/domain/viewer-scope';
import type { TaskPatch } from '@/types/auth';

/**
 * 업무 하나 + 단계 타임라인. 사이드 패널(`UC-15`)이 `?task=id`로 여는 것과 같은 대상이다.
 *
 * 쿼리 필터를 읽지 않는다 (`filter: {}`). 상세는 **id로 가리키는 한 건**이라 목록의 필터가
 * 걸리면 안 된다 — 지연만 보는 화면에서 링크를 복사했다고 정상 업무가 404가 되면 안 된다.
 *
 * 없으면 `TASK_NOT_FOUND`(404)다. `VALIDATION_FAILED`로 뭉개면 「id 형식이 틀렸다」와
 * 구분되지 않고, `UPLOAD_NOT_FOUND`를 재활용하면 사용자가 할 일이 뒤바뀐다.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const url = new URL(request.url);

  try {
    // Next 16에서 동적 세그먼트는 Promise다
    const { id } = await params;
    const view = await currentViewerContext();

    // 승인 대기 계정은 403이다 (T11 · `pending-gate.ts`). 401이 아닌 이유는 이미 로그인했다는 것
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');

    const read = await buildReadContext(view, new Date(), {
      as: url.searchParams.get('as'),
      filter: {},
    });

    const task = await view.repo.getTask(id);
    if (task === null) return errorResponse('TASK_NOT_FOUND');

    return Response.json({
      task: toTaskResponse(
        task,
        // 목록에 있으면 그 판정을 그대로 쓴다. 없을 때만 같은 함수로 만든다
        read.ctx.flags.get(task.id) ?? deriveTaskFlags(task, read.ctx),
        read.role
      ),
      stages: await view.repo.listStages([task.id]),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}

/**
 * 업무 하나의 **상태·진행률·담당자** 수정 (`UC-16` · T8 완료 기준 2). 허용 필드가 셋인 근거는
 * `task-patch-schema.ts`에 있다.
 *
 * ## 담당자만 역할을 한 번 더 본다
 *
 * 상태·진행률은 **보는 만큼 고친다**(`viewer-scope.ts` 머리말)로 충분하다 — 자기 업무의
 * 진행을 적는 것은 그 업무를 들고 있는 사람의 일이다. 담당자는 다르다: 그것은 「일을 누구에게
 * 맡기는가」라서 부원이 자기 업무를 남에게 넘기는 자리가 아니다. 그래서 `canAssignOwner`가
 * 한 겹 더 서고, DB에서는 `tasks_update_scope`의 `with check`가 같은 자리를 막는다
 * (`0008` 2절). 데모·폴백에는 RLS가 없어 앱 쪽이 유일한 층이다.
 *
 * **이름은 클라이언트가 정하지 않는다.** `ownerMemberId`·`coOwnerMemberIds`에서 명부의 이름을
 * 찾아 함께 쓴다 — 하나만 바꾸면 「담당자는 A인데 이름은 B」인 행이 남고 그것은 데이터가 틀린
 * 것으로 보인다.
 *
 * **주 담당과 공동 담당을 가른다.** 시트가 그 모양이고, `member`의 열람 범위가 주 담당
 * 하나로 정해지기 때문이다 (`viewer-scope.ts` · RLS). 공동 담당에서 주 담당과 겹치는 id와
 * 중복은 여기서 지운다 — 같은 사람이 두 칸에 뜨면 화면이 그를 두 번 세운다.
 *
 * ⚠ **`canEditTaskDetails`는 여기서 부르지 않는다.** 그것은 패널이 폼을 그릴지 정하는 화면
 * 규칙이지 권한이 아니다 (`task-authoring.ts` 머리말) — 여기서 쓰면 「화면에서 뺀 것」과
 * 「막은 것」이 같은 값을 갖게 되고, 둘 중 하나가 바뀔 때 다른 하나가 조용히 딸려 온다.
 *
 * **이 핸들러는 규칙을 만들지 않는다.** 방어는 이미 두 층이다 — `viewer-scope.ts`(앱)와
 * RLS·컬럼 GRANT(DB, `0003_auth_rls.sql`). 여기는 그 둘을 부르는 문이고, 읽기·쓰기 모두
 * **사용자 JWT 저장소(`view.repo`)** 로만 나간다 (`ADR-024`). `service_role` 핸들
 * (`view.base.repo`)로 「존재 확인만」 하는 것도 안 된다 — 그 순간 존재 여부가 샌다.
 *
 * **같은 자원, 다른 코드**: 위 `GET`은 보이지 않으면 404이고 이 `PATCH`는 403이다.
 * 인증된 사용자에게 이 라우트는 `TASK_NOT_FOUND`를 내지 않는다 — 「그 id는 있지만 당신
 * 것이 아니다」라고 답하면 부원이 id를 훑어 전사 업무의 **존재와 개수**를 셀 수 있다
 * (`S6`). 읽기에서 404를 유지하는 것은 그쪽이 덜 흘리기 때문이다(가리킨 것이 없다는 사실
 * 하나만 알려준다).
 *
 * **PATCH는 「반영」이 아니다.** `updatedAt`은 행 감사 컬럼에만 쓰이고, 화면의
 * 「마지막 반영: N일 전」은 **업로드가 돌아간 시각**이다 (`ADR-001`이 드러내기로 한 약점이
 * 사람의 수정으로 감춰지면 안 된다). memory 구현은 그대로이고, supabase 구현은
 * `tasks.updated_at`이 `not null`이라 값을 쓰므로 그쪽 `getLastSyncedAt`만 앞당겨지는
 * 갈래가 남는다 — 알고 두는 것이며 `memory-task-store.ts`의 ⚠ 주석이 그 자리를 가리킨다.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const url = new URL(request.url);

  try {
    const { id } = await params;
    const view = await currentViewerContext();

    /*
     * 1. 로그인부터. 「로그인하세요」와 「당신은 이걸 못 합니다」는 할 일이 정반대다.
     *    **대기·거절·프로필 없음이 401보다 먼저 걸린다** (T11) — 그 셋은 `status !== 'ok'`라
     *    아래 줄에 그대로 걸리는데, 그러면 이미 로그인한 사람에게 「로그인하세요」라고 답하게
     *    되고 화면은 로그인 폼을 다시 띄운다. 순서가 곧 문구다.
     */
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');
    if (view.session.status !== 'ok') return errorResponse('UNAUTHENTICATED');
    const viewer = view.session.viewer;

    // 2. 저장소를 건드리기 **전에** 읽기 전용을 판정한다 (`ADR-005`)
    if (view.base.readOnly) return errorResponse('STORAGE_READONLY');

    // 3. 본문. JSON이 아닌 것은 보낸 쪽의 잘못이라 아래 `catch`(503)에 맡기지 않는다
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errorResponse('VALIDATION_FAILED');
    }
    const patch = taskPatchSchema.parse(raw);

    /*
     * 4. 대상 확인. **없는 것과 보이지 않는 것을 구분해 답하지 않는다** (파일 머리말).
     *    RLS가 범위 밖 행을 이미 `null`로 돌려주므로 여기서 둘은 애초에 같은 모양이다.
     */
    const task = await view.repo.getTask(id);
    if (task === null) return errorResponse('FORBIDDEN');

    /*
     * 5. 앱 층의 판정. 라이브에서는 4번이 이미 걸러 대개 no-op이지만 **지운다면 이 자리가
     *    비는 것이 아니라 층이 하나 남는 것이다.** 데모·폴백에는 RLS가 없어 이 줄이 유일한
     *    층이고, 정책이 느슨해진 날에도 남는 것은 이쪽이다. 판정은 다시 쓰지 않고 부른다.
     */
    if (!taskEditable(task, viewer)) return errorResponse('FORBIDDEN');

    /*
     * 5-0. **역할이 못 고치는 칸.** 부원은 마감·우선순위·리스크·승인 같은 「조직의 판단」을
     *      적지 않는다 (`lockedTaskFields`). 화면도 그 칸을 잠그지만 숨김은 방어가 아니고,
     *      이 축에는 DB 정책이 없어 **여기가 유일한 자물쇠다** (컬럼 GRANT는 역할을 못 가른다).
     */
    const locked = lockedTaskFields(viewer.role).filter((field) => field in patch);
    if (locked.length > 0) return errorResponse('FORBIDDEN');

    /*
     * 5-2. 담당자를 손대는 요청만 역할을 한 번 더 본다 (파일 머리말). **이름을 여기서 붙인다** —
     *      후보를 `assignableMembers`로 좁히므로 팀 밖 구성원은 `undefined`가 되어 403이다.
     *      「없는 id」와 「팀 밖 id」를 갈라 답하지 않는 것은 이 라우트의 규율 그대로다 (`S6`).
     */
    const { ownerMemberId, coOwnerMemberIds, extras, ...rest } = patch;
    let effective: TaskPatch = rest;

    /*
     * 5-1. 팀 전용 칸은 **보낸 키만** 바꾼다. 통째로 받으면 화면이 그리지 않은 칸(민감 키 등)이
     *      요청에서 빠진 채 돌아와 조용히 사라진다. 값이 `null`이면 그 칸을 비운 것이다.
     */
    if (extras !== undefined) {
      effective = { ...effective, extras: { ...task.extras, ...extras } };
    }

    if (ownerMemberId !== undefined || coOwnerMemberIds !== undefined) {
      if (!canAssignOwner(viewer.role)) return errorResponse('FORBIDDEN');

      // 명부는 **한 번만** 읽는다 — 주 담당과 공동 담당이 같은 목록에서 나와야 한다
      const roster = assignableMembers(await view.repo.listMembers(), task.teamId);
      const nameOf = (id: string): string | undefined =>
        roster.find((member) => member.id === id)?.name;

      if (ownerMemberId !== undefined) {
        if (ownerMemberId === null) {
          effective = { ...effective, ownerMemberId: null, ownerNameRaw: null };
        } else {
          const name = nameOf(ownerMemberId);
          if (name === undefined) return errorResponse('FORBIDDEN');
          effective = { ...effective, ownerMemberId, ownerNameRaw: name };
        }
      }

      if (coOwnerMemberIds !== undefined) {
        /*
         * 주 담당과 겹치는 id와 중복을 지운다. **거부하지 않고 지우는 이유**는 이것이
         * 「보낸 쪽이 틀렸다」가 아니라 같은 뜻의 두 표현이기 때문이다 — 화면에서 주 담당을
         * 바꾸면 그 사람이 공동 담당 목록에도 남아 있는 상태가 자연스럽게 생긴다.
         */
        const primary = ownerMemberId !== undefined ? ownerMemberId : task.ownerMemberId;
        const seen = new Set<string>();
        const names: string[] = [];

        for (const id of coOwnerMemberIds) {
          if (id === primary || seen.has(id)) continue;
          const name = nameOf(id);
          // 팀 밖·없는 구성원. 「없다」와 「팀이 다르다」를 갈라 답하지 않는다 (`S6`)
          if (name === undefined) return errorResponse('FORBIDDEN');
          seen.add(id);
          names.push(name);
        }

        effective = { ...effective, coOwnerNames: names };
      }
    }

    // 6. 시계는 라우트가 읽어 넘긴다 — `lib` 안에서 시간을 읽지 않는다 (CLAUDE.md CRITICAL)
    const now = new Date();
    const updated = await view.repo.updateTask(id, effective, now.toISOString());
    // DB가 막았다. 여기까지 왔는데 0행이면 정책이 앱보다 좁은 것이고, 그 답도 403이다
    if (updated === null) return errorResponse('FORBIDDEN');

    // 7. 응답은 `GET`과 같은 모양이다 — 화면이 두 응답을 같은 코드로 다룬다
    const read = await buildReadContext(view, now, {
      as: url.searchParams.get('as'),
      filter: {},
    });

    return Response.json({
      task: toTaskResponse(updated, deriveTaskFlags(updated, read.ctx), read.role),
      meta: read.meta,
    });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}


/**
 * 업무 한 건 **삭제** (업무 패널 맨 아래 [업무 삭제]). **되돌릴 수 없고 단계·이력까지 함께
 * 사라진다** (`task_stages`·`task_events`의 `on delete cascade`).
 *
 * ## 문이 둘이다 — 역할과 행 범위
 *
 * `canDeleteTask(role)`는 「이 역할에게 삭제라는 조작이 있는가」이고(부원에게는 없다),
 * `taskEditable`은 「이 업무가 그 사람이 손댈 수 있는 것인가」다. 팀장이 전 팀을 **보게** 된
 * 뒤로 이 둘이 확실히 다른 물음이 됐다 (`0012`) — 팀장에게 삭제는 있지만, 남의 팀 업무는
 * 보이기만 하고 지울 수 없다. DB도 같은 자리를 막는다 (`tasks_delete_scope`, `0013` 4절).
 *
 * ## 없는 것과 못 지우는 것을 갈라 답하지 않는다
 *
 * `PATCH`와 같은 규율이다 — 둘 다 403이다. 「그 id는 있는데 당신 것이 아니다」라고 답하면
 * 부원이 id를 훑어 전사 업무의 존재와 개수를 셀 수 있다 (`S6`).
 *
 * **응답에 본문이 없다** (204). 지워진 업무의 내용을 되돌려주는 것은 「지웠다」와 어긋나고,
 * 화면은 어차피 목록을 다시 그린다.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  // 남의 페이지에 숨긴 폼이 로그인한 팀장의 쿠키로 업무를 지우는 것을 막는다
  if (!requestIsSameOrigin(request)) return errorResponse('FORBIDDEN');

  const url = new URL(request.url);

  try {
    const { id } = await params;
    const view = await currentViewerContext();

    // 순서가 곧 문구다 (`PATCH`의 1번과 같다)
    const gate = gateForSession(view.session, url.pathname);
    if (gate.kind === 'deny') return errorResponse('PENDING_APPROVAL');
    if (view.session.status !== 'ok') return errorResponse('UNAUTHENTICATED');
    const viewer = view.session.viewer;

    if (view.base.readOnly) return errorResponse('STORAGE_READONLY');
    if (!canDeleteTask(viewer.role)) return errorResponse('FORBIDDEN');

    const task = await view.repo.getTask(id);
    if (task === null) return errorResponse('FORBIDDEN');
    if (!taskEditable(task, viewer)) return errorResponse('FORBIDDEN');

    // DB가 막았다. 여기까지 왔는데 0행이면 정책이 앱보다 좁은 것이고, 그 답도 403이다
    if (!(await view.repo.deleteTask(id))) return errorResponse('FORBIDDEN');

    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(toApiErrorCode(error));
  }
}
