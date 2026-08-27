/** 라우트 전체가 Node 런타임이다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse, toApiErrorCode } from '@/lib/api/api-error';
import { buildReadContext } from '@/lib/api/read-context';
import { taskPatchSchema } from '@/lib/api/task-patch-schema';
import { toTaskResponse } from '@/lib/api/task-response';
import { currentViewerContext } from '@/lib/auth/request-viewer';
import { deriveTaskFlags } from '@/lib/domain/task-derive';
import { taskInScope } from '@/lib/domain/viewer-scope';

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
 * 업무 하나의 **상태·진행률** 수정 (`UC-16` · T8 완료 기준 2). 허용 필드가 둘뿐인 근거는
 * `task-patch-schema.ts`에 있다.
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

    // 1. 로그인부터. 「로그인하세요」와 「당신은 이걸 못 합니다」는 할 일이 정반대다
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
    if (!taskInScope(task, viewer)) return errorResponse('FORBIDDEN');

    // 6. 시계는 라우트가 읽어 넘긴다 — `lib` 안에서 시간을 읽지 않는다 (CLAUDE.md CRITICAL)
    const now = new Date();
    const updated = await view.repo.updateTask(id, patch, now.toISOString());
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
