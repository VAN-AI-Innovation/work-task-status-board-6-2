/**
 * 라우트 9개가 공유하는 **에러 계약** (`X1`).
 *
 * 코드 목록은 `docs/ARCHITECTURE.md`「에러 처리」의 확정본이며 **여기서 늘리지 않는다** —
 * 필요하면 문서를 먼저 고친다. 이 파일이 새로 지는 판단은 하나뿐이다: **어느 코드가 몇 번으로
 * 나가는가.** 문서에는 코드만 있고 HTTP 상태 대응이 없어서 라우트마다 갈라질 자리였다.
 *
 * `message`는 **사용자에게 보여줄 한국어 한 문장**이고 스택·내부 경로·셀 값을 담지 않는다
 * (CLAUDE.md 보안 규칙). 그래서 넘어온 문장도 검사한다 — 규칙을 사람의 주의력에 맡기면
 * 언젠가 `catch (e) { errorResponse(code, e.message) }`가 스택을 화면에 띄운다.
 */

/** 순서는 `ARCHITECTURE.md`의 코드 블록 그대로다. 대조할 때 눈으로 짚을 수 있게 둔다 */
export const API_ERROR_CODES = [
  'FILE_TOO_LARGE',
  'FILE_TYPE_MISMATCH',
  'ARCHIVE_LIMIT_EXCEEDED',
  'PARSE_TIMEOUT',
  'WORKBOOK_CORRUPT',
  'NO_KNOWN_TAB',
  'SETTINGS_TAB_MISSING',
  'DOCUMENT_CORRUPT',
  'NO_OUTLINE_TASK',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_ALREADY_COMMITTED',
  'TASK_NOT_FOUND',
  'STORAGE_READONLY',
  'STORAGE_UNAVAILABLE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * 상태 코드 대응. 몇 개는 왜 그 번호인지가 안 자명하므로 근거를 남긴다.
 *
 * - `ARCHIVE_LIMIT_EXCEEDED`가 413인 이유: 압축 폭탄도 사용자 입장에서는 "너무 큰 파일"이고,
 *   할 일이 `FILE_TOO_LARGE`와 같다(줄여서 다시 올린다). 400으로 두면 "형식이 틀렸나"로 읽힌다.
 * - `WORKBOOK_CORRUPT`·`NO_KNOWN_TAB`이 422인 이유: 415(형식 불일치)는 이미 통과한 상태다.
 *   xlsx인 것은 맞는데 **내용이 처리 불가**라는 구분을 뭉개지 않는다.
 * - `DOCUMENT_CORRUPT`·`NO_OUTLINE_TASK`가 422인 이유: 위와 같다. 415(형식 불일치)는 이미
 *   통과한 상태다 — `.docx`인 것은 맞는데 **내용이 처리 불가**다. 「과제 0건」이 200이 아닌
 *   이유는 `NO_KNOWN_TAB`이 그런 것과 같다: 빈 배정표를 성공으로 내려보내면 받는 사람은
 *   그게 빈 문서인지 파서 고장인지 알 수 없다.
 * - `PARSE_TIMEOUT`이 504인 이유: 5xx여야 클라이언트가 재시도 가능한 실패로 읽는다.
 *   입력이 잘못된 게 아니라 우리가 시간 안에 못 끝냈다.
 * - `TASK_NOT_FOUND`가 404인 이유: `UPLOAD_NOT_FOUND`와 같은 「없는 것을 가리켰다」이지만
 *   **코드를 따로 둔다.** 업로드가 없는 것과 업무가 없는 것은 사용자가 할 일이 다르고
 *   (파일을 다시 올린다 / 링크가 낡았다), `VALIDATION_FAILED`로 뭉개면 「id 형식이 틀렸다」와
 *   구분되지 않는다. 코드를 늘렸으므로 `ARCHITECTURE.md`·`PLAN.md` `X1` 목록도 함께 고쳤다.
 * - `UNAUTHENTICATED`가 401이고 `FORBIDDEN`이 403인 이유: **둘을 뭉개지 않는다** (T8,
 *   `PLAN.md`「T8 착수 시 확정」 결정 F). 「로그인하세요」와 「당신은 이걸 못 합니다」는
 *   사용자가 할 일이 정반대다. 이 코드는 **라우트가 명시적으로 낸다** — `toApiErrorCode`가
 *   추측으로 세우면 저장소 오류가 로그인 화면으로 사람을 보낸다.
 * - `SETTINGS_TAB_MISSING`이 200인 이유: **이것만 에러가 아니다.** 설정 탭이 없으면
 *   내장 폴백 레지스트리로 파싱을 계속하므로 경고로 실려 200으로 나간다. 표에 남겨 두는 것은
 *   `ARCHITECTURE.md`의 코드 목록과 개수를 맞추기 위해서고, **`errorResponse`에 넘기지 않는다**
 *   (넘기면 200 응답에 `error` 본문이 실려 클라이언트가 성공을 실패로 읽는다).
 */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  UPLOAD_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  UPLOAD_ALREADY_COMMITTED: 409,
  FILE_TOO_LARGE: 413,
  ARCHIVE_LIMIT_EXCEEDED: 413,
  FILE_TYPE_MISMATCH: 415,
  WORKBOOK_CORRUPT: 422,
  NO_KNOWN_TAB: 422,
  DOCUMENT_CORRUPT: 422,
  NO_OUTLINE_TASK: 422,
  SETTINGS_TAB_MISSING: 200,
  STORAGE_READONLY: 503,
  STORAGE_UNAVAILABLE: 503,
  PARSE_TIMEOUT: 504,
};

/**
 * 기본 문장. 겹치는 코드는 `parse-runner.ts`·`upload-commit.ts`의 문장을 **그대로** 옮겼다 —
 * 같은 코드에 두 문장이 생기면 사용자가 같은 실패를 두 가지로 읽는다. 그 계층들은 자기
 * `message`를 이미 들고 오므로 라우트는 그것을 넘기고, 여기 문장은 **없을 때의 대체값**이다.
 */
export const API_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>> = {
  FILE_TOO_LARGE: '파일이 너무 큽니다. 4MB 이하로 줄여 다시 올려 주세요.',
  FILE_TYPE_MISMATCH: '이 화면이 받는 형식이 아닙니다. 파일 종류를 확인해 주세요.',
  ARCHIVE_LIMIT_EXCEEDED: '파일이 처리 한도를 넘습니다. 시트나 행·열을 줄여 다시 올려 주세요.',
  PARSE_TIMEOUT: '파일을 읽는 데 너무 오래 걸려 중단했습니다. 탭을 나눠 올려 주세요.',
  WORKBOOK_CORRUPT: '워크북을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.',
  NO_KNOWN_TAB: '알아볼 수 있는 팀 탭이 없습니다. 기존 데이터를 지우지 않고 중단했습니다.',
  SETTINGS_TAB_MISSING: '설정 탭을 찾지 못해 기본 항목으로 해석했습니다.',
  // 아래 둘은 `doc/doc-pipeline.ts`의 문장을 **그대로** 옮긴 것이다. 그쪽이 자기 문장을 들고
  // 오므로 여기 값은 대체값이지만, 글자가 갈리면 같은 실패가 두 문장으로 보인다.
  DOCUMENT_CORRUPT: '문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.',
  NO_OUTLINE_TASK:
    '문서에서 과제를 찾지 못했습니다. 과제 제목에 1-1 형태의 번호가 있는지 확인해 주세요.',
  UPLOAD_NOT_FOUND: '해당 업로드를 찾을 수 없습니다. 파일을 다시 올려 주세요.',
  UPLOAD_ALREADY_COMMITTED: '이미 확정된 업로드입니다.',
  TASK_NOT_FOUND: '해당 업무를 찾을 수 없습니다. 링크가 낡았을 수 있습니다.',
  STORAGE_READONLY: '읽기 전용 모드입니다. 저장소 연결이 복구되어야 저장할 수 있습니다.',
  STORAGE_UNAVAILABLE: '저장소에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
  FORBIDDEN: '이 작업을 수행할 권한이 없습니다.',
  VALIDATION_FAILED: '요청 값이 올바르지 않습니다.',
};

/**
 * 스택·내부 경로가 새는 흔한 모양들. 하나라도 걸리면 문장을 신뢰하지 않는다.
 * 화이트리스트가 아니라 블랙리스트인 이유: 정상 문장의 모양을 미리 다 적을 수는 없다.
 */
const LEAK_PATTERNS = [/\r|\n/, /\bat\s/, /\/src\//, /Error:/] as const;

function isSafeMessage(message: string): boolean {
  return !LEAK_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * `{ error: { code, message } }` 본문 + 표의 상태 코드.
 *
 * `NextResponse`를 쓰지 않는 이유: 이 함수는 라우트 밖(테스트·유닛)에서도 불리는데
 * `next/server`를 끌고 오면 그 경계가 흐려진다. 웹 표준 `Response`로 충분하다.
 */
export function errorResponse(code: ApiErrorCode, message?: string): Response {
  const trimmed = message?.trim() ?? '';
  const safe = trimmed.length > 0 && isSafeMessage(trimmed) ? trimmed : API_ERROR_MESSAGES[code];

  return Response.json({ error: { code, message: safe } }, { status: API_ERROR_STATUS[code] });
}

/**
 * 조회 라우트 6종이 `catch`에서 부르는 판별기.
 *
 * **라우트마다 손으로 쓰지 않는다.** 여섯 곳에 같은 `instanceof` 분기를 복사하면 그중 하나가
 * 언젠가 다르게 고쳐지고, 같은 실패가 라우트마다 다른 코드로 나간다.
 *
 * 판별을 `instanceof`가 아니라 **모양**으로 하는 이유는 이 프로젝트가 이미 택한 방식이다
 * (`parse-runner.ts`·`upload-commit.ts`가 `code` 속성으로 가른다) — 모듈이 두 벌 로드되면
 * `instanceof`가 조용히 거짓이 되고, 그때 사용자는 400 대신 503을 본다.
 *
 * ⚠ 알려진 경계: 라우트의 `try` 안에는 zod가 두 번 돈다 — 쿼리 파싱과 응답 직렬화
 * (`task-response.ts`의 `.strict()`). 후자가 던지면 그것은 **우리 버그**인데 여기서는
 * `VALIDATION_FAILED`(400)로 나간다. 둘을 타입으로 가를 방법이 없어 감수하며, `.strict()`가
 * 실제로 무엇을 막는지는 `task-response.test.ts`가 단위로 지킨다.
 */
export function toApiErrorCode(error: unknown): ApiErrorCode {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'ZodError' ? 'VALIDATION_FAILED' : 'STORAGE_UNAVAILABLE';
}
