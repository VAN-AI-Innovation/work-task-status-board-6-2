/**
 * 업로드 문 앞의 판정. **신뢰할 수 없는 바이트를 파서에 넘겨도 되는지**만 정한다.
 *
 * step 0이 남긴 두 조각을 여기서 합친다 — `upload-limits.ts`가 숫자를, `zip-inspector.ts`가
 * 사실을 갖고 있고, 이 파일이 **판단**을 진다. 셋을 한 파일에 두지 않은 이유는 숫자를 고칠
 * 때와 판정을 고칠 때가 서로 다른 순간이기 때문이다.
 *
 * 짊어지는 판단은 셋이다.
 *
 * 1. **크기** (`A7`) — 압축본 4MB. Vercel 서버리스 본문 한도(4.5MB)보다 확실히 아래다.
 * 2. **종류** (`S3`) — `.xlsx`와 `.docx`는 **둘 다 `PK\x03\x04`로 시작**한다. 매직넘버로는
 *    구분되지 않으므로 ZIP 내부 엔트리(`xl/workbook.xml` / `word/document.xml`)로 판별한다.
 *    확장자는 1차 필터일 뿐이고, **최종 판별은 내부 구조**다.
 * 3. **압축 폭탄** (`S2`) — 중앙 디렉토리가 신고한 해제 총량과 엔트리 수. 압축을 풀지 않는다.
 *
 * **한도가 종류보다 먼저다.** 폭탄인지 아닌지를 정하려고 폭탄을 열어보면 안 된다.
 *
 * 예외를 던지지 않는다 — 모든 결말이 `UploadCheck`다. 라우트가 `try/catch`로 갈래를 나누기
 * 시작하면 계산이 라우트로 샌다 (`ARCHITECTURE.md` 계층 경계).
 */

import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_UPLOAD_BYTES,
} from '@/lib/upload/upload-limits';
import { inspectZip } from '@/lib/upload/zip-inspector';

/** 넷 다 「중단」 강도다. 저장소를 건드리기 전에 끝난다 */
export type UploadRejectCode =
  | 'VALIDATION_FAILED'
  | 'FILE_TOO_LARGE'
  | 'FILE_TYPE_MISMATCH'
  | 'ARCHIVE_LIMIT_EXCEEDED';

export type UploadKind = 'sheet' | 'doc';

export type UploadCheck = { ok: true } | { ok: false; code: UploadRejectCode; message: string };

/**
 * 사용자에게 보여줄 한국어 한 문장. **고정 표다** — 파일명·경로·셀 값을 담지 않는다 (`X1`·`S6`).
 * 파일명은 사용자가 준 문자열이라 그대로 되돌려주면 그 자체가 반사형 노출 경로가 된다.
 */
const MESSAGES: Record<UploadRejectCode, string> = {
  VALIDATION_FAILED: '올릴 파일을 찾지 못했습니다. 파일을 선택해 다시 시도해 주세요.',
  FILE_TOO_LARGE: '파일이 너무 큽니다. 4MB 이하로 줄이거나 탭을 나눠 올려 주세요.',
  FILE_TYPE_MISMATCH: '지원하지 않는 파일 형식입니다. 시트는 .xlsx, 문서는 .docx로 올려 주세요.',
  ARCHIVE_LIMIT_EXCEEDED: '파일이 처리 한도를 넘습니다. 시트나 행·열을 줄여 다시 올려 주세요.',
};

const reject = (code: UploadRejectCode): UploadCheck => ({ ok: false, code, message: MESSAGES[code] });

/** 확장자와 「반드시 있어야 할 ZIP 엔트리」를 짝지어 둔다. 종류가 늘면 이 표만 는다 */
const KIND_SIGNATURE: Record<UploadKind, { extension: string; entry: string }> = {
  sheet: { extension: '.xlsx', entry: 'xl/workbook.xml' },
  doc: { extension: '.docx', entry: 'word/document.xml' },
};

export interface UploadCheckInput {
  filename: string;
  /**
   * **`file.size`가 아니라 실제로 읽은 바이트다.** 멀티파트가 신고한 길이는 본문과 다를 수
   * 있고, 다르다면 우리가 파서에 넘기는 것은 신고값이 아니라 이 배열이다.
   */
  bytes: Uint8Array;
  expect: UploadKind;
}

export function checkUpload({ filename, bytes, expect: kind }: UploadCheckInput): UploadCheck {
  if (bytes.byteLength === 0) return reject('VALIDATION_FAILED');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return reject('FILE_TOO_LARGE');

  const signature = KIND_SIGNATURE[kind];
  if (!filename.toLowerCase().endsWith(signature.extension)) return reject('FILE_TYPE_MISMATCH');

  const inspection = inspectZip(bytes);
  if (inspection === null) return reject('FILE_TYPE_MISMATCH');

  // ZIP64로 크기를 가린 아카이브는 신고값을 읽을 수 없다. **모르면 거부한다** (`S2`)
  if (inspection.untrusted) return reject('ARCHIVE_LIMIT_EXCEEDED');
  if (inspection.entries.length > MAX_ARCHIVE_ENTRIES) return reject('ARCHIVE_LIMIT_EXCEEDED');
  if (inspection.totalUncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    return reject('ARCHIVE_LIMIT_EXCEEDED');
  }

  // 여기가 `S3`의 실체다. 확장자를 통과한 뒤에도 내부가 다르면 거부한다
  if (!inspection.entries.some((entry) => entry.name === signature.entry)) {
    return reject('FILE_TYPE_MISMATCH');
  }

  return { ok: true };
}
