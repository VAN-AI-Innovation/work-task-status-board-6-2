# Step 8: sheet-pipeline

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(라우트는 `lib/`을 호출만 한다), TDD, 파서 하드 실패 금지
- `docs/TICKETS.md` — `## T3` 완료 기준 **전체 1~10**(이 step에서 티켓 전체를 대조한다),
  `## T5` 완료 기준 4·7·8(`NO_KNOWN_TAB`·부분 실패는 **T5의 판정**임을 확인)
- `docs/PLAN.md` — 「4. 엑셀 파싱 파이프라인」 전체, `E6`의 `00_통합 대시보드` 줄
  ("수식 결과라 읽지 않는다"), `X2`(실패 강도 3단계)
- `docs/ARCHITECTURE.md` — 「데이터 흐름」의 엑셀→조회 다이어그램, 「에러 처리」의 코드 목록
- T2 산출물: `src/lib/sheet/workbook-reader.ts`(`readWorkbook`·`WorkbookReadError`),
  `src/lib/sheet/tab-detector.ts`(`detectTab`), `src/lib/sheet/adapter-settings-tab.ts`
- 이전 step 산출물: 어댑터 3종, `section-splitter`, `row-mapper`, `stage-unpivot`, `task-schema`

## 배경

T3의 마지막 step이다. T2의 리더·판별기와 T3의 어댑터를 **한 함수 뒤로** 감춘다.
T5의 라우트 핸들러는 이 함수 하나만 부르고 계산을 하지 않는다.

경계를 분명히 한다:

| 판정 | 주체 | 이유 |
|---|---|---|
| 탭이 어느 종류인가 | T2 `detectTab` | 이미 끝났다 |
| 탭 하나를 어떻게 읽는가 | T3 어댑터 | step 3·4·7 |
| **"알려진 탭이 0개 → 중단"** | **T5** | 업로드 트랜잭션의 판정이다 (`X2`, T5 완료 기준 7) |
| **`semantic` 매핑·미등록 값 검사** | **T4** | 판정 로직이 파서에 새면 두 곳이 된다 (`ADR-009`) |

**이 파이프라인은 예외를 던지지 않는다.** `readWorkbook`이 던지는 `WorkbookReadError`만
그대로 통과시킨다 (워크북이 안 열리면 파싱할 것이 없다).

## 작업

### 1. `src/lib/sheet/sheet-pipeline.ts`

```ts
export async function parseWorkbook(
  input: Buffer | ArrayBuffer,
  ctx: { baseYear: number },
): Promise<WorkbookParseResult>;
```

`baseYear`는 주입받는다. **여기서 `new Date()`를 부르지 마라** (`CLAUDE.md` CRITICAL —
호출자가 `kst-today`에서 얻은 값을 넘긴다. `kst-today`는 T4에서 만든다).

### 2. 동작 규칙

1. `readWorkbook(input)` → 시트마다 `detectTab(sheet)`.
2. **설정 탭을 먼저 처리한다** — `parseSettingsTab`으로 `SettingsRegistry`를 얻어
   결과의 `settings`에 싣는다. 없으면 `null`이고 `SETTINGS_TAB_MISSING` **경고**를 남긴다.
   예외를 던지지 마라 (중단 판정은 T5).
3. `kind`별 분기는 **표 하나**로 쓴다. `if` 사슬로 늘리지 마라.
   - `edit_team` → `parseEditTeamTab(sheet, matches[0].band, ctx)`
   - `shoot_team` → `parseShootTeamTab(sheet, matches[0].band, ctx)`
   - `marketing_team` → `parseMarketingTeamTab(sheet, ctx)`
   - `settings` → 위 2번에서 처리
   - `dashboard` → **건너뛴다.** 경고도 남기지 않는다.
     수식 결과라 읽지 않기로 한 것이 `E6`의 확정이고, 경고를 남기면 매 업로드마다 뜬다.
   - `unknown` → 건너뛰고 `UNKNOWN_TAB` 경고 1건
4. `matches`가 비어 있으면(`matchedBy === 'name'`) 어댑터를 부를 밴드가 없다.
   `HEADER_BAND_NOT_FOUND` 경고를 남기고 그 탭을 건너뛴다.
5. 어댑터가 던지는 예외는 **탭 단위로 잡아** `TAB_PARSE_FAILED` 경고로 바꾸고 나머지 탭을
   계속 처리한다. 탭 하나가 파이프라인 전체를 죽이면 `X2`의 "부분 실패"가 성립하지 않는다.
   경고에 예외 메시지·스택을 담지 마라 (`sheet` 이름만).
6. 결과 조립:
   - `tabs` — 어댑터가 돌려준 `TabParseResult`를 **시트 순서 그대로**
   - `settings`
   - `warnings` — 탭에 귀속되지 않는 것만 (위 2·3·4·5번). 어댑터 내부 경고는 각 탭에 남긴다

### 3. 테스트 케이스 (`src/lib/sheet/sheet-pipeline.test.ts`)

픽스처 전체를 한 번에 읽어 검증한다. 여기가 T3 완료 기준의 최종 대조 지점이다.

1. `tabs`가 **3개**다 (`01`·`02`·`03`). 대시보드·설정은 `tabs`에 없다 (완료 기준 1)
2. `settings`가 null이 아니고 `enums`·`slaRules`가 채워져 있다
3. 태스크 총합 = **편집 5 + 촬영 1 + 마케팅 3 = 9건**. 유령 25건이 없다 (완료 기준 2)
4. `goalMetrics` 3건, `teamPeriodGoals` 1건, `briefingLines` 5줄 (완료 기준 5·6·7)
5. 편집팀 태스크의 `stages`가 각 3행이다 (완료 기준 4)
6. 촬영팀 태스크의 `extras` 키 개수가 step 4에서 확정한 값과 같다 (완료 기준 3)
7. `warnings`에 `UNKNOWN_TAB`·`SETTINGS_TAB_MISSING`이 **없다** (픽스처는 정상 워크북이다)
8. 경고 전체를 훑어 **셀 값·사람 이름·계정 문자열이 하나도 없다**
9. 깨진 바이트를 넣으면 `WorkbookReadError`가 그대로 나온다 (다른 예외로 감싸지 않는다)
10. 손으로 만든 워크북 격자로: 알려진 탭이 0개여도 **예외 없이** 빈 `tabs`와 경고를 돌려준다
    (중단 판정은 T5의 일이라는 증거)

### 4. `docs/TICKETS.md` T3 완료 기준 대조

10개 기준을 하나씩 짚어 **어느 테스트가 증명하는지** 확인하고 요약에 적는다.
완료 기준 **8**(`source_key` 중복 경고)은 픽스처에 중복이 없으므로 step 1의 단위 테스트가
증명한다 — 그 사실을 요약에 명시하라. 빠진 기준이 있으면 조용히 넘기지 말고 요약에 쓴다.

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/sheet-pipeline.test.ts

# 계층 경계 — exceljs를 아는 파일은 workbook-reader 하나뿐이다 (출력이 1줄이어야 함)
grep -rln "exceljs" src/ | tee /dev/stderr | wc -l

# 파이프라인이 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "new Date\(\)|Date\.now" src/lib/sheet/sheet-pipeline.ts ; test $? -eq 1

# semantic 매핑이 파서에 새어 들어오지 않았다 (출력이 비어야 함)
grep -rnE "in_progress|pending_release|'planned'" src/lib/sheet/ ; test $? -eq 1

# T2 + T3 전체 회귀
npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **T3 완료 기준 10개를 하나씩 대조한다.** 각 기준마다 증명하는 테스트 파일과 케이스를 적는다.
3. 체크리스트:
   - `src/lib/sheet/`에 T2 5개 + T3 8개 외의 파일이 생기지 않았는가?
   - `ARCHITECTURE.md` 디렉토리 트리와 실제 파일 목록이 일치하는가?
   - 파일명이 전역 유니크한가 (`CLAUDE.md` CRITICAL — TDD 가드가 basename만 본다)?
   - 라우트·컴포넌트·DB 코드를 만들지 않았는가?
4. `phases/t3-team-adapters/index.json`의 step 8을 갱신하고, **task 레벨 요약**에
   T3 완료 기준 10개 대조 결과를 남긴다:
   - 성공 → `"status": "completed"` + `"summary"`(파이프라인 시그니처, 픽스처 전체 파싱 결과
     숫자, **완료 기준 10개 대조표**, 총 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- "알려진 탭 0개"에서 예외를 던지지 마라. 이유: 중단 판정은 T5의 업로드 트랜잭션이다 (`X2`).
- `00_통합 대시보드`를 파싱하지 마라. 이유: 수식 결과라 우리가 다시 계산한다 (`E6`).
- 대시보드를 건너뛴 것에 경고를 남기지 마라. 이유: 매 업로드마다 뜨는 잡음이 된다.
- 어댑터의 예외로 파이프라인 전체를 중단시키지 마라. 이유: `X2`의 "부분 실패"가 무너진다.
- 경고에 예외 메시지·스택·내부 경로를 담지 마라. 이유: `CLAUDE.md` 보안 규칙, `X1`.
- `new Date()`를 부르지 마라. 이유: `CLAUDE.md` CRITICAL — `baseYear`는 주입받는다.
- `semantic` 매핑·미등록 값 검사를 넣지 마라. 이유: `ADR-009`, T4의 범위다.
- API 라우트·DB·화면을 만들지 마라. 이유: T4·T5·T6의 범위다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL — `workbook-reader` 하나뿐이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
