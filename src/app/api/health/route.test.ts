/**
 * 이 라우트의 존재 이유는 「저장소가 지금 어느 모드인가」를 사람이 눈으로 확인하는 것이다
 * (`ADR-005` — 의도된 데모와 저장소 사고를 구분해야 한다).
 *
 * 그래서 여기서 가장 중요한 테스트는 **비밀이 새지 않는가**다. 진단용 엔드포인트는 인증 없이
 * 열려 있고, "디버깅에 도움이 되니까" 한 줄씩 늘어나다가 프로젝트 URL과 키가 실린다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetStorage } from '@/lib/store/store-factory';
import { GET } from './route';

const ORIGINAL_DRIVER = process.env.STORAGE_DRIVER;

beforeEach(() => {
  process.env.STORAGE_DRIVER = 'memory';
  resetStorage();
});

afterEach(() => {
  if (ORIGINAL_DRIVER === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = ORIGINAL_DRIVER;
  resetStorage();
});

describe('GET /api/health', () => {
  it('200이고 driver·mode·readOnly를 보고한다', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ ok: true, driver: 'memory', mode: 'demo', readOnly: false });
    expect(body).toHaveProperty('lastSyncedAt');
  });

  it('비밀·키·프로젝트 URL이 본문에 없다', async () => {
    const serialized = JSON.stringify(await (await GET()).json());

    for (const forbidden of ['SUPABASE', 'KEY', 'http', 'eyJ', 'secret']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('본문의 키가 다섯 개로 고정돼 있다 — 늘어나면 그때 다시 보게 만든다', async () => {
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(
      ['driver', 'lastSyncedAt', 'mode', 'ok', 'readOnly'].sort(),
    );
  });
});
