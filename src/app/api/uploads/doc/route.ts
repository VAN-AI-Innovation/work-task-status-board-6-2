/** mammoth가 Node 내장 모듈을 쓴다 (`ARCHITECTURE.md`) */
export const runtime = 'nodejs';

import { errorResponse } from '@/lib/api/api-error';
import { runDocExtract } from '@/lib/doc/doc-pipeline';
import { kstToday } from '@/lib/domain/kst-today';
import { checkUpload } from '@/lib/upload/upload-guard';

/**
 * `.docx` → 배정표 행 미리보기. **저장소를 부르지 않는다** (`ADR-022`·결정 C).
 *
 * `uploads` 행을 만들지 않는 이유는 스코프만이 아니다. 그 행의 `parse_result`에 문서 본문이
 * 통째로 남는데 워크로드 문서에는 사람 이름이 들어 있고(`S6`), 시트 업로드와 달리 여기에는
 * **확정이 없어서 비울 시점도 없다.**
 *
 * 이 파일에 계산이 없다. 하는 일은 넷뿐이다 — 바이트를 꺼내고, 문지기에게 묻고, 연도를 만들고,
 * `lib/`을 부른다. 조건 분기는 전부 「검증 실패 → 에러 응답」이다.
 */

/** 연도 추론의 상·하한. 밖의 값은 사용자가 잘못 넣은 것이라 보고 **거부가 아니라 무시**한다 */
const MIN_BASE_YEAR = 1900;
const MAX_BASE_YEAR = 2200;

/**
 * 연도를 **요청 경계에서** 만든다. 시계를 읽는 것은 라우트의 일이고 그 아래 계층은 전부
 * 주입받는다 (`CLAUDE.md` CRITICAL의 대상은 도메인 함수다).
 *
 * 폼 값이 범위 밖이면 400이 아니라 오늘 연도로 **되돌린다.** 연도는 마감 추론의 보조 입력일
 * 뿐이고, 틀렸다고 문서 전체를 거부하면 `deadlineRaw`까지 잃는다 — 값을 버리는 것이 가장
 * 나쁜 실패다(`assignment-mapper` 머리말).
 */
function resolveBaseYear(raw: FormDataEntryValue | null, now: Date): number {
  const today = Number(kstToday(now).slice(0, 4));
  if (typeof raw !== 'string') return today;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_BASE_YEAR || parsed > MAX_BASE_YEAR) return today;

  return parsed;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return errorResponse('VALIDATION_FAILED');

    // 뷰 하나로 둘을 쓴다 — 문지기는 바이트를 훑고(`Uint8Array`), 리더는 버퍼를 받는다. 복사 없음
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 크기·종류·압축 폭탄 판정은 **이미 있는 것을 쓴다.** 여기서 새로 검사하면 한도가 두 벌이 된다
    const checked = checkUpload({ filename: file.name, bytes, expect: 'doc' });
    if (!checked.ok) return errorResponse(checked.code, checked.message);

    // 한 번만 읽는다. 두 번 부르면 자정을 사이에 둔 요청이 파싱과 응답에서 다른 해를 쓴다
    const baseYear = resolveBaseYear(form.get('baseYear'), new Date());

    const extracted = await runDocExtract(bytes, { baseYear });
    if (!extracted.ok) return errorResponse(extracted.code, extracted.message);

    // 파일명을 되돌려주지 않는다 — 사용자가 준 문자열이라 그 자체가 반사형 노출 경로다.
    // `baseYear`는 싣는다: 마감이 무엇을 기준으로 붙었는지 화면이 밝혀야 한다.
    return Response.json({
      rows: extracted.result.rows,
      warnings: extracted.result.warnings,
      baseYear,
    });
  } catch {
    // 예상 못 한 예외를 여기서 접는다. **메시지를 응답에 넣지 않는다** (`X1`)
    return errorResponse('VALIDATION_FAILED');
  }
}
