/**
 * 이 파이프라인의 계약은 셋이다.
 *
 *  1. **네 계층을 순서대로 잇는다** — 그 순서를 아는 곳이 여기 말고 없어야 한다.
 *     그래서 아래 픽스처 묶음은 「손으로 이어 붙인 4계층」과 **결과가 같은지**로 잰다.
 *     따로 기댓값을 적으면 계층별 테스트를 옮겨 적는 것이 되고, 정작 **순서가 바뀐 것**은
 *     못 잡는다 (`assignment-mapper.test.ts`가 이미 값 자체를 전수로 덮고 있다).
 *  2. **어떤 결말도 값이다** — 예외가 라우트로 새지 않는다 (`parse-runner`와 같은 규율).
 *  3. **과제 0건은 중단이다** — 「알려진 탭이 하나도 없음」과 같은 강도다 (`X2`).
 *
 * 실패 문구는 사용자에게 보여줄 한국어 문장이고 스택·내부 경로를 담지 않는다 (`X1`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAssignmentRows } from '@/lib/doc/assignment-mapper';
import { buildOutline } from '@/lib/doc/outline-builder';
import { extractFromOutline, runDocExtract } from '@/lib/doc/doc-pipeline';
import { readMarkdownOutline } from '@/lib/doc/markdown-reader';
import { parseWorkloadPriorities } from '@/lib/doc/workload-parser';
import { PARSE_TIMEOUT_MS } from '@/lib/upload/upload-limits';
import type { OutlineNode } from '@/types/doc';

/**
 * 「과제 0건」만 리더를 갈아 끼운다. 그 갈래를 실제 바이트로 재려면 **과제가 없는 `.docx`**가
 * 하나 더 필요한데, 픽스처를 늘리는 대신 판정 자체를 잰다 — 이 테스트가 지키려는 것은
 * mammoth가 아니라 「과제가 0건이면 중단한다」이다. 나머지 케이스는 전부 실제 경로다.
 */
const reader = vi.hoisted(() => ({ nodes: null as OutlineNode[] | null }));

vi.mock('@/lib/doc/docx-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/doc/docx-reader')>();
  return {
    ...actual,
    readDocxOutline: (input: Buffer | Uint8Array) =>
      reader.nodes === null ? actual.readDocxOutline(input) : Promise.resolve(reader.nodes),
  };
});

const MD_FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.md', import.meta.url));
const DOCX_FIXTURE = fileURLToPath(new URL('../fixtures/sample-workload.docx', import.meta.url));

const markdown = () => readFileSync(MD_FIXTURE, 'utf8');
const docxBytes = () => readFileSync(DOCX_FIXTURE);

const BASE_YEAR = 2026;
const CTX = { baseYear: BASE_YEAR } as const;

/** 스택·내부 경로가 새는 흔한 모양들 (`api-error.ts`의 목록과 같다) */
const LEAK_PATTERNS = [/\r|\n/, /\bat\s/, /\/src\//, /Error:/] as const;

afterEach(() => {
  reader.nodes = null;
  vi.restoreAllMocks();
});

describe('extractFromOutline — 네 계층을 잇는다', () => {
  const nodes = readMarkdownOutline(markdown());

  it('손으로 이어 붙인 리더→빌더→파서→매퍼와 결과가 같다', () => {
    const built = buildOutline(nodes);
    const expected = buildAssignmentRows(built.tasks, parseWorkloadPriorities(nodes), CTX);

    expect(extractFromOutline(nodes, CTX).rows).toEqual(expected);
  });

  it('픽스처의 과제 수만큼 행이 나온다', () => {
    expect(extractFromOutline(nodes, CTX).rows.map((r) => r.taskNo)).toEqual([
      '1-1',
      '1-2',
      '2-1',
      '2-2',
      '3-1',
      '3-2',
    ]);
  });

  it('워크로드 절을 실제로 조인한다 — 빠뜨리면 우선순위가 전부 빈칸이 된다', () => {
    // 이 단언이 없으면 `parseWorkloadPriorities`를 부르지 않아도 테스트가 통과한다.
    expect(extractFromOutline(nodes, CTX).rows.map((r) => r.priority)).toEqual([
      '긴급',
      '높음',
      '긴급',
      null,
      null,
      null,
    ]);
  });

  it('경고는 빌더의 것을 그대로 올린다 — 여기서 늘리지 않는다', () => {
    expect(extractFromOutline(nodes, CTX).warnings).toEqual(buildOutline(nodes).warnings);
  });

  it('`baseYear`는 주입받는다 — 시간을 읽지 않는다', () => {
    const at = (year: number) =>
      extractFromOutline(nodes, { baseYear: year }).rows.find((r) => r.taskNo === '1-1')
        ?.deadlineDate;

    expect(at(2026)).toBe('2026-09-01');
    expect(at(2030)).toBe('2030-09-01');
  });

  it('과제가 없으면 빈 배열이고 던지지 않는다 — 중단 판정은 `runDocExtract`가 한다', () => {
    const heading: OutlineNode[] = [{ level: 1, text: '제목만 있는 문서', lines: [] }];

    expect(extractFromOutline(heading, CTX)).toEqual({ rows: [], warnings: ['ORPHAN_SECTION'] });
  });
});

describe('runDocExtract — 성공', () => {
  it('`.docx` 픽스처에서 배정표 행이 나온다', async () => {
    const outcome = await runDocExtract(docxBytes(), CTX);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.rows.length).toBeGreaterThanOrEqual(1);
    expect(outcome.result.rows.map((r) => r.taskNo)).toEqual(['1-1', '1-2']);
  });

  it('`.docx`도 같은 네 계층을 지난다 — 난이도·마감·우선순위가 채워진다', async () => {
    const outcome = await runDocExtract(docxBytes(), CTX);

    if (!outcome.ok) throw new Error('실패로 끝났다');
    expect(outcome.result.rows[0]).toMatchObject({
      taskNo: '1-1',
      title: '숏폼 시리즈 기획',
      difficulty: '상',
      deadlineDate: '2026-09-01',
      priority: '긴급',
    });
  });

  it('같은 입력을 두 번 넣으면 같은 결과다 — 부수효과가 없다', async () => {
    const first = await runDocExtract(docxBytes(), CTX);
    const second = await runDocExtract(docxBytes(), CTX);

    expect(second).toEqual(first);
  });

  it('성공해도 타이머를 남기지 않는다', async () => {
    // 정리하지 않으면 서버리스 함수가 남은 타임아웃만큼 더 산다.
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    await runDocExtract(docxBytes(), CTX);

    const scheduled = set.mock.results
      .filter((_, i) => set.mock.calls[i][1] === PARSE_TIMEOUT_MS)
      .map((r) => r.value);
    expect(scheduled).toHaveLength(1);
    expect(clear).toHaveBeenCalledWith(scheduled[0]);
  });
});

describe('runDocExtract — 실패는 전부 DocExtractOutcome이다', () => {
  it('`.docx`가 아닌 바이트가 DOCUMENT_CORRUPT로 접히고 예외가 새지 않는다', async () => {
    const outcome = await runDocExtract(Buffer.from('not a document'), CTX);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DOCUMENT_CORRUPT');
  });

  it('빈 바이트도 DOCUMENT_CORRUPT다', async () => {
    const outcome = await runDocExtract(Buffer.alloc(0), CTX);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('DOCUMENT_CORRUPT');
  });

  it('과제 0건은 성공이 아니라 NO_OUTLINE_TASK다', async () => {
    reader.nodes = [
      { level: 1, text: '제목만 있는 문서', lines: ['번호 붙은 과제가 하나도 없다.'] },
    ];

    const outcome = await runDocExtract(docxBytes(), CTX);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('NO_OUTLINE_TASK');
  });

  it('빈 배정표를 성공으로 내려보내지 않는다 — 사람은 그게 빈 문서인지 고장인지 모른다', async () => {
    reader.nodes = [];

    const outcome = await runDocExtract(docxBytes(), CTX);

    expect(outcome).toMatchObject({ ok: false, code: 'NO_OUTLINE_TASK' });
    expect(outcome).not.toHaveProperty('result');
  });

  it('`timeoutMs: 0`이면 PARSE_TIMEOUT이다', async () => {
    const outcome = await runDocExtract(docxBytes(), { ...CTX, timeoutMs: 0 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('PARSE_TIMEOUT');
  });

  it('기본 타임아웃은 `PARSE_TIMEOUT_MS`다 — 숫자를 새로 만들지 않는다', async () => {
    const set = vi.spyOn(globalThis, 'setTimeout');

    await runDocExtract(Buffer.from('not a document'), CTX);

    expect(set.mock.calls.some((call) => call[1] === PARSE_TIMEOUT_MS)).toBe(true);
  });
});

describe('runDocExtract — 실패 문구', () => {
  const codes = ['DOCUMENT_CORRUPT', 'NO_OUTLINE_TASK', 'PARSE_TIMEOUT'] as const;

  const failures = async () => {
    reader.nodes = [];
    const noTask = await runDocExtract(docxBytes(), CTX);
    reader.nodes = null;

    return [
      await runDocExtract(Buffer.from('not a document'), CTX),
      noTask,
      await runDocExtract(docxBytes(), { ...CTX, timeoutMs: 0 }),
    ];
  };

  it('세 코드가 각각 자기 문장을 들고 온다', async () => {
    const outcomes = await failures();

    expect(outcomes.map((o) => (o.ok ? null : o.code))).toEqual([...codes]);
    const messages = outcomes.map((o) => (o.ok ? '' : o.message));
    expect(new Set(messages).size).toBe(3);
  });

  it('한국어 한 문장이고 스택·내부 경로를 담지 않는다', async () => {
    for (const outcome of await failures()) {
      if (outcome.ok) throw new Error('성공으로 끝났다');

      expect(outcome.message.length).toBeGreaterThan(0);
      expect(outcome.message.trim()).toBe(outcome.message);
      for (const pattern of LEAK_PATTERNS) expect(outcome.message).not.toMatch(pattern);
    }
  });

  it('`WORKBOOK_CORRUPT`의 「워크북」을 그대로 쓰지 않는다 — `.docx`를 올린 사람이 읽는다', async () => {
    const outcome = await runDocExtract(Buffer.from('not a document'), CTX);

    if (outcome.ok) throw new Error('성공으로 끝났다');
    expect(outcome.message).not.toContain('워크북');
    expect(outcome.message).toContain('문서');
  });
});
