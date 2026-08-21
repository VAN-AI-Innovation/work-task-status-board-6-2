# Step 1: parse-runner

## 읽어야 할 파일

- `CLAUDE.md` — `exceljs` import는 두 파일에서만, TDD, 파일명 전역 유니크
- `docs/TICKETS.md` — `## T5` 완료 기준 **6**(시트 20개·셀 상한·타임아웃 8초, **부분 결과를 저장하지 않는다**)
- `docs/PLAN.md` — 「보안」 `S2`, 「에러 핸들링」 `X1`·`X2`
- `docs/ARCHITECTURE.md` — 「데이터 흐름 / 엑셀 → 조회」, 「에러 처리」의 실패 강도 3단계
- step 0 산출물: `src/lib/upload/upload-limits.ts`(`WORKBOOK_LIMITS`·`PARSE_TIMEOUT_MS`)
- `src/lib/sheet/workbook-reader.ts` **전체** — 특히 `readSheet`가 `dimensions`를 읽고
  셀 배열을 만드는 순서
- `src/lib/sheet/sheet-pipeline.ts` — `parseWorkbook(input, ctx)` 시그니처와 그 주석
  (「이 파이프라인이 하지 않는 판정 넷」)

## 배경

step 0은 **문 앞**에서 막았다. 이 step은 **문 안**에서 막는다.

`dimensions`는 워크북 XML 안의 속성이라 위조할 수 있다. `<dimension ref="A1:ZZ1000000"/>`은
바이트로 40자도 안 되는데, `readSheet`가 그 값을 믿고 셀 배열을 할당하면 **수 KB 파일 하나로
프로세스가 죽는다.** step 0의 50MB 해제 총량 상한은 실제 데이터의 부피를 막을 뿐 이 한 줄을 막지
못한다.

그래서 한도는 **셀 배열을 할당하기 전에**, 즉 `dimensions`를 본 그 자리에서 걸어야 한다.
그 자리가 `workbook-reader.ts`다 — 제품 코드에서 `exceljs`를 읽는 유일한 파일이라 그 앞에
끼워 넣을 계층이 없다.

다만 **정책(숫자)은 리더가 알면 안 된다.** 리더는 채록만 한다(파일 헤더 주석이 그렇게 못박고
있다). 숫자는 `upload-limits.ts`에 있고 리더는 **인자로 받은 숫자**를 지킬 뿐이다.

타임아웃에는 정직해야 한다. **Node 단일 스레드에서 진행 중인 동기 파싱을 중간에 끊을 수 없다.**
이 step의 타임아웃은 "중단"이 아니라 **"포기"**다 — 응답을 끊고, **아무것도 저장하지 않는다.**
저장하지 않는 것이 `S2`가 요구하는 실질이므로 이 구현으로 충분하다. 워커 스레드는 만들지 않는다.

## 작업

### 1. `src/lib/sheet/workbook-reader.ts`에 한도를 **주입**한다

**기존 테스트를 깨뜨리지 마라.** `limits`는 선택 인자이고, 없으면 지금과 완전히 같이 동작한다.

```ts
/** 한도 초과. 「중단」 강도다 (ARCHITECTURE.md 실패 강도 표) */
export class ArchiveLimitError extends Error {
  readonly code = 'ARCHIVE_LIMIT_EXCEEDED';
  constructor();
}

export async function readWorkbook(
  input: Buffer | ArrayBuffer,
  limits?: WorkbookLimits
): Promise<WorkbookGrid>;
```

검사 위치가 이 step의 전부다.

1. 워크북을 로드한 직후, 시트 순회 **전**: `worksheet` 개수 > `limits.maxSheets` → `ArchiveLimitError`
2. `readSheet` 안에서 `dimensions`로 `rowCount`·`columnCount`를 구한 직후,
   **`cells` 배열을 만들기 전**: `rowCount * columnCount > limits.maxCellsPerSheet` → `ArchiveLimitError`
3. 시트를 하나 끝낼 때마다 누적 합을 더하고 `> limits.maxCellsPerWorkbook`이면 `ArchiveLimitError`
4. `limits`가 없으면 검사를 전부 건너뛴다

`ArchiveLimitError`의 메시지에 **시트 이름·셀 수·파일명을 담지 마라** (`X1`). 위 세 갈래를
메시지로 구분하려 하지 마라 — 사용자가 할 수 있는 일이 같다(파일을 줄여서 다시 올린다).

`WorkbookLimits` 타입을 `@/lib/upload/upload-limits`에서 import한다. **숫자를 여기에 복사하지
마라** — 두 곳에 있는 순간 하나만 고쳐진다.

기존 테스트에 **추가**할 케이스:

1. `limits` 없이 부르면 픽스처가 지금과 똑같이 읽힌다 (회귀)
2. `{ maxSheets: 1, ... }`로 부르면 픽스처(시트 5개)가 `ArchiveLimitError`
3. `{ maxCellsPerSheet: 10, ... }`로 부르면 `ArchiveLimitError`
4. `{ maxCellsPerWorkbook: 1000, maxCellsPerSheet: 100_000, maxSheets: 20 }`이면
   시트별로는 통과하지만 합계에서 `ArchiveLimitError`
5. **`WORKBOOK_LIMITS`(실제 상한)로 부르면 픽스처가 통과한다** — 오탐 회귀 테스트

### 2. `src/lib/sheet/sheet-pipeline.ts`가 한도를 통과시킨다

`ParseContext`에 `limits?: WorkbookLimits`를 더하고 `readWorkbook(input, ctx.limits)`로 넘긴다.
**그 외에는 아무것도 바꾸지 마라.** 이 파일은 이미 T3에서 확정됐다.

`ParseContext`는 `sheet-pipeline.ts` 안에 있고 export되지 않는다. 필요하면 export하되
**어댑터에 `limits`를 흘려보내지 마라** — 어댑터는 한도를 모른다.

### 3. `src/lib/upload/parse-runner.ts` — 테스트를 **먼저** 쓴다

```ts
export type ParseFailureCode = 'ARCHIVE_LIMIT_EXCEEDED' | 'PARSE_TIMEOUT' | 'WORKBOOK_CORRUPT';

export type ParseOutcome =
  | { ok: true; result: WorkbookParseResult }
  | { ok: false; code: ParseFailureCode; message: string };

export function runWorkbookParse(
  input: Buffer | ArrayBuffer,
  ctx: { baseYear: number; limits?: WorkbookLimits; timeoutMs?: number }
): Promise<ParseOutcome>;
```

규칙:

- **예외를 위로 던지지 않는다.** 라우트 핸들러가 `try/catch`로 판단하게 두면 계산이 라우트로
  샌다 (`ARCHITECTURE.md` 계층 경계). 모든 결말이 `ParseOutcome`이다.
- `ArchiveLimitError` → `ARCHIVE_LIMIT_EXCEEDED`, `WorkbookReadError` → `WORKBOOK_CORRUPT`.
  **`code` 속성으로 판별하라** — `instanceof`는 번들 경계에서 흔들린다.
- 그 밖의 어떤 예외든 `WORKBOOK_CORRUPT`로 접는다. **원인 문자열을 메시지에 담지 마라**
  (내부 경로·스택이 사용자에게 샌다, `X1`).
- 타임아웃: `timeoutMs`(기본 `PARSE_TIMEOUT_MS`)가 지나면 `PARSE_TIMEOUT`을 돌려준다.
  **타이머는 어느 갈래로 끝나든 `clearTimeout`한다** — 안 하면 서버리스 함수가 타이머만큼 산다.
- 타임아웃 뒤에 파싱이 늦게 끝나도 **그 결과를 쓰지 않는다.** 이미 반환한 뒤에 상태를 만지지
  않도록 플래그 하나로 막아라.
- **`baseYear`를 여기서 계산하지 마라.** 인자로 받는다 (`CLAUDE.md` CRITICAL — 시간은 주입).
- 이 파일은 `exceljs`를 import하지 않는다. `parseWorkbook`만 부른다.

테스트:

1. 픽스처 + `WORKBOOK_LIMITS` → `ok: true`이고 `result.tabs`가 T3 테스트와 같은 탭 수
2. 픽스처 + `{ maxSheets: 1 }` → `ARCHIVE_LIMIT_EXCEEDED`
3. ZIP이 아닌 바이트 → `WORKBOOK_CORRUPT` (예외가 새지 않는다)
4. `timeoutMs: 0` → `PARSE_TIMEOUT`
5. 실패 결말의 `message`에 `Error`·`at `·`/src/`·시트 이름이 들어 있지 않다
6. **성공 케이스가 타이머를 남기지 않는다** — `vi.useFakeTimers()`로 재거나,
   테스트가 열린 핸들 때문에 끝나지 않는지로 확인한다

## Acceptance Criteria

```bash
npx vitest run src/lib/upload src/lib/sheet

# 한도 숫자가 리더에 복사되지 않았다 (출력이 비어야 함)
grep -nE "100_000|100000|300_000|20_000" src/lib/sheet/workbook-reader.ts ; test $? -eq 1

# 파서 러너는 엑셀 라이브러리를 모른다 (출력이 비어야 함)
grep -n "exceljs" src/lib/upload/parse-runner.ts ; test $? -eq 1

# exceljs import는 여전히 두 파일뿐이다 (workbook-reader만 나와야 함 — xlsx writer는 T7)
grep -rln "from 'exceljs'\|require('exceljs')" src/

# 러너가 예외를 던지지 않는다 (출력이 비어야 함)
grep -nE "^\s*throw " src/lib/upload/parse-runner.ts ; test $? -eq 1

# 타이머를 정리한다 (출력이 있어야 함)
grep -n "clearTimeout" src/lib/upload/parse-runner.ts

# 회귀 — T2·T3 파서가 그대로 통과한다
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 셀 상한 검사가 **`cells` 배열을 만들기 전**에 있는가? (뒤에 있으면 막는 의미가 없다)
   - `limits` 없이 부른 기존 테스트가 전부 그대로 통과하는가?
   - `WORKBOOK_LIMITS`로 실제 픽스처가 통과하는가? (오탐 회귀)
   - 실패 메시지에 스택·내부 경로·시트 이름이 없는가?
   - `sheet-pipeline.ts`에서 `limits` 전달 말고 다른 것을 고치지 않았는가?
3. `phases/t5-api-upload/index.json`의 step 1을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 한도 검사를 끼운 정확한 위치, 타임아웃이 "중단"이 아니라 "포기"라는 사실과
   그 이유, 테스트 개수를 남겨라.

## 금지사항

- 셀 상한을 `readSheet`가 끝난 뒤에 검사하지 마라. 이유: 그때는 이미 메모리를 다 썼다.
- 한도 숫자를 `workbook-reader.ts`에 적지 마라. 이유: 정책은 `upload-limits.ts` 한 곳이다.
  리더는 채록만 한다.
- 워커 스레드·`child_process`로 파싱을 격리하지 마라. 이유: 4MB·수천 행 규모에 과한 구조이고,
  요구되는 실질(부분 결과를 저장하지 않는다)은 결과를 버리는 것만으로 충족된다.
- `parse-runner`에서 예외를 던지지 마라. 이유: 라우트가 판단하게 되면 계층 경계가 무너진다.
- 예외 메시지를 사용자 메시지에 이어 붙이지 마라. 이유: 내부 경로가 새어 나간다 (`X1`).
- `sheet-pipeline.ts`의 탭 라우팅·경고 규칙을 고치지 마라. 이유: T3에서 확정됐고 이 step의 범위가 아니다.
- 「알려진 탭 0개」 판정을 여기서 하지 마라. 이유: step 2(`upload-preview`)의 일이다 —
  파이프라인 주석이 이미 그렇게 못박고 있다.
- 저장소를 부르지 마라. 이유: 미리보기 단계는 저장소에 아무것도 쓰지 않는다 (`ADR-008`).
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
