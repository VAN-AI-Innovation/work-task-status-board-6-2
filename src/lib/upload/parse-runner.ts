/**
 * 파싱을 **한도와 시간 안에서** 돌리고, 어떤 결말이든 값으로 돌려준다.
 *
 * step 0의 `upload-guard`가 문 앞에서 막았다면 여기는 문 안이다 — `dimensions`는 워크북 XML
 * 안의 속성이라 위조할 수 있어서, 실제 바이트를 재는 해제 총량 상한만으로는 막히지 않는다.
 * 그 검사는 `workbook-reader`가 셀 배열을 만들기 전에 하고, 이 파일은 **숫자를 전달**할 뿐이다.
 *
 * **예외를 위로 던지지 않는다.** 라우트 핸들러가 `try/catch`로 갈래를 나누기 시작하면 계산이
 * 라우트로 새고 계층 경계가 무너진다 (ARCHITECTURE.md). 모든 결말이 `ParseOutcome`이다.
 *
 * 타임아웃은 **「중단」이 아니라 「포기」**다. Node 단일 스레드에서 진행 중인 동기 파싱을 중간에
 * 끊을 수 없기 때문이다. 대신 응답을 끊고 **결과를 쓰지 않는다** — `S2`가 요구하는 실질은
 * "부분 결과를 저장하지 않는다"이므로 이것으로 충족된다. 워커 스레드는 만들지 않는다.
 *
 * 엑셀 라이브러리를 import하지 않는다 (ADR-003).
 */

import { parseWorkbook } from '@/lib/sheet/sheet-pipeline';
import { PARSE_TIMEOUT_MS, type WorkbookLimits } from '@/lib/upload/upload-limits';
import type { WorkbookParseResult } from '@/types/task';

/** 셋 다 「중단」 강도다 (ARCHITECTURE.md 실패 강도 표). 저장소는 건드리지 않는다 */
export type ParseFailureCode = 'ARCHIVE_LIMIT_EXCEEDED' | 'PARSE_TIMEOUT' | 'WORKBOOK_CORRUPT';

export type ParseOutcome =
  | { ok: true; result: WorkbookParseResult }
  | { ok: false; code: ParseFailureCode; message: string };

/**
 * 사용자에게 보여줄 한국어 문장이다. **예외 메시지를 이어 붙이지 않는다** — 스택·내부 경로가
 * 그대로 새어 나간다 (`X1`).
 */
const MESSAGES: Record<ParseFailureCode, string> = {
  ARCHIVE_LIMIT_EXCEEDED: '파일이 처리 한도를 넘습니다. 시트나 행·열을 줄여 다시 올려 주세요.',
  PARSE_TIMEOUT: '파일을 읽는 데 너무 오래 걸려 중단했습니다. 탭을 나눠 올려 주세요.',
  WORKBOOK_CORRUPT: '워크북을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.',
};

const fail = (code: ParseFailureCode): ParseOutcome => ({ ok: false, code, message: MESSAGES[code] });

/**
 * `code` 속성으로 판별한다 — `instanceof`는 번들 경계(서버·클라이언트 청크가 클래스를 각자
 * 들고 갈 때)에서 흔들린다. 알 수 없는 예외는 전부 `WORKBOOK_CORRUPT`로 접는다.
 */
function toFailure(error: unknown): ParseOutcome {
  const code = (error as { code?: unknown } | null)?.code;
  return fail(code === 'ARCHIVE_LIMIT_EXCEEDED' ? 'ARCHIVE_LIMIT_EXCEEDED' : 'WORKBOOK_CORRUPT');
}

/**
 * `baseYear`도 `timeoutMs`도 여기서 계산하지 않는다. 시간은 주입받는다 (CLAUDE.md CRITICAL).
 */
export function runWorkbookParse(
  input: Buffer | ArrayBuffer,
  ctx: { baseYear: number; limits?: WorkbookLimits; timeoutMs?: number }
): Promise<ParseOutcome> {
  return new Promise<ParseOutcome>((resolve) => {
    let settled = false;

    // 타임아웃 뒤에 파싱이 늦게 끝나도 그 결과를 쓰지 않는다. 어느 갈래로 끝나든 타이머를
    // 정리한다 — 안 하면 서버리스 함수가 남은 타임아웃만큼 더 산다.
    const settle = (outcome: ParseOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => settle(fail('PARSE_TIMEOUT')), ctx.timeoutMs ?? PARSE_TIMEOUT_MS);

    parseWorkbook(input, { baseYear: ctx.baseYear, limits: ctx.limits }).then(
      (result) => settle({ ok: true, result }),
      (error: unknown) => settle(toFailure(error))
    );
  });
}
