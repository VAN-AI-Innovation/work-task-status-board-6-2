/**
 * 주간 보고 (`UC-08`, 과제 요구 5번).
 *
 * 계약은 **「마크다운을 문자열로만 내려보낸다」**이다. 서버에서 HTML로 렌더하는 순간
 * sanitize가 필요해지고(`S7`) 셀 값에서 온 문자열이 그대로 DOM이 된다. 그래서 태그가 아니라
 * `#`로 시작하는 원문인지를 본다.
 *
 * 기간(`?week=`)의 계약도 여기서 고정한다 — **틀린 값에 400을 내지 않는다**(결정 M).
 * 되돌렸다는 사실은 `period.fellBack`으로만 말한다. 조용히 이번 주를 보여 주면 사용자는
 * 자기가 요청한 주를 보고 있다고 믿는다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

interface ReportBody {
  markdown: string;
  period: { weekStart: string; weekEnd: string; fellBack: boolean };
  meta: { today: string; role: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/report/weekly${query}`));
}

async function body(query = ''): Promise<ReportBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as ReportBody;
}

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/report/weekly', () => {
  it('markdown이 문자열이고 `#`으로 시작한다', async () => {
    const parsed = await body();

    expect(typeof parsed.markdown).toBe('string');
    expect(parsed.markdown.startsWith('#')).toBe(true);
    expect(parsed.markdown.length).toBeGreaterThan(0);
  });

  it('HTML로 렌더하지 않는다 — 태그가 들어 있지 않다 (S7)', async () => {
    const parsed = await body();

    expect(parsed.markdown).not.toContain('<div');
    expect(parsed.markdown).not.toContain('<p>');
    expect(parsed.markdown).not.toContain('<script');
  });

  it('본문 필드는 markdown·period·meta 셋뿐이다', async () => {
    expect(Object.keys(await body()).sort()).toEqual(['markdown', 'meta', 'period']);
  });

  /**
   * 시드는 전건 `created`라 이벤트가 남지 않는다. **0건이라고 말하는 것이 맞다** — 읽을 길이
   * 없어서 0인 것이 아니라 실제로 0건이고, 그래서 「집계되지 않음」이 아니다.
   */
  it('이력을 읽어 「이번 주 변경」을 센다 — 읽지 못한 것과 0건을 구분한다', async () => {
    const parsed = await body();

    expect(parsed.markdown).toContain('- 이번 주 변경: 0건');
    expect(parsed.markdown).not.toContain('집계되지 않음');
  });

  it('`?week=`로 과거 주를 열고, 되돌리지 않았다고 말한다', async () => {
    const parsed = await body('?week=2026-08-17');

    expect(parsed.period).toEqual({
      weekStart: '2026-08-17',
      weekEnd: '2026-08-23',
      fellBack: false,
    });
    expect(parsed.markdown).toContain('2026-08-17');
  });

  it('주 중간 날짜는 그 주의 월요일로 맞춘다', async () => {
    expect((await body('?week=2026-08-20')).period.weekStart).toBe('2026-08-17');
  });

  /** 오타 하나로 보고서가 통째로 안 뜨면 사용자는 URL이 아니라 도구를 의심한다 (결정 M) */
  it('틀린 `?week=`는 400이 아니라 이번 주이고, 되돌렸다고 말한다', async () => {
    for (const bad of ['?week=어제', '?week=2026-13-45', '?week=2026-07', '?week=']) {
      const parsed = await body(bad);

      expect(parsed.period.weekStart <= parsed.meta.today).toBe(true);
      expect(parsed.period.fellBack).toBe(bad !== '?week=');
    }
  });

  it('`?week=`가 없으면 이번 주이고 되돌린 것이 아니다', async () => {
    expect((await body()).period.fellBack).toBe(false);
  });

  it('?as=admin으로도 200이고 meta가 역할을 반영한다', async () => {
    expect((await body('?as=admin')).meta.role).toBe('admin');
  });

  it('응답에 감사용 원본 행이 없다', async () => {
    expect(JSON.stringify(await body())).not.toContain('"raw"');
  });

  it('본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get()).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});
