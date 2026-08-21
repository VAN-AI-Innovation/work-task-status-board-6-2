import { describe, expect, it } from 'vitest';

import {
  taskResponseSchema,
  toTaskListResponse,
  toTaskResponse,
} from '@/lib/api/task-response';
import { DISPLAY_STATUS_LABELS } from '@/lib/domain/display-status';
import type { TaskFlags } from '@/lib/domain/task-derive';
import type { Task } from '@/types/task';

const CONTACT_KEY = '출연자 연락처';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    teamId: 'edit',
    departmentId: '콘텐츠마케팅부',
    sourceKey: 'edit-001',
    title: '8월 2주차 브이로그',
    ownerMemberId: null,
    ownerNameRaw: '김편집',
    coOwnerNames: ['이촬영'],
    status: '진행 중',
    approvalStatus: null,
    priority: '높음',
    riskStatus: null,
    progress: 40,
    assignedAt: '2026-08-10',
    dueAt: '2026-08-20',
    nextAction: '컷 편집',
    nextActionOwner: '김편집',
    nextActionDue: '2026-08-18',
    delayReason: null,
    note: null,
    extras: { [CONTACT_KEY]: '010-0000-0000', 콘텐츠유형: '브이로그' },
    raw: { 업무명: '8월 2주차 브이로그', [CONTACT_KEY]: '010-0000-0000' },
    lastProgressAt: '2026-08-15T02:00:00.000Z',
    sourceUploadId: null,
    sourceSheetTab: '01_편집팀',
    sourceRowIndex: 7,
    ...overrides,
  };
}

function makeFlags(overrides: Partial<TaskFlags> = {}): TaskFlags {
  return {
    semantic: 'in_progress',
    dday: 2,
    isOverdue: false,
    isDueSoon: true,
    isStale: false,
    hasNoOwner: false,
    hasUnknownOwner: false,
    hasNoDueDate: false,
    ...overrides,
  };
}

describe('toTaskResponse', () => {
  it('감사용 원본 행을 응답에서 뺀다', () => {
    const response = toTaskResponse(makeTask(), makeFlags(), 'admin');

    expect(Object.keys(response)).not.toContain('raw');
    expect(response.id).toBe('task-1');
    expect(response.title).toBe('8월 2주차 브이로그');
  });

  it('직렬화 결과에 그 필드 이름이 나타나지 않는다', () => {
    const serialized = JSON.stringify(toTaskResponse(makeTask(), makeFlags(), 'admin'));

    expect(serialized).not.toContain('raw');
    expect(serialized).not.toContain('업무명');
  });

  it('member에게는 민감 키의 값이 가려지고 키는 남는다', () => {
    const response = toTaskResponse(makeTask(), makeFlags(), 'member');

    expect(Object.keys(response.extras)).toContain(CONTACT_KEY);
    expect(response.extras[CONTACT_KEY]).toBeNull();
    expect(response.extras['콘텐츠유형']).toBe('브이로그');
  });

  it.each(['admin', 'lead'] as const)('%s에게는 민감 키의 원본이 그대로 간다', (role) => {
    const response = toTaskResponse(makeTask(), makeFlags(), role);

    expect(response.extras[CONTACT_KEY]).toBe('010-0000-0000');
  });

  it('입력 객체를 고치지 않는다', () => {
    const task = makeTask();
    toTaskResponse(task, makeFlags(), 'member');

    expect(task.extras[CONTACT_KEY]).toBe('010-0000-0000');
  });

  it('progress 0이 0으로 남는다 (null로 바뀌지 않는다)', () => {
    const response = toTaskResponse(makeTask({ progress: 0 }), makeFlags(), 'admin');

    expect(response.progress).toBe(0);
  });

  it('progress null이 null로 남는다', () => {
    const response = toTaskResponse(makeTask({ progress: null }), makeFlags(), 'admin');

    expect(response.progress).toBeNull();
  });

  it('flags·displayStatus·statusLabel이 붙는다', () => {
    const flags = makeFlags();
    const response = toTaskResponse(makeTask(), flags, 'admin');

    expect(response.flags).toEqual(flags);
    expect(response.displayStatus).toBe('in_progress');
    expect(response.statusLabel).toBe(DISPLAY_STATUS_LABELS.in_progress);
  });

  it('지연 판정이 다른 칸을 덮어쓴다', () => {
    const response = toTaskResponse(
      makeTask(),
      makeFlags({ isOverdue: true, dday: -3 }),
      'admin'
    );

    expect(response.displayStatus).toBe('overdue');
    expect(response.statusLabel).toBe('지연');
  });

  it('semantic이 null이면 muted다', () => {
    const response = toTaskResponse(makeTask({ status: null }), makeFlags({ semantic: null }), 'admin');

    expect(response.displayStatus).toBe('muted');
  });

  it('하이퍼링크 값을 텍스트로 뭉개지 않는다', () => {
    const task = makeTask({
      extras: { 참고자료: { text: '기획서', hyperlink: 'https://example.com/a' } },
    });
    const response = toTaskResponse(task, makeFlags(), 'admin');

    expect(response.extras['참고자료']).toEqual({
      text: '기획서',
      hyperlink: 'https://example.com/a',
    });
  });
});

describe('taskResponseSchema', () => {
  it('감사용 원본 행이 섞이면 parse가 던진다 (.strict() 강제)', () => {
    const valid = toTaskResponse(makeTask(), makeFlags(), 'admin');

    expect(() => taskResponseSchema.parse({ ...valid, raw: { 업무명: '유출' } })).toThrow();
  });

  it('알 수 없는 키가 섞여도 던진다', () => {
    const valid = toTaskResponse(makeTask(), makeFlags(), 'admin');

    expect(() => taskResponseSchema.parse({ ...valid, 연락처: '010-0000-0000' })).toThrow();
  });

  it('정상 응답은 통과한다', () => {
    const valid = toTaskResponse(makeTask(), makeFlags(), 'admin');

    expect(() => taskResponseSchema.parse(valid)).not.toThrow();
  });

  it('필드가 빠지면 던진다', () => {
    const valid = toTaskResponse(makeTask(), makeFlags(), 'admin');
    const withoutFlags = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'flags')
    );

    expect(() => taskResponseSchema.parse(withoutFlags)).toThrow();
  });
});

describe('toTaskListResponse', () => {
  it('배열 전체를 스키마로 통과시킨다', () => {
    const tasks = [makeTask(), makeTask({ id: 'task-2', sourceKey: 'edit-002' })];
    const flags = new Map([
      ['task-1', makeFlags()],
      ['task-2', makeFlags({ isOverdue: true })],
    ]);

    const responses = toTaskListResponse(tasks, flags, 'member');

    expect(responses).toHaveLength(2);
    expect(responses[0].displayStatus).toBe('in_progress');
    expect(responses[1].displayStatus).toBe('overdue');
    expect(JSON.stringify(responses)).not.toContain('raw');
  });

  it('플래그가 없는 업무가 있으면 던진다 — 조용히 다른 판정으로 채우지 않는다', () => {
    expect(() => toTaskListResponse([makeTask()], new Map(), 'admin')).toThrow();
  });

  it('빈 배열은 빈 배열이다', () => {
    expect(toTaskListResponse([], new Map(), 'admin')).toEqual([]);
  });
});
