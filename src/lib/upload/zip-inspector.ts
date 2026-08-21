/**
 * ZIP 중앙 디렉토리만 읽어 **사실을 보고한다.** 한도 초과 여부는 판단하지 않는다 —
 * 그건 `upload-guard`의 일이다.
 *
 * **압축을 풀지 않는다.** 압축 폭탄을 막으려고 만든 코드가 압축 폭탄을 터뜨리게 되기 때문이다.
 * 중앙 디렉토리가 신고한 크기만 읽고, 그 값이 위조될 수 있다는 사실은 `upload-guard`가
 * 압축본 4MB 상한으로 뒷받침한다 (S2).
 *
 * 엔트리 이름은 **종류 판별에만** 쓰고 파일 시스템에 쓰지 않으므로 경로 순회(`../`) 검사를
 * 하지 않는다. 나중에 누군가 여기서 압축을 풀기 시작하면 그때 필요해진다.
 */

/** 신뢰할 수 없는 바이트를 가장 먼저 만지는 코드다. 어떤 입력에도 예외를 던지지 않는다. */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
/** ZIP 주석은 최대 65,535바이트다. EOCD 22바이트를 더한 만큼만 뒤에서 훑는다 */
const EOCD_SEARCH_WINDOW = 65_535 + EOCD_MIN_SIZE;
/** 실제 값이 ZIP64 extra field에 있다는 표식. 파싱하지 않고 `untrusted`로 넘긴다 */
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipInspection {
  entries: ZipEntry[];
  /** 엔트리들의 `uncompressedSize` 합 */
  totalUncompressedSize: number;
  /** ZIP64 등으로 크기를 신고하지 않은 아카이브. **신뢰하지 않고 거부한다** */
  untrusted: boolean;
}

/** ZIP64로 크기가 가려진 아카이브. 엔트리를 못 읽어도 거부 판정은 내릴 수 있다 */
const UNTRUSTED: ZipInspection = { entries: [], totalUncompressedSize: 0, untrusted: true };

/** 끝에서부터 EOCD를 찾는다. 주석 길이가 버퍼와 앞뒤가 맞는 것만 EOCD로 인정한다 */
function findEocdOffset(view: DataView): number | null {
  const length = view.byteLength;
  const earliest = Math.max(0, length - EOCD_SEARCH_WINDOW);
  for (let offset = length - EOCD_MIN_SIZE; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_MIN_SIZE + commentLength === length) return offset;
  }
  return null;
}

/** ZIP이 아니거나 구조가 깨졌으면 `null`. **예외를 던지지 않는다** */
export function inspectZip(bytes: Uint8Array): ZipInspection | null {
  if (bytes.byteLength < EOCD_MIN_SIZE) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocdOffset(view);
  if (eocd === null) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount === ZIP64_MARKER_16 || centralOffset === ZIP64_MARKER_32) return UNTRUSTED;
  if (centralOffset >= bytes.byteLength) return null;

  const entries: ZipEntry[] = [];
  let totalUncompressedSize = 0;
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > bytes.byteLength) return null;
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE) return null;

    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    if (compressedSize === ZIP64_MARKER_32 || uncompressedSize === ZIP64_MARKER_32) {
      return UNTRUSTED;
    }

    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const nameStart = cursor + CENTRAL_HEADER_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) return null;

    entries.push({
      name: new TextDecoder().decode(bytes.subarray(nameStart, nameEnd)),
      compressedSize,
      uncompressedSize,
    });
    totalUncompressedSize += uncompressedSize;
    cursor = nameEnd + extraLength + commentLength;
  }

  return { entries, totalUncompressedSize, untrusted: false };
}
