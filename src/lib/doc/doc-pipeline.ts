/**
 * 독스 추출의 네 계층을 **한 함수 뒤로** 감춘다. step 8의 라우트 핸들러는 이 함수 하나만
 * 부르고 계산하지 않는다 (CLAUDE.md CRITICAL · ARCHITECTURE.md 계층 경계).
 * 시트 쪽의 `sheet-pipeline` + `parse-runner`가 맡은 자리를 독스 쪽에서 맡는다.
 *
 * ```
 * readDocxOutline → buildOutline ─┬→ buildAssignmentRows → rows
 *                                 └→ parseWorkloadPriorities ┘
 * ```
 *
 * 이 파일이 지는 판단은 셋이고 그 밖은 아래 계층의 몫이다.
 *
 * 1. **순서를 안다.** 리더 → 빌더 → (워크로드) 파서 → 매퍼. 여기 말고 그 순서를 아는 곳이
 *    없어야 한다 — 라우트가 넷을 차례로 부르는 순간 계산이 라우트로 샌다.
 * 2. **어떤 결말도 값이다.** 예외를 위로 던지지 않는다 (`parse-runner`와 같은 규율).
 * 3. **과제 0건은 중단이다.** 「알려진 탭이 하나도 없음」과 같은 강도다 (`X2`) — 빈 배정표를
 *    내려보내면 사람은 그게 빈 문서인지 파서 고장인지 알 수 없다.
 *
 * **하지 않는 것**
 * - 파일 크기·ZIP 엔트리를 재지 않는다. 문 앞의 판정은 `upload-guard`가 이미 한다.
 *   두 곳에서 재면 한도가 두 벌이 된다.
 * - 저장소를 부르지 않는다. `/extract`는 아무것도 저장하지 않는다 (`ADR-022`).
 * - 경고를 늘리지 않는다. 빌더의 것을 그대로 올린다.
 * - 시간을 읽지 않는다. `baseYear`도 `timeoutMs`도 주입받는다 (CLAUDE.md CRITICAL).
 * - `exceljs`를 import하지 않는다 (ADR-003). 쓰기는 `xlsx/assignment-writer`다.
 */

import { buildAssignmentRows } from '@/lib/doc/assignment-mapper';
import { readDocxOutline } from '@/lib/doc/docx-reader';
import { buildOutline } from '@/lib/doc/outline-builder';
import { parseWorkloadPriorities } from '@/lib/doc/workload-parser';
import { PARSE_TIMEOUT_MS } from '@/lib/upload/upload-limits';
import type { AssignmentRow, OutlineNode } from '@/types/doc';

/** 셋 다 「중단」 강도다 (ARCHITECTURE.md 실패 강도 표). 부분 결과를 내려보내지 않는다 */
export type DocFailureCode = 'DOCUMENT_CORRUPT' | 'NO_OUTLINE_TASK' | 'PARSE_TIMEOUT';

export interface DocExtractResult {
  rows: AssignmentRow[];
  /** `outline-builder`의 경고 코드 그대로. 원문·사람 이름을 담지 않는다 */
  warnings: string[];
}

export type DocExtractOutcome =
  | { ok: true; result: DocExtractResult }
  | { ok: false; code: DocFailureCode; message: string };

/**
 * 사용자에게 보여줄 한국어 문장이다. **예외 메시지를 이어 붙이지 않는다** — 스택·내부 경로가
 * 그대로 새어 나간다 (`X1`). step 8의 `api-error.ts`는 이 문장을 **그대로** 옮겨 적는다.
 *
 * `PARSE_TIMEOUT`은 시트 쪽(`parse-runner.ts`)과 **코드가 같고 앞 문장도 같지만 뒤의 안내가
 * 다르다.** 그쪽은 「탭을 나눠 올려 주세요」인데 `.docx`에는 탭이 없어서, 그대로 옮기면 같은
 * 문장이 아니라 **틀린 안내**가 된다. 사실을 말하는 앞 절은 글자까지 같게 두고 할 일을
 * 말하는 뒷 절만 갈랐다.
 *
 * `DOCUMENT_CORRUPT`가 `WORKBOOK_CORRUPT`와 같은 문장이 아닌 이유가 곧 이 코드가 따로
 * 있는 이유다 — 「워크북」은 `.docx`를 올린 사람에게 아무것도 알려주지 못한다
 * (ARCHITECTURE.md「에러 처리」).
 */
const MESSAGES: Record<DocFailureCode, string> = {
  DOCUMENT_CORRUPT: '문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.',
  NO_OUTLINE_TASK:
    '문서에서 과제를 찾지 못했습니다. 과제 제목에 1-1 형태의 번호가 있는지 확인해 주세요.',
  PARSE_TIMEOUT: '파일을 읽는 데 너무 오래 걸려 중단했습니다. 문서를 나눠 올려 주세요.',
};

const fail = (code: DocFailureCode): DocExtractOutcome => ({
  ok: false,
  code,
  message: MESSAGES[code],
});

/**
 * 아웃라인 → 배정표 행. **마크다운 경로도 여기로 들어온다** — 테스트·픽스처 전용이며
 * 라우트에서 부르지 않는다 (`ADR-010`).
 *
 * 「바이트 → 노드」를 여기 두지 않은 것이 요점이다. 섞으면 마크다운 픽스처 하나 돌리는 데
 * mammoth가 딸려 오고, 「리더 아래는 입력 형식을 모른다」는 T7 완료 기준 2가 흐려진다.
 *
 * 빌더와 워크로드 파서는 **같은 노드 배열**을 본다. 파서가 빌더의 결과를 받지 않는 이유는
 * 그쪽이 과제가 아니라 「워크로드 공유」 절을 읽기 때문이다 — 절 범위 규칙은 두 파일이
 * `sectionBody` 하나로 공유한다.
 */
export function extractFromOutline(
  nodes: readonly OutlineNode[],
  ctx: { baseYear: number }
): DocExtractResult {
  const { tasks, warnings } = buildOutline(nodes);
  const workload = parseWorkloadPriorities(nodes);

  return {
    rows: buildAssignmentRows(tasks, workload, { baseYear: ctx.baseYear }),
    warnings,
  };
}

/**
 * `.docx` 바이트 → 배정표 행. 타임아웃과 실패 접기만 여기서 하고 계산은 위 함수가 한다.
 *
 * 타임아웃은 **「중단」이 아니라 「포기」**다 — Node 단일 스레드에서 진행 중인 파싱을 중간에
 * 끊을 수 없으므로 응답을 끊고 결과를 쓰지 않는다. `parse-runner.ts`와 같은 모양이고
 * 기본값도 같은 상수(`PARSE_TIMEOUT_MS`)를 쓴다. 이 경로에만 다른 숫자를 두면 같은 사고에
 * 두 개의 한계가 생긴다.
 */
export function runDocExtract(
  input: Buffer | Uint8Array,
  ctx: { baseYear: number; timeoutMs?: number }
): Promise<DocExtractOutcome> {
  return new Promise<DocExtractOutcome>((resolve) => {
    let settled = false;

    // 타임아웃 뒤에 파싱이 늦게 끝나도 그 결과를 쓰지 않는다. 어느 갈래로 끝나든 타이머를
    // 정리한다 — 안 하면 서버리스 함수가 남은 타임아웃만큼 더 산다.
    const settle = (outcome: DocExtractOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => settle(fail('PARSE_TIMEOUT')), ctx.timeoutMs ?? PARSE_TIMEOUT_MS);

    readDocxOutline(input).then(
      (nodes) => {
        // 아래 세 계층은 던지지 않기로 계약돼 있다. 그래도 감싸는 것은 그 계약이 깨진 날
        // 예외가 라우트로 새지 않게 하려는 것이다 — 이 함수의 계약이 「모든 결말이 값」이다.
        let result: DocExtractResult;
        try {
          result = extractFromOutline(nodes, { baseYear: ctx.baseYear });
        } catch {
          settle(fail('DOCUMENT_CORRUPT'));
          return;
        }

        settle(result.rows.length === 0 ? fail('NO_OUTLINE_TASK') : { ok: true, result });
      },
      // 리더가 던지는 것은 파일이 `.docx`가 아니거나 손상된 경우다 (`docx-reader` 머리말).
      () => settle(fail('DOCUMENT_CORRUPT'))
    );
  });
}
