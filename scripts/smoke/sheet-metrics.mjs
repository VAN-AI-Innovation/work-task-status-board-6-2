// T1 스모크: 실제 시트 .xlsx의 크기·규모를 실측한다 (A7 4MB 한도, S2 압축 폭탄 방어 한도).
// 실업무 파일을 읽으므로 셀 값·헤더 문자열은 출력하지 않는다 — 시트명·개수·바이트 수만 찍는다.
// 사용법: node scripts/smoke/sheet-metrics.mjs [xlsx경로]

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

const SMOKE_INPUT_DIR = 'smoke-input';
const SIZE_LIMIT_BYTES = 4 * 1024 * 1024; // A7 — 앱 업로드 한도 4MB
const SHEET_LIMIT = 20; // S2
const CELL_LIMIT_PER_SHEET = 20_000; // S2

function resolveXlsxPath(argPath) {
  if (argPath) {
    if (!existsSync(argPath)) {
      console.error(`파일을 찾을 수 없다: ${argPath}`);
      process.exit(1);
    }
    return argPath;
  }
  if (!existsSync(SMOKE_INPUT_DIR)) {
    console.error(`${SMOKE_INPUT_DIR}/ 디렉토리가 없다. scripts/smoke/README.md의 배치 규약을 따를 것.`);
    process.exit(1);
  }
  const found = readdirSync(SMOKE_INPUT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
    .sort();
  if (found.length === 0) {
    console.error(`${SMOKE_INPUT_DIR}/ 에 .xlsx 파일이 없다.`);
    process.exit(1);
  }
  return join(SMOKE_INPUT_DIR, found[0]);
}

const toMB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

// 값이 있는 셀만 센다. rowCount × columnCount는 빈 영역까지 포함해 실제보다 크게 나온다.
// dimensions(A1:J60)가 가리키는 사각형의 셀 수. rowCount는 서식만 있는 빈 행까지 세므로 둘이 갈린다.
function countDimensionCells(worksheet) {
  const d = worksheet.dimensions;
  if (!d || !d.top) return 0;
  return (d.bottom - d.top + 1) * (d.right - d.left + 1);
}

function countValueCells(worksheet) {
  let count = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== '') count += 1;
    });
  });
  return count;
}

const xlsxPath = resolveXlsxPath(process.argv[2]);
console.log(`대상 파일: ${xlsxPath}`);

const sizeBytes = statSync(xlsxPath).size;
const sizePassed = sizeBytes <= SIZE_LIMIT_BYTES;

console.log('\n=== 파일 크기 (A7) ===');
console.log(`  바이트: ${sizeBytes.toLocaleString('en-US')} bytes (${toMB(sizeBytes)} MB)`);
console.log(`  4MB 한도 대비: ${((sizeBytes / SIZE_LIMIT_BYTES) * 100).toFixed(1)}% 사용 / 여유 ${toMB(SIZE_LIMIT_BYTES - sizeBytes)} MB`);
console.log(
  `  판정: ${sizePassed ? 'PASS (단일 업로드 가능)' : 'FAIL (탭별 분할 업로드가 기본 경로)'}`
);

const workbook = new ExcelJS.Workbook();
try {
  await workbook.xlsx.readFile(xlsxPath);
} catch (error) {
  console.log('\n=== exceljs 열기 ===');
  console.log(`  실패 — ${error?.name ?? 'Error'}: ${error?.message ?? '(메시지 없음)'}`);
  console.log('\n최종 판정: FAIL (exceljs가 파일을 열지 못했다 — T2 착수 불가)');
  process.exit(1);
}
console.log('\n=== exceljs 열기 ===');
console.log(`  성공 (exceljs@${ExcelJS.version ?? '4.4.0'})`);

const sheets = [];
workbook.eachSheet((worksheet) => {
  const rowCount = worksheet.rowCount;
  const columnCount = worksheet.columnCount;
  sheets.push({
    name: worksheet.name,
    rowCount,
    columnCount,
    dimensions: worksheet.dimensions?.toString?.() ?? '(없음)',
    valueCells: countValueCells(worksheet),
    gridCells: rowCount * columnCount,
    dimensionCells: countDimensionCells(worksheet),
  });
});

console.log('\n=== 워크시트 규모 (S2) ===');
console.log(`  워크시트 수: ${sheets.length}개 (한도 ${SHEET_LIMIT}개)`);
console.log('  시트명 | rowCount | columnCount | dimensions | 값 있는 셀 | dimensions 셀 | row×col');
for (const s of sheets) {
  console.log(
    `  ${s.name} | ${s.rowCount} | ${s.columnCount} | ${s.dimensions} | ${s.valueCells} | ${s.dimensionCells} | ${s.gridCells}`
  );
}

const totalValueCells = sheets.reduce((sum, s) => sum + s.valueCells, 0);
const totalGridCells = sheets.reduce((sum, s) => sum + s.gridCells, 0);
const maxGridCells = sheets.reduce((max, s) => Math.max(max, s.gridCells), 0);
const maxDimensionCells = sheets.reduce((max, s) => Math.max(max, s.dimensionCells), 0);

console.log(`  전체 값 있는 셀: ${totalValueCells} / 전체 row×col: ${totalGridCells}`);
console.log(`  시트 하나 최대: 값 있는 셀 ${totalValueCells > 0 ? sheets.reduce((m, s) => Math.max(m, s.valueCells), 0) : 0} / dimensions 셀 ${maxDimensionCells} / row×col ${maxGridCells}`);
console.log(
  `  ※ S2 판정 기준은 보수적인 쪽(row×col)을 쓴다. 방어 로직은 값 없는 셀까지 세는 큰 숫자에서 먼저 걸린다.`
);

const sheetCountPassed = sheets.length <= SHEET_LIMIT;
const cellCountPassed = maxGridCells <= CELL_LIMIT_PER_SHEET;
const s2Passed = sheetCountPassed && cellCountPassed;

console.log(
  `  판정: ${
    s2Passed
      ? 'PASS (S2 한도 유효)'
      : 'FAIL (S2 한도가 정상 파일을 오탐 — T5 착수 전 상향 필요)'
  }`
);
if (!sheetCountPassed) console.log(`    - 시트 수 ${sheets.length} > ${SHEET_LIMIT}`);
if (!cellCountPassed) {
  console.log(`    - 최대 시트 row×col ${maxGridCells} > ${CELL_LIMIT_PER_SHEET}`);
  console.log(
    `    - 같은 시트를 dimensions 기준으로 세면 ${maxDimensionCells}셀로 한도 안이다. 어느 기준으로 세느냐가 판정을 가른다.`
  );
}

console.log(`\n최종 판정: A7 ${sizePassed ? 'PASS' : 'FAIL'} · S2 ${s2Passed ? 'PASS' : 'FAIL'}`);
