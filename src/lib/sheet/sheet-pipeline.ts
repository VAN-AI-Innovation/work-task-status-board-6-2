/**
 * T2의 리더·판별기와 T3의 어댑터를 **한 함수 뒤로** 감춘다.
 * T5의 라우트 핸들러는 이 함수 하나만 부르고 계산하지 않는다 (ARCHITECTURE.md 계층 경계).
 *
 * 이 파이프라인이 **하지 않는** 판정 넷 — 여기서 하면 규칙이 두 곳에 생긴다.
 * - 「알려진 탭이 0개 → 중단」은 T5의 업로드 트랜잭션이 내린다 (`X2`). 여기서는 빈 결과 + 경고다.
 * - `semantic` 매핑·미등록 값 검사는 도메인 계층(T4)이다 (ADR-009).
 * - `00_통합 대시보드`는 **읽지 않는다.** 수식 결과라 우리가 원시 데이터에서 다시 계산한다 (`E6`).
 *   건너뛴 사실에 경고도 남기지 않는다 — 매 업로드마다 뜨는 잡음이 된다.
 * - 오늘 날짜를 읽지 않는다. `baseYear`는 호출자가 주입한다 (CLAUDE.md CRITICAL).
 *
 * **예외를 던지지 않는다.** `readWorkbook`의 `WorkbookReadError`만 그대로 통과시킨다 —
 * 워크북이 안 열리면 파싱할 것이 없다. 어댑터가 던지면 그 탭만 경고로 바꾸고 나머지를 계속한다.
 * 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { parseEditTeamTab } from '@/lib/sheet/adapter-edit-team';
import { parseMarketingTeamTab } from '@/lib/sheet/adapter-marketing-team';
import { parseSettingsTab } from '@/lib/sheet/adapter-settings-tab';
import { parseShootTeamTab } from '@/lib/sheet/adapter-shoot-team';
import { detectTab } from '@/lib/sheet/tab-detector';
import { readWorkbook } from '@/lib/sheet/workbook-reader';
import type {
  HeaderBand,
  ParseWarning,
  SettingsRegistry,
  SheetGrid,
  SheetTabKind,
  TabDetection,
} from '@/types/sheet';
import type { TabParseResult, WorkbookParseResult } from '@/types/task';

interface ParseContext {
  baseYear: number;
}

type BandTabParser = (sheet: SheetGrid, band: HeaderBand, ctx: ParseContext) => TabParseResult;

type WholeTabParser = (sheet: SheetGrid, ctx: ParseContext) => TabParseResult;

type TabRoute =
  | { mode: 'band'; parse: BandTabParser }
  | { mode: 'whole'; parse: WholeTabParser }
  /** `warn`이 null이면 조용히 건너뛴다 */
  | { mode: 'skip'; warn: string | null };

/**
 * 탭 종류별 처리는 **이 표가 전부**다. 종류가 늘면 한 줄을 추가한다 — `if` 사슬로 옮기지 말 것.
 * `Record`(부분 아님)라서 `SheetTabKind`에 값이 늘면 컴파일이 먼저 막는다.
 */
const TAB_ROUTES: Record<SheetTabKind, TabRoute> = {
  edit_team: { mode: 'band', parse: parseEditTeamTab },
  shoot_team: { mode: 'band', parse: parseShootTeamTab },
  // 표가 셋(A/B/C)이라 밴드 하나로 표현되지 않는다. 섹션 분할은 어댑터가 스스로 한다.
  marketing_team: { mode: 'whole', parse: parseMarketingTeamTab },
  // 설정 탭은 순서가 중요해서 먼저 처리한다 (아래 `readSettings`). 여기서는 두 번 읽지 않는다.
  settings: { mode: 'skip', warn: null },
  dashboard: { mode: 'skip', warn: null },
  unknown: { mode: 'skip', warn: 'UNKNOWN_TAB' },
};

interface DetectedSheet {
  sheet: SheetGrid;
  detection: TabDetection;
}

/**
 * 어댑터 하나가 던져도 파이프라인 전체를 죽이지 않는다 (`X2`의 「부분 실패」).
 * 경고에 예외 메시지·스택을 담지 않는다 — 내부 경로가 사용자에게 새어 나간다 (`X1`).
 */
function runSafely<T>(sheet: string, warnings: ParseWarning[], run: () => T): T | null {
  try {
    return run();
  } catch {
    warnings.push({ code: 'TAB_PARSE_FAILED', sheet });
    return null;
  }
}

/**
 * 설정 탭을 **먼저** 읽는다 — enum·SLA 레지스트리가 정규화의 근거이기 때문이다
 * (PLAN.md「4. 엑셀 파싱 파이프라인」).
 *
 * 없으면 예외가 아니라 `null` + 경고다. 중단 여부는 T5가 정한다.
 * 밴드를 못 찾은 경우에도 `HEADER_BAND_NOT_FOUND`를 따로 남기지 않는다 — 결과가 같고
 * (레지스트리 없음) 한 사건에 경고가 둘이면 미리보기 화면이 읽히지 않는다.
 */
function readSettings(entries: DetectedSheet[], warnings: ParseWarning[]): SettingsRegistry | null {
  const entry = entries.find(({ detection }) => detection.kind === 'settings');
  const band = entry?.detection.matches[0]?.band ?? null;

  const registry =
    entry && band
      ? runSafely(entry.sheet.name, warnings, () => parseSettingsTab(entry.sheet, band))
      : null;

  if (!registry) {
    // 워크북 전체에 대한 사실이라 시트 이름이 없을 수 있다.
    warnings.push({ code: 'SETTINGS_TAB_MISSING', sheet: entry?.sheet.name ?? '' });
  }
  return registry;
}

function parseTab(
  { sheet, detection }: DetectedSheet,
  ctx: ParseContext,
  warnings: ParseWarning[]
): TabParseResult | null {
  const route = TAB_ROUTES[detection.kind];

  if (route.mode === 'skip') {
    if (route.warn) warnings.push({ code: route.warn, sheet: sheet.name });
    return null;
  }

  if (route.mode === 'whole') {
    return runSafely(sheet.name, warnings, () => route.parse(sheet, ctx));
  }

  // 시그니처가 아니라 이름만 맞은 탭이다 (`matchedBy === 'name'`). 헤더를 못 찾았으니
  // 어댑터에 줄 밴드가 없다 — 그 탭만 건너뛴다.
  const band = detection.matches[0]?.band;
  if (!band) {
    warnings.push({ code: 'HEADER_BAND_NOT_FOUND', sheet: sheet.name });
    return null;
  }

  return runSafely(sheet.name, warnings, () => route.parse(sheet, band, ctx));
}

/**
 * 워크북 바이트 → 팀별 파싱 결과. 시트 순서를 그대로 유지한다.
 *
 * `warnings`에는 **탭에 귀속되지 않는 것만** 담는다(리더 경고, 미판별 탭, 설정 탭 부재,
 * 밴드 부재, 탭 파싱 실패). 어댑터가 만든 경고는 각 `tabs[].warnings`에 남고,
 * 설정 탭 경고는 `settings.warnings`에 남는다.
 */
export async function parseWorkbook(
  input: Buffer | ArrayBuffer,
  ctx: ParseContext
): Promise<WorkbookParseResult> {
  const workbook = await readWorkbook(input);

  // 리더 경고(숨김 열 등)를 버리지 않는다. 이 파이프라인이 유일한 호출자다.
  const warnings: ParseWarning[] = [...workbook.warnings];

  const entries: DetectedSheet[] = workbook.sheets.map((sheet) => ({
    sheet,
    detection: detectTab(sheet),
  }));

  const settings = readSettings(entries, warnings);

  const tabs = entries
    .map((entry) => parseTab(entry, ctx, warnings))
    .filter((tab): tab is TabParseResult => tab !== null);

  return { tabs, settings, warnings };
}
