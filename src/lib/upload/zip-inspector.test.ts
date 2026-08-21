/**
 * 인스펙터는 **사실만 보고한다.** 한도 판정은 `upload-guard`의 일이라 여기서 검증하지 않는다.
 *
 * 가장 중요한 테스트는 "어떤 입력에도 예외를 던지지 않는다"다. 이 함수는 신뢰할 수 없는
 * 바이트를 가장 먼저 만지는 코드고, 여기서 던지면 라우트가 500으로 죽는다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inspectZip } from '@/lib/upload/zip-inspector';

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const FIXTURE = new Uint8Array(readFileSync(FIXTURE_PATH));

describe('inspectZip', () => {
  it('픽스처 xlsx에서 `xl/workbook.xml` 엔트리를 찾는다', () => {
    const inspection = inspectZip(FIXTURE);

    expect(inspection).not.toBeNull();
    expect(inspection?.entries.map((entry) => entry.name)).toContain('xl/workbook.xml');
    expect(inspection?.untrusted).toBe(false);
  });

  it('해제 총량이 압축된 파일 크기보다 크다', () => {
    const inspection = inspectZip(FIXTURE);

    expect(inspection?.totalUncompressedSize).toBeGreaterThan(0);
    expect(inspection?.totalUncompressedSize).toBeGreaterThan(FIXTURE.length);
  });

  it('ZIP이 아닌 바이트는 null', () => {
    expect(inspectZip(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(inspectZip(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('앞이 잘려나간 아카이브는 null — 예외를 던지지 않는다', () => {
    const truncated = FIXTURE.slice(Math.floor(FIXTURE.length / 2));

    expect(() => inspectZip(truncated)).not.toThrow();
    expect(inspectZip(truncated)).toBeNull();
  });

  it('빈 배열은 null', () => {
    expect(inspectZip(new Uint8Array(0))).toBeNull();
  });
});
