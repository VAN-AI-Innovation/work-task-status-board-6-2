/**
 * 상수의 값을 다시 적는 테스트는 오타 검사일 뿐이라 쓰지 않는다.
 * 여기서 고정하는 건 **상수 사이의 불변식** — 하나를 만졌을 때 다른 하나와 앞뒤가 맞는지다.
 *
 * 그중 `maxCellsPerSheet > 26_000`이 T1이 발견한 오탐의 회귀 테스트다. 이 선 아래로 내리면
 * Google Sheets가 기본 그리드를 통째로 내보낸 정상 파일이 압축 폭탄으로 거부된다.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_UPLOAD_BYTES,
  PARSE_TIMEOUT_MS,
  WORKBOOK_LIMITS,
} from '@/lib/upload/upload-limits';

describe('upload-limits', () => {
  it('압축본 상한이 해제 총량 상한보다 작다', () => {
    // 뒤집히면 "압축했더니 커졌다"는 말이 된다. 팽창비 상한이 사라진다
    expect(MAX_UPLOAD_BYTES).toBeLessThan(MAX_ARCHIVE_UNCOMPRESSED_BYTES);
  });

  it('시트당 셀 상한이 Google Sheets 기본 그리드(1000행 × 26열)를 통과시킨다', () => {
    // T1 오탐(26,026 > 20,000)의 회귀 테스트. 한 탭만 내보낸 파일이 빈 그리드를 달고 온다
    expect(WORKBOOK_LIMITS.maxCellsPerSheet).toBeGreaterThan(26_000);
  });

  it('워크북 상한이 시트 하나보다 작지 않다', () => {
    expect(WORKBOOK_LIMITS.maxCellsPerWorkbook).toBeGreaterThanOrEqual(
      WORKBOOK_LIMITS.maxCellsPerSheet,
    );
  });

  it('워크북 상한이 시트 × 시트당 상한보다 작다 — 실제로 조인다', () => {
    // 같거나 크면 있으나 마나다. 20 × 100,000 = 2,000,000셀이 통과하면 메모리가 죽는다
    expect(WORKBOOK_LIMITS.maxCellsPerWorkbook).toBeLessThan(
      WORKBOOK_LIMITS.maxSheets * WORKBOOK_LIMITS.maxCellsPerSheet,
    );
  });

  it('파싱 타임아웃이 Vercel 함수 타임아웃보다 짧다', () => {
    expect(PARSE_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it('엔트리 수 상한이 실측 xlsx(15개 남짓)보다 넉넉하다', () => {
    expect(MAX_ARCHIVE_ENTRIES).toBeGreaterThan(15);
  });
});
