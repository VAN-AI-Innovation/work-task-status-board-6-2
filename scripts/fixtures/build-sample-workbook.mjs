#!/usr/bin/env node
/**
 * src/lib/fixtures/sample-workbook.xlsx 생성 스크립트.
 *
 *   node scripts/fixtures/build-sample-workbook.mjs            # 생성
 *   node scripts/fixtures/build-sample-workbook.mjs --verify   # 생성물 자체 점검
 *
 * 이 스크립트가 픽스처의 명세이고 xlsx는 그 산출물이다. 바이너리를 손으로 만들어
 * 커밋하면 리뷰어가 "픽스처에 무엇이 들어 있는가"를 볼 수 없다 — T2·T3 테스트의 전제가
 * 전부 그 답에 달려 있다.
 *
 * 구조는 실업무 시트(`smoke-input/`)의 실측(scripts/smoke/RESULT.md「A7」)을 따르고
 * 내용만 익명이다. 헤더 문자열과 enum 값은 어댑터가 매칭할 대상이므로 실제 그대로 쓴다.
 *
 * exceljs import는 제품 코드에서 두 파일로 제한되지만(CLAUDE.md) `scripts/`는 예외다.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const OUT_PATH = fileURLToPath(new URL('../../src/lib/fixtures/sample-workbook.xlsx', import.meta.url));

/** 재생성이 바이트 안정적이어야 무의미한 diff가 안 난다. 모든 시간값을 이 상수로 고정한다. */
const FIXED_DATE = new Date(Date.UTC(2026, 0, 1));

/**
 * exceljs는 zip 엔트리 날짜를 지정하지 않아 jszip이 엔트리마다 `new Date()`를 채운다
 * → 매 실행마다 바이트가 달라진다. jszip은 exceljs와 같은 모듈 인스턴스이므로 여기서
 * 기본 날짜만 고정한다 (파일 엔트리뿐 아니라 자동 생성되는 폴더 엔트리까지 덮는다).
 * jszip은 DOS 시각을 UTC로 환산하므로 타임존이 달라도 결과가 같다.
 */
function pinZipEntryDates() {
  const jszipDefaults = createRequire(import.meta.url)('jszip/lib/defaults');
  jszipDefaults.date = FIXED_DATE;
}

// ---------------------------------------------------------------------------
// 공용 헬퍼
// ---------------------------------------------------------------------------

const DATE_FMT = 'yyyy. mm. dd.';
const PCT_FMT = '0%';

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - r - 1) / 26;
  }
  return s;
}

/** 한 행에 값을 왼쪽부터 채운다. null/undefined는 건너뛴다(빈 셀 유지). */
function writeRow(ws, rowNumber, values, startCol = 1) {
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    ws.getCell(rowNumber, startCol + i).value = v;
  });
}

/** 전체 폭 가로 병합 배너. */
function banner(ws, rowNumber, lastCol, text) {
  ws.mergeCells(`A${rowNumber}:${colLetter(lastCol)}${rowNumber}`);
  ws.getCell(rowNumber, 1).value = text;
}

function dateCell(ws, address, value) {
  const cell = ws.getCell(address);
  cell.value = value;
  cell.numFmt = DATE_FMT;
  return cell;
}

function pctCell(ws, address, value) {
  const cell = ws.getCell(address);
  cell.value = value;
  cell.numFmt = PCT_FMT;
  return cell;
}

/**
 * 팀 탭 공통 장식 행 r1~r6. 헤더가 1행이 아니라 8·9행이라는 사실이 이 행들 때문에 생긴다 —
 * 헤더 행 탐색을 실제 난이도로 검증하려면 픽스처에도 있어야 한다.
 */
function decorateTeamTab(ws, lastCol, kpiLabels, kpiFormulas) {
  writeRow(ws, 1, ['← 00_통합 대시보드', '01_편집팀', '02_촬영·기획팀', '03_마케팅·관리팀', '99_설정']);
  banner(ws, 2, lastCol, '[VAN LOGO] 26-2 컨텐츠마케팅부 업무 관리 시트');
  banner(ws, 3, lastCol, 'VAN AI Innovation · Contents Marketing Division · 26-2');
  writeRow(ws, 4, kpiLabels);
  kpiFormulas.forEach((v, i) => {
    ws.getCell(5, i + 1).value = v;
  });
  banner(ws, 6, lastCol, '※ 회색 셀은 수식입니다. 직접 수정하지 마세요. 진행 상태는 99_설정 탭의 목록에서 고르세요.');
}

// ---------------------------------------------------------------------------
// 00_통합 대시보드 — 10컬럼. rowCount 팽창을 재현한다.
// ---------------------------------------------------------------------------

function buildDashboard(wb) {
  const ws = wb.addWorksheet('00_통합 대시보드');

  writeRow(ws, 1, ['01_편집팀 →', '02_촬영·기획팀 →', '03_마케팅·관리팀 →', '99_설정 →']);
  banner(ws, 2, 10, '[VAN LOGO] 26-2 컨텐츠마케팅부 통합 대시보드');
  banner(ws, 3, 10, 'VAN AI Innovation · Weekly Status Board · 26-2');

  writeRow(ws, 5, [
    '전체 활성 업무', '편집팀 진행', '촬영·기획팀 진행', '마케팅·관리팀 진행', '승인 대기',
    '수정 요청', '이번 주 마감', '마감 임박', '지연', '전체 완료율',
  ]);
  // 수식 행 — 일부는 캐시된 result가 있고 일부는 없다(실제 파일과 같은 상태).
  const kpi = [
    { formula: "COUNTIFS('01_편집팀'!A:A,\"<>\")", result: 5 },
    { formula: "COUNTIFS('01_편집팀'!C:C,\"<>\")", result: 4 },
    { formula: "COUNTIFS('02_촬영·기획팀'!A:A,\"<>\")", result: 1 },
    { formula: "COUNTIFS('03_마케팅·관리팀'!A:A,\"<>\")", result: 3 },
    { formula: 'COUNTIFS(#REF!,"승인 대기")' },
    { formula: 'COUNTIFS(#REF!,"수정 중")' },
    { formula: 'COUNTIFS(#REF!,"<>")', result: 2 },
    { formula: 'COUNTIFS(#REF!,"<>")', result: 1 },
    { formula: 'COUNTIFS(#REF!,"지연")', result: 1 },
  ];
  kpi.forEach((v, i) => {
    ws.getCell(6, i + 1).value = v;
  });
  pctCell(ws, 'J6', { formula: 'B6/A6', result: 0.2 });

  writeRow(ws, 8, ['팀별 요약']);
  writeRow(ws, 9, ['팀', '전체 업무', '진행 중', '승인 대기', '지연', '완료', '완료율', '가장 가까운 마감', '주요 리스크']);
  const teamRows = [
    ['01_편집팀', 5, 3, 1, 1, 1, 0.2, d(2026, 7, 24), '지연 1건'],
    ['02_촬영·기획팀', 1, 1, 0, 0, 0, 0, d(2026, 8, 5), '섭외 지연 우려'],
    ['03_마케팅·관리팀', 3, 2, 1, 0, 0, 0, d(2026, 7, 23), '답변 기한 임박'],
    ['합계', { formula: 'SUM(B10:B12)', result: 9 }, { formula: 'SUM(C10:C12)', result: 6 }, null, null, null, null, null, null],
  ];
  teamRows.forEach((row, i) => {
    const r = 10 + i;
    writeRow(ws, r, row);
    if (typeof row[6] === 'number') ws.getCell(r, 7).numFmt = PCT_FMT;
    if (row[7] instanceof Date) ws.getCell(r, 8).numFmt = DATE_FMT;
  });

  writeRow(ws, 15, ['이번 주 확인 필요 업무']);
  writeRow(ws, 16, ['팀', '업무명', '담당자', '현재 단계', '다음 조치', '다음 기한', 'D-DAY', '승인 상태', '리스크', '업무 원본 탭 링크']);
  const checkRows = [
    ['01_편집팀', '[샘플] 카드뉴스 A', '담당자1', '진행 중', '컨셉 승인 요청', d(2026, 7, 24), -2, '검토 대기', '지연'],
    ['02_촬영·기획팀', '[샘플] 브랜드 필름', '기획자1', '준비 중', '출연자 섭외 확정', d(2026, 8, 5), 5, '미제출', '주의'],
    ['03_마케팅·관리팀', '[샘플] 리그램 이벤트', '마케터1', '진행 중', '성과 집계', d(2026, 7, 23), 0, '조건부 승인', '정상'],
  ];
  checkRows.forEach((row, i) => {
    const r = 17 + i;
    writeRow(ws, r, row);
    ws.getCell(r, 6).numFmt = DATE_FMT;
    ws.getCell(r, 10).value = { text: '해당 탭 열기', hyperlink: 'https://example.test/sample-sheet' };
  });

  // Google Sheets가 기본 그리드를 서식만 채워 내보내는 현상. 값이 없으므로 dimensions는
  // 늘지 않고 rowCount만 커진다 — workbook-reader가 dimensions 기준으로 자르는지 검증용.
  for (let r = 41; r <= 200; r += 1) {
    const row = ws.getRow(r);
    row.height = 18;
    row.border = { bottom: { style: 'hair', color: { argb: 'FFE5E5E5' } } };
  }

  return ws;
}

// ---------------------------------------------------------------------------
// 01_편집팀 — 16컬럼 A~P. 셀 값 형태 7종·숨김 행·세로 병합이 여기 모여 있다.
// ---------------------------------------------------------------------------

const EDIT_HEADERS = [
  '업무명', '담당자', '%', '배정일',
  '예정일', '실제', '내용', '확인',
  '예정일', '실제', '내용', '확인',
  '예정일', '실제', '확인',
  '비고',
];

function buildEditTeam(wb) {
  const ws = wb.addWorksheet('01_편집팀');
  decorateTeamTab(
    ws,
    16,
    ['전체 업무', '진행 중', '지연', '완료율'],
    [
      { formula: 'COUNTIFS(A10:A100,"<>")', result: 5 },
      { formula: 'COUNTIFS(A10:A100,"<>")', result: 3 },
      { formula: 'COUNTIFS(A10:A100,"<>")', result: 1 },
      { formula: 'B5/A5' },
    ],
  );

  ws.mergeCells('A8:D8');
  ws.mergeCells('E8:H8');
  ws.mergeCells('I8:L8');
  ws.mergeCells('M8:O8');
  ws.getCell('A8').value = '기본 업무정보';
  ws.getCell('E8').value = '컨셉·레퍼런스 (+2일)';
  ws.getCell('I8').value = '제작 진행 (+5일)';
  ws.getCell('M8').value = '최종본·업로드 (+7일)';
  ws.getCell('P8').value = '비고';

  writeRow(ws, 9, EDIT_HEADERS);

  // r10 — 정상 행 겸 셀 형태 총집합
  writeRow(ws, 10, ['[샘플] 카드뉴스 A', '담당자1']);
  pctCell(ws, 'C10', { formula: 'COUNTIF(H10:O10,TRUE)/3', result: 0.33, shareType: 'shared', ref: 'C10:C11' });
  dateCell(ws, 'D10', d(2026, 7, 20));
  dateCell(ws, 'E10', { formula: 'D10+2', result: d(2026, 7, 22), shareType: 'shared', ref: 'E10:E11' });
  ws.getCell('F10').value = '2026.07.22'; // 날짜인데 문자열로 들어온 셀
  ws.getCell('G10').value = { text: '컨셉 문서', hyperlink: 'https://example.test/docs/concept-a' };
  ws.getCell('H10').value = true;
  dateCell(ws, 'I10', d(2026, 7, 25));
  dateCell(ws, 'J10', d(2026, 7, 25));
  ws.getCell('K10').value = { text: '제작 파일', hyperlink: 'https://example.test/canva/card-a' };
  ws.getCell('L10').value = false;
  dateCell(ws, 'M10', d(2026, 7, 27));
  ws.getCell('O10').value = true;
  ws.getCell('P10').value = {
    richText: [
      { text: '컨셉 확정 ' },
      { font: { bold: true }, text: '승인자1' },
      { text: ' 확인 필요' },
    ],
  };

  // r11 — 공유 수식 슬레이브(result 없음) + 엑셀 시리얼 숫자 날짜
  writeRow(ws, 11, ['[샘플] 릴스 B', '담당자2']);
  ws.getCell('C11').value = { sharedFormula: 'C10' };
  ws.getCell('D11').value = 46000; // 배정일이 시리얼 숫자로 들어온 셀
  ws.getCell('E11').value = { sharedFormula: 'E10' };
  ws.getCell('H11').value = false;
  ws.getCell('P11').value = '레퍼런스 재수집';

  // r12 — 오류 셀 + 연도 없는 날짜 문자열 + 하이픈
  writeRow(ws, 12, ['[샘플] 숏폼 C', '담당자3']);
  ws.getCell('E12').value = '9/1'; // 연도 없음 — baseYear 추론 대상
  ws.getCell('F12').value = '-';
  ws.getCell('G12').value = { error: '#REF!' };
  ws.getCell('H12').value = false;

  // r13 — 숨김 행. 신원 컬럼에 값이 있어야 "숨김이라 건너뛴다"가 검증된다.
  writeRow(ws, 13, ['[샘플] 비공개 작업 D', '담당자1']);
  dateCell(ws, 'D13', d(2026, 7, 18));
  ws.getRow(13).hidden = true;

  // r14~r15 — 세로 병합. 업무명 하나를 두 행이 공유하고 담당자만 다르다.
  ws.mergeCells('A14:A15');
  ws.getCell('A14').value = '[샘플] 시리즈 E';
  ws.getCell('B14').value = '담당자2';
  ws.getCell('B15').value = '담당자3';
  dateCell(ws, 'D14', d(2026, 7, 21));
  dateCell(ws, 'D15', d(2026, 7, 21));
  ws.getCell('P15').value = '2부는 담당자3이 이어받음';

  return ws;
}

// ---------------------------------------------------------------------------
// 02_촬영·기획팀 — 71컬럼 A~BS. 유령 행 25건이 핵심이다.
// ---------------------------------------------------------------------------

const SHOOT_GROUPS = [
  ['기본 업무정보', 10],
  ['섭외', 10],
  ['촬영 일정·준비', 9],
  ['기획안 초안', 7],
  ['기획안 완성본', 8],
  ['촬영 실행', 9],
  ['편집 이관 또는 자체 편집', 9],
  ['관리', 9],
];

const SHOOT_HEADERS = [
  '업무ID', '프로젝트명', '콘텐츠 형식', '우선순위', '기획 담당자', '촬영 담당자', '공동 담당자', '업무 배정일', '최종 결과물 기한', '현재 업무 단계',
  '출연자·촬영 대상', '섭외 필요 여부', '섭외 담당자', '섭외 기한', '섭외 상태', '최초 연락일', '최종 확정일', '섭외 결과', '출연자 연락처 (내부용)', '섭외 관련 특이사항',
  '촬영 예정일', '촬영 시간', '촬영 장소', '장소 예약 상태', '촬영 장비 준비 상태', '출연자 최종 확인', '촬영 인력 확정', '촬영 전 확인사항', '촬영 취소·변경 가능성',
  '초안 공유 예정일', '실제 초안 공유일', '초안 링크', '초안 승인 상태', '초안 검토 담당자', '초안 피드백일', '초안 피드백 요약',
  '완성 기획안 제출 예정일', '실제 완성 기획안 제출일', '완성 기획안 링크', '완성 기획안 승인 상태', '최종 검토 담당자', '최종 피드백 기한', '실제 최종 피드백일', '최종 피드백 요약',
  '촬영 실행 상태', '실제 촬영일', '촬영 완료 여부', '재촬영 필요 여부', '현장 특이사항', '촬영본 원본 링크', '대본·질문지 최종본 링크', '사진·영상 활용 동의 확인', '파일 백업 확인',
  '편집 방식', '편집 담당 팀·담당자', '편집 이관 예정일', '실제 이관일', '촬영본 이관 확인', '대본 이관 확인', '편집 요청사항', '편집 마감일', '자체 편집 결과물 링크',
  '다음 조치', '다음 조치 담당자', '다음 조치 기한', '전체 진행률', 'D-DAY', '리스크 상태', '지연 사유', '임원진 최종 확인', '비고',
];

/** 유령 행 판정에 쓰는 신원 컬럼 (PLAN.md E1). */
const SHOOT_IDENTITY = ['업무ID', '프로젝트명', '기획 담당자', '촬영 담당자'];

const GHOST_ROW_COUNT = 25;

function buildShootTeam(wb) {
  const ws = wb.addWorksheet('02_촬영·기획팀');
  const col = (name) => SHOOT_HEADERS.indexOf(name) + 1;
  const put = (row, name, value) => {
    ws.getCell(row, col(name)).value = value;
  };

  decorateTeamTab(
    ws,
    71,
    ['전체 업무', '섭외 대기', '촬영 예정', '완료율'],
    [
      { formula: 'COUNTIFS(A10:A100,"<>")', result: 1 },
      { formula: 'COUNTIFS(O10:O100,"미착수")', result: 1 },
      { formula: 'COUNTIFS(U10:U100,"<>")', result: 1 },
      { formula: 'D5/A5' },
    ],
  );

  // r7 — 촬영·기획팀에만 있는 주차·책임자·핵심 목표 블록
  writeRow(ws, 7, ['기준 주차', '2026-07 4주차', '팀 책임자', '기획자1', '이번 주 핵심 목표', '브랜드 필름 섭외 확정', '주요 리스크', '출연자 일정 미확정']);

  // r8 — 그룹 헤더(가로 병합 8개)
  let start = 1;
  for (const [label, span] of SHOOT_GROUPS) {
    const end = start + span - 1;
    ws.mergeCells(`${colLetter(start)}8:${colLetter(end)}8`);
    ws.getCell(8, start).value = label;
    start = end + 1;
  }

  writeRow(ws, 9, SHOOT_HEADERS);

  // r10 — 정상 행 1건
  put(10, '업무ID', '[샘플] SH-001');
  put(10, '프로젝트명', '[샘플] 브랜드 필름');
  put(10, '콘텐츠 형식', '인터뷰');
  put(10, '우선순위', '높음');
  put(10, '기획 담당자', '기획자1');
  put(10, '촬영 담당자', '담당자2');
  put(10, '공동 담당자', '기획자2');
  dateCell(ws, `${colLetter(col('업무 배정일'))}10`, d(2026, 7, 20));
  dateCell(ws, `${colLetter(col('최종 결과물 기한'))}10`, d(2026, 8, 5));
  put(10, '현재 업무 단계', '진행 중');
  put(10, '출연자·촬영 대상', '[샘플] 학회원 A');
  put(10, '섭외 필요 여부', '필요');
  put(10, '섭외 담당자', '기획자2');
  dateCell(ws, `${colLetter(col('섭외 기한'))}10`, d(2026, 7, 28));
  put(10, '섭외 상태', '연락 중');
  put(10, '출연자 연락처 (내부용)', '010-0000-0000');
  put(10, '촬영 장소', '[샘플] 스튜디오 1');
  put(10, '장소 예약 상태', '문의 중');
  put(10, '촬영 장비 준비 상태', '준비 중');
  put(10, '출연자 최종 확인', false);
  put(10, '촬영 인력 확정', true);
  put(10, '초안 링크', { text: '초안 문서', hyperlink: 'https://example.test/docs/shoot-draft' });
  put(10, '초안 승인 상태', '검토 대기');
  put(10, '촬영 실행 상태', '예정');
  put(10, '편집 방식', '편집팀 이관');
  put(10, '다음 조치', '출연자 섭외 확정');
  put(10, '다음 조치 담당자', '기획자2');
  dateCell(ws, `${colLetter(col('다음 조치 기한'))}10`, d(2026, 7, 28));
  pctCell(ws, `${colLetter(col('전체 진행률'))}10`, { formula: 'COUNTIF(Z10:BA10,TRUE)/6', result: 0.4 });
  put(10, 'D-DAY', { formula: `${colLetter(col('최종 결과물 기한'))}10-TODAY()`, result: 16 });
  put(10, '리스크 상태', '정상');
  put(10, '임원진 최종 확인', false);

  // r11~r35 — 유령 행 25건 (PLAN.md E1).
  // 신원 컬럼 4개는 전부 비어 있고 수식 결과 컬럼만 값이 차 있다.
  const ghostFalseCols = [
    '출연자 최종 확인', '촬영 인력 확정', '촬영 완료 여부', '재촬영 필요 여부',
    '사진·영상 활용 동의 확인', '파일 백업 확인', '임원진 최종 확인',
  ];
  for (let i = 0; i < GHOST_ROW_COUNT; i += 1) {
    const r = 11 + i;
    // 엑셀 시리얼 1 / 0 — 빈 셀에 걸린 날짜 수식의 결과
    dateCell(ws, `${colLetter(col('완성 기획안 제출 예정일'))}${r}`, {
      formula: `IF(${colLetter(col('실제 초안 공유일'))}${r}="","",${colLetter(col('실제 초안 공유일'))}${r}+2)`,
      result: d(1900, 1, 1),
    });
    dateCell(ws, `${colLetter(col('최종 피드백 기한'))}${r}`, {
      formula: `${colLetter(col('완성 기획안 제출 예정일'))}${r}-1`,
      result: d(1899, 12, 31),
    });
    pctCell(ws, `${colLetter(col('전체 진행률'))}${r}`, {
      formula: `COUNTIF(Z${r}:BA${r},TRUE)/6`,
      result: 0,
    });
    for (const name of ghostFalseCols) put(r, name, false);
  }

  return ws;
}

// ---------------------------------------------------------------------------
// 03_마케팅·관리팀 — 30컬럼. 섹션이 C → A → B 순으로 세로로 놓인다.
// ---------------------------------------------------------------------------

const MARKETING_A_HEADERS = [
  '문의 ID', '문의 접수일', '접수 시간', '채널', '계정·문의자', '문의 유형', '문의 내용 요약', '긴급도', '담당자', '답변 필요 여부',
  '답변 기한', '답변 상태', '실제 답변일', '답변 내용 요약', '추가 확인 필요사항', '후속 담당자', '후속 조치 기한', '후속 조치 상태', '완료 여부', '비고',
];

const MARKETING_B_HEADERS = [
  '기준 주차', '회의일', '마케팅 과제명', '제안자', '실행 담당자', '목표', '대상', '실행 채널', '실행 방식', '계획 확정 여부',
  '임원진 승인 여부', '실행 시작일', '실행 기한', '실제 실행 내용', '실행 상태', '목표 KPI', '목표 수치', '실제 성과', '달성률', '직전 주 대비 변화',
  '성과 분석', '잘된 점', '개선 필요사항', '다음 주 유지 여부', '다음 주 개선안', '관련 링크', '담당자 자체 평가', '임원진 피드백', '최종 확인', '비고',
];

function buildMarketingTeam(wb) {
  const ws = wb.addWorksheet('03_마케팅·관리팀');
  decorateTeamTab(
    ws,
    30,
    ['미답변 문의', '이번 주 실행 과제', '평균 달성률', '지연'],
    [
      { formula: 'COUNTIFS(L18:L20,"미답변")', result: 1 },
      { formula: 'COUNTIFS(C25:C27,"<>")', result: 3 },
      { formula: 'AVERAGE(S25:S27)', result: 0.87 },
      { formula: 'COUNTIFS(#REF!,"지연")' },
    ],
  );

  // --- C 섹션 (r8~r13) — 자유 텍스트
  banner(ws, 8, 30, 'C. 주간 회의 브리핑');
  ws.getCell('A9').value = '직전 주 핵심 마케팅 성과';
  ws.getCell('A10').value = '[샘플] 리그램 이벤트로 신규 팔로워 120명 유입, 저장수 목표 초과 달성';
  ws.getCell('A11').value = '[샘플] 숏폼 시리즈 2편 게시 — 평균 조회수 직전 주 대비 상승';
  ws.getCell('A12').value = '[샘플] DM 문의 응답 지연 1건 발생, 담당 배분 조정 필요';
  ws.getCell('A13').value = '[샘플] 다음 주 임원진 보고 자료 초안 준비';

  // r14~r15 공백 2행 — section-splitter가 여기서 자른다

  // --- A 섹션 (r16~r20)
  banner(ws, 16, 30, 'A. 상시 문의·SNS 관리');
  writeRow(ws, 17, MARKETING_A_HEADERS);
  const inquiries = [
    ['[샘플] Q-001', d(2026, 7, 21), '14:20', '인스타그램 DM', 'sample_account_1', '협업 제안', '[샘플] 협업 촬영 문의', '높음', '마케터1', '필요',
      d(2026, 7, 22), '답변 완료', d(2026, 7, 22), '[샘플] 조건 안내 후 회신', '없음', '마케터1', null, '완료', true, ''],
    ['[샘플] Q-002', d(2026, 7, 22), '09:05', '댓글', 'sample_account_2', '가입 문의', '[샘플] 모집 일정 문의', '보통', '마케터2', '필요',
      d(2026, 7, 23), '미답변', null, '', '모집 일정 확정 대기', '마케터2', d(2026, 7, 24), '진행 중', false, '일정 확정 후 회신'],
    ['[샘플] Q-003', d(2026, 7, 22), '18:40', '이메일', 'sample_account_3', '기타', '[샘플] 자료 요청', '낮음', '마케터1', '불필요',
      null, '보류', null, '', '', '', null, '보류', false, ''],
  ];
  inquiries.forEach((row, i) => {
    const r = 18 + i;
    writeRow(ws, r, row);
    row.forEach((v, ci) => {
      if (v instanceof Date) ws.getCell(r, ci + 1).numFmt = DATE_FMT;
    });
  });

  // r21~r22 공백 2행

  // --- B 섹션 (r23~r27)
  banner(ws, 23, 30, 'B. 주간 마케팅 실행·성과 관리');
  writeRow(ws, 24, MARKETING_B_HEADERS);
  // 세 번째 행의 달성률은 목표 수치·실제 성과와 어긋난다 (T4의 재계산 불일치 warning 검증용).
  const executions = [
    ['2026-07 4주차', d(2026, 7, 21), '[샘플] 리그램 이벤트', '마케터1', '마케터1', '신규 팔로워 확보', '재학생', '인스타그램', '이벤트', '확정',
      '승인 완료', d(2026, 7, 21), d(2026, 7, 27), '[샘플] 리그램 참여 유도 게시물 2건', '완료', '유입수', 100, 120, 1.2, '+18%',
      '[샘플] 참여 유도 문구가 효과적', '[샘플] 반응 속도 빠름', '[샘플] 경품 안내 보완', '유지', '[샘플] 스토리 리마인드 추가', null, '상', '', true, ''],
    ['2026-07 4주차', d(2026, 7, 21), '[샘플] 숏폼 시리즈', '마케터2', '마케터2', '저장수 증대', '외부 관심층', '유튜브', '콘텐츠', '확정',
      '검토 대기', d(2026, 7, 22), d(2026, 7, 28), '[샘플] 숏폼 2편 게시', '진행 중', '저장수', 50, 41, 0.82, '-4%',
      '[샘플] 후반부 이탈 발생', '[샘플] 도입부 반응 양호', '[샘플] 길이 단축 필요', '유지', '[샘플] 30초로 축약', null, '중', '', false, ''],
    ['2026-07 4주차', d(2026, 7, 21), '[샘플] 오프라인 부스', '마케터1', '마케터2', '대면 접점 확대', '재학생', '오프라인', '부스 운영', '계획',
      '미제출', d(2026, 7, 24), d(2026, 7, 30), '[샘플] 부스 운영 1일', '진행 중', '전환수', 40, 12, 0.95, '신규',
      '[샘플] 방문자 대비 전환 저조', '[샘플] 위치 노출 양호', '[샘플] 안내 동선 개선', '보류', '[샘플] 배치 재검토', null, '중', '', false, '달성률 수식 확인 필요'],
  ];
  executions.forEach((row, i) => {
    const r = 25 + i;
    writeRow(ws, r, row);
    row.forEach((v, ci) => {
      if (v instanceof Date) ws.getCell(r, ci + 1).numFmt = DATE_FMT;
    });
    ws.getCell(r, MARKETING_B_HEADERS.indexOf('달성률') + 1).numFmt = PCT_FMT;
    ws.getCell(r, MARKETING_B_HEADERS.indexOf('관련 링크') + 1).value = {
      text: '실행 기록',
      hyperlink: `https://example.test/marketing/${i + 1}`,
    };
  });

  return ws;
}

// ---------------------------------------------------------------------------
// 99_설정 — 28컬럼. 컬럼 하나가 enum 그룹 하나다 (r3 그룹명, r4부터 값).
// ---------------------------------------------------------------------------

/** [그룹명, 값[]] — 순서가 곧 컬럼 순서다. */
const SETTINGS_GROUPS = [
  ['편집팀 구성원', ['담당자1', '담당자2', '담당자3']],
  ['촬영·기획팀 구성원', ['기획자1', '기획자2', '담당자2']],
  ['마케팅·관리팀 구성원', ['마케터1', '마케터2']],
  ['임원진·승인자', ['승인자1', '승인자2']],
  ['요청 부서', ['편집팀', '촬영·기획팀', '마케팅·관리팀', '임원진']],
  ['공통_우선순위', ['긴급', '높음', '보통', '낮음']],
  ['공통_리스크 상태', ['정상', '주의', '지연', '차단', '해당 없음']],
  ['공통_진행 상태', ['업무 배정', '준비 중', '진행 중', '검토 요청', '승인 대기', '수정 중', '게시·이관 대기', '완료', '보류', '취소']],
  ['공통_승인 상태', ['미제출', '검토 대기', '수정 요청', '조건부 승인', '승인 완료', '해당 없음']],
  ['편집_콘텐츠 유형', ['카드뉴스', '릴스', '숏폼', '포스터']],
  ['편집_최종 게시 채널', ['인스타그램', '유튜브', '블로그']],
  ['편집_제작 진행 상태', ['대기', '제작 중', '검토', '완료']],
  ['편집_최종 게시 상태', ['미게시', '예약', '게시 완료']],
  ['촬영_콘텐츠 형식', ['인터뷰', '브이로그', '스케치', '필름']],
  ['촬영_섭외 필요 여부', ['필요', '불필요', '확인 중']],
  ['촬영_섭외 상태', ['미착수', '연락 중', '확정', '불발']],
  ['촬영_장소 예약 상태', ['미예약', '문의 중', '예약 완료']],
  ['촬영_장비 준비 상태', ['미준비', '준비 중', '준비 완료']],
  ['촬영_촬영 실행 상태', ['예정', '촬영 완료', '연기', '취소']],
  ['촬영_편집 방식', ['자체 편집', '편집팀 이관', '외주']],
  ['마케팅_문의 채널', ['인스타그램 DM', '댓글', '이메일', '카카오톡']],
  ['마케팅_문의 유형', ['협업 제안', '가입 문의', '일정 문의', '기타']],
  ['마케팅_답변 상태', ['미답변', '답변 중', '답변 완료', '보류']],
  ['마케팅_실행 채널', ['인스타그램', '유튜브', '블로그', '오프라인']],
  ['마케팅_실행 상태', ['계획', '진행 중', '완료', '보류']],
  ['마케팅_KPI 유형', ['도달수', '저장수', '유입수', '전환수']],
  ['기본 SLA 설정_항목', null], // SLA_ROWS에서 채운다
  ['기본 SLA 설정_일수', null],
];

const SLA_ROWS = [
  ['편집팀 컨셉 공유', 1],
  ['편집팀 컨셉 승인', 1],
  ['편집팀 완성본 제출', 2],
  ['편집팀 완성본 피드백', 1],
  ['촬영팀 섭외', 5],
  ['촬영팀 기획안 완성본', 2],
  ['촬영팀 최종 피드백', 1],
  ['SNS 문의 1차 답변 권장', 1],
];

/** 아래쪽에 한 번 더 놓는 SLA 블록의 헤더 행. 어느 한쪽만 읽고 끝내는 구현을 막는다. */
const SLA_SECOND_BLOCK_HEADER_ROW = 21;

function buildSettings(wb) {
  const ws = wb.addWorksheet('99_설정');

  writeRow(ws, 1, ['← 00_통합 대시보드', null, '01_편집팀', null, '02_촬영·기획팀', null]);
  ws.mergeCells('A1:B1');
  ws.mergeCells('C1:D1');
  ws.mergeCells('E1:F1');
  banner(ws, 2, 28, '※ 이 탭의 목록이 각 팀 탭 드롭다운의 원본입니다. 값을 바꾸면 기존 입력이 목록에서 벗어날 수 있습니다.');

  SETTINGS_GROUPS.forEach(([name, values], i) => {
    const c = i + 1;
    ws.getCell(3, c).value = name;
    (values ?? []).forEach((v, j) => {
      ws.getCell(4 + j, c).value = v;
    });
  });

  // 그룹 컬럼 쌍에 놓인 SLA 블록 (r4~r11)
  const itemCol = SETTINGS_GROUPS.findIndex(([n]) => n === '기본 SLA 설정_항목') + 1;
  const daysCol = itemCol + 1;
  SLA_ROWS.forEach(([label, days], i) => {
    ws.getCell(4 + i, itemCol).value = label;
    ws.getCell(4 + i, daysCol).value = days;
  });

  // 아래쪽에 떨어져 있는 두 번째 SLA 블록 (r21 헤더, r22~r29 값)
  const r0 = SLA_SECOND_BLOCK_HEADER_ROW;
  ws.getCell(r0, 1).value = '기본 SLA 설정_항목';
  ws.getCell(r0, 2).value = '기본 SLA 설정_일수';
  SLA_ROWS.forEach(([label, days], i) => {
    ws.getCell(r0 + 1 + i, 1).value = label;
    ws.getCell(r0 + 1 + i, 2).value = days;
  });

  return ws;
}

// ---------------------------------------------------------------------------
// 생성
// ---------------------------------------------------------------------------

async function build() {
  pinZipEntryDates();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'work-task-status-board fixture builder';
  wb.lastModifiedBy = 'work-task-status-board fixture builder';
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;

  buildDashboard(wb);
  buildEditTeam(wb);
  buildShootTeam(wb);
  buildMarketingTeam(wb);
  buildSettings(wb);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`생성: ${OUT_PATH}`);
}

// ---------------------------------------------------------------------------
// 자체 점검 (--verify)
// ---------------------------------------------------------------------------

const SHEET_NAMES = ['00_통합 대시보드', '01_편집팀', '02_촬영·기획팀', '03_마케팅·관리팀', '99_설정'];

function classify(value) {
  if (value instanceof Date) return 'date';
  if (value === null || typeof value !== 'object') return null;
  if ('error' in value) return 'error';
  if ('richText' in value) return 'richText';
  if ('hyperlink' in value) return 'hyperlink';
  if ('sharedFormula' in value) return 'sharedFormula';
  if ('formula' in value) {
    return value.result === undefined || value.result === null ? 'formulaNoResult' : 'formulaWithResult';
  }
  return null;
}

async function verify() {
  const failures = [];
  const check = (ok, label, actual) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${actual}`);
    if (!ok) failures.push(label);
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUT_PATH);

  // 1. 워크시트 이름
  const names = wb.worksheets.map((ws) => ws.name);
  check(
    names.length === SHEET_NAMES.length && names.every((n, i) => n === SHEET_NAMES[i]),
    '워크시트 5개 이름·순서',
    names.join(' · '),
  );

  // 2. 02_촬영·기획팀 헤더 71개 · 유령 행 25건
  const shoot = wb.getWorksheet('02_촬영·기획팀');
  const shootHeader = [];
  shoot.getRow(9).eachCell({ includeEmpty: false }, (cell, col) => {
    shootHeader[col - 1] = cell.text;
  });
  check(shootHeader.filter(Boolean).length === 71, '02 r9 헤더 71개', `${shootHeader.filter(Boolean).length}개`);

  const identityCols = SHOOT_IDENTITY.map((n) => SHOOT_HEADERS.indexOf(n) + 1);
  let ghost = 0;
  for (let r = 10; r <= shoot.rowCount; r += 1) {
    const row = shoot.getRow(r);
    const hasIdentity = identityCols.some((c) => String(row.getCell(c).text ?? '').trim() !== '');
    let hasAnyValue = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') hasAnyValue = true;
    });
    if (!hasIdentity && hasAnyValue) ghost += 1;
  }
  check(ghost === GHOST_ROW_COUNT, `02 유령 행 ${GHOST_ROW_COUNT}건`, `${ghost}건`);

  // 3. 01_편집팀 병합·숨김
  const edit = wb.getWorksheet('01_편집팀');
  const merges = edit.model.merges ?? [];
  const rowEightMerges = merges.filter((m) => /^[A-Z]+8:[A-Z]+8$/.test(m));
  check(rowEightMerges.length === 4, '01 r8 가로 병합 4건', rowEightMerges.join(' '));
  check(merges.includes('A14:A15'), '01 A14:A15 세로 병합', merges.includes('A14:A15') ? 'A14:A15' : '없음');
  const hidden = [];
  for (let r = 1; r <= edit.rowCount; r += 1) if (edit.getRow(r).hidden) hidden.push(r);
  check(hidden.length === 1, '01 숨김 행 1건', `r${hidden.join(',r') || '-'}`);

  // 4. 셀 값 형태 7종
  const shapes = {
    date: 0, formulaWithResult: 0, formulaNoResult: 0, sharedFormula: 0,
    hyperlink: 0, richText: 0, error: 0,
  };
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const kind = classify(cell.value);
        if (kind) shapes[kind] += 1;
      });
    });
  }
  for (const [kind, n] of Object.entries(shapes)) {
    check(n >= 1, `셀 형태 ${kind} 1개 이상`, `${n}개`);
  }

  // 5. numFmt
  let pct = 0;
  let ymd = 0;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.numFmt === PCT_FMT) pct += 1;
        else if (typeof cell.numFmt === 'string' && cell.numFmt.includes('yyyy')) ymd += 1;
      });
    });
  }
  check(pct >= 1, "numFmt '0%' 셀 1개 이상", `${pct}개`);
  check(ymd >= 1, 'yyyy 계열 날짜 서식 셀 1개 이상', `${ymd}개`);

  // 6. 99_설정 그룹·SLA
  const settings = wb.getWorksheet('99_설정');
  const groupNames = [];
  settings.getRow(3).eachCell({ includeEmpty: false }, (cell) => groupNames.push(cell.text));
  const commonGroups = groupNames.filter((n) => n.startsWith('공통_'));
  check(commonGroups.length === 4, '99 공통_ 그룹 4개', commonGroups.join(' · '));

  const readDown = (colIndex, fromRow) => {
    const out = [];
    for (let r = fromRow; r <= settings.rowCount; r += 1) {
      const t = String(settings.getCell(r, colIndex).text ?? '').trim();
      if (t === '') break;
      out.push(t);
    }
    return out;
  };
  const statusCol = groupNames.indexOf('공통_진행 상태') + 1;
  const statusValues = readDown(statusCol, 4);
  check(statusValues.length === 10, '99 공통_진행 상태 값 10개', statusValues.join(' · '));

  const slaCol = groupNames.indexOf('기본 SLA 설정_항목') + 1;
  const slaValues = readDown(slaCol, 4);
  check(slaValues.length === 8, '99 SLA 항목 8개 (그룹 컬럼 블록)', slaValues.length + '개');
  const slaSecond = readDown(1, SLA_SECOND_BLOCK_HEADER_ROW + 1);
  check(slaSecond.length === 8, '99 SLA 항목 8개 (아래쪽 두 번째 블록)', `r${SLA_SECOND_BLOCK_HEADER_ROW + 1}~ ${slaSecond.length}개`);

  // 7. 00_통합 대시보드 rowCount 팽창
  const dash = wb.getWorksheet('00_통합 대시보드');
  const bottom = dash.dimensions.bottom;
  check(dash.rowCount > bottom, '00 rowCount > dimensions.bottom', `rowCount=${dash.rowCount}, bottom=${bottom}`);

  // 8. 03_마케팅·관리팀 섹션 제목·빈 행
  const mkt = wb.getWorksheet('03_마케팅·관리팀');
  const sectionRows = [];
  for (let r = 1; r <= mkt.rowCount; r += 1) {
    const t = String(mkt.getCell(r, 1).text ?? '').trim();
    if (/^[ABC]\.\s/.test(t)) sectionRows.push({ r, t });
  }
  check(sectionRows.length === 3, '03 섹션 제목 3개', sectionRows.map((s) => `r${s.r} ${s.t}`).join(' / '));

  const isBlank = (r) => {
    let blank = true;
    mkt.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      if (String(cell.text ?? '').trim() !== '') blank = false;
    });
    return blank;
  };
  let minGap = Infinity;
  for (let i = 1; i < sectionRows.length; i += 1) {
    let gap = 0;
    for (let r = sectionRows[i].r - 1; r > sectionRows[i - 1].r; r -= 1) {
      if (!isBlank(r)) break;
      gap += 1;
    }
    minGap = Math.min(minGap, gap);
  }
  check(minGap >= 2, '03 섹션 사이 빈 행 2개 이상', `최소 ${minGap}행`);

  if (failures.length > 0) {
    console.error(`\n자체 점검 실패 ${failures.length}건: ${failures.join(' / ')}`);
    process.exit(1);
  }
  console.log('\n자체 점검 통과.');
}

if (process.argv.includes('--verify')) {
  await verify();
} else {
  await build();
}
