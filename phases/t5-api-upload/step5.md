# Step 5: api-error + viewer-role + extras-visibility

## 읽어야 할 파일

- `CLAUDE.md` — 보안·데이터 규칙(**민감 키는 admin·lead에게만**), 아키텍처 규칙, TDD,
  파일명 전역 유니크
- `docs/TICKETS.md` — `## T5` 완료 기준 **9·10·12**
- `docs/PLAN.md` — 「보안」 `S4`(`?as=`가 프로덕션에 나가면 인증 우회)·`S6`(민감 키),
  「에러 핸들링」 **`X1`(에러 코드 체계)**
- `docs/ADR.md` — **`ADR-013`**(`?as=`는 메모리 드라이버에서만), `ADR-007`(서버 컴포넌트 직접 호출)
- `docs/ARCHITECTURE.md` — 「에러 처리」의 코드 목록과 「권한 (T8)」
- T4 산출물: `src/lib/store/store-factory.ts`(`StorageMode`·`StorageReadOnlyError`)
- step 0·1·4 산출물의 에러 코드: `UploadRejectCode`·`ParseFailureCode`·`CommitFailureCode`

## 배경

라우트 핸들러 9개가 곧 만들어진다. 그 전에 **모든 라우트가 공유할 세 가지**를 못박는다.
여기서 안 정하면 라우트마다 상태 코드가 달라지고, 마스킹을 한 곳에서 빠뜨리고,
`?as=`가 라우트마다 다르게 해석된다.

- **에러** — `X1`의 코드 목록은 있는데 **HTTP 상태 코드 대응이 없다.** 여기서 확정한다.
- **역할** — 인증은 T8이다. 그때까지 역할은 `?as=`로만 온다(`ADR-013`). **기본값을 정해야 한다.**
- **마스킹** — `extras` 안에 출연자 연락처와 문의자 SNS 계정이 있다 (`S6`). 이걸 거르는 함수는
  `lib/domain/`에 하나만 있어야 한다.

## 확정 — 여기서 못박는다

### 상태 코드 대응

| 코드 | HTTP | 비고 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | zod 검증 실패, 빈 파일 |
| `FORBIDDEN` | 403 | T8에서 쓴다. 지금은 상수만 둔다 |
| `UPLOAD_NOT_FOUND` | 404 | |
| `UPLOAD_ALREADY_COMMITTED` | 409 | 버튼 두 번 클릭 |
| `FILE_TOO_LARGE` | 413 | |
| `ARCHIVE_LIMIT_EXCEEDED` | 413 | 압축 폭탄도 "너무 큼"이다 |
| `FILE_TYPE_MISMATCH` | 415 | |
| `WORKBOOK_CORRUPT` | 422 | 형식은 맞는데 내용이 처리 불가 |
| `NO_KNOWN_TAB` | 422 | |
| `SETTINGS_TAB_MISSING` | — | **에러가 아니라 경고다.** 200으로 나가고 `warnings`에 실린다 |
| `STORAGE_READONLY` | 503 | `ADR-005` |
| `STORAGE_UNAVAILABLE` | 503 | |
| `PARSE_TIMEOUT` | 504 | |

### 기본 역할은 `member`다

`?as=`가 없으면 **가장 좁은 권한**으로 본다. 근거 둘:

1. 인증이 붙기 전(T8 이전)에 기본값이 넓으면 **연락처가 아무에게나 기본 노출된다.**
   `S6`는 그것을 막으라고 적혀 있다.
2. T8에서 실제 인증이 붙을 때 기본값을 좁히면 화면이 통째로 바뀐다. 처음부터 좁게 두면
   바뀌는 것은 "누가 admin인가"뿐이다.

넓히려면 `?as=admin`을 명시한다. `ADR-013`대로
**`NODE_ENV === 'production' && mode !== 'demo'`면 `?as=`를 무시**한다.

## 작업

### 1. `src/lib/api/api-error.ts` — 테스트를 **먼저** 쓴다

`src/lib/api/` 디렉토리를 새로 만든다.

```ts
export type ApiErrorCode =
  | 'FILE_TOO_LARGE' | 'FILE_TYPE_MISMATCH' | 'ARCHIVE_LIMIT_EXCEEDED' | 'PARSE_TIMEOUT'
  | 'WORKBOOK_CORRUPT' | 'NO_KNOWN_TAB' | 'SETTINGS_TAB_MISSING'
  | 'UPLOAD_NOT_FOUND' | 'UPLOAD_ALREADY_COMMITTED'
  | 'STORAGE_READONLY' | 'STORAGE_UNAVAILABLE' | 'FORBIDDEN' | 'VALIDATION_FAILED';

/** `ARCHITECTURE.md`「에러 처리」의 코드 목록과 **정확히 같아야 한다** */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>>;
export const API_ERROR_MESSAGES: Readonly<Record<ApiErrorCode, string>>;

/** `{ error: { code, message } }` 본문 + 위 표의 상태 코드 */
export function errorResponse(code: ApiErrorCode, message?: string): Response;
```

- `message`를 생략하면 `API_ERROR_MESSAGES`의 한국어 문장을 쓴다.
- **넘어온 `message`를 검사하라**: 개행·`at `·`/src/`·`Error:`가 들어 있으면 기본 문장으로
  갈아치운다. 스택이 실수로 흘러드는 경로를 코드로 막는다 (`X1`).
- `Response`는 `NextResponse.json`으로 만들어도 되고 `Response.json`이어도 된다.
  **테스트에서 `await res.json()`으로 본문을 읽을 수 있어야 한다.**

테스트: 모든 코드가 `API_ERROR_STATUS`·`API_ERROR_MESSAGES`에 **빠짐없이** 있는지
(`Object.keys` 개수 비교), 상태 코드가 위 표와 같은지, 스택이 든 메시지가 걸러지는지,
본문 모양이 `{ error: { code, message } }`인지.

### 2. `src/lib/domain/extras-visibility.ts` — 테스트를 **먼저** 쓴다

**`lib/domain/`에 둔다** — `PLAN.md` `S6`가 "키 이름 패턴 기반 마스킹 목록을 `lib/domain/`에
둔다"라고 못박았다.

```ts
export type ViewerRole = 'admin' | 'lead' | 'member';

/** 부분 일치로 본다. 시트 헤더가 `출연자 연락처`·`문의자 계정`처럼 접두어를 달고 온다 */
export const SENSITIVE_EXTRA_KEYS: readonly string[] = ['연락처', '계정', '이메일', '전화'];

export function isSensitiveExtraKey(key: string): boolean;

/** `member`에게는 민감 키의 **값을 지운다.** 키는 남긴다 */
export function maskExtras(
  extras: Record<string, ExtraValue>,
  role: ViewerRole
): Record<string, ExtraValue>;
```

- `admin`·`lead`는 원본 그대로. `member`는 값을 `null`로 바꾼다.
  **키까지 지우지 마라** — 사이드 패널에서 "연락처: (비공개)"로 보이는 편이
  필드가 사라지는 것보다 낫고, 무엇이 가려졌는지 사용자가 안다.
- 입력 객체를 **고치지 마라.** 새 객체를 만든다.
- 키 비교는 소문자화 + `includes`. 영문 헤더(`email`·`phone`·`contact`)도 잡도록
  목록에 넣어라 — 근거를 주석에 남긴다.

테스트: 세 역할 × 민감/일반 키, 입력 객체 불변, 빈 객체, 키에 공백·대문자가 섞인 경우,
`계정번호`처럼 접미어가 붙은 키도 걸리는지.

### 3. `src/lib/api/viewer-role.ts` — 테스트를 **먼저** 쓴다

```ts
export function resolveViewerRole(
  /** `?as=`의 값. 없으면 null */
  asParam: string | null,
  env: { nodeEnv: string | undefined; mode: StorageMode }
): ViewerRole;
```

- `nodeEnv === 'production' && mode !== 'demo'` → **`asParam`을 무시하고 `member`** (`S4`·`ADR-013`).
- 그 밖에는 `asParam`이 `'admin'|'lead'|'member'`면 그 값, 아니면 `'member'`.
- **`process.env`를 직접 읽지 마라.** 인자로 받아야 테스트가 프로덕션 갈래를 재현한다
  (`store-factory.ts`가 같은 이유로 `env`를 인자로 받는다).

테스트: 다섯 갈래(없음 / `admin` / 이상한 값 / production+live에서 `admin` / production+demo에서
`admin`). **production+live에서 `?as=admin`이 무시되는 케이스가 이 파일의 존재 이유다.**

## Acceptance Criteria

```bash
npx vitest run src/lib/api src/lib/domain/extras-visibility.test.ts

# 코드 목록이 ARCHITECTURE.md와 같은지 눈으로 대조한 뒤, 코드 쪽에 13개가 다 있는지 센다
grep -c "'" src/lib/api/api-error.ts

# 역할 해석이 환경을 직접 읽지 않는다 (출력이 비어야 함)
grep -n "process.env" src/lib/api/viewer-role.ts ; test $? -eq 1

# 마스킹이 도메인에 있다 (출력이 있어야 함)
ls src/lib/domain/extras-visibility.ts

# 마스킹이 저장소·라우트로 새지 않았다 (출력이 비어야 함)
grep -rn "SENSITIVE_EXTRA_KEYS" src/lib/store/ ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **`docs/ARCHITECTURE.md`「에러 처리」의 코드 13개와 `ApiErrorCode`를 한 줄씩 대조하라.**
   하나라도 빠지거나 남으면 고친다. 코드를 새로 만들지는 마라 — 목록은 이미 확정본이다.
3. 체크리스트:
   - 프로덕션 + Supabase에서 `?as=admin`이 무시되는가? (`S4` — 남아 있으면 인증 우회다)
   - 기본 역할이 `member`인가?
   - `maskExtras`가 입력을 고치지 않는가?
   - 스택이 든 메시지가 걸러지는가?
   - `src/lib/api/`·`src/lib/domain/`의 새 파일명이 `src/lib/` 전역에서 유니크한가?
4. `phases/t5-api-upload/index.json`의 step 5를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 상태 코드 대응표를 확정했다는 사실, 기본 역할을 `member`로 정한 근거,
   테스트 개수를 남겨라.

## 금지사항

- 에러 코드를 새로 만들지 마라. 이유: 목록은 `ARCHITECTURE.md`·`X1`의 확정본이다.
  필요하면 문서를 먼저 고친다.
- 기본 역할을 `admin`으로 두지 마라. 이유: 인증 없는 상태에서 연락처가 기본 노출된다 (`S6`).
- `?as=`를 프로덕션+Supabase에서 살려 두지 마라. 이유: URL만 치면 관리자가 되는 완전한
  인증 우회다 (`S4`, `ADR-013`).
- `viewer-role.ts`에서 `process.env`를 읽지 마라. 이유: 프로덕션 갈래를 테스트할 수 없게 된다.
- 마스킹을 저장소·파서 계층에 넣지 마라. 이유: 저장소에는 원본이 들어가야 감사·복원이 가능하다.
  거르는 곳은 응답 계층 하나다.
- 에러 응답에 스택·내부 경로·셀 값을 담지 마라. 이유: `X1`·`CLAUDE.md` 보안 규칙.
- 라우트 핸들러를 만들지 마라. 이유: step 7·8의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
