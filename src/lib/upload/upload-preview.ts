/**
 * **저장하지 않고 미리 세어 보는 대조.** 확정(step 4)이 무엇을 할지 숫자로 먼저 보여 준다
 * (`ADR-008`).
 *
 * 그래서 이 파일의 규칙은 하나로 요약된다 — **신규/변경/유지를 여기서 다시 정의하지 않는다.**
 * T4의 `taskUpsertKey`·`diffTaskFields`를 그대로 쓰고, 저장소도 같은 함수를 쓴다. 분류 규칙을
 * 두 벌 두는 순간 미리보기는 숫자만 그럴듯한 거짓이 되고 `UC-01`·`UC-03`이 함께 무너진다.
 *
 * 짊어지는 판단은 셋이다.
 * 1. 「알려진 탭이 하나도 없음 → 중단」(`X2`). `sheet-pipeline.ts`가 자기 주석에서 T5로
 *    넘긴 판정이 이것이다. 빈 결과를 성공으로 처리하면 기존 데이터가 0건으로 덮인다.
 * 2. **부분 업로드 고지**(`UC-04`). 워크북에 없는 팀은 건드리지 않는데, 그 사실을 화면이
 *    말해 주지 않으면 사용자는 나머지 팀이 지워졌다고 의심한다.
 * 3. **경고 접기.** 행마다 한 건이면 300건짜리 목록이 나오고 아무도 읽지 않는다.
 *
 * 저장소를 부르지 않고 시간을 읽지 않는다 — 대조 대상(`existing`)도 업로드 id도 인자다.
 */

import { TEAM_KEYS } from '@/lib/domain/progress-stats';
import {
  diffTaskFields,
  taskUpsertKey,
  type GoalMetricUpsertInput,
  type TaskUpsertInput,
} from '@/lib/store/task-repository';
import {
  collectDuplicateKeyWarnings,
  toGoalMetricUpsertInputs,
  toTaskUpsertInputs,
} from '@/lib/upload/upload-mapper';
import type { EnumOptionEntry, ParseWarning } from '@/types/sheet';
import type { Task, TabParseResult, TeamKey, WorkbookParseResult } from '@/types/task';

/** 같은 `code + sheet`를 개수로 접은 경고. 값은 담지 않는다 */
export interface PreviewWarning {
  code: string;
  sheet: string;
  count: number;
  /** 처음 발생한 행 (1-based). 없으면 null */
  firstRow: number | null;
}

export interface TabPreview {
  sheet: string;
  teamKey: TeamKey | null;
  taskCount: number;
  goalMetricCount: number;
  created: number;
  updated: number;
  unchanged: number;
  /** 판별 실패·밴드 부재로 반영되지 않는 탭 (`X2`의 「부분 실패」) */
  skipped: boolean;
}

/** `uploads.parse_result`에 그대로 들어간다. **JSON 직렬화 가능해야 한다** */
export interface CommitPayload {
  tasks: TaskUpsertInput[];
  goalMetrics: GoalMetricUpsertInput[];
  /** 이번 업로드가 건드리는 팀. 여기 없는 팀은 확정에서도 손대지 않는다 (`UC-04`) */
  teamKeys: TeamKey[];
  /**
   * `설정` 탭의 enum 목록. **팀 전용 컬럼의 값 목록이 여기서만 온다** — 수정 폼의 드롭다운이
   * 이것을 쓴다 (`team-enum-groups.ts`). 설정 탭이 없는 워크북이면 빈 배열이고, 그때 기존
   * 목록은 그대로 남는다 (확정은 지우지 않는다).
   *
   * ⚠ 이 필드가 생기기 전에 만들어진 업로드 레코드에는 **없다.** 읽는 쪽이 `?? []`로 받는다.
   */
  enums: EnumOptionEntry[];
}

export interface UploadPreview {
  totals: {
    taskCount: number;
    created: number;
    updated: number;
    unchanged: number;
    warningCount: number;
  };
  tabs: TabPreview[];
  /** 워크북에 없어서 이번에 갱신되지 않는 팀 (`UC-04` 고지) */
  untouchedTeams: TeamKey[];
  /** 건너뛴 탭 이름 — 「빠진 탭을 명시」의 실체 (T5 완료 기준 8) */
  skippedSheets: string[];
  warnings: PreviewWarning[];
}

export type PreviewOutcome =
  | { ok: true; preview: UploadPreview; payload: CommitPayload }
  | { ok: false; code: 'NO_KNOWN_TAB'; message: string };

/** 사용자에게 보여줄 한국어 문장. 내부 경로·셀 값을 담지 않는다 (`X1`) */
const NO_KNOWN_TAB_MESSAGE =
  '인식할 수 있는 팀 탭이 없습니다. 시트 전체를 .xlsx로 내보내 다시 올려 주세요.';

/**
 * 「이 탭은 읽으려 했는데 못 읽었다」는 사실들. 설정 탭·`00_통합 대시보드`는 여기 없다 —
 * 그 둘은 **원래 읽지 않는 탭**이라 매 업로드마다 뜨면 잡음이 된다
 * (`sheet-pipeline.ts`가 같은 이유로 경고조차 남기지 않는다).
 */
const SKIP_WARNING_CODES: readonly string[] = [
  'UNKNOWN_TAB',
  'HEADER_BAND_NOT_FOUND',
  'TAB_PARSE_FAILED',
];

interface MappedTab {
  tab: TabParseResult;
  tasks: TaskUpsertInput[];
  goalMetrics: GoalMetricUpsertInput[];
}

/** `code + sheet`로 묶고 개수를 센다. 접기 전 원본은 남기지 않는다 — 행 수만큼 커진다 */
function foldWarnings(warnings: readonly ParseWarning[]): PreviewWarning[] {
  const folded = new Map<string, PreviewWarning>();

  for (const warning of warnings) {
    // 시트 이름에 무엇이 들어와도 두 필드가 섞이지 않게 배열로 묶는다 (`taskUpsertKey`와 같은 방식)
    const key = JSON.stringify([warning.code, warning.sheet]);
    const previous = folded.get(key);
    const row = warning.row ?? null;

    if (!previous) {
      folded.set(key, { code: warning.code, sheet: warning.sheet, count: 1, firstRow: row });
      continue;
    }
    previous.count += 1;
    if (row !== null && (previous.firstRow === null || row < previous.firstRow)) {
      previous.firstRow = row;
    }
  }

  return [...folded.values()];
}

/**
 * 같은 자연키가 배열 안에 두 번이면 **뒤엣것이 이긴다** — 저장소와 같은 규칙이라야
 * 미리보기 숫자가 확정 결과와 맞는다 (`memory-task-store.ts`의 `dedupeByKey`).
 * 값이 아니라 **객체 자체**를 담아 두는 이유는, 어느 탭이 그 건을 세야 하는지 알기 위해서다.
 */
function pickWinners(tasks: readonly TaskUpsertInput[]): Map<string, TaskUpsertInput> {
  const winners = new Map<string, TaskUpsertInput>();
  for (const task of tasks) {
    winners.set(taskUpsertKey(task), task);
  }
  return winners;
}

export function buildUploadPreview(
  parsed: WorkbookParseResult,
  /** 대조 대상. 라우트가 `repo.listTasks()`로 읽어 넘긴다 — 이 함수는 저장소를 모른다 */
  existing: readonly Task[],
  uploadId: string | null,
): PreviewOutcome {
  const mapped: MappedTab[] = parsed.tabs.map((tab) => ({
    tab,
    tasks: toTaskUpsertInputs(tab, uploadId),
    goalMetrics: toGoalMetricUpsertInputs(tab, uploadId),
  }));

  // 「알려진 탭 0개」는 성공이 아니라 중단이다 (`X2`). 설정 탭만 든 파일도 여기서 걸린다
  const hasKnownTab = mapped.some(
    ({ tab }) => tab.teamKey !== null && (tab.tasks.length > 0 || tab.goalMetrics.length > 0),
  );
  if (!hasKnownTab) {
    return { ok: false, code: 'NO_KNOWN_TAB', message: NO_KNOWN_TAB_MESSAGE };
  }

  const tasks = mapped.flatMap((entry) => entry.tasks);
  const goalMetrics = mapped.flatMap((entry) => entry.goalMetrics);
  const touched = new Set<TeamKey>([
    ...tasks.map((task) => task.teamId),
    ...goalMetrics.map((metric) => metric.teamId),
  ]);
  const payload: CommitPayload = {
    tasks,
    goalMetrics,
    teamKeys: TEAM_KEYS.filter((teamKey) => touched.has(teamKey)),
    enums: parsed.settings?.enums ?? [],
  };

  const winners = pickWinners(tasks);
  const previous = new Map(existing.map((task) => [taskUpsertKey(task), task]));

  const skippedSheets = new Set(
    parsed.warnings
      .filter((warning) => SKIP_WARNING_CODES.includes(warning.code) && warning.sheet !== '')
      .map((warning) => warning.sheet),
  );

  const tabs: TabPreview[] = mapped.map(({ tab, tasks: tabTasks, goalMetrics: tabGoals }) => {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const task of tabTasks) {
      const key = taskUpsertKey(task);
      // 진 쪽(같은 키의 앞엣것)은 저장되지 않으므로 세지 않는다
      if (winners.get(key) !== task) continue;

      const prev = previous.get(key);
      if (!prev) created += 1;
      else if (diffTaskFields(prev, task).length > 0) updated += 1;
      else unchanged += 1;
    }

    return {
      sheet: tab.sheet,
      teamKey: tab.teamKey,
      taskCount: tab.tasks.length,
      goalMetricCount: tabGoals.length,
      created,
      updated,
      unchanged,
      skipped: tab.teamKey === null && skippedSheets.has(tab.sheet),
    };
  });

  // 판별에 실패한 탭은 파이프라인이 결과를 만들지 않으므로 `parsed.tabs`에 없다.
  // 그래도 화면에는 나와야 한다 — 빠진 탭을 말해 주지 않는 부분 실패는 조용한 유실과 같다
  for (const sheet of skippedSheets) {
    if (tabs.some((tab) => tab.sheet === sheet)) continue;
    tabs.push({
      sheet,
      teamKey: null,
      taskCount: 0,
      goalMetricCount: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: true,
    });
  }

  const warnings = foldWarnings([
    ...parsed.warnings,
    ...parsed.tabs.flatMap((tab) => tab.warnings),
    ...(parsed.settings?.warnings ?? []),
    ...collectDuplicateKeyWarnings(tasks),
  ]);

  const sum = (pick: (tab: TabPreview) => number) =>
    tabs.reduce((total, tab) => total + pick(tab), 0);

  return {
    ok: true,
    payload,
    preview: {
      totals: {
        taskCount: sum((tab) => tab.taskCount),
        created: sum((tab) => tab.created),
        updated: sum((tab) => tab.updated),
        unchanged: sum((tab) => tab.unchanged),
        // 접기 전 발생 건수다. 접힌 줄 수가 아니라 "경고 W건"이 사람이 기대하는 숫자다
        warningCount: warnings.reduce((total, warning) => total + warning.count, 0),
      },
      tabs,
      untouchedTeams: TEAM_KEYS.filter((teamKey) => !touched.has(teamKey)),
      skippedSheets: [...skippedSheets],
      warnings,
    },
  };
}
