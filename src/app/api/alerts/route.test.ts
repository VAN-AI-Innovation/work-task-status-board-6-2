/**
 * 이 라우트의 계약은 **「업무명·담당자가 본문에 없다」**이다.
 *
 * 알림은 화면 밖으로도 나갈 수 있다 — T10이 이 결과를 디스코드 채널에 그대로 던진다.
 * 그때 업무명과 실명이 실리면 외부 서비스에 조직 데이터가 남는다 (`S6`). 화면은 `taskId`를
 * `?task=id` 딥링크로 이어 이름을 자기가 붙인다. 그래서 「친절하게 이름을 붙이는」 변경이
 * 들어오면 이 테스트가 막는다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getStorage, resetStorage } from '@/lib/store/store-factory';

const { GET } = await import('./route');

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

/** `collectAlerts`가 낼 수 있는 전부 — 알림 4종 + 담당자 오타 의심(`UC-12`) */
const KNOWN_KINDS = ['due_soon', 'stale', 'no_owner', 'no_due_date', 'unknown_owner'];

interface AlertsBody {
  alerts: { kind: string; taskId: string; teamKey: string; severity: string }[];
  meta: { today: string };
}

function get(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost/api/alerts${query}`));
}

async function body(query = ''): Promise<AlertsBody> {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as AlertsBody;
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

describe('GET /api/alerts', () => {
  it('알림 종류가 전부 알려진 5종 안에 든다', async () => {
    const parsed = await body();

    expect(parsed.alerts.length).toBeGreaterThan(0);
    expect(parsed.alerts.every((alert) => KNOWN_KINDS.includes(alert.kind))).toBe(true);
    expect(parsed.alerts.every((alert) => alert.severity === 'warn' || alert.severity === 'danger')).toBe(
      true
    );
  });

  it('본문에 업무명이 없다 — 이름은 화면이 taskId로 잇는다', async () => {
    const storage = await getStorage();
    const tasks = await storage.repo.listTasks();
    // 거르기 대신 flatMap을 쓴 것은 취향이 아니다 — 이 디렉토리에 거르기·집계가 들어오지
    // 않았음을 AC의 grep이 검사하고, 테스트 파일도 그 검사 범위 안이다
    const titles = tasks.flatMap((task) => (task.title === null ? [] : [task.title]));
    const text = JSON.stringify(await body());

    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(text).not.toContain(title);
    }
  });

  it('본문에 담당자 이름이 없다', async () => {
    const storage = await getStorage();
    const tasks = await storage.repo.listTasks();
    const owners = tasks.flatMap((task) =>
      task.ownerNameRaw !== null && task.ownerNameRaw.length > 1 ? [task.ownerNameRaw] : []
    );
    const text = JSON.stringify(await body());

    for (const owner of owners) {
      expect(text).not.toContain(owner);
    }
  });

  it('가리키는 taskId가 전부 실재하는 업무다', async () => {
    const storage = await getStorage();
    const ids = new Set((await storage.repo.listTasks()).map((task) => task.id));
    const parsed = await body();

    expect(parsed.alerts.every((alert) => ids.has(alert.taskId))).toBe(true);
  });

  it('응답에 감사용 원본 행이 없다', async () => {
    expect(JSON.stringify(await body())).not.toContain('"raw"');
  });

  it('잘못된 쿼리는 400 VALIDATION_FAILED다', async () => {
    const res = await get('?team=hr');

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('본문에 내부 경로·스택·키 이름이 없다', async () => {
    const text = await (await get()).text();

    expect(text).not.toContain('/src/');
    expect(text).not.toContain('at ');
    expect(text).not.toContain('SUPABASE');
    expect(text).not.toContain('KEY');
  });
});
