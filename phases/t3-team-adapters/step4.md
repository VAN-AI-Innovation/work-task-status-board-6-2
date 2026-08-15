# Step 4: adapter-shoot-team

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서 하드 실패 금지, 보안 규칙(연락처는 `extras`에 두되 노출은 T6)
- `docs/TICKETS.md` — `## T3` 완료 기준 **1·2·3·7**, 「리스크·미결」의 **"촬영팀은 1차에
  공통 필드 + `extras` 전량 보존만 하고 stage 언피벗은 편집팀만 먼저 한다"**
- `docs/PLAN.md` — `E1`(유령 행 25개 — **이 step의 핵심**), 「1. 데이터 모델」의 `team_period_goals`
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `tasks`·`team_period_goals`
- T2 산출물: `src/lib/sheet/tab-detector.ts`(`shoot_team` 시그니처), `src/lib/sheet/header-resolver.ts`,
  `src/lib/sheet/cell-normalizer.ts`,
  `scripts/fixtures/build-sample-workbook.mjs`의 `buildShootTeam`과 `SHOOT_HEADERS`
  (**71개 헤더 문자열을 그대로 확인하라**)
- 이전 step 산출물: `src/types/task.ts`, `src/types/goal.ts`, `src/lib/sheet/row-mapper.ts`,
  `src/lib/sheet/stage-unpivot.ts`, `src/lib/sheet/adapter-edit-team.ts`(조립 방식의 선례)

## 배경

`02_촬영·기획팀`은 **71컬럼(A~BS)** 이고 헤더 밴드는 `{ groupRow: 7, labelRow: 8 }`(0-based)다.
그룹 8개(`기본 업무정보`·`섭외`·`촬영 일정·준비`·`기획안 초안`·`기획안 완성본`·`촬영 실행`·
`편집 이관 또는 자체 편집`·`관리`)가 10/10/9/7/8/9/9/9 컬럼으로 붙는다.

### 이 step의 최우선 항목 — 유령 행 25건

0-based 10~34행(시트 r11~r35)은 **신원 4컬럼이 전부 빈칸인데 수식이 만든 값이 들어차 있다.**
`1900-01-01`·`1899-12-31`·`0%`·`false`가 컬럼 여러 개에 깔려 있다.

"셀에 값이 있으면 데이터 행"으로 판정하면 태스크가 1건이 아니라 **26건**이 되고,
**1900년 기한의 지연 업무 25건**이 대시보드를 덮는다. 완료 기준 2가 이것이고, 티켓이
`**최우선**`이라고 표시한 항목이다.

데이터 행은 0-based 9행 **1건**뿐이다.

### 헤더 위쪽의 목표 블록

0-based 6행에 이 탭에만 있는 라벨-값 가로 쌍이 있다:

```
기준 주차 │ 2026-07 4주차 │ 팀 책임자 │ 기획자1 │ 이번 주 핵심 목표 │ 브랜드 필름 섭외 확정 │ 주요 리스크 │ 출연자 일정 미확정
```

여기서 `ParsedTeamPeriodGoal` 1건을 만든다 (완료 기준 7).

## 작업

### 1. `src/lib/sheet/adapter-shoot-team.ts`

```ts
export function parseShootTeamTab(
  sheet: SheetGrid,
  band: HeaderBand,
  ctx: { baseYear: number },
): TabParseResult;
```

### 2. 선언적 상수

```ts
const IDENTITY_HEADERS = ['업무ID', '프로젝트명', '기획 담당자', '촬영 담당자'];
const ID_HEADER = '업무ID';
const CO_OWNER_HEADER = '공동 담당자';

const FIELD_MAP: FieldMapEntry[] = [
  { header: '프로젝트명', field: 'title', kind: 'text' },
  { header: '기획 담당자', field: 'ownerNameRaw', kind: 'text' },
  { header: '우선순위', field: 'priority', kind: 'text' },
  { header: '업무 배정일', field: 'assignedAt', kind: 'date' },
  { header: '최종 결과물 기한', field: 'dueAt', kind: 'date' },
  { header: '현재 업무 단계', field: 'status', kind: 'text' },
  { header: '전체 진행률', field: 'progress', kind: 'progress' },
  { header: '리스크 상태', field: 'riskStatus', kind: 'text' },
  { header: '지연 사유', field: 'delayReason', kind: 'text' },
  { header: '임원진 최종 확인', field: 'approvalStatus', kind: 'text' },
  { header: '다음 조치', field: 'nextAction', kind: 'text' },
  { header: '다음 조치 담당자', field: 'nextActionOwner', kind: 'text' },
  { header: '다음 조치 기한', field: 'nextActionDue', kind: 'date' },
  { header: '비고', field: 'note', kind: 'text' },
];

/**
 * **비워 둔다.** 티켓 「리스크·미결」의 완화안 — 촬영팀은 1차에 공통 필드 + extras 전량
 * 보존만 한다. 완료 기준 4는 편집팀만 요구한다. 나중에 이 배열만 채우면 언피벗이 붙는
 * 구조로 남겨 두는 것이 이 상수의 존재 이유다.
 */
const STAGE_GROUPS: StageGroupSpec[] = [];
```

`촬영 담당자`는 어느 필드에도 매핑하지 않는다 — `ownerNameRaw`는 하나뿐이고, 담당자가 둘인
구조는 `extras`가 받는다. **신원 판정에 썼다는 이유로 `extras`에서 지우지 마라.**

### 3. 목표 블록 파싱

헤더 밴드 **위쪽 행들만**(0-based `0 ~ band.labelRow - 1`) 훑어, 셀 텍스트가
`기준 주차`·`이번 주 핵심 목표`·`주요 리스크`와 정확히 일치하면 **바로 오른쪽 셀**을 값으로 읽는다.
행 번호를 하드코딩하지 마라 — 장식 행 개수는 팀마다 다르고 사람이 늘린다.
(같은 기법을 T2의 `adapter-settings-tab`이 아래쪽 SLA 블록에 썼다. 그 코드를 읽어라.)

셋 다 없으면 `teamPeriodGoals`는 빈 배열이다. 경고를 남기지 마라 — 없는 것이 정상인 탭이 있다.

### 4. 조립

`mapRows` → (`STAGE_GROUPS`가 비었으므로 언피벗은 호출하지 않는다) → `TabParseResult`.
`teamKey`는 `'shoot'`, `goalMetrics`·`briefingLines`는 빈 배열이다.

`excludeFromExtras`는 넘기지 않는다 (단계 컬럼이 없다).

### 5. 테스트 케이스 (`src/lib/sheet/adapter-shoot-team.test.ts`)

픽스처를 `readWorkbook` + `detectTab`으로 읽어 통합 검증한다.

1. **태스크가 정확히 1건**이다 — 유령 행 25건이 태스크가 되지 않는다 (완료 기준 2, **최우선**)
2. 유령 행 때문에 생긴 경고가 **0건**이다 (25건이 25개의 잡음이 되지 않는다)
3. 어떤 태스크에도 `dueAt`·`assignedAt`이 `1900-01-01`·`1899-12-31`이 아니다
4. **`extras` 키 개수 = 71 − (FIELD_MAP 매핑 수 + `업무ID` + `공동 담당자`)** 이고,
   테스트는 이 값을 상수로 박지 말고 `FIELD_MAP.length`로 계산해 대조한다 (완료 기준 3)
5. `extras`에 `촬영 담당자`가 **남아 있다** (신원 컬럼이라고 지우지 않았다)
6. `extras`에 `출연자 연락처 (내부용)` 키가 있다 — 민감 값도 파싱 단계에서는 보존한다
   (마스킹은 T6의 일이다)
7. `raw`에 71컬럼이 모두 있다
8. `coOwnerNames`가 배열이다 (빈 값이면 빈 배열)
9. `sourceKey`가 `업무ID` 값(`[샘플] SH-001`)이다 — `slug` 규칙으로 떨어지지 않았다
10. `stages`가 **빈 배열**이다 (완화안이 적용됐다는 증거)
11. `teamPeriodGoals`가 1건이고 `periodLabel === '2026-07 4주차'`,
    `goalText`·`riskText`가 채워져 있다 (완료 기준 7)
12. 모든 경고에 셀 값·이름·연락처가 들어 있지 않다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/adapter-shoot-team.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/adapter-shoot-team.ts ; test $? -eq 1

# 행 번호 하드코딩이 없다 — 0-based 6행을 직접 가리키지 않았는지 눈으로 확인
grep -nE "cells\[[0-9]+\]" src/lib/sheet/adapter-shoot-team.ts ; test $? -eq 1

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **완료 기준 2를 눈으로 재확인한다** — 태스크 개수를 실제로 출력해 1인지 본다.
   26이면 신원 판정이 수식 셀을 보고 있다는 뜻이다.
3. 체크리스트:
   - `FIELD_MAP`이 선언적 배열 하나인가 (`if` 사슬이 아닌가)?
   - `extras` 개수가 계산식과 맞는가?
   - `STAGE_GROUPS`가 비어 있고 그 근거가 주석에 있는가?
4. `phases/t3-team-adapters/index.json`의 step 4를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(태스크 1건·유령 25건 차단 근거,
     `extras` 키 개수와 계산식, 목표 블록 추출 방식, `STAGE_GROUPS`를 비운 근거, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 촬영팀 `STAGE_GROUPS`를 채우지 마라. 이유: 티켓 「리스크·미결」의 완화안이고,
  컬럼 이름이 그룹마다 불규칙해 매핑 규칙이 커진다. 완료 기준 4는 편집팀만 요구한다.
- 신원 판정에 수식 셀을 쓰지 마라. 이유: 유령 행 25건이 되살아난다 (`E1`).
- 유령 행마다 경고를 남기지 마라. 이유: 진짜 경고가 25건에 묻힌다.
- 컬럼을 하나라도 버리지 마라. 이유: 완료 기준 3.
- `출연자 연락처`를 파싱 단계에서 마스킹·삭제하지 마라. 이유: 마스킹은 T6의 응답 계층이고,
  여기서 지우면 `raw`의 복원 가치가 사라진다.
- 행 번호를 하드코딩하지 마라. 이유: 장식 행 개수는 사람이 늘린다.
- 마케팅 어댑터를 만들지 마라. 이유: step 5~7의 범위다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
