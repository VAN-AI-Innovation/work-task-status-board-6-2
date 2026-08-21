import { describe, expect, it } from 'vitest';

import { z } from 'zod';

import {
  API_ERROR_CODES,
  API_ERROR_MESSAGES,
  API_ERROR_STATUS,
  errorResponse,
  toApiErrorCode,
  type ApiErrorCode,
} from '@/lib/api/api-error';

/**
 * `ARCHITECTURE.md`「에러 처리」의 코드 목록을 **손으로 옮겨 적은 것**이다. 코드에서
 * 파생하지 않는다 — 파생하면 목록이 조용히 늘거나 줄어도 테스트가 따라 통과한다.
 */
const CODES_FROM_ARCHITECTURE = [
  'FILE_TOO_LARGE',
  'FILE_TYPE_MISMATCH',
  'ARCHIVE_LIMIT_EXCEEDED',
  'PARSE_TIMEOUT',
  'WORKBOOK_CORRUPT',
  'NO_KNOWN_TAB',
  'SETTINGS_TAB_MISSING',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_ALREADY_COMMITTED',
  'TASK_NOT_FOUND',
  'STORAGE_READONLY',
  'STORAGE_UNAVAILABLE',
  'FORBIDDEN',
  'VALIDATION_FAILED',
] as const;

/** step 5에서 확정한 대응표 */
const EXPECTED_STATUS: Record<(typeof CODES_FROM_ARCHITECTURE)[number], number> = {
  VALIDATION_FAILED: 400,
  FORBIDDEN: 403,
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_ALREADY_COMMITTED: 409,
  TASK_NOT_FOUND: 404,
  FILE_TOO_LARGE: 413,
  ARCHIVE_LIMIT_EXCEEDED: 413,
  FILE_TYPE_MISMATCH: 415,
  WORKBOOK_CORRUPT: 422,
  NO_KNOWN_TAB: 422,
  SETTINGS_TAB_MISSING: 200,
  STORAGE_READONLY: 503,
  STORAGE_UNAVAILABLE: 503,
  PARSE_TIMEOUT: 504,
};

describe('API_ERROR_CODES', () => {
  it('ARCHITECTURE.md의 코드 14개와 정확히 일치한다 (빠짐도 남음도 없다)', () => {
    expect([...API_ERROR_CODES].sort()).toEqual([...CODES_FROM_ARCHITECTURE].sort());
  });

  it('상태 코드 표와 메시지 표에 코드가 빠짐없이 들어 있다', () => {
    expect(Object.keys(API_ERROR_STATUS)).toHaveLength(CODES_FROM_ARCHITECTURE.length);
    expect(Object.keys(API_ERROR_MESSAGES)).toHaveLength(CODES_FROM_ARCHITECTURE.length);

    for (const code of CODES_FROM_ARCHITECTURE) {
      expect(API_ERROR_STATUS[code]).toBeTypeOf('number');
      expect(API_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});

describe('API_ERROR_STATUS', () => {
  it.each(CODES_FROM_ARCHITECTURE)('%s의 상태 코드가 확정표와 같다', (code) => {
    expect(API_ERROR_STATUS[code]).toBe(EXPECTED_STATUS[code]);
  });

  it('압축 폭탄도 "너무 큼"이라 FILE_TOO_LARGE와 같은 413이다', () => {
    expect(API_ERROR_STATUS.ARCHIVE_LIMIT_EXCEEDED).toBe(API_ERROR_STATUS.FILE_TOO_LARGE);
  });

  it('SETTINGS_TAB_MISSING만 에러가 아니라 200이다 — 경고로 실려 나간다', () => {
    const errorStatuses = API_ERROR_CODES.filter((code) => code !== 'SETTINGS_TAB_MISSING').map(
      (code) => API_ERROR_STATUS[code]
    );
    expect(errorStatuses.every((status) => status >= 400)).toBe(true);
  });
});

describe('API_ERROR_MESSAGES', () => {
  it('전부 한국어 문장이고 스택·내부 경로를 담지 않는다', () => {
    for (const code of API_ERROR_CODES) {
      const message = API_ERROR_MESSAGES[code];
      expect(message).toMatch(/[가-힣]/);
      expect(message).not.toContain('\n');
      expect(message).not.toContain('/src/');
      expect(message).not.toContain('Error:');
    }
  });
});

describe('errorResponse', () => {
  it('{ error: { code, message } } 본문과 표의 상태 코드로 응답한다', async () => {
    const res = errorResponse('UPLOAD_NOT_FOUND');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({
      error: { code: 'UPLOAD_NOT_FOUND', message: API_ERROR_MESSAGES.UPLOAD_NOT_FOUND },
    });
  });

  it('message를 주면 그것을 쓴다 — lib 계층이 만든 문장을 그대로 흘려보내는 경로다', async () => {
    const res = errorResponse('ARCHIVE_LIMIT_EXCEEDED', '파일이 처리 한도를 넘습니다.');

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      error: { code: 'ARCHIVE_LIMIT_EXCEEDED', message: '파일이 처리 한도를 넘습니다.' },
    });
  });

  it.each([
    ['개행이 든 메시지', '읽기 실패\n  at parse (/app/src/lib/sheet/workbook-reader.ts:12:3)'],
    ['스택 프레임', 'at runWorkbookParse (node:internal/foo)'],
    ['내부 경로', '/src/lib/store/supabase-task-store.ts 에서 실패'],
    ['예외 접두사', 'Error: connect ECONNREFUSED 10.0.0.4:5432'],
  ])('%s는 기본 문장으로 갈아치운다', async (_label, dirty) => {
    const res = errorResponse('STORAGE_UNAVAILABLE', dirty);
    const body = (await res.json()) as { error: { message: string } };

    expect(body.error.message).toBe(API_ERROR_MESSAGES.STORAGE_UNAVAILABLE);
  });

  it('빈 문자열·공백만 있는 메시지도 기본 문장으로 되돌린다', async () => {
    const blank = (await errorResponse('VALIDATION_FAILED', '   ').json()) as {
      error: { message: string };
    };

    expect(blank.error.message).toBe(API_ERROR_MESSAGES.VALIDATION_FAILED);
  });

  it('본문에 코드와 메시지 말고 다른 필드를 싣지 않는다', async () => {
    const body = (await errorResponse('FORBIDDEN').json()) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error as object).sort()).toEqual(['code', 'message']);
  });

  it('모든 코드가 응답으로 만들어진다', async () => {
    for (const code of API_ERROR_CODES) {
      const res = errorResponse(code satisfies ApiErrorCode);
      expect(res.status).toBe(API_ERROR_STATUS[code]);
    }
  });
});

describe('toApiErrorCode', () => {
  it('zod 검증 실패는 사용자 입력 문제라 VALIDATION_FAILED다', () => {
    let thrown: unknown;
    try {
      z.object({ limit: z.number() }).parse({ limit: 'hr' });
    } catch (error) {
      thrown = error;
    }

    expect(toApiErrorCode(thrown)).toBe('VALIDATION_FAILED');
    expect(API_ERROR_STATUS[toApiErrorCode(thrown)]).toBe(400);
  });

  it.each([
    ['보통 예외', new Error('connect ECONNREFUSED')],
    ['문자열', 'boom'],
    ['null', null],
    ['undefined', undefined],
    ['name이 다른 객체', { name: 'TypeError' }],
  ])('%s는 우리 쪽 실패라 STORAGE_UNAVAILABLE이다', (_label, thrown) => {
    expect(toApiErrorCode(thrown)).toBe('STORAGE_UNAVAILABLE');
  });

  it('모듈이 두 벌 로드돼도 판별이 흔들리지 않는다 — instanceof가 아니라 name을 본다', () => {
    // 다른 zod 인스턴스가 던진 것처럼 생긴 객체. `instanceof`였다면 여기서 503이 나간다
    expect(toApiErrorCode({ name: 'ZodError', issues: [] })).toBe('VALIDATION_FAILED');
  });
});
