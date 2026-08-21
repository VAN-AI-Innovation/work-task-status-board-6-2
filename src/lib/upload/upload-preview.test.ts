/**
 * 이 파일이 지키는 것은 **미리보기가 거짓말을 하지 않는다**는 성질 하나다.
 *
 * 가장 값이 큰 테스트는 「같은 파일을 두 번 올리면 전건 유지」다 — 저장소에 실제로 넣은 뒤
 * 그 결과를 대조 대상으로 다시 미리보기해서, 분류 규칙이 저장소와 갈라지지 않았음을 본다
 * (`UC-03`). 여기가 갈라지면 "변경 M건"은 숫자만 그럴듯한 거짓이 된다.
 *
 * 입력은 손으로 짓지 않고 픽스처를 실제로 파싱해서 쓴다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import { createMemoryTaskStore } from '@/lib/store/memory-task-store';
import { buildUploadPreview } from '@/lib/upload/upload-preview';
import type { ParseWarning } from '@/types/sheet';
import type { Task, WorkbookParseResult } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const OCCURRED_AT = '2026-08-21T00:00:00.000Z';

/** 실패 갈래를 `ok`로 좁혀 준다 — 테스트마다 분기를 쓰면 읽히지 않는다 */
function ok(outcome: ReturnType<typeof buildUploadPreview>) {
  if (!outcome.ok) throw new Error(`미리보기가 중단됐다: ${outcome.code}`);
  return outcome;
}

describe('buildUploadPreview', () => {
  let parsed: WorkbookParseResult;

  beforeAll(async () => {
    parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  });

  it('저장된 것이 없으면 전건 신규다', () => {
    const { preview, payload } = ok(buildUploadPreview(parsed, [], 'upload-1'));

    expect(preview.totals.taskCount).toBe(payload.tasks.length);
    expect(preview.totals.created).toBe(payload.tasks.length);
    expect(preview.totals.updated).toBe(0);
    expect(preview.totals.unchanged).toBe(0);
    expect(payload.teamKeys).toEqual(['edit', 'shoot', 'marketing']);
    expect(preview.untouchedTeams).toEqual([]);
  });

  it('같은 파일을 다시 올리면 전건 유지다 — 저장소가 센 것과 같은 숫자여야 한다', async () => {
    const store = createMemoryTaskStore();
    const first = ok(buildUploadPreview(parsed, [], 'upload-1'));

    const result = await store.upsertTasks(first.payload.tasks, {
      uploadId: 'upload-1',
      occurredAt: OCCURRED_AT,
    });
    // 미리보기가 예고한 숫자와 저장소가 실제로 센 숫자가 같다
    expect(result.created).toBe(first.preview.totals.created);
    expect(result.updated).toBe(first.preview.totals.updated);
    expect(result.unchanged).toBe(first.preview.totals.unchanged);

    const existing = await store.listTasks();
    const second = ok(buildUploadPreview(parsed, existing, 'upload-2'));

    expect(second.preview.totals.unchanged).toBe(second.preview.totals.taskCount);
    expect(second.preview.totals.created).toBe(0);
    expect(second.preview.totals.updated).toBe(0);
  });

  it('한 건의 진행률만 다르면 변경 1건이고 나머지는 유지다', async () => {
    const store = createMemoryTaskStore();
    const { payload } = ok(buildUploadPreview(parsed, [], 'upload-1'));
    await store.upsertTasks(payload.tasks, { uploadId: 'upload-1', occurredAt: OCCURRED_AT });

    const existing = await store.listTasks();
    const [head, ...rest] = existing;
    // 빈 셀(null)과 0을 구분하는 규칙 때문에 값을 뒤집지 않고 확실히 다른 수로 바꾼다
    const nudged: Task[] = [{ ...head, progress: head.progress === 7 ? 8 : 7 }, ...rest];

    const { preview } = ok(buildUploadPreview(parsed, nudged, 'upload-2'));

    expect(preview.totals.updated).toBe(1);
    expect(preview.totals.created).toBe(0);
    expect(preview.totals.unchanged).toBe(preview.totals.taskCount - 1);
  });

  it('탭 하나만 든 파일은 나머지 두 팀을 건드리지 않는다고 고지한다', () => {
    const editOnly: WorkbookParseResult = {
      ...parsed,
      tabs: parsed.tabs.filter((tab) => tab.teamKey === 'edit'),
    };

    const { preview, payload } = ok(buildUploadPreview(editOnly, [], 'upload-1'));

    expect(payload.teamKeys).toEqual(['edit']);
    expect(preview.untouchedTeams).toEqual(['shoot', 'marketing']);
    expect(preview.tabs.map((tab) => tab.teamKey)).toEqual(['edit']);
  });

  it('팀 탭이 하나도 없으면 성공이 아니라 중단이다 (설정 탭만 든 파일)', () => {
    const settingsOnly: WorkbookParseResult = { ...parsed, tabs: [] };

    const outcome = buildUploadPreview(settingsOnly, [], 'upload-1');

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.code).toBe('NO_KNOWN_TAB');
    // 사용자에게 보여줄 한국어 문장이고 내부 경로·셀 값을 담지 않는다 (`X1`)
    expect(outcome.ok === false && outcome.message).toContain('팀 탭');
  });

  it('빈 워크북 결과도 중단이다 — 빈 성공으로 기존 데이터를 덮지 않는다', () => {
    const empty: WorkbookParseResult = { tabs: [], settings: null, warnings: [] };

    expect(buildUploadPreview(empty, [], null).ok).toBe(false);
  });

  it('행이 하나도 없는 팀 탭만 있으면 중단이다', () => {
    const emptyTeamTab: WorkbookParseResult = {
      ...parsed,
      tabs: parsed.tabs
        .filter((tab) => tab.teamKey === 'edit')
        .map((tab) => ({ ...tab, tasks: [], goalMetrics: [] })),
    };

    expect(buildUploadPreview(emptyTeamTab, [], null).ok).toBe(false);
  });

  it('같은 코드·시트의 경고 5건이 1건으로 접힌다', () => {
    const noisy: ParseWarning[] = Array.from({ length: 5 }, (_, index) => ({
      code: 'UNREGISTERED_ENUM',
      sheet: '01_편집팀',
      row: 20 - index,
    }));
    const withNoise: WorkbookParseResult = { ...parsed, warnings: [...parsed.warnings, ...noisy] };

    const { preview } = ok(buildUploadPreview(withNoise, [], null));
    const folded = preview.warnings.filter((warning) => warning.code === 'UNREGISTERED_ENUM');

    expect(folded).toHaveLength(1);
    expect(folded[0].count).toBe(5);
    expect(folded[0].sheet).toBe('01_편집팀');
    // 가장 먼저 발생한 행 = 가장 작은 행 번호
    expect(folded[0].firstRow).toBe(16);
  });

  it('판별 실패한 탭이 빠진 탭으로 명시된다', () => {
    const withSkipped: WorkbookParseResult = {
      ...parsed,
      warnings: [...parsed.warnings, { code: 'UNKNOWN_TAB', sheet: '04_알수없는탭' }],
    };

    const { preview } = ok(buildUploadPreview(withSkipped, [], null));

    expect(preview.skippedSheets).toEqual(['04_알수없는탭']);
    expect(preview.tabs.find((tab) => tab.sheet === '04_알수없는탭')?.skipped).toBe(true);
  });

  it('설정 탭과 대시보드는 빠진 탭이 아니다 — 원래 읽지 않는 탭이다', () => {
    const { preview } = ok(buildUploadPreview(parsed, [], null));

    expect(preview.skippedSheets).toEqual([]);
    expect(preview.warnings.map((warning) => warning.sheet)).not.toContain('00_통합 대시보드');
  });

  it('한 업로드 안의 중복 자연키가 경고로 잡힌다', () => {
    const duplicated: WorkbookParseResult = {
      ...parsed,
      tabs: parsed.tabs.map((tab) =>
        tab.teamKey === 'edit' ? { ...tab, tasks: [...tab.tasks, tab.tasks[0]] } : tab,
      ),
    };

    const { preview } = ok(buildUploadPreview(duplicated, [], null));
    const dup = preview.warnings.find((warning) => warning.code === 'DUPLICATE_SOURCE_KEY');

    expect(dup?.count).toBe(1);
    // 뒤엣것이 이기므로 저장되는 건수는 한 건 줄어든다 (저장소와 같은 규칙)
    expect(preview.totals.created).toBe(preview.totals.taskCount - 1);
  });

  it('payload가 JSON 왕복을 견딘다 — uploads.parse_result에 그대로 들어간다', () => {
    const { payload } = ok(buildUploadPreview(parsed, [], 'upload-1'));

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('미리보기에 셀 값·업무명·담당자가 실리지 않는다', () => {
    const { preview } = ok(buildUploadPreview(parsed, [], 'upload-1'));
    const serialized = JSON.stringify(preview);

    expect(serialized).not.toContain('010-0000-0000');
    expect(serialized).not.toContain('sample_account_1');
    expect(serialized).not.toContain('담당자1');
    expect(serialized).not.toContain('카드뉴스');
  });
});
