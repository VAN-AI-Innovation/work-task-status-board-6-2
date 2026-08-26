/**
 * 이름 매칭은 원래 신뢰할 수 없다 — 동명이인·오타·공백·직함이 섞인 자유 입력이다.
 * 그래서 이 스위트가 재는 것은 「얼마나 많이 붙는가」가 아니라 **「확실할 때만 붙는가」**다.
 * 잘못 붙은 한 건은 남의 업무를 내 것으로 만들고, 그것이 곧 권한 사고다 (`viewer-scope.ts`가
 * `ownerMemberId` 하나만 보고 `member` 범위를 정한다).
 *
 * 이름은 전부 관용 가명이다 (`S6` — 픽스처에도 실명을 두지 않는다).
 */

import { describe, expect, it } from 'vitest';

import type { TaskUpsertInput } from '@/lib/store/task-repository';
import { buildOwnerIndex, linkOwners } from '@/lib/upload/owner-link';
import type { MemberRecord } from '@/types/auth';
import type { TeamKey } from '@/types/task';

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: 'm-edit-1',
    teamId: 'edit',
    name: '홍길동',
    authUserId: null,
    ...overrides,
  };
}

function taskInput(overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  return {
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'card-a',
    title: '카드뉴스 A',
    ownerMemberId: null,
    ownerNameRaw: '홍길동',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-08-17',
    dueAt: '2026-08-24',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    stages: [],
    ...overrides,
  };
}

describe('linkOwners', () => {
  it('같은 팀에 같은 이름이 있으면 그 구성원 id가 붙는다', () => {
    const result = linkOwners([taskInput()], [member()]);

    expect(result.linked).toBe(1);
    expect(result.unresolved).toBe(0);
    expect(result.tasks[0].ownerMemberId).toBe('m-edit-1');
  });

  it('다른 팀의 같은 이름에는 붙지 않는다 — 동명이인이 곧 권한 사고다', () => {
    const result = linkOwners(
      [taskInput({ teamId: 'shoot', sourceSheetTab: '02_촬영·기획팀' })],
      [member({ teamId: 'edit' })],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(result.tasks[0].ownerMemberId).toBeNull();
  });

  it('앞뒤 공백과 내부 연속 공백이 달라도 같은 이름으로 본다', () => {
    const result = linkOwners(
      [taskInput({ ownerNameRaw: '  홍  길동 ' })],
      [member({ name: '홍 길동' })],
    );

    expect(result.linked).toBe(1);
    expect(result.tasks[0].ownerMemberId).toBe('m-edit-1');
  });

  it('한글 자모 분리형(NFD)과 완성형(NFC)이 같은 이름이면 붙는다', () => {
    const nfd = '홍길동'.normalize('NFD');
    expect(nfd).not.toBe('홍길동'); // 픽스처가 실제로 다른 바이트인지 먼저 잰다

    const result = linkOwners([taskInput({ ownerNameRaw: nfd })], [member({ name: '홍길동' })]);

    expect(result.linked).toBe(1);
    expect(result.tasks[0].ownerMemberId).toBe('m-edit-1');
  });

  it('한 팀에서 정규화 충돌이 나면 그 이름은 통째로 버린다 — 먼저 온 사람이 이기지 않는다', () => {
    const result = linkOwners(
      [taskInput({ ownerNameRaw: '김철수' })],
      [
        member({ id: 'm-1', name: '김철수' }),
        member({ id: 'm-2', name: '김철수 ' }),
      ],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(result.tasks[0].ownerMemberId).toBeNull();
  });

  it('정규화 충돌은 그 이름만 버린다 — 같은 팀의 다른 이름은 그대로 붙는다', () => {
    const result = linkOwners(
      [taskInput({ ownerNameRaw: '김철수' }), taskInput({ sourceKey: 'card-b' })],
      [
        member({ id: 'm-1', name: '김철수' }),
        member({ id: 'm-2', name: ' 김철수' }),
        member({ id: 'm-3', name: '홍길동' }),
      ],
    );

    expect(result.linked).toBe(1);
    expect(result.unresolved).toBe(1);
    expect(result.tasks[0].ownerMemberId).toBeNull();
    expect(result.tasks[1].ownerMemberId).toBe('m-3');
  });

  it('담당자가 애초에 없는 행은 unresolved로도 세지 않는다', () => {
    const result = linkOwners(
      [
        taskInput({ ownerNameRaw: null }),
        taskInput({ sourceKey: 'card-b', ownerNameRaw: '' }),
        taskInput({ sourceKey: 'card-c', ownerNameRaw: '   ' }),
      ],
      [member()],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(0);
    expect(result.tasks.map((task) => task.ownerMemberId)).toEqual([null, null, null]);
  });

  it('이미 ownerMemberId가 있는 행은 덮어쓰지 않는다', () => {
    const result = linkOwners(
      [taskInput({ ownerMemberId: 'm-already' })],
      [member({ id: 'm-edit-1' })],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(0);
    expect(result.tasks[0].ownerMemberId).toBe('m-already');
  });

  it('입력 배열도 입력 객체도 고치지 않는다', () => {
    const original = taskInput();
    const tasks = [original];

    const result = linkOwners(tasks, [member()]);

    expect(original.ownerMemberId).toBeNull();
    expect(tasks).toHaveLength(1);
    expect(result.tasks[0]).not.toBe(original);
  });

  it('구성원이 하나도 없으면 이름이 있는 건만 전부 unresolved다', () => {
    const result = linkOwners(
      [taskInput(), taskInput({ sourceKey: 'card-b', ownerNameRaw: null })],
      [],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(1);
  });

  it('coOwnerNames는 보지 않는다', () => {
    const result = linkOwners(
      [taskInput({ ownerNameRaw: null, coOwnerNames: ['홍길동'] })],
      [member()],
    );

    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(0);
    expect(result.tasks[0].ownerMemberId).toBeNull();
  });

  it('태스크가 없으면 빈 결과다', () => {
    const result = linkOwners([], [member()]);

    expect(result.tasks).toEqual([]);
    expect(result.linked).toBe(0);
    expect(result.unresolved).toBe(0);
  });

  it('나머지 필드는 그대로 실려 나간다', () => {
    const [linkedTask] = linkOwners([taskInput()], [member()]).tasks;

    expect(linkedTask).toEqual({ ...taskInput(), ownerMemberId: 'm-edit-1' });
  });
});

describe('buildOwnerIndex', () => {
  it('팀이 다르면 같은 이름도 다른 칸이다', () => {
    const index = buildOwnerIndex([
      member({ id: 'm-edit', teamId: 'edit' }),
      member({ id: 'm-shoot', teamId: 'shoot' }),
    ]);

    expect(index.get('edit', '홍길동')).toBe('m-edit');
    expect(index.get('shoot', '홍길동')).toBe('m-shoot');
  });

  it('없는 이름은 null이다', () => {
    const index = buildOwnerIndex([member()]);

    expect(index.get('edit', '없는사람')).toBeNull();
    expect(index.get('marketing' as TeamKey, '홍길동')).toBeNull();
  });

  it('정규화 충돌은 조회에서 null이 된다 — 인덱스가 판정을 이미 끝낸다', () => {
    const index = buildOwnerIndex([
      member({ id: 'm-1', name: '김철수' }),
      member({ id: 'm-2', name: ' 김철수' }),
    ]);

    expect(index.get('edit', '김철수')).toBeNull();
  });

  it('조회도 이름을 정규화한다', () => {
    const index = buildOwnerIndex([member({ name: '홍 길동' })]);

    expect(index.get('edit', '  홍   길동  ')).toBe('m-edit-1');
  });
});
