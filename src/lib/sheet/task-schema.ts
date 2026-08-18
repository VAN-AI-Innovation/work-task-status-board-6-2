/**
 * 파싱 산출물 검증기. **하드 실패시키지 않는다** — 예외를 던지지 않고, 실패해도
 * 입력 객체를 고치지 않는다. 호출자는 원래 값을 그대로 저장하고 경고만 함께 싣는다
 * (CLAUDE.md 개발 프로세스).
 *
 * 검증 항목을 늘리지 않는다. 시트는 자유 입력이라 규칙을 늘리면 경고만 불어나고
 * 사람이 안 읽게 된다 — 값이 틀렸다고 파싱을 멈추는 것이 이 계층의 일이 아니다.
 *
 * 경고에는 `code`·`sheet`·`row`만 담는다. `sourceKey`는 `slug(업무명)+담당자`라
 * 실명이 들어가고, 셀 값도 담지 않는다 (CLAUDE.md 보안 규칙).
 * `column`은 필드 이름을 좌표로 환산할 수 없어 넣지 않는다.
 */

import { z } from 'zod';

import type { ParsedGoalMetric } from '@/types/goal';
import type { ParseWarning } from '@/types/sheet';
import type { ParsedTask } from '@/types/task';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** null은 정상이다 — 시트에 마감이 없는 업무가 실제로 있다 */
const dateField = z.string().regex(ISO_DATE).nullable();

const taskSchema = z.object({
  sourceKey: z.string().min(1),
  // null·빈 문자열 모두 걸린다 — 이름 없는 업무는 사람도 식별할 수 없다.
  title: z.string().min(1),
  // 빈칸(null)과 0은 반드시 구분된다 — 0은 정상값이다.
  progress: z.number().int().min(0).max(100).nullable(),
  assignedAt: dateField,
  dueAt: dateField,
  nextActionDue: dateField,
});

const goalMetricSchema = z.object({
  title: z.string().min(1),
  startedAt: dateField,
  dueAt: dateField,
});

/** 어느 필드가 걸렸는지는 코드로만 구분된다 — 필드 이름을 경고에 싣지 않기 때문이다 */
const TASK_CODES: Record<string, string> = {
  sourceKey: 'SOURCE_KEY_EMPTY',
  title: 'TASK_TITLE_MISSING',
  progress: 'PROGRESS_INVALID',
  assignedAt: 'DATE_FORMAT_INVALID',
  dueAt: 'DATE_FORMAT_INVALID',
  nextActionDue: 'DATE_FORMAT_INVALID',
};

const GOAL_CODES: Record<string, string> = {
  title: 'GOAL_TITLE_MISSING',
  startedAt: 'DATE_FORMAT_INVALID',
  dueAt: 'DATE_FORMAT_INVALID',
};

function toWarnings(
  schema: z.ZodType,
  value: unknown,
  codes: Record<string, string>,
  location: { sheet: string; row: number }
): ParseWarning[] {
  const result = schema.safeParse(value);
  if (result.success) return [];

  const seen = new Set<string>();
  const warnings: ParseWarning[] = [];

  for (const issue of result.error.issues) {
    const code = codes[String(issue.path[0])];
    // 같은 코드가 두 필드에서 나와도 경고는 하나다. 필드 이름을 싣지 않으니 두 건은 구분되지 않는다.
    if (!code || seen.has(code)) continue;
    seen.add(code);
    warnings.push({ code, sheet: location.sheet, row: location.row });
  }

  return warnings;
}

export function validateParsedTask(task: ParsedTask): ParseWarning[] {
  return toWarnings(taskSchema, task, TASK_CODES, {
    sheet: task.sourceSheetTab,
    row: task.sourceRowIndex,
  });
}

export function validateParsedGoalMetric(metric: ParsedGoalMetric): ParseWarning[] {
  return toWarnings(goalMetricSchema, metric, GOAL_CODES, {
    sheet: metric.sourceSheetTab,
    row: metric.sourceRowIndex,
  });
}
