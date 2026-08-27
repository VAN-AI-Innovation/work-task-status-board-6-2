/**
 * 시트의 한글 상태 문자열을 **여기서 한 번만** 만난다 (ADR-009).
 * 판정 로직이 `'진행 중'`을 직접 비교하기 시작하면 시트에서 이름이 바뀔 때 코드가 여러 곳에서 깨진다.
 * 아래 두 함수만 원문을 알고, 나머지 도메인 계층은 `TaskSemantic` 코드만 본다.
 *
 * 같은 파일에 미등록 enum 검사가 들어가는 이유는 **보는 표가 같기 때문**이다 —
 * `설정` 탭의 enum 목록. `toSemantic`은 그 목록을 코드로 바꾸고,
 * `collectUnregisteredEnumWarnings`는 그 목록에 **없는** 값을 세어 `H4`("설정 탭 enum이 실제로
 * 쓰인다")를 실측한다. T2는 "쓰는 쪽 일"이라 미뤘고 T3는 "T4 일"이라 미뤘던 그 검사다.
 *
 * 세 가지를 하지 않는다.
 * - 값을 기본값으로 치환하지 않는다. 파서·판정은 값을 보존하고 경고만 남긴다 (CLAUDE.md).
 * - 경고에 셀 값을 담지 않는다. 코드와 위치(`시트명`·`행`)뿐이다 (CLAUDE.md 보안 규칙).
 * - 예외를 던지지 않고 입력 객체를 고치지 않는다.
 */

import type { ParseWarning, SettingsRegistry } from '@/types/sheet';
import type { Task, TaskSemantic } from '@/types/task';

/**
 * 시트 원문 → semantic. `설정` 탭 `공통_진행 상태` 10단계가 **정확히 이 키들**이다.
 * 값 10개가 semantic 9종으로 간다 — `업무 배정`과 `준비 중`이 둘 다 `planned`다.
 *
 * 글자를 바꾸지 마라. `게시·이관 대기`의 가운뎃점은 `·`(U+00B7)이고, 시트 원문과 한 글자만
 * 달라도 그 상태가 조용히 미매핑된다. 어긋남은 픽스처 대조 테스트가 잡는다.
 */
export const STATUS_SEMANTIC_MAP: Readonly<Record<string, TaskSemantic>> = {
  '업무 배정': 'planned',
  '준비 중': 'planned',
  '진행 중': 'in_progress',
  '검토 요청': 'review',
  '승인 대기': 'approval',
  '수정 중': 'rework',
  '게시·이관 대기': 'pending_release',
  완료: 'done',
  보류: 'hold',
  취소: 'cancelled',
};

/**
 * 위 표의 **키를 순서 그대로** 뽑은 것. 상태 드롭다운(배정표 xlsx · 사이드 패널의 수정 폼)이
 * 고르게 하는 값이 이 목록이다.
 *
 * 목록을 화면에 다시 적지 않기 위해 있다 (`ADR-009`). 한 글자만 달라도 — `게시·이관 대기`의
 * 가운뎃점이 흔하다 — 사용자가 고른 값이 조용히 미매핑되고, 그 화면은 상태를 고치는 기능이
 * 아니라 상태를 망가뜨리는 기능이 된다.
 */
export const STATUS_OPTIONS: readonly string[] = Object.keys(STATUS_SEMANTIC_MAP);

/** 진행형이 아닌 semantic. 완료율 모수·장기 미갱신 판정이 이 셋을 갈라 쓴다 */
const INACTIVE_SEMANTICS: readonly TaskSemantic[] = ['done', 'hold', 'cancelled'];

/** 상태 원문 → semantic 조회표. 키는 `trim()`한 원문이다 */
export type SemanticIndex = ReadonlyMap<string, TaskSemantic>;

/** 미등록 검사를 하는 `Task` 필드. 넷 다 시트의 공통 enum 컬럼이다 */
type CheckedField = 'status' | 'approvalStatus' | 'priority' | 'riskStatus';

export interface EnumGroupCheck {
  /** `설정` 탭 그룹 이름 원문 */
  groupKey: string;
  field: CheckedField;
  code: string;
}

/**
 * 검사 대상은 **공통 enum 4종뿐**이다. 팀 전용 그룹(`편집_콘텐츠 유형` 등)은 `extras`로 흘러가
 * 공통 필드에 담기지 않으므로 여기서 볼 수 있는 값이 없다.
 */
export const CHECKED_ENUM_GROUPS: readonly EnumGroupCheck[] = [
  { groupKey: '공통_진행 상태', field: 'status', code: 'UNREGISTERED_STATUS' },
  { groupKey: '공통_승인 상태', field: 'approvalStatus', code: 'UNREGISTERED_APPROVAL_STATUS' },
  { groupKey: '공통_우선순위', field: 'priority', code: 'UNREGISTERED_PRIORITY' },
  { groupKey: '공통_리스크 상태', field: 'riskStatus', code: 'UNREGISTERED_RISK_STATUS' },
];

const STATUS_GROUP_KEY = CHECKED_ENUM_GROUPS[0].groupKey;

/** 값 하나를 비교 가능한 모양으로. 미입력(빈칸·공백뿐)은 null과 같게 본다 */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 레지스트리의 `공통_진행 상태` 값에 semantic을 붙인 조회표를 만든다.
 *
 * 시트에 새 상태가 생겨도 이 함수는 깨지지 않는다 — 표에 없는 값은 인덱스에 안 들어가고
 * `toSemantic`이 `null`을 돌려줄 뿐이며, 그 사실은 미등록 경고가 아니라 매핑 실패로 드러난다.
 *
 * **레지스트리가 없거나 그 그룹이 비어 있으면 내장 표 전체를 넣는다.** 설정 탭이 빠진
 * 부분 업로드(UC-04)에서 상태 판정이 통째로 죽으면 대시보드가 무의미해진다.
 */
export function buildSemanticIndex(registry: SettingsRegistry | null): SemanticIndex {
  const index = new Map<string, TaskSemantic>();

  for (const entry of registry?.enums ?? []) {
    if (entry.groupKey !== STATUS_GROUP_KEY) continue;

    const value = normalize(entry.value);
    if (value === null) continue;

    const semantic = STATUS_SEMANTIC_MAP[value];
    if (semantic !== undefined) index.set(value, semantic);
  }

  if (index.size === 0) {
    for (const [value, semantic] of Object.entries(STATUS_SEMANTIC_MAP)) {
      index.set(value, semantic);
    }
  }

  return index;
}

/**
 * 상태 원문 하나를 semantic으로. 모르는 값은 `null`이고 예외를 던지지 않는다.
 *
 * `trim()` 후 **정확히 일치**할 때만 매핑한다. 부분 일치·소문자화를 하지 마라 —
 * 한글 상태값에 부분 일치를 쓰면 `승인 대기`가 `대기`에 걸린다.
 */
export function toSemantic(statusRaw: string | null, index: SemanticIndex): TaskSemantic | null {
  const value = normalize(statusRaw);
  if (value === null) return null;

  return index.get(value) ?? null;
}

/**
 * 진행형 semantic인가 — 완료·보류·취소가 아닌 것.
 *
 * `null`(미입력·미등록)은 **false**다. 모르는 상태를 진행형이라고 단정하면 지연·장기 미갱신
 * 알림이 근거 없이 늘어난다. 미등록 값 자체는 아래 경고가 따로 드러낸다.
 */
export function isActiveSemantic(semantic: TaskSemantic | null): boolean {
  if (semantic === null) return false;

  return !INACTIVE_SEMANTICS.includes(semantic);
}

/**
 * 설정 탭에 등록되지 않은 값을 쓰는 업무를 찾아 경고로 돌려준다 (`H4` 실측 수단).
 *
 * 규칙 넷 — 각각이 실제 사고를 막는다.
 * - **레지스트리가 없으면 검사하지 않는다.** 근거가 없는데 전건을 경고하면 사람이 경고를 안 읽는다.
 *   그룹 단위도 같다 — 레지스트리에 그 그룹이 없으면 그 필드만 검사에서 빠진다.
 * - **미입력은 미등록이 아니다.** 담당자 미지정·기한 미설정은 알림 계층이 따로 다룬다.
 * - **접지 않는다.** 같은 값이 여러 행에서 미등록이면 행마다 1건이다. `H4`의 지표가 건수라
 *   값 기준으로 접으면 그 수를 잃는다.
 * - 경고는 `code`·`sheet`·`row`뿐이다. 어느 필드가 걸렸는지는 **코드로** 구분된다.
 */
export function collectUnregisteredEnumWarnings(
  tasks: Task[],
  registry: SettingsRegistry | null
): ParseWarning[] {
  if (registry === null) return [];

  const registered = new Map<string, Set<string>>();
  for (const entry of registry.enums) {
    const value = normalize(entry.value);
    if (value === null) continue;

    const values = registered.get(entry.groupKey) ?? new Set<string>();
    values.add(value);
    registered.set(entry.groupKey, values);
  }

  const checks = CHECKED_ENUM_GROUPS.map((check) => ({
    check,
    values: registered.get(check.groupKey),
  })).filter((entry): entry is { check: EnumGroupCheck; values: Set<string> } => {
    return entry.values !== undefined;
  });

  const warnings: ParseWarning[] = [];

  for (const task of tasks) {
    for (const { check, values } of checks) {
      const value = normalize(task[check.field]);
      if (value === null || values.has(value)) continue;

      warnings.push({ code: check.code, sheet: task.sourceSheetTab, row: task.sourceRowIndex });
    }
  }

  return warnings;
}
