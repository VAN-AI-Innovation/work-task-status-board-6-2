import { describe, expect, it } from 'vitest';

import {
  TASK_DIFF_FIELDS,
  compareTaskEventsDesc,
  diffTaskFields,
  matchesTaskEventFilter,
  matchesTaskFilter,
  type TaskUpsertInput,
} from '@/lib/store/task-repository';
import type { Task, TaskEvent } from '@/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    teamId: 'edit',
    departmentId: null,
    sourceKey: 'card-a',
    title: '카드뉴스 A',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: [],
    status: '진행 중',
    approvalStatus: null,
    priority: null,
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-07-20',
    dueAt: '2026-07-27',
    nextAction: null,
    nextActionOwner: null,
    nextActionDue: null,
    delayReason: null,
    note: null,
    extras: {},
    raw: {},
    lastProgressAt: '2026-07-20T00:00:00.000Z',
    sourceUploadId: 'upload-1',
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 5,
    ...overrides,
  };
}

function toInput(task: Task, overrides: Partial<TaskUpsertInput> = {}): TaskUpsertInput {
  const copy: Record<string, unknown> = { ...task, stages: [] };
  delete copy.id;
  delete copy.lastProgressAt;
  return { ...(copy as TaskUpsertInput), ...overrides };
}

describe('TASK_DIFF_FIELDS', () => {
  it('재업로드마다 값이 바뀌는 감사 필드를 제외한다', () => {
    for (const excluded of [
      'id',
      'teamId',
      'departmentId',
      'sourceKey',
      'ownerMemberId',
      'raw',
      'lastProgressAt',
      'sourceUploadId',
      'sourceSheetTab',
      'sourceRowIndex',
    ]) {
      expect(TASK_DIFF_FIELDS).not.toContain(excluded);
    }
  });

  it('사람이 시트에서 고치는 16개 필드를 담는다', () => {
    expect([...TASK_DIFF_FIELDS]).toEqual([
      'title',
      'ownerNameRaw',
      'coOwnerNames',
      'status',
      'approvalStatus',
      'priority',
      'riskStatus',
      'progress',
      'assignedAt',
      'dueAt',
      'nextAction',
      'nextActionOwner',
      'nextActionDue',
      'delayReason',
      'note',
      'extras',
    ]);
  });

  it('중복 없이 선언돼 있다', () => {
    expect(new Set(TASK_DIFF_FIELDS).size).toBe(TASK_DIFF_FIELDS.length);
  });
});

describe('diffTaskFields', () => {
  it('같은 내용이면 빈 배열이다', () => {
    const prev = makeTask();
    expect(diffTaskFields(prev, toInput(prev))).toEqual([]);
  });

  it('바뀐 필드 이름만 돌려주고 값은 담지 않는다', () => {
    const prev = makeTask();
    const changed = diffTaskFields(prev, toInput(prev, { progress: 60 }));
    expect(changed).toEqual(['progress']);
  });

  it('progress의 0과 null을 다른 값으로 본다', () => {
    const zero = makeTask({ progress: 0 });
    expect(diffTaskFields(zero, toInput(zero, { progress: null }))).toEqual(['progress']);

    const nullish = makeTask({ progress: null });
    expect(diffTaskFields(nullish, toInput(nullish, { progress: 0 }))).toEqual(['progress']);
  });

  it('sourceUploadId·sourceRowIndex·raw만 달라지면 변경이 아니다 (UC-03)', () => {
    const prev = makeTask();
    const next = toInput(prev, {
      sourceUploadId: 'upload-2',
      sourceRowIndex: 11,
      raw: { 업무명: '카드뉴스 A' },
    });
    expect(diffTaskFields(prev, next)).toEqual([]);
  });

  it('extras는 깊은 비교를 하고 키 순서만 다르면 변경이 아니다', () => {
    const prev = makeTask({ extras: { 채널: '인스타', 비고: null } });
    const sameOtherOrder = toInput(prev, { extras: { 비고: null, 채널: '인스타' } });
    expect(diffTaskFields(prev, sameOtherOrder)).toEqual([]);

    const changed = toInput(prev, { extras: { 채널: '유튜브', 비고: null } });
    expect(diffTaskFields(prev, changed)).toEqual(['extras']);
  });

  it('extras의 하이퍼링크 객체도 깊은 비교로 구분한다', () => {
    const prev = makeTask({ extras: { 링크: { text: '초안', hyperlink: 'https://a' } } });
    expect(diffTaskFields(prev, toInput(prev))).toEqual([]);
    expect(
      diffTaskFields(prev, toInput(prev, { extras: { 링크: { text: '초안', hyperlink: 'https://b' } } })),
    ).toEqual(['extras']);
  });

  it('coOwnerNames는 배열 내용으로 비교한다', () => {
    const prev = makeTask({ coOwnerNames: ['박촬영'] });
    expect(diffTaskFields(prev, toInput(prev, { coOwnerNames: ['박촬영'] }))).toEqual([]);
    expect(diffTaskFields(prev, toInput(prev, { coOwnerNames: ['박촬영', '이기획'] }))).toEqual([
      'coOwnerNames',
    ]);
  });

  it('여러 필드가 바뀌면 TASK_DIFF_FIELDS 선언 순서로 돌려준다', () => {
    const prev = makeTask();
    const next = toInput(prev, { dueAt: '2026-08-01', title: '카드뉴스 A-1' });
    expect(diffTaskFields(prev, next)).toEqual(['title', 'dueAt']);
  });

  it('stages가 달라져도 변경 필드에 넣지 않는다', () => {
    const prev = makeTask();
    const next = toInput(prev, {
      stages: [
        {
          seq: 0,
          stageKey: 'concept',
          stageLabel: '컨셉·레퍼런스 (+2일)',
          plannedDate: '2026-07-21',
          actualDate: null,
          content: null,
          confirmStatus: null,
          slaDays: 2,
        },
      ],
    });
    expect(diffTaskFields(prev, next)).toEqual([]);
  });
});

describe('matchesTaskFilter', () => {
  const edit = makeTask({ id: 'a', teamId: 'edit', sourceKey: 'a', title: 'Card News', ownerNameRaw: '김편집' });
  const shoot = makeTask({
    id: 'b',
    teamId: 'shoot',
    sourceKey: 'b',
    title: '브이로그 촬영',
    ownerNameRaw: '박촬영',
    status: '완료',
    dueAt: '2026-08-05',
  });
  const noDue = makeTask({ id: 'c', teamId: 'marketing', sourceKey: 'c', dueAt: null, status: null, title: null, ownerNameRaw: null });

  it('필터가 없으면 전부 통과한다', () => {
    expect(matchesTaskFilter(edit)).toBe(true);
    expect(matchesTaskFilter(edit, {})).toBe(true);
  });

  it('teamKeys는 소속 팀으로 거른다', () => {
    expect(matchesTaskFilter(edit, { teamKeys: ['edit'] })).toBe(true);
    expect(matchesTaskFilter(shoot, { teamKeys: ['edit'] })).toBe(false);
    expect(matchesTaskFilter(edit, { teamKeys: [] })).toBe(false);
  });

  it('sourceKeys는 자연키로 거른다', () => {
    expect(matchesTaskFilter(edit, { sourceKeys: ['a', 'z'] })).toBe(true);
    expect(matchesTaskFilter(shoot, { sourceKeys: ['a'] })).toBe(false);
  });

  it('ownerNameRaw는 정확 일치다 (부분 일치는 search)', () => {
    expect(matchesTaskFilter(edit, { ownerNameRaw: '김편집' })).toBe(true);
    expect(matchesTaskFilter(edit, { ownerNameRaw: '김' })).toBe(false);
    expect(matchesTaskFilter(noDue, { ownerNameRaw: '김편집' })).toBe(false);
  });

  it('dueFrom·dueTo는 양끝을 포함하고 마감 없는 건은 빠진다', () => {
    expect(matchesTaskFilter(shoot, { dueFrom: '2026-08-05' })).toBe(true);
    expect(matchesTaskFilter(shoot, { dueTo: '2026-08-05' })).toBe(true);
    expect(matchesTaskFilter(shoot, { dueFrom: '2026-08-06' })).toBe(false);
    expect(matchesTaskFilter(shoot, { dueTo: '2026-08-04' })).toBe(false);
    expect(matchesTaskFilter(noDue, { dueFrom: '2026-01-01' })).toBe(false);
    expect(matchesTaskFilter(noDue, { dueTo: '2099-01-01' })).toBe(false);
  });

  it('statuses는 시트 원문 상태로 거르고 상태 없는 건은 빠진다', () => {
    expect(matchesTaskFilter(edit, { statuses: ['진행 중'] })).toBe(true);
    expect(matchesTaskFilter(shoot, { statuses: ['진행 중'] })).toBe(false);
    expect(matchesTaskFilter(noDue, { statuses: ['진행 중'] })).toBe(false);
  });

  it('search는 업무명·담당자 부분 일치이며 대소문자를 무시한다', () => {
    expect(matchesTaskFilter(edit, { search: 'card' })).toBe(true);
    expect(matchesTaskFilter(edit, { search: 'NEWS' })).toBe(true);
    expect(matchesTaskFilter(edit, { search: '김편집' })).toBe(true);
    expect(matchesTaskFilter(shoot, { search: 'card' })).toBe(false);
    expect(matchesTaskFilter(noDue, { search: 'card' })).toBe(false);
  });

  it('빈 search 문자열은 필터가 없는 것으로 본다', () => {
    expect(matchesTaskFilter(noDue, { search: '' })).toBe(true);
  });

  it('조건이 여러 개면 전부 만족해야 한다', () => {
    expect(matchesTaskFilter(edit, { teamKeys: ['edit'], statuses: ['진행 중'] })).toBe(true);
    expect(matchesTaskFilter(edit, { teamKeys: ['edit'], statuses: ['완료'] })).toBe(false);
  });

  it('limit은 행 판정에 관여하지 않는다 (목록 자르기는 listTasks의 일)', () => {
    expect(matchesTaskFilter(edit, { limit: 0 })).toBe(true);
  });
});

describe('matchesTaskEventFilter', () => {
  const event = (occurredAt: string, taskId = 'task-1'): TaskEvent => ({
    id: `event-${occurredAt}-${taskId}`,
    taskId,
    uploadId: null,
    changedFields: ['progress'],
    occurredAt,
  });

  const monday = event('2026-08-24T00:00:00.000Z');

  it('필터가 없으면 전부 통과한다', () => {
    expect(matchesTaskEventFilter(monday)).toBe(true);
    expect(matchesTaskEventFilter(monday, {})).toBe(true);
  });

  it('since는 경계를 포함하고 until은 제외한다', () => {
    expect(matchesTaskEventFilter(monday, { since: '2026-08-24T00:00:00.000Z' })).toBe(true);
    expect(matchesTaskEventFilter(monday, { since: '2026-08-24T00:00:00.001Z' })).toBe(false);
    expect(matchesTaskEventFilter(monday, { until: '2026-08-24T00:00:00.000Z' })).toBe(false);
    expect(matchesTaskEventFilter(monday, { until: '2026-08-24T00:00:00.001Z' })).toBe(true);
  });

  it('표기가 달라도 같은 순간이면 같게 본다 (문자열 비교가 아니다)', () => {
    // `2026-08-24T09:00:00+09:00` = `2026-08-24T00:00:00Z`. 문자열로 비교하면 어긋난다.
    expect(matchesTaskEventFilter(monday, { since: '2026-08-24T09:00:00+09:00' })).toBe(true);
    expect(matchesTaskEventFilter(monday, { until: '2026-08-24T09:00:00+09:00' })).toBe(false);
  });

  it('taskIds는 지정한 것만 통과시키고 빈 배열은 아무것도 통과시키지 않는다', () => {
    expect(matchesTaskEventFilter(monday, { taskIds: ['task-1'] })).toBe(true);
    expect(matchesTaskEventFilter(monday, { taskIds: ['task-2'] })).toBe(false);
    expect(matchesTaskEventFilter(monday, { taskIds: [] })).toBe(false);
  });

  it('조건이 여러 개면 전부 만족해야 한다', () => {
    const filter = { since: '2026-08-24T00:00:00.000Z', until: '2026-08-31T00:00:00.000Z' };
    expect(matchesTaskEventFilter(monday, { ...filter, taskIds: ['task-1'] })).toBe(true);
    expect(matchesTaskEventFilter(monday, { ...filter, taskIds: ['task-2'] })).toBe(false);
  });

  it('compareTaskEventsDesc는 최신을 앞에 둔다', () => {
    const sorted = [
      event('2026-08-24T00:00:00.000Z'),
      event('2026-08-31T00:00:00.000Z'),
      event('2026-08-17T00:00:00.000Z'),
    ].sort(compareTaskEventsDesc);
    expect(sorted.map((entry) => entry.occurredAt)).toEqual([
      '2026-08-31T00:00:00.000Z',
      '2026-08-24T00:00:00.000Z',
      '2026-08-17T00:00:00.000Z',
    ]);
  });
});
