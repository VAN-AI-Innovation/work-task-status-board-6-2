# Step 5: adapter-settings-tab

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(집계·판정은 `lib/domain/`), TDD, 파서 하드 실패 금지
- `docs/TICKETS.md` — `## T2` 완료 기준 **7**, `## T4` 완료 기준 1(`enum_options`·`sla_rules` 테이블)
- `docs/ARCHITECTURE.md` — 데이터 모델의 `enum_options`·`sla_rules`, **`enum_options.semantic`이
  급소**라는 문단
- `docs/PLAN.md` — 「A. 엑셀」의 설정 탭 설명, `enum_options.semantic` 매핑표,
  「4. 엑셀 파싱 파이프라인」의 `[설정 탭 먼저] enum/SLA 레지스트리 확보`
- 이전 step 산출물: `src/lib/sheet/tab-detector.ts`(밴드를 여기서 받는다),
  `src/lib/sheet/header-resolver.ts`, `src/lib/sheet/cell-normalizer.ts`,
  `scripts/fixtures/build-sample-workbook.mjs`(설정 탭에 무엇을 넣었는지)

## 배경

설정 탭이 **정규화의 근거**다. 팀별 어댑터(T3)가 상태 문자열을 만나면 이 레지스트리에
있는 값인지 대조해 미등록 값을 경고로 올린다. 이게 없으면 오타와 자유 입력이 조용히 통과한다.

설정 탭의 모양은 다른 탭과 다르다. **컬럼 하나가 enum 그룹 하나**이고, 값은 세로로 내려간다.

```
r3  편집팀 구성원 | … | 공통_우선순위 | 공통_리스크 상태 | 공통_진행 상태 | … | 기본 SLA 설정_항목 | 기본 SLA 설정_일수
r4               | … | 긴급          | 정상            | 업무 배정      | … | 편집팀 컨셉 공유    | 1
r5               | … | 높음          | 주의            | 준비 중        | … | 편집팀 컨셉 승인    | 1
…
```

### 함정 — 컬럼을 시트 끝까지 읽으면 안 된다

실제 설정 탭에는 위 블록이 끝난 뒤 **빈 행 몇 개를 두고 아래쪽에 SLA 표가 한 번 더** 있다.
그 표의 헤더가 A·B 컬럼에 놓여 있어서, A컬럼(`편집팀 구성원`)의 값을 시트 끝까지 긁으면
**SLA 항목명이 구성원 목록으로 들어간다.**

그래서 값 수집은 **밴드 안에서만** 한다: 라벨 행 다음 행부터 읽되, **밴드 컬럼 전체가 빈 행**을
만나면 거기서 끝낸다. 아래쪽 SLA 표는 그것대로 따로 찾아 병합한다 (아래 3-2).

## 작업

### 1. 타입 (`src/types/sheet.ts`에 추가)

```ts
export interface EnumOptionEntry {
  groupKey: string;    // '공통_진행 상태' — 시트 원문 그대로
  value: string;       // '진행 중' — 원문 그대로
  sortOrder: number;   // 시트에 나온 순서, 0부터
}

export interface SlaRuleEntry {
  label: string;       // '촬영팀 섭외' — 시트 원문 그대로
  days: number;
}

export interface SettingsRegistry {
  enums: EnumOptionEntry[];
  slaRules: SlaRuleEntry[];
  warnings: ParseWarning[];
}
```

`sortOrder`가 필요한 이유: `공통_진행 상태` 10단계는 **순서가 곧 진행 흐름**이다
(업무 배정 → … → 완료). 알파벳순으로 뭉개면 화면의 단계 정렬이 무너진다.

`SlaRuleEntry`에 `stageKey`를 만들지 마라. 시트에는 사람이 읽는 라벨(`촬영팀 섭외`)밖에
없고, 단계 키와 잇는 근거는 T3의 `STAGE_GROUPS`에 가서야 생긴다. 여기서 키를 지어내면
T3가 다른 규칙으로 지은 키와 어긋난다.

### 2. `src/lib/sheet/adapter-settings-tab.test.ts`를 **먼저** 쓴다

```ts
export function parseSettingsTab(sheet: SheetGrid, band: HeaderBand): SettingsRegistry
```

밴드는 호출자(T3의 파이프라인)가 `detectTab`의 `matches`에서 꺼내 넘긴다.
이 함수가 스스로 탭을 찾거나 판별하지 않는다.

### 3. 동작 규칙

#### 3-1. enum 그룹 수집

1. `resolveHeaders(sheet, band)`로 컬럼 목록을 얻는다. 각 컬럼의 `label`이 곧 `groupKey`다.
2. 라벨 행 다음 행부터 아래로 내려가며 값을 모은다. **밴드 컬럼이 전부 빈 행에서 멈춘다.**
3. 값은 `cell-normalizer.toText`로 푼다. 수식·리치텍스트 셀이 섞여 있어도 문자열이 되어야 한다.
4. 빈 칸은 건너뛴다. 컬럼마다 값 개수가 다른 것이 정상이다 (`공통_우선순위` 4개,
   `공통_진행 상태` 10개).
5. `sortOrder`는 **건너뛴 빈 칸을 세지 않은** 0부터의 연번이다.
6. `기본 SLA 설정_항목`·`기본 SLA 설정_일수` 두 컬럼은 enum이 아니다 — 3-2에서 쓴다.
   `enums`에 넣지 마라.
7. **구성원 컬럼(`편집팀 구성원` 등)도 같은 루프로 그냥 담는다.** 별도 분기를 만들지 마라.
   구조가 동일하고, 팀·구성원으로 쓸지는 T4가 `groupKey`를 보고 정한다.

#### 3-2. SLA 수집

두 곳에서 모아 합친다. 어느 한쪽만 읽는 구현은 픽스처가 잡아낸다.

1. **밴드 안의 컬럼 쌍** — `기본 SLA 설정_항목`과 `기본 SLA 설정_일수` 컬럼을 같은 행끼리 짝지어 읽는다.
2. **밴드 밖의 별도 블록** — 시트 어디든 `기본 SLA 설정_항목`과 `기본 SLA 설정_일수`가
   **가로로 인접한 행**이 있으면, 그 아래부터 빈 행까지를 같은 방식으로 읽는다.
   (이 블록은 컬럼이 2개뿐이라 헤더 밴드 후보로 잡히지 않는다. 그래서 직접 찾는다.)
3. 일수는 `cell-normalizer.toNumber`로 푼다. 숫자가 아니면 그 행을 버리고
   warning(`code: 'SLA_DAYS_INVALID'`)을 남긴다.
4. **라벨 기준으로 중복을 제거한다.**
   - 일수가 같으면 조용히 한 건으로 합친다.
   - **일수가 다르면 warning(`code: 'SLA_CONFLICT'`)을 남기고 먼저 나온 값을 쓴다.**
     조용히 덮어쓰지 않는다.
5. warning에는 **셀 값을 담지 않는다.** 코드와 위치(시트명·행·열)만이다.

#### 3-3. 하지 않는 것

- **semantic 매핑을 하지 마라.** `업무 배정 → planned` 변환은 `lib/domain/task-semantic.ts`
  (T4)의 일이다. 여기서 하면 판정 규칙이 파서와 도메인 두 곳에 생긴다.
  이 어댑터는 **시트에 있는 문자열을 있는 그대로** 실어 나른다.
- 팀·부서 레코드를 만들지 마라 (T4).
- 미등록 값 검사를 하지 마라 — 그건 레지스트리를 **쓰는** 쪽(T3 어댑터)의 일이다.

### 4. 테스트 케이스

픽스처로:

1. **`공통_` 접두 그룹이 정확히 4개** 나온다 (완료 기준 7의 앞쪽 절반)
2. `공통_진행 상태`의 값이 **10개**이고, `sortOrder` 순서가 시트 순서(업무 배정 → … → 취소)와 같다
3. `공통_우선순위` 4개 / `공통_리스크 상태` 5개 / `공통_승인 상태` 6개
4. **SLA가 8건**이고 `촬영팀 섭외`의 `days`가 **5**다 (완료 기준 7의 뒤쪽 절반)
5. **두 블록에 같은 8항목이 있는데 결과가 16건이 아니라 8건이다** (중복 제거)
6. **`편집팀 구성원` 그룹의 값에 SLA 항목명(`편집팀 컨셉 공유` 등)이 섞이지 않는다**
   — 위 「함정」이 실제로 막혔는지 보는 테스트다
7. 팀 전용 enum 그룹(`편집_`·`촬영_`·`마케팅_` 접두)도 전부 들어 있다
8. 값 중 하나가 수식 셀이어도 문자열로 정규화된다

작은 격자로:

9. 같은 SLA 라벨의 일수가 다르면 `SLA_CONFLICT` warning이 나고 먼저 나온 값이 남는다
10. 일수 칸이 문자열이면 그 행이 빠지고 `SLA_DAYS_INVALID` warning이 난다
11. warning에 셀 값이 들어 있지 않다 (코드·시트·행·열만)

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/adapter-settings-tab.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/adapter-settings-tab.ts ; test $? -eq 1

# semantic 매핑이 파서에 새어 들어오지 않았다 (출력이 비어야 함)
grep -nE "in_progress|planned|cancelled|pending_release" src/lib/sheet/adapter-settings-tab.ts ; test $? -eq 1

# T2 전체 회귀 — 이 단계의 5개 모듈이 함께 통과한다
npx vitest run src/lib/sheet

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **T2 완료 기준 8개를 하나씩 대조하고, 각각 어느 테스트가 증명하는지 확인한다.**
   이 step이 T2의 마지막이므로 여기서 티켓 전체를 점검한다.
   빠진 기준이 있으면 그 사실을 요약에 적는다 — 조용히 넘기지 마라.
3. 체크리스트:
   - semantic 매핑·팀 생성·미등록 값 검사가 섞이지 않았는가?
   - 함정 테스트(6번)가 실제로 있는가?
   - `src/lib/sheet/`에 T2 범위 5개 모듈 외의 파일이 생기지 않았는가?
4. `phases/t2-parsing-core/index.json`의 step 5를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"` (추출된 enum 그룹 수·공통 4종의 값 개수,
     SLA 8건과 중복 제거 동작, **T2 완료 기준 8개 대조 결과**, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `semantic` 매핑을 넣지 마라. 이유: `ADR-009`·T4의 `task-semantic.ts` 범위다.
- 팀 어댑터(`adapter-edit-team` 등)나 `sheet-pipeline`을 만들지 마라. 이유: T3의 범위다.
- 설정 탭을 스스로 찾지 마라. 이유: 판별은 step 4가 끝냈고, 밴드는 인자로 받는다.
- 컬럼 값을 시트 끝까지 긁지 마라. 이유: 아래쪽 SLA 블록이 딸려 들어온다.
- 중복 SLA를 조용히 덮어쓰지 마라. 이유: `E5`와 같은 부류의 사고다 — 사람에게 보여준다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
