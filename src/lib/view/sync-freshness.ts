/**
 * 「마지막 반영: N일 전」 하나를 만든다.
 *
 * 이 시스템은 시트를 **사람이 올려야** 갱신된다 (`ADR-001`). 올리지 않으면 데이터가 낡는데,
 * 그 약점은 설계로 감출 수 없으므로 **모든 페이지 상단에 상시 드러낸다** (T6 완료 기준 8).
 * 감추면 사용자는 낡은 숫자를 오늘 숫자로 읽는다 — 조용한 오해가 조회 불가보다 나쁘다.
 *
 * 계산이 여기 있는 이유는 하나다. 이 문구를 화면마다 만들면 상한(`STALE_DAYS`)이 화면 수만큼
 * 생기고, 한쪽만 고쳐졌을 때 같은 데이터가 어느 페이지에서는 경고고 어느 페이지에서는 정상이
 * 된다. **상한은 이 파일에만 있다.**
 *
 * `now`를 읽지 않는다 — `today`를 인자로 받는다 (`CLAUDE.md` CRITICAL). 날짜 산술도 직접
 * 하지 않고 `kst-today.ts`에 맡긴다. `Date` 뺄셈은 KST에서 하루가 어긋난다 (`E4`).
 */

import { daysBetween, kstDateOf } from '@/lib/domain/kst-today';

/** 「마지막 반영」이 이 일수를 **넘으면** 경고색 (`UI_GUIDE.md`). 같으면 아직 정상이다 */
export const STALE_DAYS = 5;

export interface SyncFreshness {
  /** 마지막 반영으로부터 지난 일수. 기록이 없으면 null */
  days: number | null;
  /** 「마지막 반영: 3일 전」 · 「마지막 반영: 오늘」 · 「마지막 반영: 기록 없음」 */
  label: string;
  /** `days > STALE_DAYS`. 기록이 없으면 **true** */
  stale: boolean;
}

/** 한 번도 올린 적이 없다는 사실이 바로 경고할 일이다 — 「모른다」를 「괜찮다」로 보이지 않는다 */
const UNKNOWN: SyncFreshness = {
  days: null,
  label: '마지막 반영: 기록 없음',
  stale: true,
};

/**
 * @param lastSyncedAt ISO 타임스탬프. 기록이 없으면 null
 * @param today KST 기준 `YYYY-MM-DD` (`kstToday`)
 */
export function describeSync(lastSyncedAt: string | null, today: string): SyncFreshness {
  const syncedDate = kstDateOf(lastSyncedAt);
  if (syncedDate === null) return UNKNOWN;

  const elapsed = daysBetween(syncedDate, today);
  if (elapsed === null) return UNKNOWN;

  // 서버 시계가 어긋나 미래 타임스탬프가 들어오면 「-2일 전」이 화면에 뜬다. 사용자는 그 순간
  // 필터도 데이터도 전부 의심하기 시작한다. 음수는 오늘로 접는다
  const days = Math.max(0, elapsed);

  return {
    days,
    label: days === 0 ? '마지막 반영: 오늘' : `마지막 반영: ${days}일 전`,
    stale: days > STALE_DAYS,
  };
}
