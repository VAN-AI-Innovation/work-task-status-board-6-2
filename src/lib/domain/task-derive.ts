/**
 * 업무 하나에서 나오는 **파생 판정** 전부. 뒤의 집계(step 3)와 알림(step 5)이 이 결과를 쓰고,
 * 화면(T6)만 `toDisplayStatus`로 한 칸 더 접는다.
 *
 * 규칙 셋.
 * - **오늘을 인자로 받는다** (`ctx.today`). 이 파일은 현재 시각을 스스로 읽지 않는다
 *   (CLAUDE.md CRITICAL). 날짜 차이는 `kst-today.ts`의 `daysBetween`으로만 구한다 —
 *   `Date` 객체 뺄셈은 KST에서 하루가 어긋난다 (`PLAN.md` `E4`).
 * - **상태 원문을 모른다.** semantic 변환은 `task-semantic.ts`가 한다 (`ADR-009`).
 *   예외는 아래 `RISK_DELAYED` 하나이고, 그 근거는 상수 주석에 있다.
 * - 입력을 고치지 않고 예외를 던지지 않는다.
 *
 * 단계별 SLA로 마감 임박 기준을 좁히는 것은 여기서 하지 않는다. `slaDays`는 `TaskStage`에
 * 붙지 업무에 붙지 않아서(T3 결론), 태스크 단위에는 어느 단계 SLA를 쓸지 고를 근거가 없다.
 * 그 판정은 `TaskStage`를 함께 보는 `alert-rules`(step 5)의 일이다.
 */

import { daysBetween, kstDateOf } from '@/lib/domain/kst-today';
import { isActiveSemantic, toSemantic, type SemanticIndex } from '@/lib/domain/task-semantic';
import type { Task, TaskSemantic } from '@/types/task';

/**
 * 담당자가 비어 있다고 볼 값. 비교는 `trim()` + 소문자화 후 정확 일치다.
 * 한 곳에 모아 두는 이유는 알림(step 5)·화면(T6)이 같은 목록을 봐야 하기 때문이다.
 */
const NO_OWNER_TOKENS: readonly string[] = ['미정', 'tbd', '-', '–', '—', '없음'];

/**
 * 시트 `공통_리스크 상태`의 「지연」 값. **이 파일이 아는 유일한 한글 상태 문자열**이다.
 *
 * `ADR-009`가 지연을 `due_at < today`의 파생 판정으로 두면서 **시트가 스스로 적은 지연을
 * OR로 합치라고** 했다 — 마감일이 비어 있어도 담당자가 지연이라고 표시한 건은 지연이다.
 * 진행 상태 10단계와 달리 이 값은 semantic 매핑 대상이 아니라 여기서만 쓰인다.
 */
const RISK_DELAYED = '지연';

/** 지연·임박·기한 미설정 판정에서 빠지는 semantic. 끝난 업무는 마감을 다시 묻지 않는다 */
const TERMINAL_SEMANTICS: readonly TaskSemantic[] = ['done', 'cancelled'];

const DEFAULT_DUE_SOON_DAYS = 3;
const DEFAULT_STALE_DAYS = 7;

export interface DeriveContext {
  /** KST 기준 오늘 `YYYY-MM-DD`. `kstToday(now)`가 만든 값을 **주입받는다** */
  today: string;
  /** `buildSemanticIndex`가 만든 조회표 */
  semanticIndex: SemanticIndex;
  /** 마감 임박 기준. 기본 3 (D-3) */
  dueSoonDays?: number;
  /** 장기 미갱신 기준. 기본 7 */
  staleDays?: number;
  /** 설정 탭 구성원 목록. 없으면 `hasUnknownOwner`는 항상 false */
  knownOwners?: readonly string[];
}

export interface TaskFlags {
  semantic: TaskSemantic | null;
  /** `dueAt` 기준 남은 일수. 음수면 지났다. `dueAt`이 없으면 null */
  dday: number | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  isStale: boolean;
  hasNoOwner: boolean;
  hasUnknownOwner: boolean;
  hasNoDueDate: boolean;
}

/** 비교 가능한 모양으로. 공백뿐인 값은 미입력과 같게 본다 */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function deriveTaskFlags(task: Task, ctx: DeriveContext): TaskFlags {
  const semantic = toSemantic(task.status, ctx.semanticIndex);
  const isTerminal = semantic !== null && TERMINAL_SEMANTICS.includes(semantic);

  const dday = task.dueAt === null ? null : daysBetween(ctx.today, task.dueAt);
  const dueSoonDays = ctx.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;
  const staleDays = ctx.staleDays ?? DEFAULT_STALE_DAYS;

  const isOverdue =
    !isTerminal && ((dday !== null && dday < 0) || normalize(task.riskStatus) === RISK_DELAYED);
  const isDueSoon = !isOverdue && !isTerminal && dday !== null && dday >= 0 && dday <= dueSoonDays;

  // 갱신 이력이 없으면 미갱신이 아니다. 값이 없는 것은 「오래됐다」는 증거가 아니라 증거의 부재다
  const sinceProgress = ((): number | null => {
    const lastDate = kstDateOf(task.lastProgressAt);
    return lastDate === null ? null : daysBetween(lastDate, ctx.today);
  })();
  const isStale = sinceProgress !== null && sinceProgress > staleDays && isActiveSemantic(semantic);

  const owner = normalize(task.ownerNameRaw);
  const hasNoOwner = owner === null || NO_OWNER_TOKENS.includes(owner.toLowerCase());

  // 구성원 목록을 모르는데 전건을 오타로 신고하면 사람이 경고를 안 읽는다
  const knownOwners = ctx.knownOwners ?? [];
  const hasUnknownOwner =
    !hasNoOwner && knownOwners.length > 0 && !knownOwners.some((name) => name.trim() === owner);

  return {
    semantic,
    dday,
    isOverdue,
    isDueSoon,
    isStale,
    hasNoOwner,
    hasUnknownOwner,
    // 담당자 미지정과 대칭인 별도 신호다. 지연으로 뭉개면 마감이 없는 업무가 영영 안 보인다
    hasNoDueDate: task.dueAt === null && !isTerminal,
  };
}

/** 여러 건을 한 번에. 키는 `task.id`다 */
export function deriveAllFlags(tasks: readonly Task[], ctx: DeriveContext): Map<string, TaskFlags> {
  return new Map(tasks.map((task) => [task.id, deriveTaskFlags(task, ctx)]));
}
