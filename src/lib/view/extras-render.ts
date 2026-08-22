/**
 * `extras` 한 칸을 **화면에 그릴 모양으로** 접는다. 사이드 패널이 라벨-값으로 나열하는
 * 60여 칸이 전부 여기를 지난다 (`ADR-002`).
 *
 * ## 마스킹을 다시 하지 않는다
 *
 * 민감 값은 이미 `toTaskListResponse` → `maskExtras`가 `null`로 지워서 넘어온다 (`S6`).
 * 이 파일이 하는 일은 그 `null`이 **원래 빈 값인지 가려진 값인지 표시**하는 것뿐이다.
 * 두 곳에서 거르면 한쪽만 고쳐졌을 때 어느 쪽이 진짜인지 알 수 없다 —
 * 그래서 `maskExtras`를 부르지 않고 `isSensitiveExtraKey`로 **판별만** 한다.
 *
 * ## 스킴 화이트리스트 (`S7` · 완료 기준 12)
 *
 * 값은 시트 셀에서 온다. `javascript:`로 시작하는 하이퍼링크가 그대로 `<a href>`가 되면
 * 그것이 곧 XSS다. 그래서 **`http`·`https`만 앵커가 되고 나머지는 텍스트로만** 남는다.
 * 값을 버리지는 않는다 — 사용자는 시트에 무엇이 적혀 있는지 볼 수 있어야 한다.
 *
 * 판정은 `URL`이 해석한 **스킴 하나를 정확히 비교**한다. 위험한 낱말이 문자열 어딘가에
 * 들어 있는지 부분 일치로 찾으면 `https://x.com/javascript-tips` 같은 정상 URL이 막히고,
 * 정작 `java{탭}script:`는 통과한다. (AC의 grep이 이 파일에 그 부분 일치 코드가 없음을 본다.)
 */

import { isSensitiveExtraKey, type ViewerRole } from '@/lib/domain/extras-visibility';
import { EMPTY } from '@/lib/view/kpi-format';
import type { ExtraValue } from '@/types/task';

/** 가려진 값의 표기. 「없음」(`EMPTY`)과 **다른 글자여야** 두 사실이 구분된다 */
export const MASKED = '(비공개)';

export interface ExtraCell {
  label: string;
  /** 화면에 그릴 문자열. 마스킹이면 `(비공개)`, 빈 값이면 `—` */
  text: string;
  /** `http`·`https`일 때만 값이 있다. 그 외엔 null이고 `text`만 그린다 */
  href: string | null;
  masked: boolean;
}

const ALLOWED_SCHEMES: readonly string[] = ['http:', 'https:'];

/**
 * 브라우저는 URL 안의 제어문자(탭·개행 등)를 **지우고 읽는다.** 판정도 같은 모양을 봐야
 * `java{탭}script:alert(1)`이 통과하지 않는다. 공백까지 함께 털어 선행 공백으로 스킴을
 * 숨기는 경로도 막는다.
 */
function stripControl(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f]/g, '');
}

/** `http`·`https`만 통과. 그 외·형식 오류는 null이며 **예외를 던지지 않는다** */
export function safeHref(value: string): string | null {
  const cleaned = stripControl(value);
  if (cleaned === '') return null;

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    // 상대 경로·그냥 텍스트. 링크로 만들 근거가 없다
    return null;
  }

  // `URL.protocol`은 이미 소문자로 정규화돼 있다. 부분 일치가 아니라 정확 비교다
  return ALLOWED_SCHEMES.includes(parsed.protocol) ? cleaned : null;
}

/** 값이 비었는가. 공백만 있는 셀은 시트에서 흔하고, 화면에서는 빈 칸과 같다 */
function isBlank(value: string): boolean {
  return value.trim() === '';
}

function toCell(label: string, value: ExtraValue, role: ViewerRole): ExtraCell {
  if (value === null) {
    /*
     * **여기가 이 파일의 요점이다.** 같은 `null`이라도 member에게 민감 키면 「가려졌다」,
     * 그 외에는 「원래 없다」다. 뭉개면 사용자가 값이 없다고 믿고 시트를 다시 뒤진다.
     */
    const masked = role === 'member' && isSensitiveExtraKey(label);
    return { label, text: masked ? MASKED : EMPTY, href: null, masked };
  }

  if (typeof value === 'object') {
    // 텍스트가 비면 URL 자체를 보여 준다 — 링크 칸이 빈 칸으로 보이면 안 된다
    const text = value.text !== null && !isBlank(value.text) ? value.text : value.hyperlink;
    return {
      label,
      text: isBlank(text) ? EMPTY : text,
      href: safeHref(value.hyperlink),
      masked: false,
    };
  }

  // `false`·`0`은 값이다. `String()`으로 접어야 `—`가 되지 않는다
  const text = String(value);
  return { label, text: isBlank(text) ? EMPTY : text, href: null, masked: false };
}

/**
 * 라벨 순으로 정렬해 돌려준다. **입력을 고치지 않는다.**
 *
 * 정렬 비교는 `task-sort.ts`와 같은 방식이다 — `localeCompare`는 실행 환경의 로케일을
 * 따라가서 서버와 CI가 다른 순서를 낼 수 있다. 같은 업무의 패널이 매번 다른 순서로 보이면
 * 70컬럼에서 원하는 칸을 눈으로 찾을 수 없다.
 */
export function toExtraCells(extras: Record<string, ExtraValue>, role: ViewerRole): ExtraCell[] {
  return Object.keys(extras)
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1))
    .map((label) => toCell(label, extras[label], role));
}
