/**
 * 주간 보고 (`UC-08`, 과제 요구 5번).
 *
 * 계약은 **「마크다운을 문자열로만 내려보낸다」**이다. 서버에서 HTML로 렌더하는 순간
 * sanitize가 필요해지고(`S7`) 셀 값에서 온 문자열이 그대로 DOM이 된다. 그래서 태그가 아니라
 * `#`로 시작하는 원문인지를 본다.
 *
 * `events`가 빈 배열인 것도 여기서 고정한다 — `TaskRepository`에 이벤트 **조회** 메서드가
 * 없어서다. 「이번 주 변경 0건」이 지금은 사실이 아니라 **읽을 길이 없다는 표시**이고,
 * 인터페이스를 넓히는 것은 T6·T9의 일이다 (`TICKETS.md` T9 리스크·미결).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

interface ReportBody {
  markdown: string;
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

  it('본문 필드는 markdown과 meta 둘뿐이다', async () => {
    expect(Object.keys(await body()).sort()).toEqual(['markdown', 'meta']);
  });

  it('이벤트 조회 경로가 없어 「이번 주 변경」이 0건으로 나간다 — 지어내지 않았다는 표시다', async () => {
    const parsed = await body();

    expect(parsed.markdown).toContain('- 이번 주 변경: 0건');
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
