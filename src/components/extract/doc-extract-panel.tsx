'use client';

/**
 * 드롭존 + 추출 상태 머신 + 두 번의 `fetch`.
 *
 * `sheet-upload-panel.tsx`와 **모양은 닮았지만 상태 머신이 다르다.** 저장하는 것이 없으니
 * 확정 단계도 없고 취소에 의미도 없다 (`ADR-022` — 두 라우트 모두 아무것도 저장하지 않는다).
 * 그래서 둘을 공통 컴포넌트로 묶지 않았다: 묶으면 「확정이 있는 쪽/없는 쪽」 분기가 파일마다
 * 흩어져 두 화면 다 읽기 어려워진다.
 *
 *   idle → validating → parsing → previewing → (내려받기)
 *            ↓ rejected   ↓ failed
 *
 * 이 파일에 계산이 없다. 하는 일은 상태 전이와 `fetch`뿐이고 **행을 가공하지 않는다** —
 * 실패 문구도 서버가 준 것을 그대로 쓴다. 코드별 문구를 여기서 다시 만들면 같은 실패가
 * 두 가지 문장으로 읽힌다.
 */

import Link from 'next/link';
import { useRef, useState } from 'react';

import { AssignmentPreview } from '@/components/extract/assignment-preview';
import type { ApiErrorBody } from '@/types/api';
import type { AssignmentRow } from '@/types/doc';

type Stage = 'idle' | 'validating' | 'parsing' | 'previewing' | 'rejected' | 'failed';

interface ExtractResponse {
  rows: AssignmentRow[];
  warnings: string[];
  baseYear: number;
}

/**
 * 「파일을 되돌려보냈다」와 「읽다가 실패했다」는 사용자가 할 일이 다르다. `sheet-upload-panel`과
 * 같은 집합을 쓴다 — 두 화면이 같은 에러 코드를 다르게 분류하면 같은 실패가 화면마다
 * 다른 성격으로 보인다. **문구는 여기서 가르지 않는다** (서버 것을 그대로 쓴다).
 */
const REJECT_CODES: ReadonlySet<string> = new Set([
  'FILE_TOO_LARGE',
  'FILE_TYPE_MISMATCH',
  'ARCHIVE_LIMIT_EXCEEDED',
  'VALIDATION_FAILED',
]);

/** 서버가 `{error:{code,message}}`를 주지 못했을 때(네트워크 끊김 등)만 쓰는 한 문장 */
const UNREACHABLE_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/**
 * 내려받는 파일 이름. **서버의 `Content-Disposition`은 이 경로에 닿지 않는다** —
 * `fetch` + `blob`으로 받으면 이름을 정하는 것은 `<a download>`다. 서버 헤더는 라우트를
 * 직접 부르는 쪽(curl 등)을 위해 그대로 두고, 화면은 여기서 이름을 준다.
 */
const DOWNLOAD_FILENAME = '업무 배정표.xlsx';

async function readApiError(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (!body?.error) return { code: '', message: UNREACHABLE_MESSAGE };
  return { code: body.error.code, message: body.error.message };
}

export function DocExtractPanel() {
  const [stage, setStage] = useState<Stage>('idle');
  const [filename, setFilename] = useState<string | null>(null);
  const [rows, setRows] = useState<AssignmentRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [baseYear, setBaseYear] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = stage === 'validating' || stage === 'parsing';

  function reset() {
    setStage('idle');
    setFilename(null);
    setRows(null);
    setWarnings([]);
    setBaseYear(null);
    setMessage(null);
    setDownloading(false);
    setDownloaded(false);
    // 같은 파일을 다시 고를 수 있게 비운다 (같은 값이면 change가 다시 오지 않는다)
    if (inputRef.current) inputRef.current.value = '';
  }

  async function extract(file: File) {
    setFilename(file.name);
    setMessage(null);
    setRows(null);
    setWarnings([]);
    setBaseYear(null);
    setDownloaded(false);

    // `validating`·`parsing`은 **화면 상태**다 — 서버 왕복 한 번을 두 단계로 나눠 보여 준다.
    // 실제 판정은 서버가 한다 (`checkUpload` → `runDocExtract`).
    setStage('validating');
    const form = new FormData();
    form.append('file', file);
    const pending = fetch('/api/uploads/doc', { method: 'POST', body: form });
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

    const body = (await response.json()) as ExtractResponse;
    setRows(body.rows);
    setWarnings(body.warnings);
    setBaseYear(body.baseYear);
    setStage('previewing');
  }

  async function download() {
    if (rows === null) return;
    setMessage(null);
    setDownloading(true);

    let response: Response;
    try {
      response = await fetch('/api/export/assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
    } catch {
      setDownloading(false);
      setStage('failed');
      setMessage(UNREACHABLE_MESSAGE);
      return;
    }

    if (!response.ok) {
      // 미리보기를 버리지 않는다 — 같은 행으로 다시 시도할 수 있다
      const error = await readApiError(response);
      setDownloading(false);
      setStage('failed');
      setMessage(error.message);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = DOWNLOAD_FILENAME;
    anchor.click();
    // 브라우저가 blob을 붙들고 있지 않도록 되돌려준다. 두지 않으면 탭이 살아 있는 동안
    // 파일 하나만큼의 메모리가 계속 남는다
    URL.revokeObjectURL(url);

    setDownloading(false);
    setDownloaded(true);
    setStage('previewing');
  }

  /** 되돌림 두 갈래. 미리보기가 남아 있으면 내려받기만 다시, 없으면 파일부터 다시 */
  function retry() {
    if (rows === null) {
      reset();
      return;
    }
    setMessage(null);
    setStage('previewing');
  }

  function handleFiles(files: FileList | null) {
    const file = files?.item(0);
    if (!file) return;
    void extract(file);
  }

  return (
    <div className="space-y-6">
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
        }`}
      >
        <p className="text-ink-body text-sm">
          워크로드 .docx 파일을 여기에 끌어다 놓거나 파일을 선택하세요.
        </p>
        <label
          className={`border-line bg-panel text-ink mt-3 inline-block rounded border px-4 py-2 text-sm ${
            busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-raise cursor-pointer'
          }`}
        >
          파일 선택
          <input
            ref={inputRef}
            type="file"
            // `accept`는 편의일 뿐이다. 최종 판별은 서버가 ZIP 내부 엔트리로 한다 (`S3`) —
            // `.xlsx`와 `.docx`는 둘 다 `PK\x03\x04`로 시작해 확장자·매직넘버로는 갈리지 않는다
            accept=".docx"
            className="hidden"
            disabled={busy}
            onChange={(event) => handleFiles(event.target.files)}
          />
        </label>
        <p className="text-ink-muted mt-3 text-xs">
          문서는 저장되지 않습니다. 배정표를 만들어 내려보내기만 합니다.
        </p>
      </div>

      {filename !== null && (
        <p className="text-ink-muted text-xs">
          파일: <span className="text-ink-body">{filename}</span>
        </p>
      )}

      {busy && (
        <p className="text-ink-body text-sm">
          {stage === 'validating' && '파일을 확인하는 중…'}
          {stage === 'parsing' && '문서를 읽는 중…'}
        </p>
      )}

      {/* 서버가 준 문장을 그대로 보여 준다. 코드별 문구를 여기서 다시 만들지 않는다 */}
      {message !== null && (stage === 'rejected' || stage === 'failed') && (
        <div className="border-late-line bg-late-bg text-late rounded border px-3 py-2 text-sm">
          <p>{message}</p>
          <button
            type="button"
            onClick={retry}
            className="border-line bg-panel text-ink hover:bg-raise mt-2 rounded border px-4 py-2 text-sm"
          >
            {rows === null ? '다시 올리기' : '다시 시도'}
          </button>
        </div>
      )}

      {rows !== null && (stage === 'previewing' || stage === 'failed') && (
        <>
          <AssignmentPreview rows={rows} warnings={warnings} />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void download()}
              disabled={downloading}
              className={`bg-brand text-canvas rounded px-4 py-2 text-sm ${
                downloading ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-strong'
              }`}
            >
              배정표 xlsx 내려받기
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={downloading}
              className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
            >
              다른 문서 올리기
            </button>
            <span className="text-ink-muted text-xs">
              {downloading
                ? '배정표를 만드는 중…'
                : '상태·난이도·우선순위 칸에 드롭다운이 붙어 나갑니다.'}
            </span>
          </div>

          {/* 연도 없는 마감(`9/1`)을 무엇으로 읽었는지 밝힌다. 이 숫자를 모르면 사용자는
              배정표의 연도가 어디서 왔는지 알 수 없다 */}
          {baseYear !== null && (
            <p className="text-ink-muted text-xs">
              연도가 없는 마감 표기는 {baseYear}년 기준으로 읽었습니다.
            </p>
          )}

          {downloaded && (
            <section className="border-line bg-panel rounded-md border p-5">
              <h2 className="text-ink text-sm font-semibold">내려받았습니다</h2>
              <p className="text-ink-body mt-2 text-sm">
                담당자·상태·진행률을 채워서 시트 업로드에 올리면 현황판에 반영됩니다.
              </p>
              <div className="mt-4">
                {/* 자동으로 옮기지 않는다 — 파일을 채우는 것이 먼저다 */}
                <Link
                  href="/upload"
                  className="bg-brand text-canvas hover:bg-brand-strong rounded px-4 py-2 text-sm"
                >
                  시트 업로드로 가기
                </Link>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
