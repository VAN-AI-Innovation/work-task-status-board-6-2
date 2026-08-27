/**
 * 주간 보고 라우트와 대시보드 브리핑이 **같은 방식으로** 기간과 이력을 얻는지 고정한다.
 * 둘이 갈리면 같은 주의 보고서가 화면과 API에서 다른 숫자를 낸다.
 */

import { describe, expect, it } from 'vitest';

import { loadPeriodEvents, parseReportQuery } from '@/lib/api/report-context';
import { resolveReportPeriod } from '@/lib/domain/report-period';
import type { TaskEventFilter } from '@/lib/store/task-repository';
import type { TaskEvent } from '@/types/task';

const TODAY = '2026-08-27';

function query(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

function eventAt(occurredAt: string): TaskEvent {
  return { id: `e-${occurredAt}`, taskId: 't1', uploadId: null, changedFields: ['status'], occurredAt };
}

describe('parseReportQuery — 모양만 본다. 뜻은 `resolveReportPeriod`가 정한다', () => {
  it('`?week=`가 없으면 null이다 — 요청이 없는 것이지 틀린 것이 아니다', () => {
    expect(parseReportQuery(query(''))).toBeNull();
    expect(resolveReportPeriod(TODAY, parseReportQuery(query(''))).fellBack).toBe(false);
  });

  it('값을 그대로 넘긴다', () => {
    expect(parseReportQuery(query('week=2026-08-17'))).toBe('2026-08-17');
  });

  it('앞뒤 공백을 지우고, 값이 비면 키가 없는 것으로 본다 (`read-context`와 같은 규칙)', () => {
    expect(parseReportQuery(query('week=%20%202026-08-17%20'))).toBe('2026-08-17');
    expect(parseReportQuery(query('week='))).toBeNull();
    expect(parseReportQuery(query('week=%20%20'))).toBeNull();
  });

  /** 400을 내면 오타 하나로 보고서가 통째로 안 뜬다 (결정 M). 되돌리는 것은 도메인이 한다 */
  it('형식이 틀려도 던지지 않는다 — 그대로 넘겨 도메인이 이번 주로 되돌린다', () => {
    expect(() => parseReportQuery(query('week=어제'))).not.toThrow();
    expect(parseReportQuery(query('week=어제'))).toBe('어제');

    const period = resolveReportPeriod(TODAY, parseReportQuery(query('week=어제')));
    expect(period.fellBack).toBe(true);
    expect(period.weekStart).toBe('2026-08-24');
  });
});

describe('loadPeriodEvents — 기간만 넘긴다', () => {
  const period = resolveReportPeriod(TODAY, '2026-08-17');

  it('`since`·`until`을 그대로 넘기고 `taskIds`로 좁히지 않는다 (범위는 RLS가 자른다)', async () => {
    const seen: (TaskEventFilter | undefined)[] = [];
    const events = [eventAt('2026-08-18T10:00:00+09:00')];

    const loaded = await loadPeriodEvents(
      {
        listEvents: async (filter) => {
          seen.push(filter);
          return events;
        },
      },
      period
    );

    expect(loaded).toEqual(events);
    expect(seen).toEqual([{ since: period.since, until: period.until }]);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['since', 'until']);
  });

  it('빈 배열은 그대로 빈 배열이다 — 「실제로 0건」이라는 뜻이다', async () => {
    expect(await loadPeriodEvents({ listEvents: async () => [] }, period)).toEqual([]);
  });

  /** `[]`로 뭉개면 보고서가 「이번 주 아무 일도 없었다」고 거짓말한다 */
  it('이력을 읽지 못하면 null이다 — 0건과 구분한다', async () => {
    const loaded = await loadPeriodEvents(
      {
        listEvents: async () => {
          throw new Error('permission denied for table task_events');
        },
      },
      period
    );

    expect(loaded).toBeNull();
  });

  it('실패해도 저장소 오류 문구를 밖으로 내보내지 않는다', async () => {
    await expect(
      loadPeriodEvents(
        {
          listEvents: async () => {
            throw new Error('postgres://user:pw@host');
          },
        },
        period
      )
    ).resolves.toBeNull();
  });
});
