/**
 * 파싱 산출물 타입. **DB에 들어가기 전의 모양**이고, 필드 이름은 `ARCHITECTURE.md`
 * 데이터 모델의 컬럼과 1:1로 대응한다 (`snake_case` 컬럼 → `camelCase` 프로퍼티).
 * T4가 옮겨 담기만 하면 되게 하려는 것이다.
 *
 * `semantic`(`planned`·`in_progress` …) 코드는 여기 없다. 상태는 시트 원문 그대로 싣고
 * 매핑은 도메인 계층(T4)이 한다 (ADR-009).
 */

import type { ParsedGoalMetric, ParsedTeamPeriodGoal } from '@/types/goal';
import type { ParseWarning, SettingsRegistry } from '@/types/sheet';

export type TeamKey = 'edit' | 'shoot' | 'marketing';

/**
 * `extras`·`raw`에 담기는 값. 하이퍼링크 셀은 **텍스트와 URL을 둘 다** 보존한다.
 * 문자열로 뭉개면 T6가 앵커를 그릴 근거를 잃는다 (UI 규칙은 T6, 여기서는 보존만).
 */
export type ExtraValue =
  | string
  | number
  | boolean
  | null
  | { text: string | null; hyperlink: string };

export interface ParsedStage {
  /** 그룹이 시트에 나온 순서, 0부터 */
  seq: number;
  /** `STAGE_GROUPS`가 정한 안정 키. 예: `concept` */
  stageKey: string;
  /** 시트 그룹 헤더 원문. 예: `컨셉·레퍼런스 (+2일)` */
  stageLabel: string;
  /** `YYYY-MM-DD` 또는 null */
  plannedDate: string | null;
  actualDate: string | null;
  content: string | null;
  confirmStatus: string | null;
  slaDays: number | null;
}

export interface ParsedTask {
  teamKey: TeamKey;
  /** 자연키. 업무ID가 있으면 그 값, 없으면 `slug(업무명)::slug(담당자)` */
  sourceKey: string;
  title: string | null;
  ownerNameRaw: string | null;
  coOwnerNames: string[];
  /** 시트 원문 그대로. `semantic` 변환은 T4다 */
  status: string | null;
  approvalStatus: string | null;
  priority: string | null;
  riskStatus: string | null;
  /** 0~100 정수. **빈칸은 null이고 0과 반드시 구분된다** */
  progress: number | null;
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  delayReason: string | null;
  note: string | null;
  /** 매핑되지 않은 컬럼 전량. 키는 헤더 결합 라벨 원문 */
  extras: Record<string, ExtraValue>;
  /** 원본 행 통째(감사·복원). **API 응답에 실으면 안 된다** (CLAUDE.md 보안 규칙) */
  raw: Record<string, ExtraValue>;
  sourceSheetTab: string;
  /** **1-based** — `ParseWarning`과 같은 규칙(사람이 읽는 좌표) */
  sourceRowIndex: number;
  stages: ParsedStage[];
}

export interface TabParseResult {
  sheet: string;
  teamKey: TeamKey | null;
  tasks: ParsedTask[];
  goalMetrics: ParsedGoalMetric[];
  teamPeriodGoals: ParsedTeamPeriodGoal[];
  /** 마케팅 C섹션의 회의 브리핑 줄. 저장 스키마는 T4에서 정한다 */
  briefingLines: string[];
  warnings: ParseWarning[];
}

export interface WorkbookParseResult {
  tabs: TabParseResult[];
  settings: SettingsRegistry | null;
  /** 탭 하나에 귀속되지 않는 경고(미판별 탭 등) */
  warnings: ParseWarning[];
}
