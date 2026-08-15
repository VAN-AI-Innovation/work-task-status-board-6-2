# Step 3: header-resolver

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, `src/lib/` 파일명 전역 유니크
- `docs/TICKETS.md` — `## T2` 완료 기준 **2**, `## T3` 완료 기준 3·4(이 모듈의 출력으로
  어댑터가 무엇을 하는지)
- `docs/ARCHITECTURE.md` — 「엑셀 → 조회」 흐름의 `header-resolver` 줄
- `docs/PLAN.md` — 「4. 엑셀 파싱 파이프라인」의 `FIELD_MAP`·`STAGE_GROUPS` 설명
- 이전 step 산출물: `src/types/sheet.ts`(좌표 규칙), `src/lib/sheet/workbook-reader.ts`,
  `src/lib/sheet/cell-normalizer.ts`, `scripts/fixtures/build-sample-workbook.mjs`

## 배경

실제 시트의 헤더는 **1행이 아니라 8·9행**이고, 위에 장식 행(네비 링크·배너 2줄·KPI 2줄·
안내 문구)이 7줄 깔려 있다. 게다가 `03_마케팅·관리팀`은 **한 탭 안에 헤더 행이 두 개**다
(A 섹션·B 섹션). "첫 행이 헤더"라는 가정은 이 시트에서 전부 틀린다.

그래서 이 모듈은 두 가지를 한다.

1. **헤더로 보이는 행 후보를 찾는다** (`findHeaderBands`) — 확정하지 않는다. 어느 후보가
   진짜인지는 step 4의 시그니처 매칭이 정한다. 후보를 넉넉히 내는 편이 안전하다.
2. **찾은 헤더 밴드를 컬럼 경로로 결합한다** (`resolveHeaders`) —
   `컨셉·레퍼런스 (+2일)` + `예정일` → `컨셉·레퍼런스 (+2일) / 예정일`.

결합이 필요한 이유는 미관이 아니다. `01_편집팀`의 16컬럼에서 `예정일`·`실제`·`내용`·`확인`이
**단계마다 반복**된다. 하위 라벨만 보면 컬럼 12개가 4개로 뭉개져 어느 단계의 예정일인지
알 수 없다. 그룹을 붙여야 컬럼 키가 유일해지고, T3의 stage 언피벗이 가능해진다.

> 티켓 완료 기준 2는 `컨셉·레퍼런스 / 예정일`이라고 줄여 적었지만, 실제 그룹 셀 문자열은
> `컨셉·레퍼런스 (+2일)`이다. **원문을 자르지 않는다.** `(+2일)`은 T3의 `STAGE_GROUPS`가
> SLA 기본값을 읽을 근거다. 테스트는 `path[0]`이 `컨셉·레퍼런스`로 시작하고
> `path[1] === '예정일'`임을 확인하는 형태로 쓴다.

## 작업

### 1. 타입 (`src/types/sheet.ts`에 추가)

```ts
export interface HeaderBand {
  groupRow: number | null;   // 0-based. 상위 그룹 행이 없으면 null
  labelRow: number;          // 0-based
}

export interface HeaderColumn {
  index: number;             // 0-based 컬럼 인덱스
  path: string[];            // ['컨셉·레퍼런스 (+2일)', '예정일']
  label: string;             // path.join(' / ')
}
```

### 2. `src/lib/sheet/header-resolver.test.ts`를 **먼저** 쓴다

```ts
export function findHeaderBands(sheet: SheetGrid): HeaderBand[]
export function resolveHeaders(sheet: SheetGrid, band: HeaderBand): HeaderColumn[]
```

테스트는 두 층으로 쓴다.

- **손으로 만든 작은 `SheetGrid`** — 판정 규칙 하나하나를 좁게 검증한다.
  픽스처만 쓰면 왜 통과했는지 알 수 없다.
- **픽스처 통합** — `readWorkbook`으로 실제 격자를 얻어 완료 기준 2를 확인한다.

### 3. `findHeaderBands` — 후보 탐색 규칙

**라벨 행 후보**의 조건 (전부 만족):

- `cell-normalizer.toText`로 풀었을 때 값이 있는 셀이 **3개 이상**
- 그 값들이 **서로 다른 값 3개 이상**을 포함한다 — 전체 폭 병합 배너는 모든 셀이 같은
  문자열이라 이 조건에서 탈락한다. **배너를 거르는 장치가 이것이다.**
- 값이 전부 **짧은 텍스트**다 (길이 40자 이하). 안내 문구·본문 행이 걸러진다
- 수식에서 온 값(`FORMULA_WITHOUT_RESULT` 경고가 나거나 `{formula}` 형태)이 **없다** —
  KPI 숫자 행이 걸러진다
- 그 아래에 행이 하나 이상 남아 있다

**그룹 행** 판정: 라벨 행 **바로 위** 행이 아래를 만족하면 `groupRow`로 붙인다.

- 그 행에 **2컬럼 이상을 덮는 가로 병합**이 하나 이상 있다 (`sheet.merges` 기준)
- 그 병합이 **시트 전체 폭을 통째로 덮지는 않는다** (전체 폭 하나짜리는 배너다)

만족하지 않으면 `groupRow: null`인 단층 헤더로 본다 (`99_설정`·마케팅 섹션이 이 경우다).

후보는 **위에서 아래 순서로 전부** 돌려준다. 한 탭에 두 개 이상 나오는 것이 정상이다
(마케팅 탭의 A·B 섹션). 여기서 "진짜 헤더 하나"를 고르려 하지 마라 — step 4의 일이다.

### 4. `resolveHeaders` — 경로 결합 규칙

컬럼 `0 .. columnCount-1`을 돌며:

1. `label = toText(cells[labelRow][col])`
2. `group = groupRow != null ? toText(cells[groupRow][col]) : null`
3. **그룹 값 채우기는 `sheet.merges`에 근거해서만 한다.** 그룹 셀이 비어 있고 그 좌표가
   어떤 가로 병합 범위 안에 있으면 그 범위의 왼쪽 끝 값을 쓴다.
   **범위 밖으로 무조건 forward-fill 하지 마라** — `기본 업무정보`가 시트 오른쪽 끝까지
   번져 컬럼 키가 전부 오염된다. (리더가 이미 병합 값을 채워 준다면 이 분기는 실행되지
   않는다. 그렇더라도 방어로 남긴다 — 근거가 `merges`라서 틀릴 여지가 없기 때문이다.)
4. `path`는 `[group, label]`에서 빈 값을 뺀 것. **둘이 같은 문자열이면 하나로 접는다**
   (`P8=비고` / `P9=비고` → `['비고']`)
5. `label`은 `path.join(' / ')`
6. `path`가 비면(그룹·라벨 둘 다 빈 컬럼) **결과에서 제외**한다. 인덱스는 `HeaderColumn.index`가
   들고 있으므로 배열 위치와 컬럼 위치를 혼동하지 마라

### 5. 테스트 케이스

작은 격자로:

1. 전체 폭 병합 배너 행이 후보에서 **탈락**한다
2. 수식 값만 있는 KPI 행이 후보에서 **탈락**한다
3. 값 2개짜리 행이 후보에서 탈락한다 (3개 이상 규칙)
4. 그룹 행이 없는 단층 헤더에서 `groupRow: null`이 나온다
5. 병합 범위 밖 컬럼에 그룹 값이 **번지지 않는다**
6. 그룹과 라벨이 같은 문자열이면 경로가 하나로 접힌다

픽스처로:

7. **`01_편집팀`에서 `path[0]`이 `컨셉·레퍼런스`로 시작하고 `path[1] === '예정일'`인 컬럼이
   존재한다** (완료 기준 2)
8. `01_편집팀`의 결합 라벨 16개가 **전부 유일하다** — 이것이 결합의 존재 이유다
9. `기본 업무정보` 그룹이 A~D 4컬럼에만 붙고 E부터는 `컨셉·레퍼런스 (+2일)`이다
10. `02_촬영·기획팀`에서 컬럼 **71개**가 결합되고, 그룹 8종이 각각 실제 컬럼 수만큼 붙는다
11. `03_마케팅·관리팀`에서 후보 밴드가 **2개 이상** 나오고, 그중 하나의 라벨에
    `문의 ID`가, 다른 하나에 `마케팅 과제명`이 들어 있다
12. `99_설정`에서 `groupRow: null`인 밴드가 나오고 라벨에 `공통_진행 상태`가 있다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/header-resolver.test.ts

# 계층 경계 — 이 파일은 exceljs를 모른다 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/header-resolver.ts ; test $? -eq 1

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - `findHeaderBands`가 후보를 **여러 개** 돌려주는가? (하나로 좁히면 마케팅 탭이 깨진다)
   - forward-fill이 `merges` 범위 안에서만 일어나는가?
   - 탭 종류를 판단하는 코드가 섞이지 않았는가? (step 4의 범위)
   - 손으로 만든 격자 테스트와 픽스처 테스트가 **둘 다** 있는가?
3. `phases/t2-parsing-core/index.json`의 step 3을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"` (내보낸 시그니처, 후보 판정 규칙 요약,
     탭별로 나온 밴드 개수, 완료 기준 2 충족 근거, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 탭 종류를 판별하거나 시그니처를 매칭하지 마라. 이유: step 4의 범위다.
- 데이터 행 판정(`isDataRow`)을 넣지 마라. 이유: `ADR-011`이 정한 T3의 범위다.
- 헤더 문자열에서 `(+2일)` 같은 접미사를 잘라내지 마라. 이유: T3의 `STAGE_GROUPS`가
  SLA 기본값을 읽을 근거다. 자르면 정보가 사라진다.
- 병합 범위와 무관한 무조건 forward-fill을 쓰지 마라. 이유: 그룹 라벨이 오른쪽 끝까지 번진다.
- 헤더 문자열을 소문자화·공백제거 같은 방식으로 정규화해 저장하지 마라. 이유: 매칭 시점의
  정규화는 어댑터(T3)가 자기 규칙으로 한다. 저장값은 원문이어야 `extras` 키가 사람이 읽힌다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
