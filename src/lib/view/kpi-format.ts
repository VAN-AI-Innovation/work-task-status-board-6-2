/**
 * 화면이 숫자를 **글자로 바꾸는 규칙**. 컴포넌트마다 다시 쓰지 않으려고 한 곳에 모았다.
 *
 * 규칙은 하나뿐이다 — **`null`은 `0`이 아니다.** 모수가 없어 계산되지 않은 완료율과 `0%`는
 * 다른 사실이고, 뭉개면 화면이 「완료율 0%」라고 거짓말한다. `null`은 전부 `—`(em dash)다.
 *
 * 천 단위 구분자를 `toLocaleString()`으로 넣지 않는다. 인자 없는 호출은 실행 환경의 로케일을
 * 따라가서 서버와 CI가 다른 문자열을 낼 수 있다. 자릿수 삽입은 직접 한다.
 */

import type { KpiTile } from '@/lib/domain/progress-stats';

/** 값이 없다는 표기. 화면 전체가 이 글자 하나를 쓴다 — 표의 빈 칸도 여기서 가져다 쓴다 */
export const EMPTY = '—';

/** `null` → `—`. 천 단위 구분자를 넣는다 */
export function formatCount(value: number | null): string {
  if (value === null) return EMPTY;

  // `\B` 덕분에 부호 바로 뒤에는 콤마가 붙지 않는다 (`-1234` → `-1,234`)
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `null` → `—`. 그 외에는 정수 + `%` */
export function formatPercent(value: number | null): string {
  return value === null ? EMPTY : `${value}%`;
}

/** `KpiTile.unit`에 따라 위 둘 중 하나. 타일이 단위를 들고 다니므로 화면이 판단하지 않는다 */
export function formatKpi(tile: KpiTile): string {
  return tile.unit === 'percent' ? formatPercent(tile.value) : formatCount(tile.value);
}

/**
 * `dday`는 **남은 일수**다 (`task-derive.ts`가 `dueAt - today`로 낸다). 표기는 통념대로
 * 남았으면 `D-3`, 오늘이면 `D-DAY`, 지났으면 `D+2`.
 */
export function formatDday(dday: number | null): string {
  if (dday === null) return EMPTY;
  if (dday === 0) return 'D-DAY';

  return dday > 0 ? `D-${dday}` : `D+${-dday}`;
}

/** `YYYY-MM-DD` 그대로. 표기를 바꾸면 시트와 눈으로 대조할 수 없다 */
export function formatDate(value: string | null): string {
  return value === null || value === '' ? EMPTY : value;
}
