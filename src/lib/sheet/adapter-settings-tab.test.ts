/**
 * 두 층으로 검증한다.
 * - **픽스처 통합** — 실제 격자(`sample-workbook.xlsx`)로 T2 완료 기준 7(공통 enum 4종·SLA 8행)을 확인한다.
 * - **손으로 만든 작은 격자** — 중복·불량 데이터 판정을 좁게 고정한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseSettingsTab } from '@/lib/sheet/adapter-settings-tab';
import { detectTab } from '@/lib/sheet/tab-detector';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type {
  HeaderBand,
  MergeRange,
  SettingsRegistry,
  SheetCellValue,
  SheetGrid,
} from '@/types/sheet';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));

/** 값 배열로 격자를 만든다. 행 길이는 리더와 같게 columnCount로 맞춘다 */
function grid(rows: SheetCellValue[][], merges: MergeRange[] = []): SheetGrid {
  const columnCount = Math.max(...rows.map((r) => r.length));
  return {
    name: '테스트',
    rowCount: rows.length,
    columnCount,
    cells: rows.map((row) =>
      Array.from({ length: columnCount }, (_, c) => ({ value: row[c] ?? null, numFmt: null }))
    ),
    merges,
    hiddenRows: [],
    hiddenColumns: [],
  };
}

const valuesOf = (registry: SettingsRegistry, groupKey: string) =>
  registry.enums.filter((e) => e.groupKey === groupKey).map((e) => e.value);

const groupKeys = (registry: SettingsRegistry) => [...new Set(registry.enums.map((e) => e.groupKey))];

describe('parseSettingsTab — 픽스처 통합', () => {
  let sheet: SheetGrid;
  let band: HeaderBand;
  let registry: SettingsRegistry;

  beforeAll(async () => {
    const workbook = await readWorkbook(readFileSync(FIXTURE));
    const found = workbook.sheets.find((s) => s.name === '99_설정');
    if (!found) throw new Error('픽스처에 99_설정 탭이 없다');
    sheet = found;

    // 밴드는 판별기가 준 것을 그대로 쓴다 — 이 어댑터는 탭을 스스로 찾지 않는다.
    const detection = detectTab(sheet);
    expect(detection.kind).toBe('settings');
    band = detection.matches[0].band;

    registry = parseSettingsTab(sheet, band);
  });

  it('공통_ 접두 그룹이 정확히 4개다 (완료 기준 7 앞쪽)', () => {
    expect(groupKeys(registry).filter((k) => k.startsWith('공통_'))).toEqual([
      '공통_우선순위',
      '공통_리스크 상태',
      '공통_진행 상태',
      '공통_승인 상태',
    ]);
  });

  it('공통_진행 상태 10단계가 시트 순서 그대로 실린다', () => {
    expect(valuesOf(registry, '공통_진행 상태')).toEqual([
      '업무 배정',
      '준비 중',
      '진행 중',
      '검토 요청',
      '승인 대기',
      '수정 중',
      '게시·이관 대기',
      '완료',
      '보류',
      '취소',
    ]);

    const sortOrders = registry.enums
      .filter((e) => e.groupKey === '공통_진행 상태')
      .map((e) => e.sortOrder);
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('공통_우선순위 4개 / 리스크 상태 5개 / 승인 상태 6개', () => {
    expect(valuesOf(registry, '공통_우선순위')).toHaveLength(4);
    expect(valuesOf(registry, '공통_리스크 상태')).toHaveLength(5);
    expect(valuesOf(registry, '공통_승인 상태')).toHaveLength(6);
  });

  it('SLA가 8건이고 촬영팀 섭외가 5일이다 (완료 기준 7 뒤쪽)', () => {
    expect(registry.slaRules).toHaveLength(8);
    expect(registry.slaRules.find((r) => r.label === '촬영팀 섭외')?.days).toBe(5);
    expect(registry.slaRules.find((r) => r.label === 'SNS 문의 1차 답변 권장')?.days).toBe(1);
  });

  it('같은 8항목이 두 블록에 있어도 16건이 아니라 8건이다 (중복 제거)', () => {
    // 밴드 안 컬럼 쌍(r4~r11)과 아래쪽 별도 블록(r22~r29)에 같은 표가 있다.
    // 한쪽만 읽는 구현은 8건을 내고 통과해 버리므로, 두 블록을 실제로 봤는지도 함께 고정한다.
    expect(new Set(registry.slaRules.map((r) => r.label)).size).toBe(8);
    expect(registry.warnings.filter((w) => w.code === 'SLA_CONFLICT')).toHaveLength(0);

    // 아래쪽 블록만 지우면 결과가 같고, 위쪽 블록만 지워도 결과가 같아야 한다.
    const withoutLower = structuredClone(sheet);
    for (let row = 20; row < withoutLower.rowCount; row += 1) {
      withoutLower.cells[row][0].value = null;
      withoutLower.cells[row][1].value = null;
    }
    expect(parseSettingsTab(withoutLower, band).slaRules).toEqual(registry.slaRules);

    const withoutUpper = structuredClone(sheet);
    for (let row = 3; row <= 12; row += 1) {
      withoutUpper.cells[row][26].value = null;
      withoutUpper.cells[row][27].value = null;
    }
    expect(parseSettingsTab(withoutUpper, band).slaRules).toEqual(registry.slaRules);
  });

  it('편집팀 구성원 그룹에 아래쪽 SLA 항목명이 섞이지 않는다', () => {
    // 컬럼을 시트 끝까지 긁으면 r22~r29의 `편집팀 컨셉 공유` 등이 구성원으로 들어온다.
    expect(valuesOf(registry, '편집팀 구성원')).toEqual(['담당자1', '담당자2', '담당자3']);
    const memberValues = valuesOf(registry, '편집팀 구성원');
    for (const rule of registry.slaRules) {
      expect(memberValues).not.toContain(rule.label);
    }
  });

  it('SLA 컬럼 쌍은 enum 그룹으로 실리지 않는다', () => {
    expect(groupKeys(registry)).not.toContain('기본 SLA 설정_항목');
    expect(groupKeys(registry)).not.toContain('기본 SLA 설정_일수');
  });

  it('팀 전용 enum 그룹과 구성원 그룹이 모두 들어 있다', () => {
    const keys = groupKeys(registry);
    expect(keys.filter((k) => k.startsWith('편집_'))).toHaveLength(4);
    expect(keys.filter((k) => k.startsWith('촬영_'))).toHaveLength(7);
    expect(keys.filter((k) => k.startsWith('마케팅_'))).toHaveLength(6);
    // 구성원 컬럼도 같은 루프로 그냥 담는다 — 팀·구성원으로 쓸지는 T4가 정한다.
    expect(keys).toContain('촬영·기획팀 구성원');
    expect(keys).toContain('임원진·승인자');
    // 26개 enum 그룹 + SLA 2컬럼 = 28컬럼.
    expect(keys).toHaveLength(26);
  });

  it('값이 수식 셀이어도 문자열로 정규화된다', () => {
    const patched = structuredClone(sheet);
    patched.cells[5][7].value = { formula: "'99_설정'!H6", result: '진행 중' };
    expect(valuesOf(parseSettingsTab(patched, band), '공통_진행 상태')[2]).toBe('진행 중');
  });

  it('semantic 매핑을 하지 않는다 — 시트 문자열이 원문 그대로 남는다', () => {
    expect(valuesOf(registry, '공통_진행 상태')).toContain('진행 중');
    expect(JSON.stringify(registry)).not.toContain('in_progress');
  });
});

describe('parseSettingsTab — SLA 판정 (작은 격자)', () => {
  const band: HeaderBand = { groupRow: null, labelRow: 0 };

  it('같은 라벨의 일수가 다르면 SLA_CONFLICT를 남기고 먼저 나온 값을 쓴다', () => {
    const sheet = grid([
      ['공통_우선순위', '기본 SLA 설정_항목', '기본 SLA 설정_일수'],
      ['긴급', '촬영팀 섭외', 5],
      ['보통', '편집팀 컨셉 공유', 1],
      [null, null, null],
      [null, '기본 SLA 설정_항목', '기본 SLA 설정_일수'],
      [null, '촬영팀 섭외', 9],
    ]);

    const registry = parseSettingsTab(sheet, band);

    expect(registry.slaRules).toEqual([
      { label: '촬영팀 섭외', days: 5 },
      { label: '편집팀 컨셉 공유', days: 1 },
    ]);
    const conflicts = registry.warnings.filter((w) => w.code === 'SLA_CONFLICT');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ code: 'SLA_CONFLICT', sheet: '테스트', row: 6, column: 2 });
  });

  it('일수가 숫자가 아니면 그 행이 빠지고 SLA_DAYS_INVALID를 남긴다', () => {
    const sheet = grid([
      ['공통_우선순위', '기본 SLA 설정_항목', '기본 SLA 설정_일수'],
      ['긴급', '촬영팀 섭외', '협의'],
      ['보통', '편집팀 컨셉 공유', 1],
    ]);

    const registry = parseSettingsTab(sheet, band);

    expect(registry.slaRules).toEqual([{ label: '편집팀 컨셉 공유', days: 1 }]);
    expect(registry.warnings).toEqual([
      { code: 'SLA_DAYS_INVALID', sheet: '테스트', row: 2, column: 3 },
    ]);
  });

  it('경고에 셀 값이 들어 있지 않다 (코드·시트·행·열만)', () => {
    const sheet = grid([
      ['공통_우선순위', '기본 SLA 설정_항목', '기본 SLA 설정_일수'],
      ['긴급', '촬영팀 섭외', '담당자와 협의 후 결정'],
      ['보통', '촬영팀 섭외', 5],
    ]);

    const registry = parseSettingsTab(sheet, band);

    expect(registry.warnings.length).toBeGreaterThan(0);
    for (const warning of registry.warnings) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'column', 'row', 'sheet']);
    }
    expect(JSON.stringify(registry.warnings)).not.toContain('담당자와 협의');
    expect(JSON.stringify(registry.warnings)).not.toContain('촬영팀 섭외');
  });

  it('밴드 컬럼이 전부 빈 행에서 값 수집을 멈춘다', () => {
    const sheet = grid([
      ['공통_우선순위', '공통_리스크 상태', '요청 부서'],
      ['긴급', '정상', '편집팀'],
      ['보통', '주의', null],
      [null, null, null],
      ['아래쪽 표 제목', '다른 값', '또 다른 값'],
      ['섞이면 안 되는 값', null, null],
    ]);

    const registry = parseSettingsTab(sheet, band);

    expect(valuesOf(registry, '공통_우선순위')).toEqual(['긴급', '보통']);
    expect(registry.enums.map((e) => e.value)).not.toContain('섞이면 안 되는 값');
  });

  it('빈 칸을 건너뛰어도 sortOrder는 0부터의 연번이다', () => {
    const sheet = grid([
      ['공통_우선순위', '공통_리스크 상태', '요청 부서'],
      ['긴급', '정상', '편집팀'],
      [null, '주의', '촬영·기획팀'],
      ['보통', '지연', '마케팅·관리팀'],
    ]);

    const registry = parseSettingsTab(sheet, band);

    expect(registry.enums.filter((e) => e.groupKey === '공통_우선순위')).toEqual([
      { groupKey: '공통_우선순위', value: '긴급', sortOrder: 0 },
      { groupKey: '공통_우선순위', value: '보통', sortOrder: 1 },
    ]);
  });
});
