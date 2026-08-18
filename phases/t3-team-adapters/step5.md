# Step 5: section-splitter

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 단순함 우선
- `docs/TICKETS.md` — `## T3` 완료 기준 **5**
- `docs/PLAN.md` — 「4. 엑셀 파싱 파이프라인」의 `section-splitter 마케팅 탭 A/B/C 분할
  (빈 행 2개 이상 + "A." 헤더 패턴)`, 「A. 엑셀」의 `03_마케팅·관리팀` 설명
- `docs/ARCHITECTURE.md` — 「데이터 흐름」의 `section-splitter` 줄
- T2 산출물: `src/lib/sheet/header-resolver.ts`(`findHeaderBands`가 한 탭에서 밴드를 여럿 돌려준다),
  `src/lib/sheet/cell-normalizer.ts`,
  `scripts/fixtures/build-sample-workbook.mjs`의 `buildMarketingTeam`
- 이전 step 산출물: `src/types/task.ts`, `src/lib/sheet/row-mapper.ts`

## 배경

`03_마케팅·관리팀`은 **한 탭에 표가 셋**이다. 그것도 A→B→C 순이 아니라 **C → A → B** 순으로
세로로 놓여 있다. 순서를 가정하면 틀린다.

픽스처의 실제 배치 (0-based):

| 행 | 내용 |
|---|---|
| 0~6 | 내비·배너·KPI 라벨·KPI 수식 (장식) |
| 7 | 전체 폭 배너 `C. 주간 회의 브리핑` |
| 8~12 | 자유 텍스트 5줄 (A열에만) |
| 13~14 | **빈 행 2줄** |
| 15 | 전체 폭 배너 `A. 상시 문의·SNS 관리` |
| 16 | 헤더 20컬럼 |
| 17~19 | 문의 3건 |
| 20~21 | **빈 행 2줄** |
| 22 | 전체 폭 배너 `B. 주간 마케팅 실행·성과 관리` |
| 23 | 헤더 30컬럼 |
| 24~26 | 실행·성과 3건 |

배너 행은 시트 전체 폭 병합이라 **T2의 `findHeaderBands`가 헤더 후보로 잡지 않는다**
(전체 폭 배너를 거르는 조건이 이미 들어 있다). 그래서 배너를 직접 찾아야 한다.

## 작업

### 1. `src/lib/sheet/section-splitter.ts`

```ts
export type SectionKey = 'A' | 'B' | 'C';

export interface SheetSection {
  key: SectionKey;
  /** 배너 원문. 예: `A. 상시 문의·SNS 관리` */
  title: string;
  /** 배너 행. 0-based */
  titleRow: number;
  /** 내용 시작 행(배너 다음 행). 0-based */
  startRow: number;
  /** 내용 끝 행, 포함. 0-based */
  endRow: number;
  /** 이 범위 안의 헤더 밴드. 자유 텍스트 섹션이면 null */
  band: HeaderBand | null;
}

export function splitSections(sheet: SheetGrid): SheetSection[];
```

### 2. 동작 규칙

1. 모든 행을 훑어 **첫 번째로 값이 있는 셀의 텍스트**가 `/^([ABC])\.\s*(.+)$/`에 맞으면
   섹션 배너다. `key`는 캡처한 글자, `title`은 셀 원문 전체다.
2. 섹션은 **시트에 나온 순서 그대로** 돌려준다. `A`·`B`·`C`로 정렬하지 마라 —
   픽스처가 C→A→B다.
3. `endRow`는 **다음 배너 행 − 1**, 마지막 섹션은 `sheet.rowCount - 1`이다.
   그런 뒤 **뒤쪽의 빈 행을 잘라낸다**(모든 컬럼이 빈 행). 섹션 사이 빈 행 2줄이
   앞 섹션에 딸려 들어가면 뒤 섹션의 데이터 범위 계산이 어긋난다.
4. `band`는 `findHeaderBands(sheet)`가 돌려준 후보 중 **`startRow ≤ labelRow ≤ endRow`**
   인 첫 번째다. 없으면 null이다 (C섹션이 그렇다).
   밴드 판정 로직을 여기서 새로 쓰지 마라 — `header-resolver`가 이미 갖고 있다.
5. 배너가 하나도 없으면 **빈 배열**을 돌려준다. 예외를 던지지 마라. 섹션이 없는 탭이 정상이다.
6. 같은 `key`가 두 번 나오면 둘 다 돌려주고 `DUPLICATE_SECTION` 경고는 **만들지 않는다** —
   이 함수는 경고를 만들지 않고 사실만 돌려준다. 판단은 어댑터가 한다.

### 3. 테스트 케이스 (`src/lib/sheet/section-splitter.test.ts`)

픽스처로:

1. 섹션이 **3개**이고 순서가 **C · A · B**다
2. `A` 섹션의 `band.labelRow === 16`, `B` 섹션의 `band.labelRow === 23` (0-based)
3. `C` 섹션의 `band`가 **null**이다
4. `A` 섹션의 `endRow === 19`다 — 뒤의 빈 행 2줄이 포함되지 않았다
5. `C` 섹션의 `endRow === 12`다
6. 각 섹션의 `title`이 배너 원문 그대로다

작은 격자로:

7. 배너가 없는 시트 → 빈 배열
8. 배너가 하나뿐인 시트 → `endRow`가 마지막 비지 않은 행이다
9. `A.` 패턴을 닮았지만 아닌 텍스트(`A/B 테스트 결과`)는 배너로 잡히지 않는다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/section-splitter.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/section-splitter.ts ; test $? -eq 1

# 밴드 판정을 다시 구현하지 않았다 — header-resolver를 쓴다 (출력이 있어야 함)
grep -n "findHeaderBands" src/lib/sheet/section-splitter.ts

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 섹션 순서를 정렬하지 않았는가 (C·A·B 그대로인가)?
   - 뒤쪽 빈 행이 잘렸는가?
   - 마케팅이라는 단어가 이 파일에 하드코딩돼 있지 않은가 (A/B/C 패턴만 안다)?
3. `phases/t3-team-adapters/index.json`의 step 5를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(시그니처, 픽스처 섹션 3개의 좌표,
     밴드 연결 방식, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 섹션을 `A`·`B`·`C` 순으로 정렬하지 마라. 이유: 시트가 C→A→B다.
- 헤더 밴드 판정을 다시 구현하지 마라. 이유: `header-resolver`가 이미 한다.
- 여기서 태스크·지표를 만들지 마라. 이유: step 6·7의 범위다.
- 경고를 만들지 마라. 이유: 이 함수는 사실만 돌려주고 판단은 어댑터가 한다.
- 배너가 없다고 예외를 던지지 마라. 이유: 파서 하드 실패 금지(`CLAUDE.md`).
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
