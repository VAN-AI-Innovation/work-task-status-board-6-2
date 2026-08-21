/**
 * 이 러너의 계약은 하나다 — **어떤 결말도 예외로 새지 않는다.** 라우트 핸들러가 `try/catch`로
 * 갈래를 나누기 시작하면 계산이 라우트로 새고 계층 경계가 무너진다 (ARCHITECTURE.md).
 *
 * 두 번째 축은 메시지다. 실패 사유는 사용자에게 보여줄 한국어 문장이어야 하고 스택·내부 경로·
 * 시트 이름을 담지 않는다 (`X1`·`S6`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWorkbookParse } from '@/lib/upload/parse-runner';
import { PARSE_TIMEOUT_MS, WORKBOOK_LIMITS } from '@/lib/upload/upload-limits';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const bytes = () => readFileSync(FIXTURE);
const CTX = { baseYear: 2026, limits: WORKBOOK_LIMITS } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runWorkbookParse — 성공', () => {
  it('픽스처를 실제 상한으로 파싱하면 T3와 같은 탭 3개가 나온다', async () => {
    const outcome = await runWorkbookParse(bytes(), CTX);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.tabs.map((tab) => tab.teamKey)).toEqual(['edit', 'shoot', 'marketing']);
  });

  it('성공해도 타이머를 남기지 않는다', async () => {
    // 정리하지 않으면 서버리스 함수가 남은 타임아웃만큼 더 산다.
    // "아무 타이머나 정리했다"로는 부족해서 **그 타이머 핸들**이 정리됐는지를 본다
    const set = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    await runWorkbookParse(bytes(), CTX);

    const scheduled = set.mock.results
      .filter((_, i) => set.mock.calls[i][1] === PARSE_TIMEOUT_MS)
      .map((r) => r.value);
    expect(scheduled).toHaveLength(1);
    expect(clear).toHaveBeenCalledWith(scheduled[0]);
  });
});

describe('runWorkbookParse — 실패는 전부 ParseOutcome이다', () => {
  it('한도 초과가 ARCHIVE_LIMIT_EXCEEDED로 접힌다', async () => {
    const outcome = await runWorkbookParse(bytes(), { ...CTX, limits: { ...WORKBOOK_LIMITS, maxSheets: 1 } });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('ARCHIVE_LIMIT_EXCEEDED');
  });

  it('ZIP이 아닌 바이트가 WORKBOOK_CORRUPT로 접히고 예외가 새지 않는다', async () => {
    const outcome = await runWorkbookParse(Buffer.from('not a workbook'), CTX);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('WORKBOOK_CORRUPT');
  });

  it('시간을 넘기면 PARSE_TIMEOUT을 돌려준다', async () => {
    const outcome = await runWorkbookParse(bytes(), { ...CTX, timeoutMs: 0 });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('PARSE_TIMEOUT');
  });

  it('실패 메시지에 스택·내부 경로·시트 이름이 없다', async () => {
    const outcomes = [
      await runWorkbookParse(bytes(), { ...CTX, limits: { ...WORKBOOK_LIMITS, maxSheets: 1 } }),
      await runWorkbookParse(Buffer.from('not a workbook'), CTX),
      await runWorkbookParse(bytes(), { ...CTX, timeoutMs: 0 }),
    ];

    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.message).not.toMatch(/Error|at |\/src\/|촬영|편집|대시보드|설정/);
      expect(outcome.message.length).toBeGreaterThan(0);
    }
  });
});
