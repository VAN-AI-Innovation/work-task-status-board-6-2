/**
 * 권한 상승·열거·CSRF 방어를 **파일 내용으로** 확인한다 (T11 step 9).
 *
 * `env-guard.ts`와 나란히 서되 **합치지 않는다.** 저쪽은 `prebuild`가 부르는 별개의
 * 게이트이고 지키는 규칙이 하나(`NEXT_PUBLIC_` + `service_role`)뿐이다. 규칙을 섞으면
 * 하나가 실패했을 때 무엇이 깨졌는지 메시지에서 흐려지고, 배포를 막는 가드와 감사
 * 테스트가 같은 실패로 보인다.
 *
 * 이 모듈은 **탐지만** 한다 — 파일 I/O는 호출자가 하고, 인자로 받은 내용만 보고 판단한다
 * (`env-guard.ts`와 같은 규율). 그래서 순수 함수이고 `src/lib/`에 있다.
 *
 * ## 여섯 규칙
 *
 * | 규칙 | 무엇을 지키나 |
 * |---|---|
 * | `service-role-in-auth-route` | 인증·팀·멤버 라우트는 사용자 JWT로만 나간다 (`ADR-024`) |
 * | `post-without-origin-check` | 상태를 바꾸는 `POST`는 출처를 본다 (CSRF) |
 * | `console-in-auth-route` | 인증 라우트는 아무것도 로그에 남기지 않는다 (`S6`) |
 * | `metadata-privilege-read` | 권한을 `user_metadata`에서 읽지 않는다 (권한 상승 경로) |
 * | `get-session-in-viewer-session` | 세션 해석은 서명을 검증하는 `getUser()`로 한다 |
 * | `pwned-prefix-too-long` | 유출 대조에 나가는 것은 해시 접두사 5글자뿐이다 |
 *
 * ## 아직 덮지 않는 자리 — 적어 두지 않으면 덮은 줄 안다
 *
 * 규칙 2의 범위는 **인증·팀·멤버 라우트 셋**이다. `POST /api/uploads/*`·
 * `POST /api/export/assignment`는 상태를 바꾸거나 파일을 내보내지만 여기서 보지 않는다 —
 * T11이 넓히기로 한 목록(`login`·`logout`·`signup`·`rejoin`·승인·거절·승격) 밖이고,
 * 그 라우트들에 출처 검사를 붙이는 것은 이 감사가 아니라 별도의 변경이다.
 * **범위를 넓히려면 라우트를 먼저 고치고 이 상수를 고친다** — 반대로 하면 규칙이 빨개진
 * 채로 남는다.
 */

export type SecurityRuleId =
  | 'service-role-in-auth-route'
  | 'post-without-origin-check'
  | 'console-in-auth-route'
  | 'metadata-privilege-read'
  | 'get-session-in-viewer-session'
  | 'pwned-prefix-too-long';

export interface SecurityViolation {
  /** 저장소 루트 기준 상대 경로 */
  file: string;
  /** 1부터 시작하는 줄 번호. `0`은 파일 전체를 가리킨다 */
  line: number;
  rule: SecurityRuleId;
  /** 무엇이 걸렸는지. **값을 담지 않는다** — 담으면 가드가 비밀을 로그로 흘린다 */
  detail: string;
}

export interface ScanFile {
  path: string;
  content: string;
}

/** 규칙 1·2가 보는 자리. 넓히려면 라우트를 먼저 고친다 (머리말) */
const GUARDED_ROUTE_DIRS = [
  'src/app/api/auth/',
  'src/app/api/team/',
  'src/app/api/members/',
  /*
   * 보고 제출·검토도 같은 성질이다 — `submit_report`·`review_report`의 자격 검사가
   * `auth.uid()`에 기대므로 **사용자 JWT로만** 나가야 한다 (`ADR-024`).
   *
   * `src/app/api/report/`가 아니라 두 자리를 따로 적는다. 같은 부모 아래 `weekly/`가
   * 있는데 그쪽은 `currentViewerContext()`로 저장소 성질(`meta`)까지 읽는 조회 라우트라
   * 규칙의 대상이 아니다 — 넓게 적었다가 그 파일이 걸리면 규칙을 느슨하게 고치게 된다.
   */
  'src/app/api/report/submit/',
  'src/app/api/report/review/',
] as const;

/** 규칙 3이 보는 자리. 인증 라우트에는 자격증명이 지나간다 */
const AUTH_ROUTE_DIR = 'src/app/api/auth/';

const MIGRATION_DIR = 'supabase/migrations/';
const SESSION_FILE = 'src/lib/auth/viewer-session.ts';
const PWNED_FILE = 'src/lib/auth/pwned-password.ts';

/** k-익명성의 k를 정하는 값. 늘리면 「이 사람이 무엇을 쓰는지」가 좁혀진다 */
const MAX_HASH_PREFIX = 5;

const SERVICE_ROLE = /SERVICE_ROLE|\bgetStorage\s*\(/;
const EXPORTS_POST = /export\s+(?:async\s+)?function\s+POST\b|export\s+const\s+POST\b/;
const CALLS_ORIGIN_CHECK = /\b(?:request)?[Ii]sSameOrigin\s*\(/;
const CONSOLE_CALL = /\bconsole\s*\.\s*(?:log|error|warn)\s*\(/;
const METADATA_PRIVILEGE = /raw_user_meta_data\s*->>\s*'(?:role|status)'/;
const GET_SESSION = /\bgetSession\b/;

/** 문자열 안에서 `range/` 바로 뒤에 실제 글자가 붙은 경우. `${…}` 보간은 여기 걸리지 않는다 */
const RANGE_LITERAL = /range\/([A-Za-z0-9]+)/;
const NUMERIC_CONST = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(\d+)\s*;/g;
const SLICE_FROM_ZERO = /\.slice\s*\(\s*0\s*,\s*([A-Za-z0-9_$]+)\s*\)/g;

function isTestFile(filePath: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(filePath);
}

function under(filePath: string, dir: string): boolean {
  return filePath.startsWith(dir);
}

function scanLines(
  file: ScanFile,
  pattern: RegExp,
  rule: SecurityRuleId,
  detail: string
): SecurityViolation[] {
  const found: SecurityViolation[] = [];

  file.content.split('\n').forEach((lineText, index) => {
    if (pattern.test(lineText)) found.push({ file: file.path, line: index + 1, rule, detail });
  });

  return found;
}

/**
 * 접두사 길이는 두 방향으로 샐 수 있다 — URL에 해시를 그대로 붙이거나, 잘라 내는 길이를
 * 늘리거나. 둘 다 본다. 상수를 거쳐 늘리는 것도 잡으려고 파일 안의 숫자 상수를 먼저 모은다.
 */
function checkHashPrefix(file: ScanFile): SecurityViolation[] {
  const found: SecurityViolation[] = [];
  const constants = new Map<string, number>();

  for (const match of file.content.matchAll(NUMERIC_CONST)) {
    constants.set(match[1], Number(match[2]));
  }

  file.content.split('\n').forEach((lineText, index) => {
    const line = index + 1;

    const literal = RANGE_LITERAL.exec(lineText);
    if (literal && literal[1].length > 0) {
      found.push({
        file: file.path,
        line,
        rule: 'pwned-prefix-too-long',
        // 걸린 값이 해시 조각이므로 길이만 남긴다
        detail: `range/ 뒤에 리터럴 ${literal[1].length}글자가 붙었다`,
      });
    }

    for (const slice of lineText.matchAll(SLICE_FROM_ZERO)) {
      const raw = slice[1];
      const length = /^\d+$/.test(raw) ? Number(raw) : constants.get(raw);
      if (length !== undefined && length > MAX_HASH_PREFIX) {
        found.push({
          file: file.path,
          line,
          rule: 'pwned-prefix-too-long',
          detail: `접두사 ${length}글자 — 상한은 ${MAX_HASH_PREFIX}이다`,
        });
      }
    }
  });

  return found;
}

export function findAuthRouteViolations(files: readonly ScanFile[]): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  for (const file of files) {
    // 테스트 파일은 보지 않는다. 픽스처가 금지 문자열을 들고 있어야 규칙을 잴 수 있다
    if (isTestFile(file.path)) continue;

    const guarded = GUARDED_ROUTE_DIRS.some((dir) => under(file.path, dir));

    if (guarded) {
      violations.push(
        ...scanLines(
          file,
          SERVICE_ROLE,
          'service-role-in-auth-route',
          'service_role 경로가 인증·팀·멤버 라우트에 닿는다'
        )
      );

      if (
        file.path.endsWith('/route.ts') &&
        EXPORTS_POST.test(file.content) &&
        !CALLS_ORIGIN_CHECK.test(file.content)
      ) {
        violations.push({
          file: file.path,
          line: 0,
          rule: 'post-without-origin-check',
          detail: 'POST를 내보내면서 isSameOrigin을 부르지 않는다',
        });
      }
    }

    if (under(file.path, AUTH_ROUTE_DIR)) {
      violations.push(
        ...scanLines(file, CONSOLE_CALL, 'console-in-auth-route', '인증 라우트에 로그가 있다')
      );
    }

    if (under(file.path, MIGRATION_DIR)) {
      violations.push(
        ...scanLines(
          file,
          METADATA_PRIVILEGE,
          'metadata-privilege-read',
          '권한을 user_metadata에서 읽는다'
        )
      );
    }

    if (file.path === SESSION_FILE) {
      violations.push(
        ...scanLines(
          file,
          GET_SESSION,
          'get-session-in-viewer-session',
          'getSession은 쿠키를 검증 없이 믿는다 — getUser를 쓴다'
        )
      );
    }

    if (file.path === PWNED_FILE) violations.push(...checkHashPrefix(file));
  }

  return violations;
}
