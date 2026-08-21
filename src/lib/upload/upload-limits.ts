/**
 * 업로드 문에 걸리는 상한들. **숫자마다 근거를 남긴다** — 근거 없는 상수는 다음 사람이
 * 만졌을 때 무엇이 깨지는지 모르는 부채가 된다 (S2·A7).
 *
 * 실측값(T1, `scripts/smoke/RESULT.md`)이 이 숫자들의 바닥이다:
 *   - 실제 시트 `.xlsx` 파일 크기: 100,618 bytes (0.10 MB)
 *   - 최대 시트 `02_촬영·기획팀`: `dimensions` 기준 4,260셀
 *   - 워크북 전체: 같은 기준 8,732셀
 */

/**
 * 압축된 업로드 본문 상한. Vercel 서버리스 본문 한도(4.5MB)보다 확실히 아래다 (A7).
 * 실측 0.10MB라 여유가 2.4%밖에 안 쓰인다.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * ZIP 중앙 디렉토리가 **신고한** 해제 총량 상한 (S2). 압축을 풀어서 재지 않는다 —
 * 압축 폭탄을 막으려는 코드가 압축 폭탄을 터뜨리면 안 된다.
 * `MAX_UPLOAD_BYTES`와 짝지으면 팽창비 12.5:1 상한이 자동으로 걸린다.
 */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * 엔트리 수 폭발로 중앙 디렉토리 순회 자체가 느려지는 것을 막는다.
 * 실측 xlsx는 15개 남짓이라 34배 여유다.
 */
export const MAX_ARCHIVE_ENTRIES = 512;

export interface WorkbookLimits {
  maxSheets: number;
  /** `dimensions` 사각형 기준. `worksheet.rowCount`가 아니다 */
  maxCellsPerSheet: number;
  maxCellsPerWorkbook: number;
}

/**
 * 셀 수를 세는 기준은 **`dimensions` 사각형**(`SheetGrid.rowCount × columnCount`)이다.
 * `workbook-reader.ts`가 이미 `worksheet.dimensions`로 이 값을 잡으므로 새로 세지 않는다.
 * ExcelJS의 `worksheet.rowCount`는 서식만 있는 행까지 세서 정상 파일을 26,026으로 부풀렸고,
 * 그것이 T1에서 발견된 오탐의 원인이다. **오탐하는 방어는 방어가 아니라 장애다.**
 */
export const WORKBOOK_LIMITS: WorkbookLimits = {
  /** 실측 5개 (S2 원안 유지) */
  maxSheets: 20,
  /**
   * 실측 최대 시트 4,260셀의 23배. 무엇보다 **Google Sheets 기본 그리드
   * 1000행 × 26열 = 26,000** 위에 둔다 — 한 탭만 내보낸 파일이 빈 그리드를 통째로
   * 달고 와도 통과해야 한다. 원안 20,000은 이 선 아래라 처음부터 성립하지 않았다.
   */
  maxCellsPerSheet: 100_000,
  /**
   * 실측 워크북 전체 8,732셀의 34배. 시트당 상한만 두면 20 × 100,000 = 2,000,000셀이
   * 통과하고, 셀 하나가 객체 하나라 그 지점에서 메모리가 죽는다.
   */
  maxCellsPerWorkbook: 300_000,
};

/** Vercel 함수 타임아웃보다 짧게 (S2) */
export const PARSE_TIMEOUT_MS = 8_000;
