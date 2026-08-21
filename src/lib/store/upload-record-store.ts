/**
 * 업로드 레코드 저장소. `ADR-008`의 **미리보기 → 확정 2단계**가 서버 세션 상태 없이
 * 성립하게 만드는 자리다 — 파싱 결과를 메모리에 들고 있으면 서버리스 인스턴스가 바뀌는
 * 순간 확정이 실패하므로 `uploads.parse_result`에 넣는다.
 *
 * **`TaskRepository`에 메서드를 더하지 않는다.** 업로드 이력은 업무와 다른 종류의 자료이고,
 * 인터페이스를 넓히면 T4의 계약 19항목과 두 구현이 전부 흔들린다.
 *
 * 이 파일이 지는 급소 둘.
 *
 * 1. **`parseResult`는 개인정보 덩어리다** (`S6`). 원본 행에 실명·연락처·문의자 계정이 있다.
 *    확정 즉시 비우고 `summary`만 남긴다 (T5 완료 기준 13). 성능이 아니라 보안 조치다.
 * 2. **같은 업로드를 두 번 확정하면 안 된다.** 사용자가 버튼을 두 번 누르는 일은 반드시
 *    일어난다. `get` → 검사 → `update` 사이에는 경합이 있으므로 **조건부 갱신**으로 막는다.
 *
 * **행은 `previewing`부터 만든다.** `validating`·`parsing`은 파일이 아직 DB에 닿기 전의
 * 클라이언트 화면 상태다 (`0001_init.sql`의 `uploads` 위 주석이 `idle`·`rejected`에 대해
 * 같은 말을 한다). 덕분에 파싱에 실패한 업로드가 테이블에 쓰레기를 쌓지 않는다.
 *
 * 판정도 집계도 하지 않는다 (`ADR-006`). 확정 자체(upsert 호출)는 이 파일이 모른다 —
 * 여기는 레코드만 안다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CommitPayload } from '@/lib/upload/upload-preview';

/** `0001_init.sql`의 check 제약과 같아야 한다 */
export type UploadStatus =
  | 'validating'
  | 'parsing'
  | 'previewing'
  | 'committing'
  | 'done'
  | 'failed';

export interface UploadSummary {
  created: number;
  updated: number;
  unchanged: number;
  goalMetricsCreated: number;
  goalMetricsUpdated: number;
  warningCount: number;
  teamKeys: string[];
}

export interface UploadRecord {
  id: string;
  kind: 'sheet' | 'doc';
  filename: string | null;
  status: UploadStatus;
  /** 확정 후에는 **반드시 null**이다 (`S6`·T5 완료 기준 13) */
  parseResult: CommitPayload | null;
  summary: UploadSummary | null;
  /** ISO 8601 */
  createdAt: string;
}

export interface UploadCreateInput {
  kind: 'sheet' | 'doc';
  filename: string | null;
  parseResult: CommitPayload;
  /** 저장소는 시계를 읽지 않는다 (`CLAUDE.md` CRITICAL) */
  createdAt: string;
}

export interface UploadRecordStore {
  create(input: UploadCreateInput): Promise<UploadRecord>;

  get(id: string): Promise<UploadRecord | null>;

  /**
   * `previewing`인 행만 `done`으로 옮기고 `parse_result`를 **비운다**.
   * 조건에 안 맞으면(없음·이미 확정됨·실패로 표시됨) `null` — 호출자가 409를 낸다.
   */
  markCommitted(id: string, summary: UploadSummary): Promise<UploadRecord | null>;

  /** 확정 실패. `parse_result`는 **남긴다** — 재시도가 같은 입력으로 돌아야 한다 */
  markFailed(id: string): Promise<UploadRecord | null>;
}

/**
 * 두 전이 모두 **`previewing`에서만** 출발한다. 확정된 행을 뒤늦게 `failed`로 되돌리거나
 * 실패한 행을 확정하는 경로가 생기면 `parse_result`가 비워진 뒤에도 상태가 흔들린다.
 */
const COMMITTABLE_STATUS: UploadStatus = 'previewing';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clone<T>(value: T): T {
  return structuredClone(value);
}

// ---------------------------------------------------------------------------
// 메모리 구현
// ---------------------------------------------------------------------------

/**
 * `Map` 하나면 충분하다. **읽기·쓰기 모두 깊은 복사**한다 — 참조를 그대로 넘기면 호출자가
 * 만진 `parseResult`가 저장소 내부를 조용히 바꾸고, 그 사고는 supabase 구현에서 재현되지
 * 않아 계약이 깨진다 (`memory-task-store`와 같은 이유).
 */
export function createMemoryUploadStore(): UploadRecordStore & { clear(): void } {
  const records = new Map<string, UploadRecord>();

  return {
    async create(input: UploadCreateInput): Promise<UploadRecord> {
      const record: UploadRecord = {
        id: crypto.randomUUID(),
        kind: input.kind,
        filename: input.filename,
        status: 'previewing',
        parseResult: clone(input.parseResult),
        summary: null,
        createdAt: input.createdAt,
      };
      records.set(record.id, record);
      return clone(record);
    },

    async get(id: string): Promise<UploadRecord | null> {
      const record = records.get(id);
      return record ? clone(record) : null;
    },

    async markCommitted(id: string, summary: UploadSummary): Promise<UploadRecord | null> {
      const record = records.get(id);
      if (!record || record.status !== COMMITTABLE_STATUS) return null;

      // `parse_result: null` — 개인정보를 여기서 버린다 (`S6`).
      const next: UploadRecord = {
        ...record,
        status: 'done',
        parseResult: null,
        summary: clone(summary),
      };
      records.set(id, next);
      return clone(next);
    },

    async markFailed(id: string): Promise<UploadRecord | null> {
      const record = records.get(id);
      if (!record || record.status !== COMMITTABLE_STATUS) return null;

      // `parseResult`는 손대지 않는다.
      const next: UploadRecord = { ...record, status: 'failed' };
      records.set(id, next);
      return clone(next);
    },

    clear(): void {
      records.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase 구현
// ---------------------------------------------------------------------------

/** PostgREST가 돌려주는 `uploads` 행. 컬럼 이름은 `0001_init.sql`과 1:1이다 */
interface UploadRow {
  id: string;
  kind: 'sheet' | 'doc';
  filename: string | null;
  parse_result: CommitPayload | null;
  status: UploadStatus;
  summary: UploadSummary | null;
  created_at: string;
}

const UPLOAD_COLUMNS = 'id,kind,filename,parse_result,status,summary,created_at';

/**
 * PostgREST 에러를 밖으로 낼 때 **파일명·행 내용을 담지 않는다** (`CLAUDE.md` 보안 규칙).
 * 남기는 것은 어느 테이블에서 무슨 동작이 무슨 코드로 실패했는지까지다.
 */
function fail(operation: string, error: { code?: string } | null): never {
  throw new Error(`Supabase ${operation} 실패 (uploads, code=${error?.code ?? 'UNKNOWN'})`);
}

/** `timestamptz`는 `+00:00` 모양으로 온다. 주입한 ISO 문자열이 그대로 돌아와야 한다 */
function toIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function toRecord(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    status: row.status,
    parseResult: row.parse_result,
    summary: row.summary,
    createdAt: toIso(row.created_at),
  };
}

export function createSupabaseUploadStore(client: SupabaseClient): UploadRecordStore {
  return {
    async create(input: UploadCreateInput): Promise<UploadRecord> {
      const { data, error } = await client
        .from('uploads')
        .insert({
          kind: input.kind,
          filename: input.filename,
          // `jsonb`라 그대로 넣고 그대로 받는다.
          parse_result: input.parseResult,
          status: 'previewing',
          summary: null,
          created_at: input.createdAt,
        })
        .select(UPLOAD_COLUMNS)
        .single();
      if (error || !data) fail('insert', error);
      return toRecord(data as unknown as UploadRow);
    },

    async get(id: string): Promise<UploadRecord | null> {
      // uuid가 아닌 문자열을 그대로 보내면 Postgres가 22P02로 던진다. 없는 id일 뿐이다.
      if (!UUID_PATTERN.test(id)) return null;

      const { data, error } = await client
        .from('uploads')
        .select(UPLOAD_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (error) fail('select', error);
      return data ? toRecord(data as unknown as UploadRow) : null;
    },

    async markCommitted(id: string, summary: UploadSummary): Promise<UploadRecord | null> {
      if (!UUID_PATTERN.test(id)) return null;

      // **조건부 갱신이 중복 확정 방어의 전부다.** `get`으로 상태를 본 뒤 갱신하면 두 요청이
      // 그 틈에 모두 통과한다. `previewing`인 행이 없으면 0행이 돌아오고 그것이 곧 409다.
      const { data, error } = await client
        .from('uploads')
        .update({ status: 'done', parse_result: null, summary })
        .eq('id', id)
        .eq('status', COMMITTABLE_STATUS)
        .select(UPLOAD_COLUMNS)
        .maybeSingle();
      if (error) fail('update', error);
      return data ? toRecord(data as unknown as UploadRow) : null;
    },

    async markFailed(id: string): Promise<UploadRecord | null> {
      if (!UUID_PATTERN.test(id)) return null;

      // `parse_result`를 건드리지 않는다 — 재시도가 같은 입력으로 돌아야 한다.
      const { data, error } = await client
        .from('uploads')
        .update({ status: 'failed' })
        .eq('id', id)
        .eq('status', COMMITTABLE_STATUS)
        .select(UPLOAD_COLUMNS)
        .maybeSingle();
      if (error) fail('update', error);
      return data ? toRecord(data as unknown as UploadRow) : null;
    },
  };
}
