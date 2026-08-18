# Step 1: task-semantic

## 읽어야 할 파일

- `CLAUDE.md` — 도메인 규칙, 파서 하드 실패 금지, **경고에 셀 값을 담지 않는다**
- `docs/ADR.md` — **`ADR-009`**(상태 문자열을 `semantic`으로 한 번 감싼다). 이 step의 근거 전부다
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `enum_options.semantic`과 10단계 매핑표
- `docs/PLAN.md` — 「1. 데이터 모델」의 매핑표, **`H4`**(설정 탭 enum이 실제로 쓰이는지 —
  미등록 값을 warnings로 집계해 실측한다), 「엣지 케이스 처리 방침」
- T2 산출물: `src/lib/sheet/adapter-settings-tab.ts`와 `src/types/sheet.ts`의
  `SettingsRegistry`·`EnumOptionEntry`(`groupKey`·`value`·`sortOrder`, **`semantic`은 없다**)
- step 0 산출물: `src/types/task.ts`의 `TaskSemantic`·`Task`

## 배경

**이 step에는 T3에서 빠진 것이 하나 들어온다.**

T2 step 5는 "미등록 값 검사는 레지스트리를 **쓰는** 쪽(T3 어댑터)의 일"이라고 미뤘고,
T3 step 8은 "`semantic` 매핑·미등록 값 검사는 **T4**"라고 미뤘다. 그래서 **어느 쪽도 하지 않았다.**
`PLAN.md`의 가설 `H4`("설정 탭의 enum이 실제로 쓰인다 / 검증: 파싱 시 미등록 값을 `warnings`로
집계해 실측")는 아직 검증 수단이 없는 상태다. **이 step이 그 구멍을 메운다.**

두 일이 한 파일에 들어가는 이유는 같은 표를 본다는 것이다 — `설정` 탭의 enum 목록.
`toSemantic`은 그 목록을 코드로 바꾸고, 미등록 검사는 그 목록에 **없는** 값을 찾는다.

## 작업

### 1. `src/lib/domain/task-semantic.ts` — 테스트를 **먼저** 쓴다

```ts
/** 시트 원문 → semantic. `설정` 탭 `공통_진행 상태` 10단계가 정확히 이 키들이다 */
export const STATUS_SEMANTIC_MAP: Readonly<Record<string, TaskSemantic>>;

/** enum 검사를 하는 4개 그룹. 시트의 `공통_` 그룹 이름 그대로 */
export const CHECKED_ENUM_GROUPS: readonly EnumGroupCheck[];

/** 레지스트리의 `공통_진행 상태` 값에 semantic을 붙인 조회표를 만든다 */
export function buildSemanticIndex(registry: SettingsRegistry | null): SemanticIndex;

/** 상태 원문 하나를 semantic으로. 모르면 null (예외를 던지지 않는다) */
export function toSemantic(statusRaw: string | null, index: SemanticIndex): TaskSemantic | null;

/** 진행형 semantic인가 — 완료·보류·취소가 아닌 것 */
export function isActiveSemantic(semantic: TaskSemantic | null): boolean;

/** 설정 탭에 등록되지 않은 값을 쓰는 업무를 찾아 경고로 돌려준다 (H4 실측 수단) */
export function collectUnregisteredEnumWarnings(
  tasks: Task[],
  registry: SettingsRegistry | null
): ParseWarning[];
```

`SemanticIndex`·`EnumGroupCheck` 타입은 이 파일에서 내보낸다 (`src/types/`에 두지 마라 —
이 모듈 밖에서 쓰이지 않는 조회 구조다).

### 2. `STATUS_SEMANTIC_MAP` — 픽스처 `99_설정` 탭의 실제 값 10개

```
'업무 배정'      → 'planned'          '승인 대기'      → 'approval'
'준비 중'        → 'planned'          '수정 중'        → 'rework'
'진행 중'        → 'in_progress'      '게시·이관 대기' → 'pending_release'
'검토 요청'      → 'review'           '완료'           → 'done'
                                      '보류'           → 'hold'
                                      '취소'           → 'cancelled'
```

값 10개 → semantic 9종이다(`planned`가 둘을 받는다). 이 표는 `ARCHITECTURE.md`·`PLAN.md`와
글자까지 같아야 한다. **`게시·이관 대기`의 가운뎃점은 `·`(U+00B7)이다** — 시트 원문을 그대로 옮겨라.

### 3. `buildSemanticIndex` / `toSemantic`

- 인덱스는 `Map<string, TaskSemantic>`. 키는 **`trim()`한 원문**이다.
- 레지스트리의 `공통_진행 상태` 값 중 `STATUS_SEMANTIC_MAP`에 있는 것만 담는다.
  시트에 새 상태가 생겨도 이 함수는 깨지지 않고 `toSemantic`이 `null`을 돌려줄 뿐이다.
- **레지스트리가 `null`이거나 그 그룹이 비어 있으면 `STATUS_SEMANTIC_MAP` 전체를 넣은
  인덱스를 만든다.** 부분 업로드(UC-04)로 설정 탭이 없는 파일에서도 판정이 죽으면 안 된다.
  이 폴백을 테스트로 고정하라.
- `toSemantic(null)`·`toSemantic('')`·공백만 있는 값 → `null`, 경고 없음.
- `toSemantic`은 **`trim()` 후 정확히 일치**할 때만 매핑한다. 부분 일치·소문자화를 하지 마라
  (한글 상태값에 부분 일치를 쓰면 `승인 대기`가 `대기`에 걸린다).

### 4. `collectUnregisteredEnumWarnings` — **이 step의 급소**

검사 대상 4개 그룹과 경고 코드:

| 그룹 (`groupKey`) | `Task` 필드 | 경고 코드 |
|---|---|---|
| `공통_진행 상태` | `status` | `UNREGISTERED_STATUS` |
| `공통_승인 상태` | `approvalStatus` | `UNREGISTERED_APPROVAL_STATUS` |
| `공통_우선순위` | `priority` | `UNREGISTERED_PRIORITY` |
| `공통_리스크 상태` | `riskStatus` | `UNREGISTERED_RISK_STATUS` |

규칙 — 하나도 빼지 마라. 각각이 실제 사고를 막는다.

1. **경고에 값을 담지 마라.** `{ code, sheet: task.sourceSheetTab, row: task.sourceRowIndex }`
   뿐이다. 업무명·담당자·셀 값이 들어가면 안 된다 (`CLAUDE.md` 보안 규칙, T3 전 step의 선례).
   어느 필드가 걸렸는지는 **코드로** 구분된다.
2. **레지스트리에 그 그룹이 아예 없으면 그 그룹은 검사하지 않는다** (경고 0건).
   설정 탭 없는 부분 업로드에서 전건 경고가 터지면 사람이 경고를 안 읽게 된다.
   `registry`가 `null`이면 **전체 검사를 건너뛰고 빈 배열**을 돌려준다.
3. 값이 `null`·빈 문자열·공백뿐이면 **경고하지 않는다.** 미입력은 미등록이 아니고,
   담당자 미지정·기한 미설정은 알림(step 5)이 따로 다룬다.
4. 비교는 양쪽 다 `trim()`한 뒤 **정확히 일치**로 한다.
5. 업무 하나가 4개 필드 모두 미등록이면 경고 4건이 나온다 (필드마다 1건).
6. **같은 값이 여러 행에서 미등록이면 행마다 1건씩** 나온다. 접지 마라 —
   `H4`의 실측 지표는 "미등록 값이 몇 **건**인가"이고, 접으면 그 수를 잃는다.
7. 하드 실패시키지 마라. 예외를 던지지 않고 입력 객체를 고치지 않는다.

### 5. 테스트 케이스 (`src/lib/domain/task-semantic.test.ts`)

레지스트리는 실제 픽스처로 만들어라 — `sheet-pipeline`의 `parseWorkbook`을
`src/lib/fixtures/sample-workbook.xlsx`에 돌려 나온 `settings`를 쓴다. 손으로 지은 가짜
레지스트리만 쓰면 시트 원문과 어긋나도 테스트가 통과한다.

1. 픽스처 레지스트리로 만든 인덱스에서 `toSemantic('진행 중')` → `'in_progress'`
2. **픽스처 `공통_진행 상태` 10개 값이 전부 `toSemantic`에서 non-null을 낸다** —
   하나라도 null이면 `STATUS_SEMANTIC_MAP`이 시트와 어긋난 것이다
3. `toSemantic('업무 배정')`과 `toSemantic('준비 중')`이 둘 다 `'planned'`
4. `toSemantic('진행중')`(공백 없음) → `null` (정확히 일치만)
5. `toSemantic('  진행 중  ')` → `'in_progress'` (trim)
6. `toSemantic(null)` / `''` / `'   '` → `null`
7. `buildSemanticIndex(null)`로도 `toSemantic('완료')`가 `'done'`을 낸다 (폴백)
8. `isActiveSemantic`: `in_progress`·`review`·`planned`는 true, `done`·`hold`·`cancelled`는 false
9. 미등록 검사: `status: '진행중'`인 업무 1건 → `UNREGISTERED_STATUS` 1건,
   `sheet`·`row`가 그 업무의 값과 같다
10. **경고 객체의 키가 `code`·`sheet`·`row` 셋뿐이고, 업무명·담당자·상태 원문이 어디에도
    들어 있지 않다** (`JSON.stringify(warnings)`에 해당 문자열이 없음을 단언)
11. 4개 필드가 전부 미등록인 업무 1건 → 경고 4건, 코드 4종이 각각 1건
12. 같은 미등록 값을 쓰는 업무 3건 → 경고 3건 (접지 않는다)
13. 값이 `null`·`''`인 업무 → 경고 0건
14. `registry`가 `null` → 경고 0건
15. 레지스트리에 `공통_우선순위`가 없으면 우선순위만 검사되지 않고 나머지 3종은 검사된다
16. **픽스처 태스크 9건 전체에 대해 미등록 경고가 몇 건인지 실측하고 그 수를 단언한다**
    (`H4`의 답이다. 0건이면 0건이라고 고정하라 — "가설이 맞았다"는 사실도 회귀 대상이다)

## Acceptance Criteria

```bash
npx vitest run src/lib/domain/task-semantic.test.ts

# 시간을 읽지 않는다 (출력이 비어야 함)
grep -nE "Date\.now\(\)|new Date\(\)" src/lib/domain/task-semantic.ts ; test $? -eq 1

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs\|@supabase" src/lib/domain/task-semantic.ts ; test $? -eq 1

# 회귀
npx vitest run src/lib/sheet src/lib/domain

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 픽스처 `공통_진행 상태` 10개 값이 **전부** 매핑되는가? (테스트 2번이 실제로 돌았는가)
   - 경고에 상태 원문·업무명·담당자가 새어 나갈 경로가 없는가?
   - 레지스트리 없음/그룹 없음에서 경고가 폭발하지 않는가?
   - `display-status`·`deriveTaskFlags` 코드가 섞여 들어가지 않았는가?
3. `phases/t4-store-domain/index.json`의 step 1을 갱신한다:
   - `"summary"`에 **픽스처 실측 미등록 경고 건수**(`H4`의 답)를 반드시 포함하라.
   - 실패/차단 처리는 step 0과 동일하다.

## 금지사항

- 화면 5색 매핑(`toDisplayStatus`)을 만들지 마라. 이유: step 2의 범위다.
- `isOverdue`·`isDueSoon` 등 파생 판정을 만들지 마라. 이유: step 2의 범위다.
- 미등록 값을 기본값(`'진행 중'` 등)으로 치환하지 마라. 이유: 파서·판정은 값을 보존하고 경고만 남긴다.
- 경고를 값 기준으로 접지 마라. 이유: `H4`의 실측 지표가 건수다.
- 한글 상태 문자열을 `task-semantic.ts` **밖에서** 비교하는 코드를 만들지 마라. 이유: `ADR-009`.
- `SettingsRegistry`나 T2·T3 모듈을 고치지 마라. 이유: 이 step은 읽기만 한다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
