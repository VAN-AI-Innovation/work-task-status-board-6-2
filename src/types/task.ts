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

/** 시트 10단계 진행 상태를 감싼 안정 코드 (ADR-009). 판정 로직은 한글 문자열을 직접 모른다 */
export type TaskSemantic =
  | 'planned'
  | 'in_progress'
  | 'review'
  | 'approval'
  | 'rework'
  | 'pending_release'
  | 'done'
  | 'hold'
  | 'cancelled';

/** 화면 5색 + 무채색. 한글 라벨은 `display-status.ts`가 따로 들고 있다 (UI_GUIDE.md) */
export type DisplayStatus = 'planned' | 'in_progress' | 'review' | 'done' | 'overdue' | 'muted';

/** 저장소에 들어갔다 나온 업무. `ParsedTask` + 신원(`id`)·소속·감사 필드 */
export interface Task {
  id: string;
  /** `teams.id`. 이 프로젝트에서 팀 PK는 uuid가 아니라 `TeamKey` 문자열이다 (step 8) */
  teamId: TeamKey;
  departmentId: string | null;
  sourceKey: string;
  title: string | null;
  /** `members.id`. T4에서는 항상 null이다 — 이름→구성원 해석은 T5 커밋의 일이다 */
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
  coOwnerNames: string[];
  /** 시트 원문 그대로 보존. `semantic` 변환은 `task-semantic.ts`가 한다 */
  status: string | null;
  approvalStatus: string | null;
  priority: string | null;
  riskStatus: string | null;
  /** 0~100 정수. **빈칸은 null이고 0과 반드시 구분된다** */
  progress: number | null;
  /** 전부 `YYYY-MM-DD` 또는 null */
  assignedAt: string | null;
  dueAt: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  nextActionDue: string | null;
  delayReason: string | null;
  note: string | null;
  extras: Record<string, ExtraValue>;
  /** **API 응답에 실으면 안 된다** (CLAUDE.md 보안 규칙) */
  raw: Record<string, ExtraValue>;
  /** ISO 8601 타임스탬프 또는 null. **실제로 값이 바뀐 업로드에서만** 갱신된다 (step 7) */
  lastProgressAt: string | null;
  sourceUploadId: string | null;
  sourceSheetTab: string;
  /** 1-based */
  sourceRowIndex: number;
}

export interface TaskStage {
  id: string;
  taskId: string;
  seq: number;
  stageKey: string;
  stageLabel: string;
  plannedDate: string | null;
  actualDate: string | null;
  content: string | null;
  confirmStatus: string | null;
  slaDays: number | null;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  uploadId: string | null;
  /** 바뀐 필드 **이름만**. 값을 담지 않는다 — 이력 테이블이 개인정보 사본이 되면 안 된다 */
  changedFields: string[];
  /** ISO 8601 */
  occurredAt: string;
}
