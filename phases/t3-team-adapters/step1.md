# Step 1: row-mapper

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서 하드 실패 금지, 보안 규칙
- `docs/TICKETS.md` — `## T3` 완료 기준 **2·3·8·9·10**
- `docs/PLAN.md` — `E1`(유령 행 25개, `isDataRow` 확정 문구), `E5`(`source_key` 충돌),
  `E6`(숨김 행은 건너뛴다), 「4. 엑셀 파싱 파이프라인」의 `FIELD_MAP`
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `tasks`, `extras jsonb`가 70컬럼 대응의 전부라는 문단
- T2 산출물: `src/types/sheet.ts`, `src/lib/sheet/cell-normalizer.ts`(전 함수 시그니처),
  `src/lib/sheet/header-resolver.ts`(`resolveHeaders`가 돌려주는 `HeaderColumn`)
- 이전 step 산출물: `src/types/task.ts`, `src/types/goal.ts`, `src/lib/sheet/task-schema.ts`

## 배경

어댑터 3종이 공유하는 **행 → 레코드 변환 엔진**이다. 어댑터는 이 엔진에 선언적 표
(`FIELD_MAP`·신원 컬럼)만 넘기고, 절차적 분기를 갖지 않는다. 70컬럼을 if문으로 처리하면
유지가 불가능하다는 것이 티켓의 확정 판단이다.

이 step에서 막아야 할 사고 세 가지:

1. **유령 행 25건** — `02_촬영·기획팀`의 빈 행에 수식이 만든 `FALSE`·`0%`·`1900-01-01`이
   들어차 있다. "셀에 값이 있으면 데이터 행"으로 판정하면 유령 태스크 25건이 생기고
   대시보드가 통째로 무의미해진다.
2. **컬럼 누락** — 매핑되지 않은 컬럼이 조용히 사라지면 70컬럼 대응이 성립하지 않는다.
3. **`source_key` 충돌** — 조용히 덮어쓰면 미리보기의 "신규 N건"이 오히려 *줄어들어서*
   사람이 감지할 수 없다.

## 작업

### 1. `src/lib/sheet/row-mapper.ts`의 인터페이스

```ts
/** ParsedTask에서 이 엔진이 채울 수 있는 스칼라 필드 */
export type TaskScalarField =
  | 'title' | 'ownerNameRaw' | 'status' | 'approvalStatus' | 'priority'
  | 'riskStatus' | 'progress' | 'assignedAt' | 'dueAt' | 'nextAction'
  | 'nextActionOwner' | 'nextActionDue' | 'delayReason' | 'note';

export interface FieldMapEntry {
  /** 헤더 결합 경로의 **마지막 조각**과 정확히 일치해야 한다 */
  header: string;
  field: TaskScalarField;
  kind: 'text' | 'number' | 'date' | 'progress';
}

export interface RowMapSpec {
  teamKey: TeamKey;
  /** 이 값들 중 **하나 이상**에 실제 값이 있어야 데이터 행이다 (PLAN.md E1) */
  identityHeaders: string[];
  /** 있으면 이 컬럼 값이 곧 `sourceKey`다. 예: `업무ID`·`문의 ID` */
  idHeader?: string;
  fieldMap: FieldMapEntry[];
  /** 값이 여럿일 수 있는 컬럼. `coOwnerNames`로 들어간다 */
  coOwnerHeader?: string;
  /** `extras`·`raw`에서 제외할 컬럼(단계 컬럼 등). 어댑터가 넘긴다 */
  excludeFromExtras?: string[];
  /** 날짜 문자열의 연도 추론 기준. `9/1` 같은 값에 쓴다 */
  baseYear: number;
}

export interface RowMapResult {
  tasks: ParsedTask[];
  warnings: ParseWarning[];
  /** 어댑터가 단계 언피벗에 쓴다. `tasks[i]`와 같은 순서다 */
  records: RowRecord[];
}

/** 한 행을 헤더 라벨로 색인한 것. 키는 `HeaderColumn.label`(결합 라벨 원문) */
export interface RowRecord {
  /** 0-based 행 좌표 */
  row: number;
  cells: Map<string, SheetCell>;
  /** 라벨 → 컬럼. 어댑터가 단계 컬럼을 찾을 때 쓴다 */
  columns: HeaderColumn[];
}

export function mapRows(
  sheet: SheetGrid,
  band: HeaderBand,
  spec: RowMapSpec,
  range?: { startRow: number; endRow: number },
): RowMapResult;
```

`range`는 마케팅 탭처럼 한 탭에 표가 여럿일 때 어댑터가 섹션 범위를 넘기는 용도다.
없으면 `band.labelRow + 1`부터 `sheet.rowCount - 1`까지다. 좌표는 전부 **0-based**다.

### 2. 동작 규칙

#### 2-1. 행 선별

1. `range` 안의 행을 위에서 아래로 훑는다.
2. **`sheet.hiddenRows`에 있는 행은 건너뛴다** (완료 기준 10, `E6`).
   경고를 남기지 않는다 — 작업용 임시 행이라는 것이 시트 작성자의 의도다.
3. **신원 판정** (완료 기준 2, `E1`):
   - `spec.identityHeaders`에 해당하는 컬럼만 본다.
   - 그 셀의 원본 `value`가 `{formula}`·`{sharedFormula}`면 **판정에 쓰지 않는다.**
     수식 결과 컬럼으로 행을 살리면 유령 행이 되살아난다.
   - 위를 통과한 셀을 `toText`로 풀어 **하나라도 null이 아니면** 데이터 행이다.
   - 하나도 없으면 그 행은 **조용히 건너뛴다.** 경고를 남기지 마라 — 25건이 25개의 경고가
     되면 진짜 경고가 묻힌다.

#### 2-2. 값 매핑

1. `resolveHeaders(sheet, band)`로 컬럼 목록을 얻는다. 컬럼 키는 `HeaderColumn.label`이다.
2. `FieldMapEntry.header`는 **`column.path`의 마지막 조각과 정확히 일치**할 때 매칭이다.
   접두 일치를 쓰지 마라 — `담당자`가 `기획 담당자`·`후속 담당자`를 잡아 값이 뒤바뀐다.
3. 같은 `header`에 컬럼이 2개 이상 맞으면 **첫 컬럼을 쓰고** `AMBIGUOUS_FIELD_HEADER`
   경고를 한 번(행마다가 아니라 시트당 한 번) 남긴다.
4. `kind`별 변환은 `cell-normalizer`를 그대로 쓴다. 새 변환 함수를 만들지 마라.
   - `text` → `toText`
   - `number` → `toNumber`
   - `date` → `toDateString(value, { baseYear: spec.baseYear })`
   - `progress` → `toProgress(value, numFmt)`
5. `cell-normalizer`가 돌려준 `warning`은 그대로 `ParseWarning`으로 승격한다:
   `{ code: warning, sheet: sheet.name, row: row + 1, column: column + 1 }` (**1-based로 변환**).
6. `coOwnerHeader`가 있으면 그 값을 `,`·`/`·`·`·개행으로 쪼개고 공백을 털어 `coOwnerNames`에
   넣는다. 빈 값이면 빈 배열이다.

#### 2-3. `extras`와 `raw` (완료 기준 3)

- `raw` — **모든 컬럼**을 `label → 값`으로 담는다. 값은 `unwrapCellValue`의 결과를 쓰되,
  `Date`는 `toDateString`으로 문자열화하고, 하이퍼링크 셀은 `{ text, hyperlink }`로 담는다.
  `raw`는 감사·복원용이라 손실이 없어야 한다.
- `extras` — `raw`에서 **`FIELD_MAP`에 매칭된 컬럼**, **`idHeader`**, **`coOwnerHeader`**,
  **`excludeFromExtras`** 를 뺀 나머지 전부. 값이 null인 컬럼도 키를 남긴다.
  키가 있어야 "컬럼이 있는데 비었다"와 "컬럼이 없다"가 구분된다.
  **`identityHeaders`를 이유로 빼지 마라.** 신원 컬럼은 행을 살릴지 판정하는 데 쓸 뿐이고,
  그중 어느 필드에도 매핑되지 않은 것(촬영팀의 `촬영 담당자`)은 `extras`에 남아야 한다.
  판정에 썼다는 이유로 지우면 완료 기준 3(누락 없음)이 깨진다.
- **컬럼 하나도 버리지 마라.** 이것이 완료 기준 3이고, 촬영팀 71컬럼으로 검증된다.

#### 2-4. `sourceKey`와 중복 검출 (완료 기준 8, `E5`)

1. `spec.idHeader` 컬럼에 값이 있으면 그 문자열이 `sourceKey`다.
2. 없으면 `slug(title) + '::' + slug(ownerNameRaw)`. `slug`는 이 파일 안의 함수로 둔다 —
   앞뒤 공백 제거, 연속 공백을 `-` 하나로, 소문자화. **한글을 지우거나 음차하지 마라.**
   null은 빈 문자열로 취급한다.
3. 같은 호출 안에서 `sourceKey`가 이미 나왔으면 `DUPLICATE_SOURCE_KEY` 경고를 남기고
   **두 태스크를 모두 반환한다.** 뒤 건을 버리거나 앞 건을 덮어쓰지 마라 — 판단은 사람이 한다.
4. **경고에 `sourceKey` 문자열을 담지 마라.** 실명이 들어 있다. `code`·`sheet`·`row`만이다.

#### 2-5. 검증

각 태스크에 `validateParsedTask`를 돌려 나온 경고를 `warnings`에 합친다 (완료 기준 9).
검증 실패로 태스크를 버리지 마라.

### 3. 테스트 케이스 (`src/lib/sheet/row-mapper.test.ts`)

손으로 만든 작은 격자로 (픽스처 통합 검증은 step 3·4에서 한다):

1. 신원 컬럼이 전부 비었는데 다른 컬럼에 값이 있는 행 → 태스크 0건, **경고 0건**
2. 신원 컬럼의 값이 `{sharedFormula}`뿐인 행 → 태스크 0건 (수식은 신원 근거가 아니다)
3. 신원 컬럼 하나에만 값이 있는 행 → 태스크 1건
4. `hiddenRows`에 든 행 → 신원 컬럼에 값이 있어도 건너뛴다
5. `FIELD_MAP`에 없는 컬럼이 **전부** `extras`에 남는다 (개수로 검증: 전체 컬럼 수 − 매핑 수)
5-1. **매핑되지 않은 신원 컬럼이 `extras`에 남는다** (판정에 썼다고 지우지 않는다)
6. 값이 null인 미매핑 컬럼도 `extras`에 **키가 남는다**
7. 하이퍼링크 셀이 `{ text, hyperlink }`로 `raw`·`extras`에 보존된다
8. `idHeader` 값이 있으면 그것이 `sourceKey`, 없으면 `업무명::담당자` 꼴이다
9. 같은 업무명·담당자가 두 행이면 `DUPLICATE_SOURCE_KEY` 경고 1건 + **태스크 2건**
10. 경고 객체에 `sourceKey`·업무명·담당자 문자열이 없다
11. `date` 필드에 `1900-01-01` 시리얼이 오면 `null`이 되고 경고가 승격된다 (좌표가 1-based)
12. 같은 마지막 조각을 가진 컬럼이 둘이면 `AMBIGUOUS_FIELD_HEADER`가 **시트당 1건**만 난다
13. `range`를 주면 그 범위 밖의 행은 읽지 않는다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/row-mapper.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/row-mapper.ts ; test $? -eq 1

# 팀 이름이 엔진에 하드코딩되지 않았다 (출력이 비어야 함)
grep -nE "편집팀|촬영|마케팅" src/lib/sheet/row-mapper.ts ; test $? -eq 1

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 팀별 분기(`if (teamKey === 'shoot')` 등)가 이 파일에 하나도 없는가?
   - 좌표 변환(0-based → 1-based)이 경고에서만 일어나는가?
   - 유령 행이 경고를 만들지 않는가 (25건이 25개의 잡음이 되지 않는가)?
3. `phases/t3-team-adapters/index.json`의 step 1을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(내보낸 타입·함수, 신원 판정 규칙,
     `extras`/`raw` 경계, `sourceKey` 규칙, 경고 코드, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 팀 이름·팀별 컬럼 이름을 이 파일에 넣지 마라. 이유: 선언적 표는 어댑터가 갖는다.
- 신원 판정에 수식 셀을 쓰지 마라. 이유: `PLAN.md E1`의 유령 행 25건이 되살아난다.
- 중복 `sourceKey`를 자동 병합·덮어쓰기 하지 마라. 이유: `E5` — 사람이 감지할 수 없게 된다.
- 미매핑 컬럼을 버리지 마라. 이유: 완료 기준 3, 70컬럼 대응의 전부다.
- 숨김 행을 읽지 마라. 이유: `E6`.
- 검증 실패로 태스크를 버리지 마라. 이유: 파서 하드 실패 금지(`CLAUDE.md`).
- 단계 언피벗을 여기서 하지 마라. 이유: step 2의 범위다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
