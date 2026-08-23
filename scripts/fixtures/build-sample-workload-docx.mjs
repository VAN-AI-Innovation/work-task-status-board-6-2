#!/usr/bin/env node
/**
 * src/lib/fixtures/sample-workload.docx 생성 스크립트.
 *
 *   node scripts/fixtures/build-sample-workload-docx.mjs   # 생성 (npm run fixture:docx)
 *
 * 이 스크립트가 픽스처의 명세이고 .docx는 그 산출물이다. `.docx`는 바이너리라 픽스처로
 * 최악이고(ADR-010) git diff로 내용을 볼 수 없다 — 그래서 손으로 만들어 커밋하지 않고
 * 여기서 생성한다. 리뷰어가 "픽스처에 무엇이 들어 있는가"를 읽을 자리가 이 파일이다.
 *
 * **이 픽스처가 증명하는 것은 mammoth 경로가 살아 있다는 사실 하나다.** 아웃라인 로직은
 * sample-workload.md가 전부 덮으므로 여기에는 그 md의 앞부분만 옮긴다 —
 * 대분류 1개 + 번호 없는 절 1개 + 과제 2개 + 「워크로드 공유」 절.
 *
 * 구조는 최소다. mammoth가 읽는 데 필요한 ZIP 엔트리는 셋뿐이고
 * (`[Content_Types].xml` · `_rels/.rels` · `word/document.xml`),
 * `word/styles.xml`은 **일부러 넣지 않는다** — mammoth 기본 styleMap이 스타일 **ID**로도
 * 걸어서 `Heading1`~`Heading3`이 `h1`~`h3`으로 인식된다(H8: 기본 옵션 PASS). 스타일 정의가
 * 없어 경고 메시지는 나오지만 변환 결과는 같다. 목록 문단은 `<p>`로 떨어지는데,
 * 리더가 `p`와 `li`를 같은 「본문 줄」로 다루므로 문제가 되지 않는다.
 *
 * 압축하지 않는다(stored). zip 라이브러리 없이 로컬 헤더·중앙 디렉토리·EOCD를 직접 쓰고
 * 타임스탬프를 고정값으로 박아 **재실행해도 같은 바이트**가 나오게 한다 — 매번 diff가
 * 생기면 픽스처가 커밋 잡음이 된다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_PATH = fileURLToPath(
  new URL('../../src/lib/fixtures/sample-workload.docx', import.meta.url),
);

// ---------------------------------------------------------------------------
// 문서 내용 — sample-workload.md의 앞부분을 그대로 옮긴 익명 데이터다
// ---------------------------------------------------------------------------

/** `[스타일 ID, 텍스트]`. 스타일 ID가 null이면 본문 문단이다 */
const PARAGRAPHS = [
  ['Heading1', '[샘플] 26-2 워크로드'],
  ['Heading2', '1. 콘텐츠 제작'],
  ['Heading3', '작성 안내'],
  [null, '이 절은 번호 접두사가 없다. 과제로 잡히면 안 된다.'],
  ['Heading3', '1-1. 숏폼 시리즈 기획 (上) (9/1까지)'],
  [null, '레퍼런스 20건 수집'],
  [null, '시리즈 컨셉 3안 도출'],
  ['Heading3', '1-2. 썸네일 A/B 테스트 (中上)'],
  [null, '+15% 노출 개선을 목표로 시안 4종 제작'],
  ['Heading2', '워크로드 공유'],
  ['Heading3', 'P0'],
  [null, '1-1'],
  ['Heading3', 'P1'],
  [null, '1-2'],
];

const xmlEscape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function paragraphXml([styleId, text]) {
  const props = styleId === null ? '' : `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`;
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const ENTRIES = [
  [
    '[Content_Types].xml',
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  ],
  [
    '_rels/.rels',
    `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  ],
  [
    'word/document.xml',
    `${DECLARATION}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      PARAGRAPHS.map(paragraphXml).join('') +
      '</w:body></w:document>',
  ],
];

// ---------------------------------------------------------------------------
// 최소 ZIP 작성기 — stored(무압축), 타임스탬프 고정
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 고정 타임스탬프: 2026-01-01 00:00. DOS 날짜는 1980 기준이고 0은 유효한 날짜가 아니다 */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // 로컬 헤더 시그니처
    local.writeUInt16LE(20, 4); // 버전
    local.writeUInt16LE(0, 6); // 플래그
    local.writeUInt16LE(0, 8); // 압축 방식 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 압축 크기 = 원본 크기
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra 없음
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // 중앙 디렉토리 시그니처
    central.writeUInt16LE(20, 4); // 만든 버전
    central.writeUInt16LE(20, 6); // 필요한 버전
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // 디스크 번호
    central.writeUInt16LE(0, 36); // 내부 속성
    central.writeUInt32LE(0, 38); // 외부 속성
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // 디스크 번호
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 코멘트 없음

  return Buffer.concat([...locals, centralBytes, eocd]);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
const zip = buildZip(ENTRIES);
writeFileSync(OUT_PATH, zip);
console.log(`생성: ${OUT_PATH} (${zip.length} bytes, 문단 ${PARAGRAPHS.length}개)`);
