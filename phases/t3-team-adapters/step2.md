# Step 2: stage-unpivot

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 단순함 우선
- `docs/TICKETS.md` — `## T3` 완료 기준 **4**, 「리스크·미결」의 `STAGE_GROUPS` 문단
- `docs/PLAN.md` — 「1. 데이터 모델」의 `task_stages`, 「4. 엑셀 파싱 파이프라인」의
  `STAGE_GROUPS` 예시
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `task_stages`
- T2 산출물: `src/lib/sheet/header-resolver.ts`(2단 헤더가 `['컨셉·레퍼런스 (+2일)', '예정일']`
  꼴 경로로 결합된다), `src/lib/sheet/cell-normalizer.ts`
- 이전 step 산출물: `src/types/task.ts`(`ParsedStage`), `src/lib/sheet/row-mapper.ts`(`RowRecord`)

## 배경

`01_편집팀`은 단계 3개가 **컬럼 그룹으로 옆으로 펼쳐진 wide 포맷**이다.

```
r8   기본 업무정보 (A~D)      컨셉·레퍼런스 (+2일) (E~H)   제작 진행 (+5일) (I~L)   최종본·업로드 (+7일) (M~O)   비고 (P)
r9   업무명 담당자 % 배정일    예정일 실제 내용 확인         예정일 실제 내용 확인      예정일 실제 확인            비고
```

이걸 `task_stages` 3행으로 펴는 것이 언피벗이다. `예정일`·`실제`·`내용`·`확인`이 단계마다
반복되므로 **하위 라벨만으로는 컬럼을 구분할 수 없다** — T2의 헤더 결합이 이걸 위해 있었다.

이 함수는 팀을 모른다. 어댑터가 `STAGE_GROUPS` 상수를 넘긴다.

## 작업

### 1. `src/lib/sheet/stage-unpivot.ts`의 인터페이스

```ts
export interface StageGroupSpec {
  /** 안정 키. 시트 문자열이 바뀌어도 유지된다. 예: `concept` */
  key: string;
  /** 화면에 보일 짧은 이름. 예: `컨셉·레퍼런스` */
  label: string;
  /** 헤더 결합 경로의 **첫 조각**과 정확히 일치해야 한다. 예: `컨셉·레퍼런스 (+2일)` */
  groupHeader: string;
  /** 시트 그룹 헤더의 `(+N일)`에서 읽은 값. 없으면 null */
  slaDays: number | null;
  /** 값은 경로의 **마지막 조각**과 정확히 일치해야 한다 */
  cols: {
    planned?: string;
    actual?: string;
    content?: string;
    confirm?: string;
  };
}

export function unpivotStages(
  record: RowRecord,
  groups: StageGroupSpec[],
  ctx: { sheet: string; baseYear: number },
): { stages: ParsedStage[]; warnings: ParseWarning[] };

/** 어댑터가 `excludeFromExtras`에 넘길 컬럼 라벨을 계산한다 */
export function stageColumnLabels(columns: HeaderColumn[], groups: StageGroupSpec[]): string[];
```

### 2. 동작 규칙

1. 컬럼 선택은 **`path[0] === groupHeader` 그리고 `path[path.length - 1] === cols.X`** 두 조건을
   모두 만족하는 컬럼이다. 라벨 문자열(`컨셉·레퍼런스 (+2일) / 예정일`)을 통째로 비교하지 마라 —
   구분자 규칙이 바뀌면 전부 깨진다.
2. **그룹마다 항상 `ParsedStage` 1행을 만든다.** 그 행의 모든 값이 비어도 만든다.
   완료 기준 4가 "3개 컬럼 그룹이 3행으로"라고 못박고 있고, 단계가 아직 시작되지 않은 것과
   단계가 없는 것은 다르다.
3. `seq`는 `groups` 배열 순서 그대로 0부터다.
4. `stageLabel`은 `spec.label`이 아니라 **시트의 그룹 헤더 원문**(`groupHeader`)을 넣는다.
   화면에 시트와 같은 글자가 떠야 사용자가 대조할 수 있다.
5. 값 변환은 `cell-normalizer`를 쓴다: `planned`·`actual`은 `toDateString(v, { baseYear })`,
   `content`·`confirm`은 `toText`. 편집팀의 `확인` 컬럼은 불리언 셀이고 `toText`가
   `'true'`/`'false'` 문자열을 준다 — **그대로 둔다.** `true`를 `'완료'`·`'확인됨'` 같은 말로
   바꾸지 마라. 상태 해석은 T4의 `task-semantic`이 설정 탭 레지스트리를 근거로 한다.
6. `slaDays`는 `spec.slaDays`를 그대로 복사한다. 설정 탭의 SLA 레지스트리와 잇는 일은 T4다
   (`SlaRuleEntry`에 `stageKey`가 없는 이유가 그것이다).
7. `cell-normalizer` 경고는 `{ code, sheet, row: record.row + 1, column: column + 1 }`로 승격한다.
8. `groupHeader`에 맞는 컬럼이 하나도 없으면 `STAGE_GROUP_NOT_FOUND` 경고를 남기고
   **빈 값의 단계 행은 그대로 만든다.** 예외를 던지지 마라.

### 3. 테스트 케이스 (`src/lib/sheet/stage-unpivot.test.ts`)

손으로 만든 작은 격자로:

1. 그룹 2개 × 컬럼 4종 → 단계 2행, `seq` 0·1
2. 두 그룹의 하위 라벨이 똑같아도(`예정일`이 양쪽에) 값이 섞이지 않는다 — **이 테스트가 이 모듈의 존재 이유다**
3. 값이 전부 빈 그룹도 행이 만들어진다 (`plannedDate` 등이 전부 null)
4. `cols`에 `content`가 없는 그룹(편집팀 3단계처럼)은 `content`가 null이다
5. `slaDays`가 그대로 실린다
6. `groupHeader`에 맞는 컬럼이 없으면 `STAGE_GROUP_NOT_FOUND` 경고 + 행은 생성
7. 날짜 셀이 `1900-01-01` 시리얼이면 null + 경고 승격(좌표 1-based)
8. `stageColumnLabels`가 그룹에 속한 컬럼 라벨을 **전부** 돌려준다 (`extras` 중복 방지용)

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/stage-unpivot.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/stage-unpivot.ts ; test $? -eq 1

# 팀·단계 이름이 엔진에 하드코딩되지 않았다 (출력이 비어야 함)
grep -nE "컨셉|제작 진행|최종본|섭외" src/lib/sheet/stage-unpivot.ts ; test $? -eq 1

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 컬럼 선택이 `path[0]`+마지막 조각 두 축인가 (라벨 통째 비교가 아닌가)?
   - 값이 빈 그룹도 행을 만드는가?
   - 불리언 확인 값에 임의 해석이 붙지 않았는가?
3. `phases/t3-team-adapters/index.json`의 step 2를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(시그니처, 컬럼 선택 규칙, 빈 그룹 처리,
     `stageColumnLabels`의 용도, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 편집팀·촬영팀의 실제 단계 이름을 이 파일에 넣지 마라. 이유: 상수는 어댑터가 갖는다.
- 값이 빈 그룹의 행을 버리지 마라. 이유: 완료 기준 4가 개수를 못박고 있다.
- 확인 컬럼의 불리언(`'true'`/`'false'`)을 `완료`·`미확인` 같은 말로 바꾸지 마라.
  이유: 해석은 T4의 `task-semantic`이다.
- 설정 탭 SLA와 `stageKey`를 여기서 잇지 마라. 이유: T4의 범위다.
- 어댑터를 만들지 마라. 이유: step 3·4의 범위다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
