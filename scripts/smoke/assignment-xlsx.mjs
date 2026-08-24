/**
 * 내려받은 배정표 `.xlsx`를 되읽어 T7 완료 기준 4·5를 **파일 자체로** 확인한다.
 *
 * 단위 테스트는 `buildAssignmentWorkbook`의 출력 버퍼를 검사하지만, 여기서는
 * 라우트가 실제로 내려보낸 바이트를 본다 — 직렬화·헤더·스트리밍이 끼어드는
 * 구간이 테스트와 다르기 때문이다 (`docs/TICKETS.md` T7 step 10 감사).
 *
 * `scripts/`는 제품 경로가 아니므로 `exceljs`를 직접 import한다
 * (`CLAUDE.md` import 예외 — `scripts/smoke/README.md` 참고).
 *
 * 출력에 셀 값을 담지 않는다. 구조 정보(타입·서식·프리픽스 유무·드롭다운 수식)만 남긴다.
 *
 * 실행: node scripts/smoke/assignment-xlsx.mjs <내려받은.xlsx>
 */
import process from 'node:process';
import ExcelJS from 'exceljs';

const path = process.argv[2];
if (!path) {
  console.error('사용법: node scripts/smoke/assignment-xlsx.mjs <배정표.xlsx>');
  process.exit(2);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const ws = wb.worksheets[0];

console.log(`시트: ${ws.name} · 행 ${ws.rowCount} · 열 ${ws.columnCount}`);
console.log(`틀고정: ${JSON.stringify(ws.views?.[0]?.state ?? null)} ${JSON.stringify(ws.views?.[0]?.ySplit ?? null)}`);

const headers = [];
ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
  headers[col] = String(cell.value ?? '');
});
console.log(`헤더(${headers.filter(Boolean).length}칸): ${headers.filter(Boolean).join(' | ')}`);

// 드롭다운 (완료 기준 4)
console.log('\n[드롭다운 — dataValidation]');
const dv = new Map();
for (let r = 1; r <= ws.rowCount; r += 1) {
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const v = ws.getCell(r, c).dataValidation;
    if (!v) continue;
    const key = `${headers[c] ?? `col${c}`}`;
    if (!dv.has(key)) dv.set(key, { rows: [], type: v.type, formulae: v.formulae });
    dv.get(key).rows.push(r);
  }
}
if (dv.size === 0) console.log('  없음');
for (const [col, info] of dv) {
  console.log(`  ${col}: type=${info.type} rows=[${info.rows.join(',')}] 목록=${JSON.stringify(info.formulae)}`);
}

// 수식 주입 방어 (완료 기준 5)
console.log('\n[수식 주입 방어 — 셀 타입·서식·프리픽스]');
let formulaCells = 0;
let prefixed = 0;
let nonTextFmt = 0;
for (let r = 1; r <= ws.rowCount; r += 1) {
  for (let c = 1; c <= ws.columnCount; c += 1) {
    const cell = ws.getCell(r, c);
    if (cell.value === null || cell.value === undefined || cell.value === '') continue;
    const isObj = typeof cell.value === 'object';
    if (isObj && ('formula' in cell.value || 'sharedFormula' in cell.value)) {
      formulaCells += 1;
      console.log(`  ⚠ 수식 셀: ${ws.name}!${r}:${c}`);
    }
    if (typeof cell.value === 'string' && cell.value.startsWith("'")) {
      prefixed += 1;
      console.log(`  ' 프리픽스: ${ws.name}!${r}:${c} (헤더 "${headers[c]}") numFmt=${JSON.stringify(cell.numFmt)}`);
    }
    if (typeof cell.value === 'string' && cell.numFmt !== '@') {
      nonTextFmt += 1;
      console.log(`  ⚠ 문자열인데 텍스트 서식이 아님: ${ws.name}!${r}:${c} numFmt=${JSON.stringify(cell.numFmt)}`);
    }
  }
}
console.log(`\n요약: 수식 셀 ${formulaCells}개(0이어야 함) · ' 프리픽스 ${prefixed}개 · 비텍스트 서식 문자열 ${nonTextFmt}개(0이어야 함)`);
process.exit(formulaCells === 0 && nonTextFmt === 0 ? 0 : 1);
