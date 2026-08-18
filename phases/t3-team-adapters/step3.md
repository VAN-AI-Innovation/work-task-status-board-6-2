# Step 3: adapter-edit-team

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서 하드 실패 금지
- `docs/TICKETS.md` — `## T3` 완료 기준 **1·3·4·8·9·10**, 「리스크·미결」의 선언적 맵 문단
- `docs/PLAN.md` — 「4. 엑셀 파싱 파이프라인」의 `FIELD_MAP`·`STAGE_GROUPS` 예시, `E6`(숨김 행)
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `tasks`·`task_stages`
- T2 산출물: `src/lib/sheet/tab-detector.ts`(`edit_team` 시그니처, 밴드를 여기서 받는다),
  `src/lib/sheet/header-resolver.ts`, `src/lib/sheet/cell-normalizer.ts`,
  `scripts/fixtures/build-sample-workbook.mjs`의 `buildEditTeam`(**행마다 무엇을 넣었는지 반드시 읽어라**)
- 이전 step 산출물: `src/types/task.ts`, `src/lib/sheet/row-mapper.ts`, `src/lib/sheet/stage-unpivot.ts`

## 배경

`01_편집팀`은 16컬럼(A~P)이고 헤더 밴드는 **`{ groupRow: 7, labelRow: 8 }`(0-based)** 이다.

```
r8(0-based 7)   기본 업무정보(A~D 병합) │ 컨셉·레퍼런스 (+2일)(E~H) │ 제작 진행 (+5일)(I~L) │ 최종본·업로드 (+7일)(M~O) │ 비고(P)
r9(0-based 8)   업무명 담당자 % 배정일  │ 예정일 실제 내용 확인      │ 예정일 실제 내용 확인   │ 예정일 실제 확인          │ 비고
```

데이터 행은 0-based 9~14다. 픽스처가 심어 둔 함정:

| 0-based 행 | 내용 |
|---|---|
| 9  | 셀 형태 총집합 — 공유 수식 마스터, 하이퍼링크 2건, 리치텍스트, 문자열 날짜 `2026.07.22` |
| 10 | `{sharedFormula}`(result 없음), 배정일이 **엑셀 시리얼 숫자 46000** |
| 11 | `{error:'#REF!'}` 셀, 연도 없는 날짜 `9/1`, 하이픈 `-` |
| 12 | **숨김 행.** 신원 컬럼에 값이 있다 — 건너뛰지 않으면 태스크가 6건이 된다 |
| 13·14 | **세로 병합** `A14:A15`. 업무명은 같고 담당자만 다르다 (`담당자2`/`담당자3`) |

기대 결과는 **태스크 5건**(0-based 9·10·11·13·14)이고, 13·14는 `sourceKey`가 서로 달라야 한다
(담당자가 다르므로). 이 둘이 하나로 합쳐지면 `slug(업무명)+담당자` 규칙이 깨진 것이다.

## 작업

### 1. `src/lib/sheet/adapter-edit-team.ts`

```ts
export function parseEditTeamTab(
  sheet: SheetGrid,
  band: HeaderBand,
  ctx: { baseYear: number },
): TabParseResult;
```

밴드는 호출자(step 8의 파이프라인)가 `detectTab`의 `matches[0].band`에서 꺼내 넘긴다.
**이 함수가 스스로 탭을 찾거나 판별하지 않는다.**

### 2. 선언적 상수 두 개만 쓴다

```ts
const IDENTITY_HEADERS = ['업무명', '담당자'];

const FIELD_MAP: FieldMapEntry[] = [
  { header: '업무명', field: 'title', kind: 'text' },
  { header: '담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '%', field: 'progress', kind: 'progress' },
  { header: '배정일', field: 'assignedAt', kind: 'date' },
  { header: '비고', field: 'note', kind: 'text' },
];

const STAGE_GROUPS: StageGroupSpec[] = [
  { key: 'concept', label: '컨셉·레퍼런스', groupHeader: '컨셉·레퍼런스 (+2일)', slaDays: 2,
    cols: { planned: '예정일', actual: '실제', content: '내용', confirm: '확인' } },
  { key: 'production', label: '제작 진행', groupHeader: '제작 진행 (+5일)', slaDays: 5,
    cols: { planned: '예정일', actual: '실제', content: '내용', confirm: '확인' } },
  { key: 'final', label: '최종본·업로드', groupHeader: '최종본·업로드 (+7일)', slaDays: 7,
    cols: { planned: '예정일', actual: '실제', confirm: '확인' } },
];
```

`slaDays`의 근거는 **그룹 헤더의 `(+N일)`** 이다. T2가 헤더 원문을 자르지 않고 보존한 이유가
이것이다. 설정 탭 SLA 표와 잇는 일은 T4다 — 여기서 이으려 하지 마라.

세 번째 그룹에 `content`가 없는 것은 오타가 아니다. 시트의 M~O가 3컬럼이다.

### 3. 조립 순서

1. `mapRows(sheet, band, spec)` — `spec.excludeFromExtras`에는
   `stageColumnLabels(resolveHeaders(sheet, band), STAGE_GROUPS)`를 넘긴다.
   단계 컬럼이 `extras`에도 중복으로 들어가면 사이드 패널에 같은 값이 두 번 뜬다.
2. 반환된 `records`로 `unpivotStages`를 돌려 각 태스크의 `stages`를 채운다.
3. 경고를 합쳐 `TabParseResult`로 반환한다. `teamKey`는 `'edit'`, `goalMetrics`·
   `teamPeriodGoals`·`briefingLines`는 빈 배열이다.

### 4. 테스트 케이스 (`src/lib/sheet/adapter-edit-team.test.ts`)

픽스처(`src/lib/fixtures/sample-workbook.xlsx`)를 `readWorkbook`으로 읽고 `detectTab`으로
밴드를 얻어 통합 검증한다. 밴드를 손으로 하드코딩하지 마라 — 파이프라인과 다른 경로가 된다.

1. **태스크가 정확히 5건**이고 숨김 행의 업무명이 그중에 없다 (완료 기준 10)
2. 각 태스크의 `stages`가 **정확히 3행**이고 `seq`가 0·1·2다 (완료 기준 4)
3. 0-based 9행: `stages[0].plannedDate === '2026-07-22'`(수식 `result`가 `Date`),
   `stages[1].plannedDate === '2026-07-25'`, `progress === 33`(퍼센트 0.33 → 33)
4. **두 그룹의 `예정일`이 서로 다른 값**이다 — 하위 라벨 충돌이 실제로 막혔는지 보는 테스트
5. 0-based 10행: `progress`가 null이고 `FORMULA_WITHOUT_RESULT` 경고가 있다,
   `assignedAt`이 시리얼 46000에서 `YYYY-MM-DD`로 변환된다
6. 0-based 11행: `stages[0].plannedDate`가 `9/1` → `ctx.baseYear` 기준 `YYYY-09-01`,
   `#REF!` 셀에서 `CELL_ERROR` 경고가 난다
7. 0-based 13·14행: 업무명이 같고 `sourceKey`가 **서로 다르다**, `DUPLICATE_SOURCE_KEY` 경고가 없다
8. `extras`에 단계 컬럼(`예정일`·`실제`·`내용`·`확인`)이 **하나도 없다**
9. `raw`에는 16컬럼이 모두 있다 (`extras`와 `raw`의 역할 구분)
10. 하이퍼링크 셀(`컨셉 문서`·`제작 파일`)의 URL이 `stages[].content` 또는 `raw`에 보존된다
11. 리치텍스트 셀(`비고`)이 조각을 이어붙인 문자열이 된다
12. 모든 경고에 셀 값·업무명·담당자가 들어 있지 않다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/adapter-edit-team.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/adapter-edit-team.ts ; test $? -eq 1

# 절차적 분기로 컬럼을 처리하지 않았다 — if/else if 사슬이 없어야 한다 (눈으로 확인)
grep -c "else if" src/lib/sheet/adapter-edit-team.ts

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 어댑터가 `FIELD_MAP`·`STAGE_GROUPS`·`IDENTITY_HEADERS` 세 상수와 조립 코드뿐인가?
   - 밴드를 인자로 받는가 (스스로 찾지 않는가)?
   - 숨김 행이 실제로 빠졌는가 (5건인가)?
3. `phases/t3-team-adapters/index.json`의 step 3을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(태스크 5건의 근거, 단계 3행, `slaDays` 출처,
     `extras` 키 개수, 발생한 경고 코드, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 촬영팀·마케팅팀 어댑터를 만들지 마라. 이유: step 4·6·7의 범위다.
- 밴드를 스스로 찾지 마라. 이유: 판별은 T2의 `tab-detector`가 끝냈다.
- `if`문으로 컬럼을 하나씩 처리하지 마라. 이유: 티켓 「리스크·미결」의 확정 판단이다.
- 설정 탭 SLA와 `stageKey`를 잇지 마라. 이유: T4의 범위다.
- 상태 문자열을 `semantic` 코드로 바꾸지 마라. 이유: `ADR-009`, T4의 범위다.
- 단계 컬럼을 `extras`에 중복으로 넣지 마라. 이유: 사이드 패널에 같은 값이 두 번 뜬다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
