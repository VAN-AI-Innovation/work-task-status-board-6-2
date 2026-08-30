/**
 * 미리보기 → **확정**. `ADR-008` 2단계의 두 번째 걸음이고, 이 프로젝트에서 **저장소에 처음으로
 * 쓰는 지점**이다.
 *
 * ### 원자성을 이름으로 감추지 않는다 (`X4`)
 *
 * - **메모리 드라이버는 스냅샷-교체로 실제 원자적**이다 (`TaskRepository.runAtomically?`).
 * - **Supabase는 원자적이지 않다.** `supabase-js`에 트랜잭션 API가 없어 태스크 upsert ·
 *   목표 지표 upsert가 각각 별개의 왕복이다. 진짜 트랜잭션은 Postgres 함수(RPC)를 새로
 *   만들어야 하는데, 그 길은 `ADR-006`이 밀어낸 로직을 SQL로 되돌리고 마이그레이션 적용이라는
 *   사용자 개입을 만든다. 그래서 **멱등 재시도**로 대신한다 — 실패하면 `parse_result`를 남긴 채
 *   `failed`로 두고, 같은 입력으로 다시 확정하면 정확히 같은 결과에 수렴한다.
 * - 멱등이 성립하는 근거: upsert 키가 `(teamId, sourceKey)`이고, 단계는 통째 교체이며,
 *   이벤트는 `updated`인 건에만 생긴다. 두 번째 시도에서 이미 반영된 건은 `unchanged`가 되고
 *   `lastProgressAt`도 움직이지 않는다.
 *
 * ### 이 파일이 절대 하지 않는 것
 *
 * - **삭제하지 않는다.** 워크북에 없는 팀·행은 그대로 둔다 — 그것이 부분 업로드(`UC-04`)의
 *   실체다. 「이번에 안 올라온 것」과 「지워진 것」을 구별하지 못하면 팀장이 자기 탭만 올렸을 때
 *   다른 팀 데이터가 통째로 사라진다.
 * - **시간을 읽지 않는다.** `occurredAt`은 라우트가 주입한다 (`CLAUDE.md` CRITICAL).
 * - **읽기 전용 여부를 다시 계산하지 않는다.** `store-factory`가 이미 낸 값을 받는다 —
 *   규칙이 두 곳에 생기면 갈라진다 (`ADR-005`).
 * - **`summary`·에러 메시지에 업무명·담당자·셀 값을 담지 않는다** (`S6`·`X1`).
 */

import type { TaskRepository, UpsertOptions } from '@/lib/store/task-repository';
import type { UploadRecordStore, UploadSummary } from '@/lib/store/upload-record-store';
import { linkOwners } from '@/lib/upload/owner-link';
import type { CommitPayload } from '@/lib/upload/upload-preview';

export type CommitFailureCode =
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_ALREADY_COMMITTED'
  | 'STORAGE_READONLY'
  | 'STORAGE_UNAVAILABLE';

export type CommitOutcome =
  | { ok: true; summary: UploadSummary }
  | { ok: false; code: CommitFailureCode; message: string };

export interface CommitDeps {
  repo: TaskRepository;
  uploads: UploadRecordStore;
  /** `store-factory`가 낸 값을 그대로 받는다. 여기서 `process.env`를 읽지 않는다 */
  readOnly: boolean;
}

/**
 * 사용자에게 보여줄 한국어 한 문장. **고정 표다** — 예외 메시지를 이어 붙이면 내부 호스트명·
 * 셀 값이 그대로 화면에 나간다 (`X1`).
 */
const FAILURE_MESSAGE: Record<CommitFailureCode, string> = {
  UPLOAD_NOT_FOUND: '해당 업로드를 찾을 수 없습니다. 파일을 다시 올려 주세요.',
  UPLOAD_ALREADY_COMMITTED: '이미 확정된 업로드입니다.',
  STORAGE_READONLY: '읽기 전용 모드입니다. 저장소 연결이 복구되어야 확정할 수 있습니다.',
  STORAGE_UNAVAILABLE: '저장소에 반영하지 못했습니다. 잠시 후 다시 확정해 주세요.',
};

function failure(code: CommitFailureCode): CommitOutcome {
  return { ok: false, code, message: FAILURE_MESSAGE[code] };
}

/** 폴백 저장소가 던지는 `StorageReadOnlyError`. `instanceof` 대신 코드로 본다 */
function isReadOnlyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'STORAGE_READONLY'
  );
}

/**
 * `runAtomically`가 없는 구현(supabase)에서는 그냥 부른다. 여기서 대신 흉내 내지 않는다 —
 * 보장하지 않는 원자성을 이름으로 보장하는 척하는 것이 이 경로에서 가장 위험한 거짓말이다.
 */
function runMaybeAtomically<T>(repo: TaskRepository, fn: () => Promise<T>): Promise<T> {
  return repo.runAtomically ? repo.runAtomically(fn) : fn();
}

/**
 * 저장소에 실제로 쓰는 유일한 자리. **`recordEvents`를 부르지 않는다** — `upsertTasks`가
 * 돌려주는 이벤트는 태스크와 같은 자리에서 **이미 저장돼 있고**(`UpsertResult.events` 주석),
 * 다시 넣으면 변경 이력이 두 벌이 된다.
 */
async function applyPayload(
  repo: TaskRepository,
  payload: CommitPayload,
  options: UpsertOptions,
): Promise<UploadSummary> {
  // 담당자 이름 → 구성원 id. **`listMembers`가 던지면 삼키지 않는다** — 바깥 `try`가 그것을
  // `STORAGE_UNAVAILABLE`로 접는다. 저장소가 죽었는데 연결만 조용히 건너뛰면 그 업로드는
  // 영구히 `unknown_owner`인 채로 남고, 그 태스크들은 `member`에게 영영 보이지 않는다.
  const members = await repo.listMembers();
  const linked = linkOwners(payload.tasks, members);

  const taskResult = await repo.upsertTasks(linked.tasks, options);
  const goalResult = await repo.upsertGoalMetrics(payload.goalMetrics, options);
  // `설정` 탭의 값 목록. 이 필드가 생기기 전의 레코드에는 없어서 `?? []`다 (`CommitPayload`)
  await repo.upsertEnumOptions(payload.enums ?? []);

  return {
    created: taskResult.created,
    updated: taskResult.updated,
    unchanged: taskResult.unchanged,
    goalMetricsCreated: goalResult.created,
    goalMetricsUpdated: goalResult.updated,
    // 경고는 미리보기 시점의 값이고 `CommitPayload`가 싣지 않는다. 확정 시점에는 셀 수 없다 —
    // 업로드 이력에 경고 수를 남기려면 payload에 실어 와야 한다 (step 7이 정한다).
    warningCount: 0,
    teamKeys: [...payload.teamKeys],
  };
}

export async function commitUpload(
  deps: CommitDeps,
  uploadId: string,
  /** 이벤트·`lastProgressAt`의 타임스탬프. **주입받는다** */
  occurredAt: string,
): Promise<CommitOutcome> {
  // 저장소를 건드리기 **전에** 막는다. 폴백 중 쓰기를 받으면 재시작 때 조용히 사라진다 (`ADR-005`)
  if (deps.readOnly) return failure('STORAGE_READONLY');

  let record;
  try {
    record = await deps.uploads.get(uploadId);
  } catch {
    return failure('STORAGE_UNAVAILABLE');
  }
  if (!record) return failure('UPLOAD_NOT_FOUND');

  // `previewing`이 아니거나 파싱 결과가 비었으면 확정할 것이 없다 (확정 즉시 비우기 때문이다)
  if (record.status !== 'previewing' || record.parseResult === null) {
    return failure('UPLOAD_ALREADY_COMMITTED');
  }
  const payload = record.parseResult;

  let summary: UploadSummary;
  try {
    summary = await runMaybeAtomically(deps.repo, () =>
      applyPayload(deps.repo, payload, { uploadId, occurredAt }),
    );
  } catch (error) {
    // `parse_result`는 남긴다 — 재시도가 같은 입력으로 돌아야 한다 (`X4`).
    // **여기서 또 던져도 삼킨다**: 저장소가 죽은 상태에서 이것까지 실패하는 건 정상이고,
    // 그 예외가 원래 실패를 덮으면 사용자는 엉뚱한 이유를 보게 된다.
    try {
      await deps.uploads.markFailed(uploadId);
    } catch {
      /* 원래 실패를 덮지 않는다 */
    }
    return failure(isReadOnlyError(error) ? 'STORAGE_READONLY' : 'STORAGE_UNAVAILABLE');
  }

  let committed;
  try {
    committed = await deps.uploads.markCommitted(uploadId, summary);
  } catch {
    return failure('STORAGE_UNAVAILABLE');
  }
  // 그 사이에 다른 요청이 먼저 확정했다. 반영은 멱등이라 데이터는 같다 — 응답만 409다
  if (!committed) return failure('UPLOAD_ALREADY_COMMITTED');

  return { ok: true, summary };
}
