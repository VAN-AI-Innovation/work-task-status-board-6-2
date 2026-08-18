/**
 * 날짜 계산의 단일 소스. 도메인 계층이 시간을 읽는 유일한 방법이다.
 *
 * - **`now`는 인자로 받는다.** 이 모듈 어디서도 현재 시각을 스스로 읽지 않는다
 *   (CLAUDE.md CRITICAL). 날짜에 따라 테스트가 깨지면 판정을 못 믿는다.
 * - 시간대 환산은 `Intl`에 맡긴다. `+9시간` 오프셋 상수를 손으로 박지 않는다 —
 *   근거가 코드에서 사라진다.
 * - 날짜 산술은 **`Date.UTC`로만** 한다. `new Date('2026-08-18')`는 UTC 자정,
 *   `new Date(2026, 7, 18)`은 로컬 자정이라 둘을 섞으면 하루가 어긋난다 (PLAN.md E4).
 * - 형식이 어긋난 입력에 예외를 던지지 않는다. `null`을 돌려준다.
 */

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD`을 UTC 자정 epoch ms로. 형식이 아니거나 실재하지 않는 날짜면 null */
function parseYmd(ymd: string): number | null {
  const matched = YMD_PATTERN.exec(ymd);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const ms = Date.UTC(year, month - 1, day);

  // `2026-02-30`처럼 실재하지 않는 날짜는 다른 날로 굴러간다. 왕복시켜 걸러낸다
  const rolled = new Date(ms);
  if (rolled.getUTCFullYear() !== year || rolled.getUTCMonth() !== month - 1) return null;
  if (rolled.getUTCDate() !== day) return null;

  return ms;
}

function formatUtc(ms: number): string {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `en-CA`는 `YYYY-MM-DD`로 포맷한다 */
const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `now`를 Asia/Seoul 기준 `YYYY-MM-DD`로 환산한다. 인자 없이 호출할 수 없다 */
export function kstToday(now: Date): string {
  return KST_FORMATTER.format(now);
}

/** ISO 타임스탬프를 Asia/Seoul 기준 `YYYY-MM-DD`로 환산한다. 파싱 불가면 null */
export function kstDateOf(isoTimestamp: string | null): string | null {
  if (isoTimestamp === null) return null;

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;

  return kstToday(parsed);
}

/** `to - from`을 **일수**로. 둘 다 `YYYY-MM-DD`. 형식이 아니면 null */
export function daysBetween(fromYmd: string, toYmd: string): number | null {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  if (from === null || to === null) return null;

  return (to - from) / MS_PER_DAY;
}

/** `YYYY-MM-DD`에 일수를 더한 `YYYY-MM-DD` */
export function addDays(ymd: string, days: number): string | null {
  const base = parseYmd(ymd);
  if (base === null) return null;

  return formatUtc(base + days * MS_PER_DAY);
}

/** 그 날짜가 속한 주의 월요일. 주는 **월요일에 시작**한다 */
export function startOfWeek(ymd: string): string | null {
  const base = parseYmd(ymd);
  if (base === null) return null;

  // `getUTCDay()`는 일요일이 0이다. 월요일 기준으로 옮긴다
  const offset = (new Date(base).getUTCDay() + 6) % 7;
  return formatUtc(base - offset * MS_PER_DAY);
}

/** 그 날짜가 속한 주의 일요일 */
export function endOfWeek(ymd: string): string | null {
  const monday = startOfWeek(ymd);
  if (monday === null) return null;

  return addDays(monday, 6);
}
