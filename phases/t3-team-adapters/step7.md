# Step 7: adapter-marketing-team

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 보안 규칙(`extras`의 민감 키는 admin·lead에게만 — **노출 제어는 T6**)
- `docs/TICKETS.md` — `## T3` 완료 기준 **1·5·8·9**, `## T6` 완료 기준 13(민감 키 마스킹)
- `docs/PLAN.md` — 「A. 엑셀」의 `03_마케팅·관리팀` 설명, 「엣지 케이스 처리 방침」의
  "시트에 개인정보(연락처·문의자 계정)" 줄, `E5`
- `docs/ARCHITECTURE.md` — 「데이터 모델」의 `tasks`
- 이전 step 산출물: `src/lib/sheet/section-splitter.ts`, `src/lib/sheet/adapter-goal-metrics.ts`,
  `src/lib/sheet/row-mapper.ts`, `src/lib/sheet/adapter-edit-team.ts`(조립 방식의 선례),
  `scripts/fixtures/build-sample-workbook.mjs`의 `MARKETING_A_HEADERS`와 `inquiries`

## 배경

이 어댑터가 마케팅 탭의 **세 섹션을 각각 다른 목적지로** 흘려보낸다 (완료 기준 5).

```
C 섹션 (자유 텍스트 5줄) → briefingLines: string[]
A 섹션 (문의 20컬럼 3건) → tasks
B 섹션 (성과 30컬럼 3건) → goalMetrics   ← step 6의 parseGoalMetrics에 위임
```

A섹션은 "업무"가 아니라 "문의"지만 진행 상태·담당자·기한 축으로 움직이므로 `tasks`에 담는다.
이건 티켓이 확정한 것이다 (`A→tasks`).

C섹션의 목적지는 **파싱 결과의 `briefingLines` 문자열 배열까지**다. 저장 스키마는 T4에서 정한다.
`team_period_goals`에 밀어 넣지 마라 — 브리핑은 목표가 아니라 회고 문장이다.

`계정·문의자` 컬럼은 개인정보다. **파싱 단계에서는 `extras`에 그대로 보존**하고,
역할별 마스킹은 T6의 응답 계층이 한다. 여기서 지우면 admin도 못 본다.

## 작업

### 1. `src/lib/sheet/adapter-marketing-team.ts`

```ts
export function parseMarketingTeamTab(
  sheet: SheetGrid,
  ctx: { baseYear: number },
): TabParseResult;
```

편집팀·촬영팀 어댑터와 달리 `band`를 받지 않는다. 이 탭은 표가 셋이라 밴드 하나로 표현되지
않기 때문이다. 대신 `splitSections(sheet)`를 스스로 호출한다.

### 2. 선언적 상수 (A섹션)

```ts
const IDENTITY_HEADERS = ['문의 ID', '담당자'];
const ID_HEADER = '문의 ID';

const FIELD_MAP: FieldMapEntry[] = [
  { header: '문의 내용 요약',   field: 'title',           kind: 'text' },
  { header: '담당자',          field: 'ownerNameRaw',    kind: 'text' },
  { header: '긴급도',          field: 'priority',        kind: 'text' },
  { header: '문의 접수일',      field: 'assignedAt',      kind: 'date' },
  { header: '답변 기한',        field: 'dueAt',           kind: 'date' },
  { header: '답변 상태',        field: 'status',          kind: 'text' },
  { header: '후속 조치 상태',    field: 'riskStatus',      kind: 'text' },
  { header: '추가 확인 필요사항', field: 'nextAction',      kind: 'text' },
  { header: '후속 담당자',      field: 'nextActionOwner', kind: 'text' },
  { header: '후속 조치 기한',    field: 'nextActionDue',   kind: 'date' },
  { header: '비고',            field: 'note',            kind: 'text' },
];
```

`담당자`와 `후속 담당자`가 **마지막 조각 정확 일치**로 구분된다. 접두 일치를 쓰면
`담당자`가 둘 다 잡아 값이 뒤바뀐다 — `row-mapper`가 정확 일치인 이유가 이것이다.

`STAGE_GROUPS`는 없다. 마케팅 문의는 단계 컬럼 그룹이 없다.

### 3. 조립 순서

1. `splitSections(sheet)`로 섹션 목록을 얻는다.
2. `key === 'A'`이고 `band !== null`인 섹션 → `mapRows(sheet, section.band, spec,
   { startRow: section.band.labelRow + 1, endRow: section.endRow })` → `tasks`
3. `key === 'B'`인 섹션 → `parseGoalMetrics(sheet, section, { teamKey: 'marketing', baseYear })`
   → `goalMetrics`
4. `key === 'C'`인 섹션 → `startRow ~ endRow`의 각 행에서 **값이 있는 첫 셀의 텍스트**를
   `toText`로 읽어 `briefingLines`에 담는다. 빈 행은 건너뛴다. 배너 행(`titleRow`)은 넣지 않는다.
5. 섹션이 하나도 없거나 특정 섹션이 없으면 **그 부분만 빈 배열**이고, `MARKETING_SECTION_MISSING`
   경고를 섹션 종류당 한 번 남긴다. 예외를 던지지 마라 — 한 섹션만 있는 파일이 정상적으로 올 수 있다
   (`UC-04` 부분 업로드).
6. `teamKey`는 `'marketing'`, `teamPeriodGoals`는 빈 배열이다.

### 4. 테스트 케이스 (`src/lib/sheet/adapter-marketing-team.test.ts`)

픽스처로 통합 검증한다.

1. **태스크 3건 · 지표 3건 · 브리핑 5줄**이 한 번의 호출로 나온다 (완료 기준 5)
2. 태스크의 `title`이 문의 내용 요약이고 `sourceKey`가 `문의 ID` 값(`[샘플] Q-001` 등)이다
3. 담당자 매핑이 뒤바뀌지 않았다 — 둘째 건의 `ownerNameRaw === '마케터2'`,
   `nextActionOwner === '마케터2'`, 셋째 건의 `nextActionOwner`는 null이다
4. 셋째 건의 `dueAt`이 null이다 (`답변 기한`이 빈칸) — **"기한 미설정"의 근거가 보존된다**
5. `extras`에 `계정·문의자` 키가 있고 값이 남아 있다 (마스킹은 T6)
6. `extras`에 `채널`·`문의 유형`·`접수 시간`·`실제 답변일`·`완료 여부`가 전부 있다
7. `briefingLines[0]`이 `직전 주 핵심 마케팅 성과`이고, 배너 문자열
   (`C. 주간 회의 브리핑`)은 들어 있지 않다
8. B섹션 지표가 step 6의 결과와 같다 (위임이 실제로 일어났다)
9. `stages`가 전부 빈 배열이다
10. 모든 경고에 셀 값·계정·이름이 들어 있지 않다

작은 격자로:

11. A섹션만 있는 시트 → 태스크는 나오고 `MARKETING_SECTION_MISSING` 경고가 B·C에 대해 난다
12. 섹션이 하나도 없는 시트 → 예외 없이 빈 결과 + 경고

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/adapter-marketing-team.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/adapter-marketing-team.ts ; test $? -eq 1

# 지표 파싱을 복제하지 않았다 — step 6에 위임한다 (출력이 있어야 함)
grep -n "parseGoalMetrics" src/lib/sheet/adapter-marketing-team.ts

# 개인정보를 파싱 단계에서 지우지 않았다 (출력이 비어야 함)
grep -nE "mask|\*\*\*|redact" src/lib/sheet/adapter-marketing-team.ts ; test $? -eq 1

npx vitest run src/lib/sheet
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 세 섹션이 각각 다른 목적지로 갔는가 (완료 기준 5)?
   - `담당자`/`후속 담당자`가 뒤바뀌지 않았는가?
   - 지표 파싱 코드가 복제되지 않았는가?
3. `phases/t3-team-adapters/index.json`의 step 7을 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"`(태스크 3·지표 3·브리핑 5줄의 근거,
     섹션 누락 처리, `extras` 보존 범위, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- 브리핑 텍스트를 `team_period_goals`로 보내지 마라. 이유: 브리핑은 목표가 아니라 회고 문장이다.
- `계정·문의자`를 파싱 단계에서 마스킹·삭제하지 마라. 이유: 마스킹은 T6의 응답 계층이다.
- 지표 파싱을 복제하지 마라. 이유: step 6의 `parseGoalMetrics`에 위임한다.
- 섹션이 없다고 예외를 던지지 마라. 이유: 부분 업로드(`UC-04`)가 정상 경로다.
- 접두 일치로 컬럼을 찾지 마라. 이유: `담당자`가 `후속 담당자`를 잡는다.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
