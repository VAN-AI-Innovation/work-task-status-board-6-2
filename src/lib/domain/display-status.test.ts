/**
 * 매핑표 하나뿐인 파일이라 테스트가 볼 것도 셋뿐이다.
 * **누락**(semantic 9종이 전부 갈 곳이 있는가), **덮어쓰기**(지연이 최우선인가),
 * **경계**(스타일이 도메인으로 새지 않았는가).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DISPLAY_STATUS_LABELS, toDisplayStatus } from '@/lib/domain/display-status';
import { STATUS_SEMANTIC_MAP } from '@/lib/domain/task-semantic';
import type { TaskSemantic } from '@/types/task';

const SOURCE = fileURLToPath(new URL('./display-status.ts', import.meta.url));
const NOT_OVERDUE = { isOverdue: false };

describe('toDisplayStatus', () => {
  it('semantic 9종이 전부 매핑된다', () => {
    const semantics = new Set<TaskSemantic>(Object.values(STATUS_SEMANTIC_MAP));

    expect(semantics.size).toBe(9);
    for (const semantic of semantics) {
      expect(DISPLAY_STATUS_LABELS[toDisplayStatus(semantic, NOT_OVERDUE)]).toBeDefined();
    }
  });

  it('지연이 다른 색을 덮어쓴다', () => {
    expect(toDisplayStatus('in_progress', { isOverdue: true })).toBe('overdue');
    expect(toDisplayStatus('planned', { isOverdue: true })).toBe('overdue');
    expect(toDisplayStatus('done', { isOverdue: true })).toBe('overdue');
    expect(toDisplayStatus(null, { isOverdue: true })).toBe('overdue');
  });

  it('10단계가 5색으로 접힌다', () => {
    expect(toDisplayStatus('planned', NOT_OVERDUE)).toBe('planned');
    expect(toDisplayStatus('in_progress', NOT_OVERDUE)).toBe('in_progress');
    expect(toDisplayStatus('rework', NOT_OVERDUE)).toBe('in_progress');
    expect(toDisplayStatus('review', NOT_OVERDUE)).toBe('review');
    expect(toDisplayStatus('approval', NOT_OVERDUE)).toBe('review');
    expect(toDisplayStatus('done', NOT_OVERDUE)).toBe('done');
    expect(toDisplayStatus('pending_release', NOT_OVERDUE)).toBe('done');
  });

  it('보류·취소·미등록은 5색에 속하지 않는다', () => {
    expect(toDisplayStatus('hold', NOT_OVERDUE)).toBe('muted');
    expect(toDisplayStatus('cancelled', NOT_OVERDUE)).toBe('muted');
    expect(toDisplayStatus(null, NOT_OVERDUE)).toBe('muted');
  });
});

describe('DISPLAY_STATUS_LABELS', () => {
  it('UI_GUIDE.md의 이름 그대로 6개가 한글이다', () => {
    expect(DISPLAY_STATUS_LABELS).toEqual({
      planned: '예정',
      in_progress: '진행',
      review: '검토',
      done: '완료',
      overdue: '지연',
      muted: '기타',
    });
  });
});

describe('계층 경계', () => {
  it('도메인 파일에 스타일 문자열이 없다 — 배지 색은 T6가 고른다', () => {
    expect(readFileSync(SOURCE, 'utf8')).not.toMatch(/bg-|text-|border-/);
  });
});
