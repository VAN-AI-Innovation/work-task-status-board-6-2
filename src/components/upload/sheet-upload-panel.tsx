'use client';

/**
 * 드롭존 + 업로드 상태 머신 + 두 번의 `fetch`.
 *
 * 단계 이름은 `PLAN.md`「업로드 상태 전이」를 **그대로** 옮긴 것이다. 화면이 그 다이어그램과
 * 같은 말을 해야 `ADR-008`의 2단계가 사용자에게 보인다 — 확정 버튼을 누르기 전에는 저장소에
 * 아무것도 쓰이지 않는다는 사실이 취소를 안심하게 만든다 (`UC-02`).
 *
 * 이 파일에 계산이 없다. 숫자는 서버가 준 것을 그대로 넘기고, 실패 문구도 서버가 준 것을
 * 그대로 쓴다 — 코드별 문구를 여기서 다시 만들면 같은 실패가 두 가지 문장으로 읽힌다.
 */

import Link from 'next/link';
import { useRef, useState } from 'react';

import { PreviewSummary } from '@/components/upload/preview-summary';
import type { StorageMode } from '@/lib/store/store-factory';
import type { UploadSummary } from '@/lib/store/upload-record-store';
import type { UploadPreview } from '@/lib/upload/upload-preview';
import type { ApiErrorBody } from '@/types/api';

/** `PLAN.md`「업로드 상태 전이」의 이름 그대로. 바꾸지 않는다 */
type Stage =
  | 'idle'
  | 'validating'
  | 'parsing'
  | 'previewing'
  | 'committing'
  | 'done'
  | 'rejected'
  | 'failed';

interface PreviewResponse {
  upload: { id: string; status: string; filename: string | null };
  preview: UploadPreview;
}

interface CommitResponse {
  upload: { id: string; status: string };
  summary: UploadSummary;
}

/**
 * 「파일을 되돌려보냈다」와 「읽다가 실패했다」는 사용자가 할 일이 다르다 — 앞은 다른 파일을
 * 올려야 하고 뒤는 같은 파일로 다시 시도할 수 있다. 그래서 두 단계를 나눈 다이어그램대로
 * 서버 코드를 두 갈래로만 가른다. **문구는 가르지 않는다** (문구는 서버 것을 그대로 쓴다).
 */
const REJECT_CODES: ReadonlySet<string> = new Set([
  'FILE_TOO_LARGE',
  'FILE_TYPE_MISMATCH',
  'ARCHIVE_LIMIT_EXCEEDED',
  'VALIDATION_FAILED',
]);

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

async function readApiError(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (!body?.error) return { code: '', message: UNREACHABLE_MESSAGE };
  return { code: body.error.code, message: body.error.message };
}

export function SheetUploadPanel({ readOnly, mode }: { readOnly: boolean; mode: StorageMode }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [filename, setFilename] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = stage === 'validating' || stage === 'parsing' || stage === 'committing';

  function reset() {
    setStage('idle');
    setFilename(null);
    setUploadId(null);
    setPreview(null);
    setSummary(null);
    setMessage(null);
    // 같은 파일을 다시 고를 수 있게 비운다 (같은 값이면 change가 다시 오지 않는다)
    if (inputRef.current) inputRef.current.value = '';
  }

  async function upload(file: File) {
    setFilename(file.name);
    setMessage(null);
    setPreview(null);
    setSummary(null);

    // `validating`·`parsing`은 **화면 상태**다 — 서버 왕복 한 번을 두 단계로 나눠 보여 준다.
    // 실제 판정은 서버가 하고(`checkUpload` → `runWorkbookParse`), DB 행은 `previewing`부터
    // 생긴다. `validating`은 파일을 폼에 싣는 동안이라 대개 한 프레임 안에 지나간다.
    setStage('validating');
    const form = new FormData();
    form.append('file', file);
    const pending = fetch('/api/uploads/sheet', { method: 'POST', body: form });
    setStage('parsing');

    let response: Response;
    try {
      response = await pending;
    } catch {
      setStage('failed');
      setMessage(UNREACHABLE_MESSAGE);
      return;
    }

    if (!response.ok) {
      const error = await readApiError(response);
      setStage(REJECT_CODES.has(error.code) ? 'rejected' : 'failed');
      setMessage(error.message);
      return;
    }

    const body = (await response.json()) as PreviewResponse;
    setUploadId(body.upload.id);
    setPreview(body.preview);
    setStage('previewing');
  }

  async function commit() {
    if (uploadId === null) return;
    setMessage(null);
    setStage('committing');

    let response: Response;
    try {
      response = await fetch(`/api/uploads/${uploadId}/commit`, { method: 'POST' });
    } catch {
      setStage('failed');
      setMessage(UNREACHABLE_MESSAGE);
      return;
    }

    if (!response.ok) {
      // 미리보기를 버리지 않는다 — 다이어그램의 `failed → previewing (재시도 가능)`
      const error = await readApiError(response);
      setStage('failed');
      setMessage(error.message);
      return;
    }

    const body = (await response.json()) as CommitResponse;
    setSummary(body.summary);
    setStage('done');
  }

  /** 다이어그램의 되돌림 두 갈래. 미리보기가 남아 있으면 확정만 다시, 없으면 파일부터 다시 */
  function retry() {
    if (preview === null) {
      reset();
      return;
    }
    setMessage(null);
    setStage('previewing');
  }

  function handleFiles(files: FileList | null) {
    const file = files?.item(0);
    if (!file || readOnly) return;
    void upload(file);
  }

  return (
    <div className="space-y-6">
      {stage !== 'done' && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleFiles(event.dataTransfer.files);
          }}
          className={`rounded-md border border-dashed p-8 text-center ${
            dragging ? 'border-ink bg-raise' : 'border-line bg-panel'
          } ${readOnly ? 'opacity-50' : ''}`}
        >
          <p className="text-sm text-ink-body">
            시트 .xlsx 파일을 여기에 끌어다 놓거나 파일을 선택하세요.
          </p>
          <label
            className={`mt-3 inline-block rounded border border-line bg-panel px-4 py-2 text-sm text-ink ${
              readOnly || busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-raise'
            }`}
          >
            파일 선택
            <input
              ref={inputRef}
              type="file"
              // `accept`는 편의일 뿐이다. 최종 판별은 서버가 ZIP 내부 엔트리로 한다 (`S3`)
              accept=".xlsx"
              className="hidden"
              disabled={readOnly || busy}
              onChange={(event) => handleFiles(event.target.files)}
            />
          </label>
          <p className="mt-3 text-xs text-ink-muted">확정 전에는 저장되지 않습니다.</p>
          {mode === 'demo' && (
            <p className="mt-1 text-xs text-ink-muted">
              샘플 데이터 모드입니다. 반영 결과는 서버를 다시 시작하면 사라집니다.
            </p>
          )}
        </div>
      )}

      {filename !== null && (
        <p className="text-xs text-ink-muted">
          파일: <span className="text-ink-body">{filename}</span>
        </p>
      )}

      {busy && (
        <p className="text-sm text-ink-body">
          {stage === 'validating' && '파일을 확인하는 중…'}
          {stage === 'parsing' && '시트를 읽는 중…'}
          {stage === 'committing' && '반영하는 중…'}
        </p>
      )}

      {/* 서버가 준 문장을 그대로 보여 준다. 코드별 문구를 여기서 다시 만들지 않는다 */}
      {message !== null && (stage === 'rejected' || stage === 'failed') && (
        <div className="rounded border border-late-line bg-late-bg px-3 py-2 text-sm text-late">
          <p>{message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-2 rounded border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-raise"
          >
            {preview === null ? '다시 올리기' : '다시 시도'}
          </button>
        </div>
      )}

      {preview !== null && (stage === 'previewing' || stage === 'committing' || stage === 'failed') && (
        <>
          <PreviewSummary preview={preview} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={readOnly || stage !== 'previewing'}
              className={`rounded bg-brand text-canvas px-4 py-2 text-sm ${
                readOnly || stage !== 'previewing'
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:bg-brand-strong'
              }`}
            >
              확정하기
            </button>
            {/* 취소는 **아무 요청도 보내지 않는다** — 미리보기 단계에서 저장소에 쓰인 것이 없다 */}
            <button
              type="button"
              onClick={reset}
              disabled={stage === 'committing'}
              className="rounded border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-raise"
            >
              취소
            </button>
            <span className="text-xs text-ink-muted">
              확정하면 위 숫자대로 반영됩니다. 취소하면 아무것도 저장되지 않습니다.
            </span>
          </div>
        </>
      )}

      {stage === 'done' && summary !== null && (
        <section className="rounded-md border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink">반영 완료</h2>
          <p className="mt-2 text-sm text-ink-body">
            신규 <span className="tabular-nums">{summary.created}</span>건 · 변경{' '}
            <span className="tabular-nums">{summary.updated}</span>건 · 유지{' '}
            <span className="tabular-nums">{summary.unchanged}</span>건
          </p>
          <div className="mt-4 flex items-center gap-3">
            {/* 자동으로 옮기지 않는다 — 사용자가 숫자를 읽을 시간을 뺏는다 */}
            <Link
              href="/"
              className="rounded bg-brand text-canvas px-4 py-2 text-sm hover:bg-brand-strong"
            >
              현황판으로 가기
            </Link>
            <button
              type="button"
              onClick={reset}
              className="rounded border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-raise"
            >
              다른 파일 올리기
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
