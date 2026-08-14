// T1 스모크: mammoth가 .docx의 heading을 h1~h6으로 인식하는지 실측한다 (H8).
// 실업무 문서를 읽으므로 본문 텍스트는 출력하지 않는다 — 태그·개수·번호 접두사·길이만 찍는다.
// 사용법: node scripts/smoke/docx-headings.mjs [docx경로]

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import mammoth from 'mammoth';
import { parse } from 'node-html-parser';

const SMOKE_INPUT_DIR = 'smoke-input';
const COUNTED_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'table', 'ul', 'ol'];

function resolveDocxPath(argPath) {
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
    .filter((name) => name.toLowerCase().endsWith('.docx') && !name.startsWith('~$'))
    .sort();
  if (found.length === 0) {
    console.error(`${SMOKE_INPUT_DIR}/ 에 .docx 파일이 없다.`);
    process.exit(1);
  }
  return join(SMOKE_INPUT_DIR, found[0]);
}

// 번호 접두사만 분류한다. 본문 텍스트는 반환하지 않는다.
function numberPrefix(text) {
  if (/^\s*\d+-\d+\./.test(text)) return 'N-M.';
  if (/^\s*\d+\./.test(text)) return 'N.';
  return '(없음)';
}

function analyze(html) {
  const root = parse(html);
  const tagCounts = Object.fromEntries(
    COUNTED_TAGS.map((tag) => [tag, root.querySelectorAll(tag).length])
  );

  const headings = [];
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    for (const node of root.querySelectorAll(tag)) {
      const text = node.text ?? '';
      headings.push({ tag, prefix: numberPrefix(text), length: text.trim().length });
    }
  }

  const demotedParagraphs = root
    .querySelectorAll('p')
    .filter((node) => numberPrefix(node.text ?? '') !== '(없음)').length;

  return { tagCounts, headings, demotedParagraphs };
}

function judge({ tagCounts, headings }) {
  const hasH2WithSection = headings.some((h) => h.tag === 'h2' && h.prefix === 'N.');
  const hasH3WithTask = headings.some((h) => h.tag === 'h3' && h.prefix === 'N-M.');
  return tagCounts.h2 >= 1 && tagCounts.h3 >= 1 && hasH2WithSection && hasH3WithTask;
}

function report(label, analysis, passed) {
  console.log(`\n=== ${label} ===`);
  console.log('태그별 개수:');
  for (const tag of COUNTED_TAGS) {
    console.log(`  ${tag.padEnd(6)} ${analysis.tagCounts[tag]}`);
  }

  const prefixCount = (tag, prefix) =>
    analysis.headings.filter((h) => h.tag === tag && h.prefix === prefix).length;
  console.log('heading 번호 접두사:');
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    if (analysis.tagCounts[tag] === 0) continue;
    console.log(
      `  ${tag}: N. ${prefixCount(tag, 'N.')}건 / N-M. ${prefixCount(tag, 'N-M.')}건 / (없음) ${prefixCount(tag, '(없음)')}건`
    );
  }
  console.log('heading 목록 (태그 · 접두사 · 텍스트 길이):');
  for (const h of analysis.headings) {
    console.log(`  ${h.tag} · ${h.prefix} · ${h.length}자`);
  }
  console.log(`p로 강등된 번호 문단: ${analysis.demotedParagraphs}건`);
  console.log(`판정: ${passed ? 'PASS' : 'FAIL'} (${label})`);
}

function printMessages(messages) {
  console.log(`\nmammoth messages (${messages.length}건):`);
  for (const m of messages) {
    console.log(`  [${m.type}] ${m.message}`);
  }
}

// messages의 경고에서 실제 스타일 이름을 읽는다. 추측해서 하드코딩하지 않는다.
function collectUnrecognisedStyles(messages) {
  const styles = new Map();
  for (const m of messages) {
    const matched = /style: '([^']+)'(?: \(Style ID: ([^)]+)\))?/.exec(m.message ?? '');
    if (!matched) continue;
    styles.set(matched[1], matched[2] ?? null);
  }
  return [...styles.entries()].map(([name, id]) => ({ name, id }));
}

// 스타일 이름/ID에 든 숫자만으로 heading 레벨을 정한다. 숫자가 없으면 매핑하지 않는다.
function buildStyleMap(styles) {
  const rules = [];
  for (const { name, id } of styles) {
    const level = (/(\d)/.exec(name) ?? /(\d)/.exec(id ?? ''))?.[1];
    if (!level || Number(level) < 1 || Number(level) > 6) continue;
    rules.push(`p[style-name='${name}'] => h${level}:fresh`);
  }
  return rules;
}

const docxPath = resolveDocxPath(process.argv[2]);
console.log(`대상 파일: ${docxPath}`);

const base = await mammoth.convertToHtml({ path: docxPath });
const baseAnalysis = analyze(base.value);
const basePassed = judge(baseAnalysis);
report('기본 옵션', baseAnalysis, basePassed);
printMessages(base.messages);

if (basePassed) {
  console.log('\n최종 판정: PASS (기본 옵션) — styleMap 불필요');
  process.exit(0);
}

const styles = collectUnrecognisedStyles(base.messages);
console.log('\n인식되지 않은 스타일 이름:');
for (const s of styles) {
  console.log(`  '${s.name}'${s.id ? ` (Style ID: ${s.id})` : ''}`);
}

const styleMap = buildStyleMap(styles);
if (styleMap.length === 0) {
  console.log('\nmessages에서 heading으로 매핑할 스타일 이름을 찾지 못했다. 2차 시도를 건너뛴다.');
  console.log('최종 판정: FAIL (기본 옵션 · styleMap 구성 불가)');
  process.exit(0);
}

console.log('\n구성한 styleMap:');
for (const rule of styleMap) console.log(`  ${rule}`);

const retry = await mammoth.convertToHtml({ path: docxPath }, { styleMap });
const retryAnalysis = analyze(retry.value);
const retryPassed = judge(retryAnalysis);
report('styleMap 적용', retryAnalysis, retryPassed);
printMessages(retry.messages);

console.log(
  `\n최종 판정: ${retryPassed ? 'PASS (styleMap 필요)' : 'FAIL (기본 옵션·styleMap 둘 다 실패)'}`
);
