import { describe, expect, it } from 'vitest';

import {
  applyDisplayFilter,
  buildHref,
  countActiveFilters,
  DEFAULT_SORT,
  FILTER_RESET_PATCH,
  parseDashboardQuery,
  toSearchParams,
  toURLSearchParams,
  type DashboardQuery,
} from '@/lib/view/dashboard-query';
import type { DisplayStatus } from '@/types/task';

function parse(query: string): DashboardQuery {
  return parseDashboardQuery(new URLSearchParams(query));
}

describe('parseDashboardQuery', () => {
  it('빈 쿼리는 전부 기본값이다 — 기본 정렬은 마감 임박순', () => {
    expect(parse('')).toEqual({
      team: [],
      display: [],
      owner: null,
      dueFrom: null,
      dueTo: null,
      search: null,
      overdue: false,
      sort: 'due',
      as: null,
      task: null,
    });
    expect(DEFAULT_SORT).toBe('due');
  });

  it('모르는 `display` 값은 던지지 않고 조용히 버린다', () => {
    expect(parse('display=purple&display=overdue').display).toEqual(['overdue']);
  });

  it('모르는 팀 키도 조용히 버린다', () => {
    expect(parse('team=edit&team=nope').team).toEqual(['edit']);
  });

  it('모르는 정렬 키는 기본값으로 떨어진다', () => {
    expect(parse('sort=nonsense').sort).toBe('due');
    expect(parse('sort=progress').sort).toBe('progress');
  });

  it('`overdue`는 `1`만 켜짐이다', () => {
    expect(parse('overdue=0').overdue).toBe(false);
    expect(parse('overdue=1').overdue).toBe(true);
    expect(parse('overdue=yes').overdue).toBe(false);
  });

  it('값이 빈 키는 없는 것으로 본다 — 필터를 지우면 `?owner=`가 남는다', () => {
    const query = parse('owner=&search=%20%20&task=');
    expect(query.owner).toBeNull();
    expect(query.search).toBeNull();
    expect(query.task).toBeNull();
  });

  it('중복 값은 한 번만 남고 순서는 고정된다 — 같은 상태는 같은 문자열이어야 한다', () => {
    expect(parse('display=done&display=planned&display=done').display).toEqual(['planned', 'done']);
    expect(parse('team=marketing&team=edit').team).toEqual(['edit', 'marketing']);
  });

  it('`as`는 해석하지 않고 그대로 옮긴다 — 판정은 `resolveViewerRole`이 진다', () => {
    expect(parse('as=admin').as).toBe('admin');
    expect(parse('as=nonsense').as).toBe('nonsense');
  });
});

describe('toSearchParams', () => {
  const full: DashboardQuery = {
    team: ['edit', 'shoot'],
    display: ['in_progress', 'overdue'],
    owner: '김편집',
    dueFrom: '2026-08-01',
    dueTo: '2026-08-31',
    search: '브이로그',
    overdue: true,
    sort: 'progress',
    as: 'lead',
    task: 'task-7',
  };

  it('왕복해도 같은 값이다 — 링크 복사로 같은 화면이 재현된다 (UC-11)', () => {
    expect(parseDashboardQuery(toSearchParams(full))).toEqual(full);
  });

  it('기본값은 URL에 싣지 않는다', () => {
    const params = toSearchParams(parse(''));
    expect(params.toString()).toBe('');
  });

  it('기본 정렬은 생략된다', () => {
    const params = toSearchParams({ ...full, sort: DEFAULT_SORT });
    expect(params.getAll('sort')).toEqual([]);
  });

  it('`overdue`가 꺼지면 키가 사라진다', () => {
    expect(toSearchParams({ ...full, overdue: false }).has('overdue')).toBe(false);
  });

  it('키 순서가 고정이라 같은 상태가 같은 문자열이 된다', () => {
    const forward = toSearchParams(full).toString();
    const backward = toSearchParams(parseDashboardQuery(new URLSearchParams(forward))).toString();
    expect(backward).toBe(forward);
    expect(forward).toBe(
      'team=edit&team=shoot&owner=%EA%B9%80%ED%8E%B8%EC%A7%91&dueFrom=2026-08-01&dueTo=2026-08-31' +
        '&search=%EB%B8%8C%EC%9D%B4%EB%A1%9C%EA%B7%B8&overdue=1&display=in_progress&display=overdue' +
        '&sort=progress&as=lead&task=task-7'
    );
  });
});

describe('buildHref', () => {
  const query = parse('team=edit&display=overdue&sort=team');

  it('전부 기본값이면 pathname만 돌려준다', () => {
    expect(buildHref('/', parse(''))).toBe('/');
  });

  it('patch가 비면 원본과 같은 문자열이다', () => {
    expect(buildHref('/teams/edit', query, {})).toBe(buildHref('/teams/edit', query));
  });

  it('`null`은 그 키를 지운다 — 필터 하나만 해제하는 링크', () => {
    expect(buildHref('/', query, { team: null })).toBe('/?display=overdue&sort=team');
    expect(buildHref('/', query, { sort: null })).toBe('/?team=edit&display=overdue');
  });

  it('`undefined`는 건드리지 않는다', () => {
    expect(buildHref('/', query, { team: undefined })).toBe(buildHref('/', query));
  });

  it('값을 주면 더한다 — `?task=` 딥링크 (UC-15)', () => {
    expect(buildHref('/', query, { task: 'abc' })).toBe('/?team=edit&display=overdue&sort=team&task=abc');
  });

  it('원본 쿼리를 고치지 않는다', () => {
    const before = { ...query, team: [...query.team], display: [...query.display] };
    buildHref('/', query, { team: null, task: 'abc' });
    expect(query).toEqual(before);
  });
});

describe('applyDisplayFilter', () => {
  const tasks: { id: string; displayStatus: DisplayStatus }[] = [
    { id: 'a', displayStatus: 'overdue' },
    { id: 'b', displayStatus: 'done' },
    { id: 'c', displayStatus: 'in_progress' },
  ];

  it('`display`가 비면 전건 통과다 — 칩을 다 끄면 화면이 비는 것이 아니다', () => {
    expect(applyDisplayFilter(tasks, parse('')).map((task) => task.id)).toEqual(['a', 'b', 'c']);
  });

  it('칩이 켜진 칸만 남는다', () => {
    expect(applyDisplayFilter(tasks, parse('display=overdue')).map((task) => task.id)).toEqual(['a']);
    expect(
      applyDisplayFilter(tasks, parse('display=overdue&display=done')).map((task) => task.id)
    ).toEqual(['a', 'b']);
  });

  it('입력 배열을 고치지 않는다', () => {
    const snapshot = [...tasks];
    applyDisplayFilter(tasks, parse('display=done'));
    expect(tasks).toEqual(snapshot);
  });
});

describe('toURLSearchParams', () => {
  it('Next의 searchParams 세 모양을 다 받는다', () => {
    const params = toURLSearchParams({
      team: ['edit', 'shoot'],
      owner: '김편집',
      search: undefined,
    });

    expect(params.getAll('team')).toEqual(['edit', 'shoot']);
    expect(params.get('owner')).toBe('김편집');
    expect(params.has('search')).toBe(false);
  });

  it('그대로 `parseDashboardQuery`에 들어간다', () => {
    const query = parseDashboardQuery(toURLSearchParams({ team: ['edit'], overdue: '1' }));
    expect(query.team).toEqual(['edit']);
    expect(query.overdue).toBe(true);
  });
});

describe('countActiveFilters · FILTER_RESET_PATCH', () => {
  /**
   * 이 숫자가 필요한 이유는 화면 사고 하나다 — 필터가 걸린 줄 모르고 「데이터가 없다」고
   * 오해하는 것. 그래서 「지금 몇 개가 걸려 있는가」가 화면에 보여야 한다.
   */
  it('기본 화면은 0개다', () => {
    expect(countActiveFilters(parse(''))).toBe(0);
  });

  it('정렬·역할·열린 패널은 필터가 아니다', () => {
    expect(countActiveFilters(parse('sort=team&as=admin&task=t-1'))).toBe(0);
  });

  it('다중 값 하나는 필터 하나로 센다 — 칩 개수가 아니라 조건 개수다', () => {
    expect(countActiveFilters(parse('team=edit&team=shoot'))).toBe(1);
    expect(countActiveFilters(parse('display=overdue&display=done'))).toBe(1);
  });

  it('조건이 늘면 그만큼 는다', () => {
    expect(countActiveFilters(parse('team=edit&owner=김편집&overdue=1&search=촬영'))).toBe(4);
  });

  it('초기화는 필터만 지우고 역할·정렬·열린 패널은 남긴다', () => {
    const query = parse('team=edit&display=done&owner=김편집&overdue=1&sort=team&as=admin&task=t-1');
    const href = buildHref('/', query, FILTER_RESET_PATCH);

    expect(countActiveFilters(parseDashboardQuery(new URLSearchParams(href.split('?')[1])))).toBe(0);
    expect(href).toContain('sort=team');
    expect(href).toContain('as=admin');
    expect(href).toContain('task=t-1');
  });
});
