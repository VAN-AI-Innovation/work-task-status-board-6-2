/**
 * 문 앞의 판정이다. 여기가 뚫리면 뒤의 모든 상한이 의미를 잃는다.
 *
 * 가장 중요한 테스트는 **「`.docx`로 위장한 `.xlsx`가 거부된다」**(`S3`)와
 * **「`.xlsx`로 위장한 압축 폭탄이 거부된다」**(`S2`) 둘이다. 앞엣것이 없으면 파서가 예상 못 한
 * 지점에서 터지고, 뒤엣것이 없으면 서버가 OOM으로 죽는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_UPLOAD_BYTES,
} from '@/lib/upload/upload-limits';
import { checkUpload } from '@/lib/upload/upload-guard';

const SHEET_BYTES = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url))),
);

/**
 * 중앙 디렉토리만 손으로 짓는다 — `uncompressedSize`가 위조 가능하다는 사실을 그대로 쓴다.
 * 실제 압축 데이터는 없다. `inspectZip`이 중앙 디렉토리만 읽기 때문에 그것으로 충분하고,
 * 진짜 폭탄을 만들어 테스트에 두는 것보다 안전하다.
 */
function forgeZip(entries: readonly { name: string; uncompressedSize: number }[]): Uint8Array {
  const encoder = new TextEncoder();
  const headers = entries.map((entry) => {
    const name = encoder.encode(entry.name);
    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 0, true);
    view.setUint32(24, entry.uncompressedSize, true);
    view.setUint16(28, name.length, true);
    header.set(name, 46);
    return header;
  });

  const centralSize = headers.reduce((sum, header) => sum + header.length, 0);
  const bytes = new Uint8Array(centralSize + 22);
  let offset = 0;
  for (const header of headers) {
    bytes.set(header, offset);
    offset += header.length;
  }

  const eocd = new DataView(bytes.buffer, centralSize, 22);
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, 0, true);
  return bytes;
}

const WORKBOOK_ENTRY = { name: 'xl/workbook.xml', uncompressedSize: 1_024 };
const DOCUMENT_ENTRY = { name: 'word/document.xml', uncompressedSize: 1_024 };

describe('checkUpload — 통과', () => {
  it('실제 픽스처 xlsx가 sheet로 통과한다', () => {
    expect(checkUpload({ filename: 'sample.xlsx', bytes: SHEET_BYTES, expect: 'sheet' })).toEqual({
      ok: true,
    });
  });

  it('확장자 대소문자를 가리지 않는다', () => {
    expect(checkUpload({ filename: 'SAMPLE.XLSX', bytes: SHEET_BYTES, expect: 'sheet' }).ok).toBe(true);
  });

  it('docx 엔트리를 가진 zip이 doc으로 통과한다', () => {
    const bytes = forgeZip([DOCUMENT_ENTRY]);
    expect(checkUpload({ filename: 'workload.docx', bytes, expect: 'doc' }).ok).toBe(true);
  });
});

describe('checkUpload — 크기 (A7)', () => {
  it('4MB를 넘으면 FILE_TOO_LARGE', () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const result = checkUpload({ filename: 'big.xlsx', bytes, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
  });

  it('정확히 4MB는 크기로 거부되지 않는다 — 경계는 초과부터다', () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES);
    const result = checkUpload({ filename: 'edge.xlsx', bytes, expect: 'sheet' });
    // ZIP이 아니므로 형식으로는 걸리되, 크기로는 걸리지 않는다
    expect(result).toMatchObject({ ok: false, code: 'FILE_TYPE_MISMATCH' });
  });

  it('빈 파일은 VALIDATION_FAILED', () => {
    const result = checkUpload({ filename: 'empty.xlsx', bytes: new Uint8Array(0), expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('checkUpload — 종류 판별 (S3)', () => {
  it('.docx로 위장한 xlsx가 거부된다', () => {
    const result = checkUpload({ filename: 'disguised.docx', bytes: SHEET_BYTES, expect: 'doc' });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TYPE_MISMATCH' });
  });

  it('확장자는 맞지만 내부 엔트리가 다르면 거부된다 — 최종 판별은 내부 구조다', () => {
    const bytes = forgeZip([DOCUMENT_ENTRY]);
    const result = checkUpload({ filename: 'trap.xlsx', bytes, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TYPE_MISMATCH' });
  });

  it('ZIP이 아니면 거부된다 — 둘 다 PK로 시작하므로 매직넘버만으로는 부족하다', () => {
    const bytes = new TextEncoder().encode('이것은 워크북이 아니다');
    const result = checkUpload({ filename: 'note.xlsx', bytes, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TYPE_MISMATCH' });
  });

  it('알 수 없는 확장자는 거부된다', () => {
    const result = checkUpload({ filename: 'sheet.csv', bytes: SHEET_BYTES, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'FILE_TYPE_MISMATCH' });
  });
});

describe('checkUpload — 압축 폭탄 (S2)', () => {
  it('해제 총량 50MB 초과가 거부된다', () => {
    const bytes = forgeZip([
      WORKBOOK_ENTRY,
      { name: 'xl/worksheets/sheet1.xml', uncompressedSize: MAX_ARCHIVE_UNCOMPRESSED_BYTES },
    ]);
    const result = checkUpload({ filename: 'bomb.xlsx', bytes, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'ARCHIVE_LIMIT_EXCEEDED' });
  });

  it('엔트리 수 512 초과가 거부된다', () => {
    const entries = [WORKBOOK_ENTRY];
    for (let i = 0; i < MAX_ARCHIVE_ENTRIES; i += 1) {
      entries.push({ name: `xl/worksheets/sheet${i}.xml`, uncompressedSize: 16 });
    }
    const result = checkUpload({ filename: 'many.xlsx', bytes: forgeZip(entries), expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'ARCHIVE_LIMIT_EXCEEDED' });
  });

  it('한도 검사가 종류 판별보다 먼저다 — 폭탄을 열어보고 판단하지 않는다', () => {
    const bytes = forgeZip([
      DOCUMENT_ENTRY,
      { name: 'word/media/x.png', uncompressedSize: MAX_ARCHIVE_UNCOMPRESSED_BYTES },
    ]);
    const result = checkUpload({ filename: 'bomb.xlsx', bytes, expect: 'sheet' });
    expect(result).toMatchObject({ ok: false, code: 'ARCHIVE_LIMIT_EXCEEDED' });
  });
});

describe('checkUpload — 메시지 위생 (X1)', () => {
  it('거부 메시지에 파일명·경로·스택이 담기지 않는다', () => {
    const result = checkUpload({
      filename: '/Users/someone/실명 연락처.xlsx',
      bytes: new TextEncoder().encode('nope'),
      expect: 'sheet',
    });

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.message;
    // 안내 문구가 `.xlsx`를 말하는 것은 정상이다. 막으려는 것은 **사용자가 준 문자열의 반사**다
    expect(message).not.toContain('실명');
    expect(message).not.toContain('연락처');
    expect(message).not.toContain('/Users/');
    expect(message).not.toContain('\n');
    expect(message.length).toBeGreaterThan(0);
  });
});
