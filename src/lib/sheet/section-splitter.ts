/**
 * 한 탭에 세로로 놓인 섹션들을 배너 행 기준으로 자른다.
 *
 * `03_마케팅·관리팀`은 한 탭에 표가 셋이고, 그것도 A→B→C 순이 아니라 **C → A → B** 순이다.
 * 순서를 가정하면 틀리므로 **시트에 나온 순서 그대로** 돌려주고 정렬하지 않는다.
 *
 * - 팀 이름을 모른다. 아는 것은 `A.`·`B.`·`C.` 배너 패턴뿐이다.
 * - 밴드 판정을 다시 구현하지 않는다. `header-resolver`의 후보를 범위로 거를 뿐이다.
 * - **경고를 만들지 않는다.** 여기서는 사실만 돌려주고 판단(섹션 누락·중복)은 어댑터가 한다.
 * - 배너가 없어도 예외를 던지지 않는다. 섹션이 없는 탭이 정상이다 (CLAUDE.md 하드 실패 금지).
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { toText } from '@/lib/sheet/cell-normalizer';
import { findHeaderBands } from '@/lib/sheet/header-resolver';
import type { HeaderBand, SheetGrid } from '@/types/sheet';

export type SectionKey = 'A' | 'B' | 'C';

/** `A. 상시 문의·SNS 관리` — 글자 하나 + 마침표로 시작해야 배너다 (`A/B 테스트`는 아니다) */
const BANNER_PATTERN = /^([ABC])\.\s*.+$/;

export interface SheetSection {
  key: SectionKey;
  /** 배너 원문. 예: `A. 상시 문의·SNS 관리` */
  title: string;
  /** 배너 행. 0-based */
  titleRow: number;
  /** 내용 시작 행(배너 다음 행). 0-based */
  startRow: number;
  /** 내용 끝 행, 포함. 0-based. 내용이 전부 비면 `startRow - 1`이 되어 빈 범위가 된다 */
  endRow: number;
  /** 이 범위 안의 헤더 밴드. 자유 텍스트 섹션이면 null */
  band: HeaderBand | null;
}

/**
 * 그 행에서 **처음으로 값이 있는** 셀의 텍스트. 전부 비었으면 null.
 * (자유 텍스트 섹션을 읽는 `adapter-marketing-team`이 같은 규칙을 써야 해서 export한다.)
 */
export function firstFilledText(sheet: SheetGrid, row: number): string | null {
  for (const cell of sheet.cells[row] ?? []) {
    const { value } = toText(cell.value);
    if (value !== null) return value;
  }
  return null;
}

export function splitSections(sheet: SheetGrid): SheetSection[] {
  const banners: { key: SectionKey; title: string; titleRow: number }[] = [];

  for (let row = 0; row < sheet.rowCount; row += 1) {
    const text = firstFilledText(sheet, row);
    if (text === null) continue;
    const matched = BANNER_PATTERN.exec(text);
    if (!matched) continue;
    banners.push({ key: matched[1] as SectionKey, title: text, titleRow: row });
  }

  if (banners.length === 0) return [];

  const bands = findHeaderBands(sheet);

  return banners.map((banner, index) => {
    const startRow = banner.titleRow + 1;
    const next = banners[index + 1];

    // 섹션 사이 빈 행이 앞 섹션에 딸려 들어가면 데이터 범위 계산이 어긋난다.
    let endRow = next ? next.titleRow - 1 : sheet.rowCount - 1;
    while (endRow >= startRow && firstFilledText(sheet, endRow) === null) endRow -= 1;

    const band = bands.find((b) => b.labelRow >= startRow && b.labelRow <= endRow) ?? null;

    return { key: banner.key, title: banner.title, titleRow: banner.titleRow, startRow, endRow, band };
  });
}
