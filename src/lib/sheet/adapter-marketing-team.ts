/**
 * `03_마케팅·관리팀` 어댑터. 한 탭의 **세 섹션을 각각 다른 목적지로** 흘려보낸다
 * (T3 완료 기준 5).
 *
 * ```
 * C 섹션 (자유 텍스트) → briefingLines
 * A 섹션 (문의 20컬럼) → tasks         ← "업무"가 아니라 "문의"지만 상태·담당자·기한 축이다
 * B 섹션 (성과 30컬럼) → goalMetrics   ← adapter-goal-metrics에 위임한다
 * ```
 *
 * - 편집팀·촬영팀과 달리 `band`를 받지 않는다. 표가 셋이라 밴드 하나로 표현되지 않는다.
 *   대신 `splitSections`를 스스로 호출한다.
 * - **브리핑을 `teamPeriodGoals`로 보내지 않는다.** 브리핑은 목표가 아니라 회고 문장이다.
 *   저장 스키마는 T4에서 정하고, 여기서는 문자열 배열까지가 끝이다.
 * - **`계정·문의자`를 지우거나 가리지 않는다.** 여기서 지우면 admin도 못 본다 —
 *   역할별 마스킹은 T6의 응답 계층이다 (T6 완료 기준 13).
 * - 지표 파싱을 복제하지 않는다. `parseGoalMetrics`에 위임한다.
 * - 섹션이 없다고 예외를 던지지 않는다. 한 섹션만 담긴 파일이 정상이다 (UC-04 부분 업로드).
 * - 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { parseGoalMetrics } from '@/lib/sheet/adapter-goal-metrics';
import { mapRows, type FieldMapEntry, type RowMapSpec } from '@/lib/sheet/row-mapper';
import { firstFilledText, splitSections } from '@/lib/sheet/section-splitter';
import type { ParseWarning, SheetGrid } from '@/types/sheet';
import type { TabParseResult } from '@/types/task';

/** 이 중 하나라도 값이 있어야 데이터 행이다. 수식 결과 컬럼은 쓰지 않는다 (E1) */
const IDENTITY_HEADERS = ['문의 ID', '담당자'];
const ID_HEADER = '문의 ID';

/**
 * `담당자`와 `후속 담당자`가 **마지막 조각 정확 일치**로 갈린다. 접두 일치를 쓰면
 * `담당자` 하나가 둘 다 잡아 값이 뒤바뀐다 — `row-mapper`가 정확 일치인 이유다.
 *
 * 테스트가 `extras` 개수를 이 배열 길이로 계산하므로 export한다.
 */
export const FIELD_MAP: FieldMapEntry[] = [
  { header: '문의 내용 요약', field: 'title', kind: 'text' },
  { header: '담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '긴급도', field: 'priority', kind: 'text' },
  { header: '문의 접수일', field: 'assignedAt', kind: 'date' },
  { header: '답변 기한', field: 'dueAt', kind: 'date' },
  { header: '답변 상태', field: 'status', kind: 'text' },
  { header: '후속 조치 상태', field: 'riskStatus', kind: 'text' },
  { header: '추가 확인 필요사항', field: 'nextAction', kind: 'text' },
  { header: '후속 담당자', field: 'nextActionOwner', kind: 'text' },
  { header: '후속 조치 기한', field: 'nextActionDue', kind: 'date' },
  { header: '비고', field: 'note', kind: 'text' },
];

// `STAGE_GROUPS`가 없는 것은 누락이 아니다. 마케팅 문의에는 단계 컬럼 그룹이 없다.

export function parseMarketingTeamTab(
  sheet: SheetGrid,
  ctx: { baseYear: number }
): TabParseResult {
  const sections = splitSections(sheet);
  const warnings: ParseWarning[] = [];

  // 섹션 종류당 한 번만 남긴다. 어느 섹션인지는 코드에 담지 않는다 —
  // ParseWarning은 코드와 좌표만 싣는다 (CLAUDE.md 보안 규칙).
  const missing = (): void => {
    warnings.push({ code: 'MARKETING_SECTION_MISSING', sheet: sheet.name });
  };

  // --- A 섹션 → tasks
  const a = sections.find((section) => section.key === 'A' && section.band !== null);
  let tasks: TabParseResult['tasks'] = [];
  if (a && a.band) {
    const spec: RowMapSpec = {
      teamKey: 'marketing',
      identityHeaders: IDENTITY_HEADERS,
      idHeader: ID_HEADER,
      fieldMap: FIELD_MAP,
      baseYear: ctx.baseYear,
    };
    // 범위를 주지 않으면 아래 B섹션 행까지 문의로 읽힌다.
    const mapped = mapRows(sheet, a.band, spec, {
      startRow: a.band.labelRow + 1,
      endRow: a.endRow,
    });
    tasks = mapped.tasks;
    warnings.push(...mapped.warnings);
  } else {
    missing();
  }

  // --- B 섹션 → goalMetrics (위임)
  const b = sections.find((section) => section.key === 'B' && section.band !== null);
  let goalMetrics: TabParseResult['goalMetrics'] = [];
  if (b) {
    const parsed = parseGoalMetrics(sheet, b, { teamKey: 'marketing', baseYear: ctx.baseYear });
    goalMetrics = parsed.goalMetrics;
    warnings.push(...parsed.warnings);
  } else {
    missing();
  }

  // --- C 섹션 → briefingLines
  const c = sections.find((section) => section.key === 'C');
  const briefingLines: string[] = [];
  if (c) {
    const endRow = Math.min(c.endRow, sheet.rowCount - 1);
    for (let row = c.startRow; row <= endRow; row += 1) {
      const text = firstFilledText(sheet, row);
      if (text !== null) briefingLines.push(text);
    }
  } else {
    missing();
  }

  return {
    sheet: sheet.name,
    teamKey: 'marketing',
    tasks,
    goalMetrics,
    // 이번 주 핵심 목표 블록은 촬영·기획팀 헤더에 있다. 이 탭에는 없다.
    teamPeriodGoals: [],
    briefingLines,
    warnings,
  };
}
