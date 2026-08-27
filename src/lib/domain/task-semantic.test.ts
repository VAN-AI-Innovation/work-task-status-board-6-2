/**
 * 두 축을 본다.
 *
 * 1. **매핑표가 시트와 어긋나지 않는가.** `STATUS_SEMANTIC_MAP`은 손으로 적은 표라
 *    시트 원문과 글자 하나만 달라도 조용히 `null`이 된다. 그래서 레지스트리를 손으로 짓지 않고
 *    **실제 픽스처를 파이프라인에 돌려** 나온 것을 쓴다 (가짜 레지스트리는 어긋남을 통과시킨다).
 * 2. **미등록 값 검사가 `H4`의 실측 수단이 되는가.** 건수가 지표라 접지 않고,
 *    경고에 값이 새지 않으며, 설정 탭이 없는 부분 업로드에서 폭발하지 않아야 한다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  STATUS_OPTIONS,
  STATUS_SEMANTIC_MAP,
  buildSemanticIndex,
  collectUnregisteredEnumWarnings,
  isActiveSemantic,
  toSemantic,
} from '@/lib/domain/task-semantic';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { EnumOptionEntry, SettingsRegistry } from '@/types/sheet';
import type { ParsedTask, Task } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const STATUS_GROUP = '공통_진행 상태';

let registry: SettingsRegistry;
let fixtureTasks: Task[];

/** `ParsedTask`를 저장 모델로 옮긴다. 이 step이 보는 필드는 상태 4종과 위치 둘뿐이다 */
function toTask(parsed: ParsedTask, index: number): Task {
  return {
    id: `task-${index}`,
    teamId: parsed.teamKey,
    departmentId: null,
    sourceKey: parsed.sourceKey,
    title: parsed.title,
    ownerMemberId: null,
    ownerNameRaw: parsed.ownerNameRaw,
    coOwnerNames: parsed.coOwnerNames,
    status: parsed.status,
    approvalStatus: parsed.approvalStatus,
    priority: parsed.priority,
    riskStatus: parsed.riskStatus,
    progress: parsed.progress,
    assignedAt: parsed.assignedAt,
    dueAt: parsed.dueAt,
    nextAction: parsed.nextAction,
    nextActionOwner: parsed.nextActionOwner,
    nextActionDue: parsed.nextActionDue,
    delayReason: parsed.delayReason,
    note: parsed.note,
    extras: parsed.extras,
    raw: parsed.raw,
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: parsed.sourceSheetTab,
    sourceRowIndex: parsed.sourceRowIndex,
  };
}

/** 상태 4종만 바꾼 최소 업무. 나머지 필드는 이 step의 판정에 쓰이지 않는다 */
function task(overrides: Partial<Task>): Task {
  return {
    ...toTask(
      {
        teamKey: 'edit',
        sourceKey: 'k',
        title: null,
        ownerNameRaw: null,
        coOwnerNames: [],
        status: null,
        approvalStatus: null,
        priority: null,
        riskStatus: null,
        progress: null,
        assignedAt: null,
        dueAt: null,
        nextAction: null,
        nextActionOwner: null,
        nextActionDue: null,
        delayReason: null,
        note: null,
        extras: {},
        raw: {},
        sourceSheetTab: '01_편집팀',
        sourceRowIndex: 10,
        stages: [],
      },
      0
    ),
    ...overrides,
  };
}

/** 레지스트리에서 그룹 하나를 빼거나 남긴다 */
function registryWith(groupKeys: string[]): SettingsRegistry {
  return { ...registry, enums: registry.enums.filter((e) => groupKeys.includes(e.groupKey)) };
}

beforeAll(async () => {
  const parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  expect(parsed.settings).not.toBeNull();
  registry = parsed.settings as SettingsRegistry;
  fixtureTasks = parsed.tabs.flatMap((tab) => tab.tasks).map(toTask);
});

describe('toSemantic', () => {
  it('픽스처 레지스트리로 만든 인덱스에서 진행 중을 in_progress로 옮긴다', () => {
    expect(toSemantic('진행 중', buildSemanticIndex(registry))).toBe('in_progress');
  });

  it('픽스처 공통_진행 상태 10개 값이 전부 매핑된다', () => {
    const values = registry.enums
      .filter((e: EnumOptionEntry) => e.groupKey === STATUS_GROUP)
      .map((e) => e.value);
    const index = buildSemanticIndex(registry);

    expect(values).toHaveLength(10);
    // 하나라도 null이면 `STATUS_SEMANTIC_MAP`이 시트 원문과 어긋난 것이다
    expect(values.filter((value) => toSemantic(value, index) === null)).toEqual([]);
  });

  it('업무 배정과 준비 중이 둘 다 planned다', () => {
    const index = buildSemanticIndex(registry);
    expect(toSemantic('업무 배정', index)).toBe('planned');
    expect(toSemantic('준비 중', index)).toBe('planned');
  });

  it('공백이 빠진 진행중은 매핑하지 않는다', () => {
    // 부분 일치를 쓰면 `승인 대기`가 `대기`에 걸린다. 정확히 일치만 한다
    expect(toSemantic('진행중', buildSemanticIndex(registry))).toBeNull();
  });

  it('앞뒤 공백은 잘라내고 매핑한다', () => {
    expect(toSemantic('  진행 중  ', buildSemanticIndex(registry))).toBe('in_progress');
  });

  it('null·빈 문자열·공백뿐인 값은 null이다', () => {
    const index = buildSemanticIndex(registry);
    expect(toSemantic(null, index)).toBeNull();
    expect(toSemantic('', index)).toBeNull();
    expect(toSemantic('   ', index)).toBeNull();
  });

  it('레지스트리가 없어도 내장 표로 판정한다', () => {
    // 설정 탭이 빠진 부분 업로드(UC-04)에서 판정이 죽으면 안 된다
    expect(toSemantic('완료', buildSemanticIndex(null))).toBe('done');
    expect(toSemantic('완료', buildSemanticIndex(registryWith([])))).toBe('done');
  });

  it('레지스트리에 없는 상태는 인덱스에도 없다', () => {
    const trimmed = registryWith([STATUS_GROUP]);
    const index = buildSemanticIndex({
      ...trimmed,
      enums: trimmed.enums.filter((e) => e.value !== '취소'),
    });
    expect(toSemantic('취소', index)).toBeNull();
    expect(toSemantic('완료', index)).toBe('done');
  });
});

describe('isActiveSemantic', () => {
  it('진행형 semantic만 true다', () => {
    expect(isActiveSemantic('in_progress')).toBe(true);
    expect(isActiveSemantic('review')).toBe(true);
    expect(isActiveSemantic('planned')).toBe(true);
    expect(isActiveSemantic('done')).toBe(false);
    expect(isActiveSemantic('hold')).toBe(false);
    expect(isActiveSemantic('cancelled')).toBe(false);
    expect(isActiveSemantic(null)).toBe(false);
  });
});

describe('collectUnregisteredEnumWarnings', () => {
  it('미등록 상태 하나를 위치와 함께 경고한다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: '진행중', sourceSheetTab: '01_편집팀', sourceRowIndex: 42 })],
      registry
    );

    expect(warnings).toEqual([
      { code: 'UNREGISTERED_STATUS', sheet: '01_편집팀', row: 42 },
    ]);
  });

  it('경고에 상태 원문·업무명·담당자가 새지 않는다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: '진행중', title: '비밀 업무', ownerNameRaw: '홍길동' })],
      registry
    );
    const serialized = JSON.stringify(warnings);

    expect(Object.keys(warnings[0]).sort()).toEqual(['code', 'row', 'sheet']);
    expect(serialized).not.toContain('진행중');
    expect(serialized).not.toContain('비밀 업무');
    expect(serialized).not.toContain('홍길동');
  });

  it('네 필드가 모두 미등록이면 코드 4종이 한 건씩 나온다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: 'X', approvalStatus: 'X', priority: 'X', riskStatus: 'X' })],
      registry
    );

    expect(warnings).toHaveLength(4);
    expect(warnings.map((w) => w.code).sort()).toEqual([
      'UNREGISTERED_APPROVAL_STATUS',
      'UNREGISTERED_PRIORITY',
      'UNREGISTERED_RISK_STATUS',
      'UNREGISTERED_STATUS',
    ]);
  });

  it('같은 미등록 값을 쓰는 업무가 셋이면 경고도 셋이다', () => {
    // 접으면 `H4`의 실측 지표(몇 건인가)를 잃는다
    const warnings = collectUnregisteredEnumWarnings(
      [
        task({ status: '진행중', sourceRowIndex: 10 }),
        task({ status: '진행중', sourceRowIndex: 11 }),
        task({ status: '진행중', sourceRowIndex: 12 }),
      ],
      registry
    );

    expect(warnings).toHaveLength(3);
    expect(warnings.map((w) => w.row)).toEqual([10, 11, 12]);
  });

  it('미입력은 미등록이 아니다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: null, approvalStatus: '', priority: '   ', riskStatus: null })],
      registry
    );

    expect(warnings).toEqual([]);
  });

  it('등록된 값은 앞뒤 공백이 있어도 경고하지 않는다', () => {
    expect(collectUnregisteredEnumWarnings([task({ status: '  진행 중 ' })], registry)).toEqual([]);
  });

  it('레지스트리가 없으면 전체 검사를 건너뛴다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: 'X', approvalStatus: 'X', priority: 'X', riskStatus: 'X' })],
      null
    );

    expect(warnings).toEqual([]);
  });

  it('레지스트리에 없는 그룹만 검사에서 빠진다', () => {
    const warnings = collectUnregisteredEnumWarnings(
      [task({ status: 'X', approvalStatus: 'X', priority: 'X', riskStatus: 'X' })],
      registryWith(['공통_진행 상태', '공통_승인 상태', '공통_리스크 상태'])
    );

    expect(warnings.map((w) => w.code).sort()).toEqual([
      'UNREGISTERED_APPROVAL_STATUS',
      'UNREGISTERED_RISK_STATUS',
      'UNREGISTERED_STATUS',
    ]);
  });

  it('픽스처 업무 9건의 미등록 경고는 6건이다', () => {
    // `H4`의 답이다. 「설정 탭 enum이 실제로 쓰인다」는 **팀 전용 그룹에서만** 성립한다 —
    // 마케팅 탭의 `답변 완료`·`미답변`은 `마케팅_답변 상태` 값이라 `공통_진행 상태`에 없고,
    // 리스크 컬럼에도 공통 값이 아닌 진행 상태 문구가 들어가 있다. 값은 보존하고 경고만 남긴다
    const warnings = collectUnregisteredEnumWarnings(fixtureTasks, registry);
    const byCode = warnings.reduce<Record<string, number>>((acc, w) => {
      acc[w.code] = (acc[w.code] ?? 0) + 1;
      return acc;
    }, {});

    expect(fixtureTasks).toHaveLength(9);
    expect(warnings).toHaveLength(6);
    expect(byCode).toEqual({
      UNREGISTERED_STATUS: 2,
      UNREGISTERED_APPROVAL_STATUS: 1,
      UNREGISTERED_RISK_STATUS: 3,
    });
  });
});

describe('STATUS_SEMANTIC_MAP', () => {
  it('값 10개가 semantic 9종을 덮는다', () => {
    expect(Object.keys(STATUS_SEMANTIC_MAP)).toHaveLength(10);
    expect(new Set(Object.values(STATUS_SEMANTIC_MAP)).size).toBe(9);
  });

  /*
   * 드롭다운 목록이 표에서 **자라 나온 것**임을 못박는다. 손으로 적은 배열이면 시트 원문과
   * 한 글자만 어긋나도 사용자가 고른 값이 조용히 미매핑되고, 그것을 잡는 테스트가 없다.
   */
  it('STATUS_OPTIONS가 표의 키를 순서 그대로 담는다', () => {
    expect(STATUS_OPTIONS).toEqual(Object.keys(STATUS_SEMANTIC_MAP));
    // 화면이 실제로 쓰는 폴백 표(`buildSemanticIndex(null)`)가 열 값을 전부 안다
    const fallback = buildSemanticIndex(null);
    expect(STATUS_OPTIONS.every((value) => toSemantic(value, fallback) !== null)).toBe(true);
  });
});
