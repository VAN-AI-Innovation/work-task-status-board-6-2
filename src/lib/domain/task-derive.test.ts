/**
 * 「지연」이 상태값이 아니라 **파생 판정**이라는 것(`ADR-009`)이 이 파일이 지키는 전부다.
 * 그래서 테스트가 보는 축도 둘이다.
 *
 * 1. **완료·취소를 확실히 제외하는가.** 시트가 스스로 `리스크 상태 = 지연`이라고 적어도
 *    완료된 건은 지연이 아니다. 여기가 새면 완료율과 화면 색이 어긋난다.
 * 2. **오늘을 주입받은 대로만 쓰는가.** 실행 시각에 따라 결과가 달라지면 판정을 못 믿는다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { deriveAllFlags, deriveTaskFlags, type DeriveContext } from '@/lib/domain/task-derive';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import type { SettingsRegistry } from '@/types/sheet';
import type { ParsedTask, Task } from '@/types/task';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-workbook.xlsx', import.meta.url));
const TODAY = '2026-07-25';

let registry: SettingsRegistry;
let fixtureTasks: Task[];

/** `ParsedTask`를 저장 모델로 옮긴다. T5 커밋 이전이라 신원·감사 필드는 비어 있다 */
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

function ctx(overrides: Partial<DeriveContext> = {}): DeriveContext {
  return { today: TODAY, semanticIndex: buildSemanticIndex(registry), ...overrides };
}

beforeAll(async () => {
  const parsed = await parseWorkbook(readFileSync(FIXTURE), { baseYear: 2026 });
  expect(parsed.settings).not.toBeNull();
  registry = parsed.settings as SettingsRegistry;
  fixtureTasks = parsed.tabs.flatMap((tab) => tab.tasks).map(toTask);
});

describe('deriveTaskFlags — 지연', () => {
  it('마감이 하루 지난 진행 중 업무는 지연이고 dday가 -1이다', () => {
    const flags = deriveTaskFlags(task({ dueAt: '2026-07-24', status: '진행 중' }), ctx());

    expect(flags.dday).toBe(-1);
    expect(flags.isOverdue).toBe(true);
    expect(flags.semantic).toBe('in_progress');
  });

  it('같은 업무의 상태를 완료로만 바꾸면 지연이 아니게 된다', () => {
    const flags = deriveTaskFlags(task({ dueAt: '2026-07-24', status: '완료' }), ctx());

    expect(flags.dday).toBe(-1);
    expect(flags.isOverdue).toBe(false);
  });

  it('마감이 없어도 시트 리스크 상태가 지연이면 지연이다', () => {
    const flags = deriveTaskFlags(task({ dueAt: null, riskStatus: '지연' }), ctx());

    expect(flags.dday).toBeNull();
    expect(flags.isOverdue).toBe(true);
  });

  it('시트 리스크가 지연이어도 취소 건은 지연이 아니다', () => {
    const flags = deriveTaskFlags(task({ riskStatus: '지연', status: '취소' }), ctx());

    expect(flags.isOverdue).toBe(false);
  });
});

describe('deriveTaskFlags — 마감 임박', () => {
  it('오늘 마감은 dday 0이고 임박에 포함되며 지연이 아니다', () => {
    const flags = deriveTaskFlags(task({ dueAt: TODAY, status: '진행 중' }), ctx());

    expect(flags.dday).toBe(0);
    expect(flags.isDueSoon).toBe(true);
    expect(flags.isOverdue).toBe(false);
  });

  it('기본 기준 D-3에서 오늘+3은 임박이고 오늘+4는 아니다', () => {
    expect(deriveTaskFlags(task({ dueAt: '2026-07-28' }), ctx()).isDueSoon).toBe(true);
    expect(deriveTaskFlags(task({ dueAt: '2026-07-29' }), ctx()).isDueSoon).toBe(false);
  });

  it('dueSoonDays를 1로 좁히면 오늘+3이 임박에서 빠진다', () => {
    const flags = deriveTaskFlags(task({ dueAt: '2026-07-28' }), ctx({ dueSoonDays: 1 }));

    expect(flags.isDueSoon).toBe(false);
  });
});

describe('deriveTaskFlags — 장기 미갱신', () => {
  it('8일 전 갱신된 진행 중 업무는 미갱신이고 7일 전이면 아니다', () => {
    const base = { status: '진행 중' };

    expect(
      deriveTaskFlags(task({ ...base, lastProgressAt: '2026-07-17T09:00:00+09:00' }), ctx()).isStale
    ).toBe(true);
    expect(
      deriveTaskFlags(task({ ...base, lastProgressAt: '2026-07-18T09:00:00+09:00' }), ctx()).isStale
    ).toBe(false);
  });

  it('8일 전 갱신이어도 완료 건은 미갱신이 아니다', () => {
    const flags = deriveTaskFlags(
      task({ status: '완료', lastProgressAt: '2026-07-17T09:00:00+09:00' }),
      ctx()
    );

    expect(flags.isStale).toBe(false);
  });

  it('갱신 이력이 없으면 미갱신이 아니다 — 증거가 없는 것은 증거가 아니다', () => {
    const flags = deriveTaskFlags(task({ status: '진행 중', lastProgressAt: null }), ctx());

    expect(flags.isStale).toBe(false);
  });
});

describe('deriveTaskFlags — 담당자', () => {
  it('빈칸·공백·미정·TBD·하이픈은 전부 담당자 미지정이다', () => {
    for (const owner of [null, '', '  ', '미정', 'TBD', 'tbd', '-', '–', '—', '없음']) {
      expect(deriveTaskFlags(task({ ownerNameRaw: owner }), ctx()).hasNoOwner).toBe(true);
    }
  });

  it('구성원 목록에 없는 이름은 오타 후보로 분류된다', () => {
    const known = ctx({ knownOwners: ['담당자1'] });

    expect(deriveTaskFlags(task({ ownerNameRaw: '담당자2' }), known).hasUnknownOwner).toBe(true);
    expect(deriveTaskFlags(task({ ownerNameRaw: ' 담당자1 ' }), known).hasUnknownOwner).toBe(false);
  });

  it('구성원 목록을 주지 않으면 오타 후보가 하나도 나오지 않는다', () => {
    expect(deriveTaskFlags(task({ ownerNameRaw: '담당자2' }), ctx()).hasUnknownOwner).toBe(false);
    expect(
      deriveTaskFlags(task({ ownerNameRaw: '담당자2' }), ctx({ knownOwners: [] })).hasUnknownOwner
    ).toBe(false);
  });

  it('미지정 담당자는 오타 후보로 중복 신고되지 않는다', () => {
    const flags = deriveTaskFlags(task({ ownerNameRaw: '미정' }), ctx({ knownOwners: ['담당자1'] }));

    expect(flags.hasNoOwner).toBe(true);
    expect(flags.hasUnknownOwner).toBe(false);
  });
});

describe('deriveTaskFlags — 기한 미설정', () => {
  it('진행 중인데 마감이 없으면 기한 미설정이고 완료 건은 아니다', () => {
    expect(deriveTaskFlags(task({ dueAt: null, status: '진행 중' }), ctx()).hasNoDueDate).toBe(true);
    expect(deriveTaskFlags(task({ dueAt: null, status: '완료' }), ctx()).hasNoDueDate).toBe(false);
  });
});

describe('deriveTaskFlags — 순수성', () => {
  it('today를 고정한 두 번의 호출이 같은 결과를 낸다', () => {
    const subject = task({ dueAt: '2026-07-24', status: '진행 중' });

    expect(deriveTaskFlags(subject, ctx())).toEqual(deriveTaskFlags(subject, ctx()));
  });

  it('입력 업무를 고치지 않는다', () => {
    const subject = task({ dueAt: '2026-07-24', status: '진행 중', ownerNameRaw: '담당자1' });
    const before = structuredClone(subject);

    deriveTaskFlags(subject, ctx({ knownOwners: ['담당자9'] }));

    expect(subject).toEqual(before);
  });
});

describe('deriveAllFlags — 픽스처 실측', () => {
  it('2026-07-25 기준 픽스처 9건 중 지연 2건, 임박 0건이다', () => {
    // 마케팅 문의 2건(마감 7/22·7/23)만 지난 마감이다. 둘 다 상태 원문이 `마케팅_답변 상태`
    // 값이라 semantic이 null인데, **미등록 상태는 완료가 아니므로 지연 판정에서 빠지지 않는다.**
    // 촬영 건(8/5)은 열흘 넘게 남아 임박도 아니다
    const flags = deriveAllFlags(fixtureTasks, ctx());
    const values = [...flags.values()];

    expect(flags.size).toBe(9);
    expect(values.filter((f) => f.isOverdue)).toHaveLength(2);
    expect(values.filter((f) => f.isDueSoon)).toHaveLength(0);
  });

  it('8/3로 옮기면 촬영 건(8/5 마감)이 임박으로 잡힌다', () => {
    const values = [...deriveAllFlags(fixtureTasks, ctx({ today: '2026-08-03' })).values()];

    expect(values.filter((f) => f.isDueSoon)).toHaveLength(1);
    expect(values.filter((f) => f.isOverdue)).toHaveLength(2);
  });

  it('업무 id를 키로 돌려준다', () => {
    const flags = deriveAllFlags(fixtureTasks, ctx());

    for (const subject of fixtureTasks) {
      expect(flags.get(subject.id)).toEqual(deriveTaskFlags(subject, ctx()));
    }
  });
});
