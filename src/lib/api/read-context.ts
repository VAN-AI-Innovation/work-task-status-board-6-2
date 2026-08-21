/**
 * 조회 라우트 6종이 공통으로 필요로 하는 준비를 **한 번에** 한다.
 *
 * 이 파일이 있는 이유는 T5 완료 기준 1이다 — 「라우트 핸들러가 zod 검증 → lib 호출 → 직렬화
 * 3단계만 수행한다(계산 로직 0줄)」. 라우트를 아홉 개 쓰기 시작하면 매번 같은 준비 코드를 쓰게
 * 되고, 그러다 어느 라우트에서 한 줄만 계산하게 된다. 그래서 **라우트가 부를 것을 먼저** 만든다.
 * 라우트에 남는 것은 `파라미터 파싱 → 이 파일 호출 → Response.json` 세 줄이다 (`ADR-007`).
 *
 * 두 가지를 여기서 못박는다.
 *
 * - **시계는 인자다.** `now`를 받고 스스로 읽지 않는다 (CLAUDE.md CRITICAL). 현재 시각은
 *   라우트가 요청마다 읽어 넘긴다. 그래야 같은 `now`에 같은 결과가 나오고 판정을 믿을 수 있다.
 * - **지연 거르기는 저장소가 아니라 여기서 한다.** `TaskFilter`에 `overdue`가 없는 것은
 *   빠뜨린 게 아니다 — 저장소는 판정하지 않는다 (`ADR-006`). 그렇다고 라우트에 맡기면
 *   그것이 곧 「계산 로직」이므로 이 함수가 진다.
 */

import { z } from 'zod';

import { resolveViewerRole } from '@/lib/api/viewer-role';
import type { AlertContext } from '@/lib/domain/alert-rules';
import type { ViewerRole } from '@/lib/domain/extras-visibility';
import { kstToday } from '@/lib/domain/kst-today';
import type { StatsContext } from '@/lib/domain/progress-stats';
import { deriveAllFlags, type TaskFlags } from '@/lib/domain/task-derive';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import type { StorageHandle } from '@/lib/store/store-factory';
import type { TaskFilter } from '@/lib/store/task-repository';
import type { ApiMeta } from '@/types/api';
import type { Task, TaskStage } from '@/types/task';

export interface ReadContext {
  tasks: Task[];
  stages: TaskStage[];
  role: ViewerRole;
  /**
   * 도메인 함수에 그대로 넘긴다. `flags`가 **반드시** 들어 있다 —
   * `AlertContext`·`StatsContext`에서는 선택 필드지만 여기서는 좁힌다. 그래야 라우트가
   * `read.ctx.flags!`를 쓰지 않고, 판정을 다시 계산할 유혹도 생기지 않는다.
   */
  ctx: AlertContext & StatsContext & { flags: ReadonlyMap<string, TaskFlags> };
  meta: ApiMeta;
}

export interface ReadContextParams {
  /** `?as=`의 값. 해석은 `resolveViewerRole`이 하고 여기서 다시 판단하지 않는다 */
  as: string | null;
  filter: TaskFilter;
  /** `?overdue=1`. `TaskFilter`가 아니라 별도 인자인 이유는 파일 머리말에 있다 */
  overdueOnly?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 값이 비어 있으면 **키가 없는 것으로** 본다. 필터 상태가 URL에 사는 화면이라
 * (`UC-11`) 사용자가 필터를 지우면 `?owner=`가 값 없이 남는다. 그것을 400으로 돌려주면
 * 「필터 초기화」가 에러가 된다. 반대로 값이 **있는데 형식이 틀린** 것은 그대로 던진다.
 */
function optionalValue(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key);
  if (value === null) return undefined;

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalValues(searchParams: URLSearchParams, key: string): string[] | undefined {
  const values = searchParams.getAll(key).map((value) => value.trim()).filter((value) => value !== '');
  return values.length === 0 ? undefined : values;
}

/**
 * 쿼리스트링 → `TaskFilter`. **알 수 없는 키는 무시**한다 (읽는 키를 이 스키마가 열거하므로
 * `?foo=1`은 애초에 들어오지 않는다). 반대로 **아는 키의 값이 틀리면 던진다** — 라우트가
 * 그것을 잡아 `VALIDATION_FAILED`(400)로 옮긴다.
 *
 * `overdue`가 `'0'|'1'` 두 값뿐인 것은 의도다. `true`·`yes`까지 받아 주면 URL 표기가 갈라지고,
 * 링크를 복사해 공유하는 화면에서 같은 조건이 여러 모양으로 돌아다닌다.
 */
export const taskQuerySchema: z.ZodType<{ filter: TaskFilter; overdueOnly: boolean }> = z
  .object({
    team: z.array(z.enum(['edit', 'shoot', 'marketing'])).optional(),
    status: z.array(z.string()).optional(),
    owner: z.string().optional(),
    dueFrom: z.string().regex(ISO_DATE).optional(),
    dueTo: z.string().regex(ISO_DATE).optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    overdue: z.enum(['0', '1']).optional(),
  })
  .transform((query) => {
    const filter: TaskFilter = {};
    if (query.team !== undefined) filter.teamKeys = query.team;
    if (query.status !== undefined) filter.statuses = query.status;
    if (query.owner !== undefined) filter.ownerNameRaw = query.owner;
    if (query.dueFrom !== undefined) filter.dueFrom = query.dueFrom;
    if (query.dueTo !== undefined) filter.dueTo = query.dueTo;
    if (query.search !== undefined) filter.search = query.search;
    if (query.limit !== undefined) filter.limit = query.limit;

    return { filter, overdueOnly: query.overdue === '1' };
  });

export function parseTaskQuery(searchParams: URLSearchParams): {
  filter: TaskFilter;
  overdueOnly: boolean;
} {
  return taskQuerySchema.parse({
    team: optionalValues(searchParams, 'team'),
    status: optionalValues(searchParams, 'status'),
    owner: optionalValue(searchParams, 'owner'),
    dueFrom: optionalValue(searchParams, 'dueFrom'),
    dueTo: optionalValue(searchParams, 'dueTo'),
    search: optionalValue(searchParams, 'search'),
    limit: optionalValue(searchParams, 'limit'),
    overdue: optionalValue(searchParams, 'overdue'),
  });
}

export async function buildReadContext(
  storage: StorageHandle,
  now: Date,
  params: ReadContextParams
): Promise<ReadContext> {
  const today = kstToday(now);

  /*
   * 설정 탭 레지스트리를 조회하지 않고 `null`을 넘긴다. T5는 업로드 확정에서 enum·SLA를
   * 저장하지 않기로 했고(`TICKETS.md` T5 리스크·미결), `buildSemanticIndex`는 표가 비면
   * 내장 10단계 표로 폴백한다. 없는 저장 경로를 여기서 흉내 내면 시트가 준 값인 것처럼 보인다.
   */
  const semanticIndex = buildSemanticIndex(null);
  const ctx = { today, semanticIndex };

  const listed = await storage.repo.listTasks(params.filter);
  const listedFlags = deriveAllFlags(listed, ctx);

  const tasks = params.overdueOnly
    ? listed.filter((task) => listedFlags.get(task.id)?.isOverdue === true)
    : listed;

  // 거른 뒤에는 플래그 표도 함께 좁힌다. 남은 목록과 판정의 모수가 어긋나면 집계가 갈라진다
  const flags: ReadonlyMap<string, TaskFlags> =
    tasks.length === listed.length
      ? listedFlags
      : new Map(
          tasks.flatMap((task) => {
            const taskFlags = listedFlags.get(task.id);
            return taskFlags === undefined ? [] : [[task.id, taskFlags] as const];
          })
        );

  const stages = await storage.repo.listStages(tasks.map((task) => task.id));
  const lastSyncedAt = await storage.repo.getLastSyncedAt();

  /*
   * `NODE_ENV`는 요청이 아니라 프로세스의 성질이라 여기서 읽는다 (`getStorage()`가 같은 이유로
   * `process.env`를 읽는다). 「프로덕션 + 실제 저장소면 `?as=`를 무시한다」(`S4`)는 판정 자체는
   * `resolveViewerRole`이 지고 그쪽 테스트가 지킨다 — 이 파일은 그 결과를 옮길 뿐이다.
   */
  const role = resolveViewerRole(params.as, {
    nodeEnv: process.env.NODE_ENV,
    mode: storage.mode,
  });

  return {
    tasks,
    stages,
    role,
    ctx: { ...ctx, flags },
    meta: {
      today,
      lastSyncedAt,
      driver: storage.driver,
      mode: storage.mode,
      readOnly: storage.readOnly,
      role,
    },
  };
}
