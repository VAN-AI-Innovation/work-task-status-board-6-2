# Step 2: upload-preview

## 읽어야 할 파일

- `CLAUDE.md` — 도메인·저장소 경계, 보안 규칙(경고에 셀 값 금지), TDD, 파일명 전역 유니크
- `docs/TICKETS.md` — `## T5` 완료 기준 **2·3·4·7·8**, 「리스크·미결」의 부분 업로드
- `docs/PLAN.md` — 「4. 엑셀 파싱 파이프라인」의 미리보기 블록, 「엣지·에러」 `E5`(source_key 충돌),
  「에러 핸들링」 `X2`(실패 강도 3단계), `UC-01`~`UC-04`
- `docs/ADR.md` — `ADR-008`(미리보기→확정 2단계)
- `docs/ARCHITECTURE.md` — 「데이터 흐름」, 「에러 처리」의 실패 강도 표
- T3·T4 산출물: `src/types/task.ts`(`ParsedTask`·`TabParseResult`·`WorkbookParseResult`·`Task`),
  `src/types/goal.ts`(`ParsedGoalMetric`·`GoalMetric`),
  `src/lib/store/task-repository.ts`(**`TaskUpsertInput`·`diffTaskFields`·`taskUpsertKey`**)
- `supabase/migrations/0002_seed_reference.sql` — `teams.id`가 곧 `TeamKey`이고 세 팀의
  `department_id`가 전부 `contents-marketing`이라는 사실

## 배경

파싱 결과(`ParsedTask`)와 저장 모델(`Task`)은 다른 계층의 타입이다. 그 사이를 잇는 변환과,
**저장하지 않고 미리 세어 보는 대조**가 이 step이다.

급소가 넷이다.

1. **미리보기 숫자와 확정 결과가 같아야 한다.** 다르면 미리보기는 거짓말이고 `UC-01`·`UC-03`이
   무너진다. 그래서 신규/변경/유지를 여기서 다시 정의하지 않고 **T4의 `diffTaskFields`를 그대로
   쓴다.** step 4(`upload-commit`)도 같은 함수를 쓰는 저장소를 통해 센다.
2. **「알려진 탭이 하나도 없음」은 성공이 아니라 중단이다** (`X2`). 빈 결과를 확정하면 기존
   데이터가 0건으로 덮인다. 이 판정을 여기서 내린다 — `sheet-pipeline.ts`가 자기 주석에서
   "T5의 업로드 트랜잭션이 내린다"라고 넘긴 판정이다.
3. **부분 업로드**(`UC-04`)는 타협 대상이 아니다. 워크북에 없는 팀은 **건드리지 않는다.**
   미리보기는 그 사실을 **화면에 말해 줘야** 한다 — "이번 업로드에 편집팀이 없습니다"를 보지
   못하면 사용자는 나머지 팀이 지워졌다고 의심한다.
4. **경고를 접어야 한다.** 행마다 경고 1건이면 300건짜리 목록이 나오고 아무도 읽지 않는다.
   `code + sheet`로 묶어 개수로 접는다.

## 작업

### 1. `src/lib/upload/upload-mapper.ts` — 테스트를 **먼저** 쓴다

```ts
/** 팀 → 부서. 0002_seed_reference.sql과 같아야 한다. T8에서 DB 조회로 바뀔 수 있다 */
export const TEAM_DEPARTMENT: Readonly<Record<TeamKey, string>>;

export function toTaskUpsertInputs(
  tab: TabParseResult,
  uploadId: string | null
): TaskUpsertInput[];

export function toGoalMetricUpsertInputs(
  tab: TabParseResult,
  uploadId: string | null
): GoalMetricUpsertInput[];

/** 같은 `(teamId, sourceKey)`가 한 업로드 안에 두 번 이상 나온 사실 (E5) */
export function collectDuplicateKeyWarnings(inputs: readonly TaskUpsertInput[]): ParseWarning[];
```

규칙:

- `tab.teamKey`가 `null`인 탭(설정·대시보드·미판별)은 **빈 배열**을 돌려준다. 예외를 던지지 마라.
- `teamId = tab.teamKey`, `departmentId = TEAM_DEPARTMENT[teamKey]`.
- **`ownerMemberId`는 항상 `null`이다.** 시트의 담당자는 자유 입력 문자열이고 구성원 해석은
  T8(`members.auth_user_id`)의 일이다. `ownerNameRaw`만 채운다. 이 결정을 주석에 남겨라.
- `stages`는 `ParsedStage`를 그대로 옮긴다 (`TaskUpsertInput.stages`가 이미 그 모양이다).
- `sourceUploadId = uploadId`, `sourceSheetTab = tab.sheet`, `sourceRowIndex`는 파서 값 그대로
  (**이미 1-based다. 여기서 더하지 마라**).
- `raw`·`extras`는 그대로 옮긴다. **여기서 마스킹하지 마라** — 마스킹은 API 응답 계층(step 5·6)이다.
  저장소에는 원본이 들어간다.
- `collectDuplicateKeyWarnings`는 `code: 'DUPLICATE_SOURCE_KEY'`, `sheet`, `row`만 담는다.
  **`sourceKey` 값을 경고에 담지 마라** — 키에 업무명과 담당자 이름이 들어 있다
  (`CLAUDE.md` 보안 규칙). 첫 번째 등장은 정상이고 **두 번째부터** 경고다.

테스트: 픽스처를 `parseWorkbook`으로 돌린 결과를 입력으로 쓴다 (가짜 객체를 손으로 짓지 마라 —
실제 파서 출력과 어긋나면 이 파일만 통과하고 배포에서 깨진다).

1. 편집팀 탭 → `TaskUpsertInput[]`의 길이가 `tab.tasks.length`와 같다
2. `teamId`·`departmentId`가 전부 채워지고 `ownerMemberId`가 전부 `null`이다
3. `extras`·`raw`의 키가 하나도 사라지지 않았다 (T3 완료 기준 3의 연장)
4. `stages`가 보존된다 (편집팀 3단계)
5. `teamKey: null`인 탭 → `[]`
6. 같은 `sourceKey`를 두 번 담은 입력 → 경고 1건, `code`가 `DUPLICATE_SOURCE_KEY`
7. **경고 객체를 `JSON.stringify`했을 때 업무명·담당자 문자열이 들어 있지 않다**

### 2. `src/lib/upload/upload-preview.ts` — 테스트를 **먼저** 쓴다

```ts
/** 같은 code+sheet를 개수로 접은 경고. 값은 담지 않는다 */
export interface PreviewWarning {
  code: string;
  sheet: string;
  count: number;
  /** 처음 발생한 행 (1-based). 없으면 null */
  firstRow: number | null;
}

export interface TabPreview {
  sheet: string;
  teamKey: TeamKey | null;
  taskCount: number;
  goalMetricCount: number;
  created: number;
  updated: number;
  unchanged: number;
  /** 판별 실패·밴드 부재로 반영되지 않는 탭 (X2의 「부분 실패」) */
  skipped: boolean;
}

/** `uploads.parse_result`에 그대로 들어간다. **JSON 직렬화 가능해야 한다** */
export interface CommitPayload {
  tasks: TaskUpsertInput[];
  goalMetrics: GoalMetricUpsertInput[];
  /** 이번 업로드가 건드리는 팀. 여기 없는 팀은 확정에서도 손대지 않는다 (UC-04) */
  teamKeys: TeamKey[];
}

export interface UploadPreview {
  totals: {
    taskCount: number;
    created: number;
    updated: number;
    unchanged: number;
    warningCount: number;
  };
  tabs: TabPreview[];
  /** 워크북에 없어서 이번에 갱신되지 않는 팀 (UC-04 고지) */
  untouchedTeams: TeamKey[];
  /** 건너뛴 탭 이름 — 「빠진 탭을 명시」의 실체 (완료 기준 8) */
  skippedSheets: string[];
  warnings: PreviewWarning[];
}

export type PreviewOutcome =
  | { ok: true; preview: UploadPreview; payload: CommitPayload }
  | { ok: false; code: 'NO_KNOWN_TAB'; message: string };

export function buildUploadPreview(
  parsed: WorkbookParseResult,
  /** 대조 대상. **라우트가 `repo.listTasks()`로 읽어 넘긴다** — 이 함수는 저장소를 모른다 */
  existing: readonly Task[],
  uploadId: string | null
): PreviewOutcome;
```

규칙 — 순서대로 적었다.

1. `parsed.tabs` 중 `teamKey !== null`이고 태스크나 목표 지표가 하나라도 있는 탭이 **0개면
   `NO_KNOWN_TAB`**. 설정 탭만 든 파일도 여기서 걸린다. `message`는
   `'인식할 수 있는 팀 탭이 없습니다. 시트 전체를 .xlsx로 내보내 다시 올려 주세요.'`
   — **이 판정이 이 파일의 존재 이유 중 절반이다** (`X2`).
2. `existing`을 `taskUpsertKey`로 인덱싱한다. 키가 없으면 `created`,
   있고 `diffTaskFields(prev, next)`가 비어 있지 않으면 `updated`, 비어 있으면 `unchanged`.
   **분류를 다시 구현하지 마라.** T4의 함수를 그대로 쓴다.
3. 같은 배열 안에 같은 키가 두 번이면 **뒤엣것이 이긴다** (T4 저장소와 같은 규칙).
   미리보기 숫자도 그 규칙 뒤의 값이어야 확정 결과와 맞는다.
4. `untouchedTeams` = `TEAM_KEYS` − `payload.teamKeys`. **`TEAM_KEYS`는
   `@/lib/domain/progress-stats`에 이미 있다.** 새로 정의하지 마라.
5. `skipped` 탭: `teamKey`가 `null`인데 `parsed.warnings`에 그 시트의
   `UNKNOWN_TAB`·`HEADER_BAND_NOT_FOUND`·`TAB_PARSE_FAILED`가 있는 탭. 설정 탭과
   `00_통합 대시보드`는 **건너뛴 것이 아니라 원래 읽지 않는 탭이므로 `skippedSheets`에 넣지 마라**
   (매 업로드마다 뜨는 잡음이 된다 — `sheet-pipeline.ts`가 같은 이유로 경고도 남기지 않는다).
6. 경고는 세 곳에서 모은다: `parsed.warnings` + 각 `tab.warnings` + `parsed.settings?.warnings`
   + `collectDuplicateKeyWarnings`. `code + sheet`로 묶고 `count`를 센다. `firstRow`는 가장 작은
   `row`. **접기 전 원본 경고를 결과에 남기지 마라** (행 수만큼 커진다).
7. **저장소를 부르지 않는다. `Date`를 읽지 않는다.** 둘 다 인자로 받는다.

테스트: 픽스처를 실제로 파싱해서 쓴다.

1. `existing: []` → 모든 태스크가 `created`, `updated`·`unchanged`가 0
2. **같은 파싱 결과를 저장소에 넣었다 치고 다시 미리보기** — `memory-task-store`에
   `upsertTasks`한 뒤 `listTasks()`를 `existing`으로 주면 **전건 `unchanged`**
   (`UC-03`의 핵심. 이 테스트가 미리보기와 확정의 일치를 지킨다)
3. 한 건의 `progress`만 바꾸면 `updated: 1`, 나머지 `unchanged`
4. **편집팀 탭 하나만 든 `WorkbookParseResult`** → `untouchedTeams`에 `shoot`·`marketing`이
   들어가고 `payload.teamKeys`는 `['edit']` (`UC-04`)
5. 팀 탭이 없는 결과(설정 탭만) → `NO_KNOWN_TAB`
6. `tabs: []` → `NO_KNOWN_TAB`
7. 같은 `code`·`sheet` 경고 5건 → `PreviewWarning` 1건에 `count: 5`
8. `payload`가 `JSON.parse(JSON.stringify(payload))` 왕복 후에도 같다
   (**`uploads.parse_result`에 그대로 들어가므로 `Date`·`undefined`가 섞이면 안 된다**)
9. `preview`를 `JSON.stringify`했을 때 **연락처·계정 같은 원본 값이 없다** — 미리보기는 숫자와
   코드만 싣는다

### 3. 알아 둘 것 — 설정 탭 레지스트리는 저장하지 않는다

`TaskRepository`에 enum·SLA 저장 메서드가 없다. 추가하면 계약 테스트·두 구현·마이그레이션까지
번져 T5(M)를 넘긴다. **T5는 설정 탭 레지스트리를 저장하지 않는다.** 조회 API의
`semanticIndex`는 `buildSemanticIndex(null)`의 내장 폴백을 쓴다 (T4 step 1이 이미 그 폴백을
만들어 뒀다). 미등록 enum 경고는 **레지스트리가 손에 있는 이 시점**에만 계산할 수 있으므로,
`collectUnregisteredEnumWarnings`를 여기서 부르지는 말고(도메인 함수는 `Task`를 받는다)
`parsed.settings?.warnings`만 미리보기에 실어라.

이 결정을 `docs/TICKETS.md`의 **T5「리스크·미결」에 한 줄로 추가하라**:
설정 탭 enum·SLA는 T5에서 저장하지 않고 도메인 내장 폴백을 쓴다는 사실과 그 이유.

## Acceptance Criteria

```bash
npx vitest run src/lib/upload

# 분류를 다시 구현하지 않았다 (출력이 있어야 함)
grep -n "diffTaskFields\|taskUpsertKey" src/lib/upload/upload-preview.ts

# 저장소·시간을 직접 만지지 않는다 (출력이 비어야 함)
grep -nE "getStorage|createMemoryTaskStore|createSupabaseTaskStore|Date\.now\(\)|new Date\(\)" src/lib/upload/upload-preview.ts ; test $? -eq 1

# 팀 목록을 새로 정의하지 않았다 (출력이 비어야 함)
grep -nE "'edit'\s*,\s*'shoot'" src/lib/upload/upload-preview.ts ; test $? -eq 1

# 중단 판정이 있다 (출력이 있어야 함)
grep -n "NO_KNOWN_TAB" src/lib/upload/upload-preview.ts

# 문서에 결정이 남았다 (출력이 있어야 함)
grep -n "내장 폴백\|레지스트리" docs/TICKETS.md

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - **같은 파일을 두 번 올리면 전건 `unchanged`인가?** (테스트 2번 — 미리보기의 신뢰도 그 자체다)
   - 팀 탭이 하나도 없을 때 성공이 아니라 `NO_KNOWN_TAB`인가?
   - 탭 하나만 든 파일에서 `untouchedTeams`가 나머지 두 팀을 정확히 담는가?
   - 경고가 접히는가? 접은 경고에 셀 값·업무명·담당자가 없는가?
   - `payload`가 JSON 왕복을 견디는가?
   - `src/lib/upload/` 파일명이 `src/lib/` 전역에서 유니크한가?
3. `phases/t5-api-upload/index.json`의 step 2를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 미리보기가 확정과 같은 숫자를 내는 근거(`diffTaskFields` 공유), `NO_KNOWN_TAB`
   판정 조건, 부분 업로드 고지 방식, 테스트 개수를 남겨라.

## 금지사항

- 신규/변경/유지를 여기서 새로 정의하지 마라. 이유: 미리보기와 확정의 숫자가 갈라지는 순간
  `UC-01`·`UC-03`이 거짓이 된다.
- 저장소를 import하지 마라. 이유: 미리보기는 **읽기조차** 호출자가 한다. 이 함수는 순수 함수다.
- 「알려진 탭 0개」를 빈 성공으로 처리하지 마라. 이유: 기존 데이터가 0건으로 덮인다 (`X2`).
- 워크북에 없는 팀의 데이터를 지우는 계획을 세우지 마라. 이유: 부분 업로드는 사용자 확정
  요구사항이고 완료 기준 4는 타협 대상이 아니다.
- 경고를 행 단위로 그대로 내보내지 마라. 이유: 300건짜리 목록은 아무도 읽지 않는다.
- 경고·미리보기에 셀 값·업무명·담당자·`sourceKey`를 담지 마라. 이유: `CLAUDE.md` 보안 규칙.
- `extras`를 마스킹하거나 `raw`를 지우지 마라. 이유: 저장소에는 원본이 들어간다.
  마스킹은 응답 계층(step 5·6)의 일이고, 여기서 지우면 감사 경로가 사라진다.
- `enum_options`·`sla_rules`에 쓰는 코드를 만들지 마라. 이유: `TaskRepository`에 그 메서드가
  없고, 추가하면 계약 테스트와 두 구현으로 번져 T5 범위를 넘는다.
- 라우트 핸들러를 만들지 마라. 이유: step 7의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
