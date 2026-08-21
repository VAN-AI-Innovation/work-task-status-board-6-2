/**
 * 이 라우트의 계약은 셋이다.
 *
 * 1. **감사용 원본 행이 응답에 없다** (완료 기준 9 · `S6`). `PLAN.md`「검증 방법」 21번이
 *    `curl /api/tasks | grep 연락처`로 확인하라고 한 것을 여기서 자동으로 지킨다.
 * 2. **역할에 따라 민감 값이 다르다** (완료 기준 12). 같은 URL에 `?as=`만 붙였을 때
 *    실제로 값이 달라져야 한다 — 키 목록을 갖고 있다는 것만으로는 증거가 아니다.
 * 3. **에러 본문에 내부 정보가 없다** (`X1`).
 *
 * 메모리 드라이버에는 시드가 들어 있어 데이터가 있는 상태에서 돈다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

interface TaskBody {
  tasks: {
    id: string;
    teamId: string;
    extras: Record<string, unknown>;
    flags: { isOverdue: boolean };
  }[];
  meta: { today: string; role: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/tasks${query}`));
}

async function body(query = ''): Promise<TaskBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as TaskBody;
}

/** 시드 안의 민감 키 하나. 부분 일치 목록(`연락처`)에 걸리는 실제 헤더다 */
const CONTACT_KEY = '섭외 / 출연자 연락처 (내부용)';

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/tasks', () => {
  it('200으로 업무 목록과 meta를 준다', async () => {
    const parsed = await body();

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.meta.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('응답 어디에도 감사용 원본 행이 없다 (완료 기준 9)', async () => {
    expect(JSON.stringify(await body())).not.toContain('"raw"');
  });

  it('?as=admin과 기본(member)에서 민감 키의 값이 다르다 (완료 기준 12)', async () => {
    const asMember = await body();
    const asAdmin = await body('?as=admin');

    const memberTask = asMember.tasks.find((task) => CONTACT_KEY in task.extras);
    const adminTask = asAdmin.tasks.find((task) => CONTACT_KEY in task.extras);

    expect(memberTask).toBeDefined();
    expect(memberTask?.extras[CONTACT_KEY]).toBeNull();
    // 키는 남는다 — "가려졌다"와 "원래 비어 있었다"를 구분하기 위해서다
    expect(adminTask?.extras[CONTACT_KEY]).not.toBeNull();
    expect(asMember.meta.role).toBe('member');
    expect(asAdmin.meta.role).toBe('admin');
  });

  it('?team=edit이면 편집팀만 나온다', async () => {
    const parsed = await body('?team=edit');

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.tasks.every((task) => task.teamId === 'edit')).toBe(true);
  });

  it('?team=hr처럼 없는 팀은 400 VALIDATION_FAILED다', async () => {
    const res = await get('?team=hr');
    const parsed = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(400);
    expect(parsed.error.code).toBe('VALIDATION_FAILED');
  });

  it('?overdue=1이면 전건이 지연이다', async () => {
    const parsed = await body('?overdue=1');

    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(parsed.tasks.every((task) => task.flags.isOverdue)).toBe(true);
  });

  it('?limit=1이면 1건이다', async () => {
    expect((await body('?limit=1')).tasks).toHaveLength(1);
  });

  it('에러 본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get('?limit=0')).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});
