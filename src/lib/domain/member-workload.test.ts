import { describe, expect, it } from 'vitest';

import { deriveAllFlags } from '@/lib/domain/task-derive';
import {
  openTasksOf,
  summarizeMemberWorkload,
  tasksOwnedBy,
} from '@/lib/domain/member-workload';
import { buildSemanticIndex } from '@/lib/domain/task-semantic';
import type { StatsContext } from '@/lib/domain/progress-stats';
import type { Task } from '@/types/task';

const TODAY = '2026-08-28';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'k1',
    title: '제목',
    ownerMemberId: 'm1',
    ownerNameRaw: '담당자',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 50,
    assignedAt: null,
    dueAt: null,
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    lastProgressAt: null,
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 2,
    createdAt: null,
    updatedAt: null,
    ...over,
  } as Task;
}

/** 도메인 함수는 `now`를 인자로 받는다 (CLAUDE.md CRITICAL). 여기서도 고정값을 넣는다 */
function contextFor(tasks: readonly Task[]): StatsContext {
  // 등록된 상태값이 없어도 `toSemantic`이 원문으로 판정한다 — 픽스처가 설정 탭을 지어낼 이유가 없다
  const semanticIndex = buildSemanticIndex(null);
  const base = { today: TODAY, semanticIndex };

  return { ...base, flags: deriveAllFlags(tasks, base) };
}

describe('tasksOwnedBy', () => {
  it('담당자가 본인인 업무만 고른다', () => {
    const mine = task({ id: 'a', ownerMemberId: 'm1' });
    const theirs = task({ id: 'b', ownerMemberId: 'm2' });

    expect(tasksOwnedBy([mine, theirs], 'm1').map((t) => t.id)).toEqual(['a']);
  });

  /**
   * 담당자가 붙지 않은 행(`unknown_owner`)을 「내 것」으로 치면 담당자 미상 업무가 계정
   * 연결된 전원에게 붙는다 — `viewer-scope.ts` 결정 D와 같은 판단이다.
   */
  it('ownerMemberId가 null인 업무는 누구의 것도 아니다', () => {
    expect(tasksOwnedBy([task({ ownerMemberId: null })], 'm1')).toEqual([]);
  });

  it('memberId가 null이면 아무것도 고르지 않는다 — 명부에 안 붙은 계정이다', () => {
    expect(tasksOwnedBy([task()], null)).toEqual([]);
  });

  it('입력 배열을 고치지 않는다', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', ownerMemberId: 'm2' })];
    tasksOwnedBy(tasks, 'm1');

    expect(tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('summarizeMemberWorkload', () => {
  it('그 사람 업무만 세고, 남의 것은 세지 않는다', () => {
    const tasks = [
      task({ id: 'a', ownerMemberId: 'm1', status: '완료' }),
      task({ id: 'b', ownerMemberId: 'm1', status: '진행 중' }),
      task({ id: 'c', ownerMemberId: 'm2', status: '진행 중' }),
    ];

    const summary = summarizeMemberWorkload(tasks, contextFor(tasks), 'm1', 'edit');
    expect(summary?.total).toBe(2);
  });

  /** 팀이 없으면 셀 기준이 없다. 0으로 접으면 「없다」와 「모른다」가 같아 보인다 */
  it('팀을 모르면 null이다 — 0건이 아니다', () => {
    const tasks = [task()];
    expect(summarizeMemberWorkload(tasks, contextFor(tasks), 'm1', null)).toBeNull();
  });

  it('명부에 안 붙은 계정은 0건 요약을 준다 — null이 아니다', () => {
    const tasks = [task()];
    const summary = summarizeMemberWorkload(tasks, contextFor(tasks), null, 'edit');

    expect(summary?.total).toBe(0);
  });
});

describe('openTasksOf', () => {
  it('완료·취소를 뺀 것만 남긴다', () => {
    const tasks = [
      task({ id: 'done', status: '완료' }),
      task({ id: 'live', status: '진행 중' }),
    ];

    expect(openTasksOf(tasks, contextFor(tasks), 'm1').map((t) => t.id)).toEqual(['live']);
  });

  /** 마감이 급한 것이 위로 와야 목록이 「할 일」이 된다. 마감 없는 건 맨 뒤다 */
  it('마감이 이른 순으로 세우고, 마감 없는 것은 뒤로 보낸다', () => {
    const tasks = [
      task({ id: 'none', dueAt: null }),
      task({ id: 'late', dueAt: '2026-09-30' }),
      task({ id: 'soon', dueAt: '2026-08-29' }),
    ];

    expect(openTasksOf(tasks, contextFor(tasks), 'm1').map((t) => t.id)).toEqual([
      'soon',
      'late',
      'none',
    ]);
  });

  it('같은 마감이면 id로 갈라 순서가 흔들리지 않는다', () => {
    const tasks = [
      task({ id: 'b', dueAt: '2026-08-29' }),
      task({ id: 'a', dueAt: '2026-08-29' }),
    ];

    expect(openTasksOf(tasks, contextFor(tasks), 'm1').map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('입력 배열을 고치지 않는다 — 정렬은 사본에 한다', () => {
    const tasks = [task({ id: 'b', dueAt: '2026-09-30' }), task({ id: 'a', dueAt: '2026-08-29' })];
    openTasksOf(tasks, contextFor(tasks), 'm1');

    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});
