# Step 2: sheet-metrics-smoke

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 보안·데이터 규칙, 그리고 `exceljs` import 제한 CRITICAL 항목의 적용 범위
  (step 0에서 `scripts/smoke/` 예외가 명시됐다)
- `docs/TICKETS.md` — `## T1` 절의 범위 In 2번·완료 기준 3, `## T5` 절의 완료 기준 5·6
  (4MB 한도와 압축 폭탄 방어 한도)
- `docs/PLAN.md` — `A7`(업로드 한도 4MB 확정), `S2`(압축 폭탄 방어), 「1. 시트 구조」 절
- 이전 step 산출물: `scripts/smoke/README.md`, `scripts/smoke/docx-headings.mjs`,
  `scripts/smoke/RESULT.md`(`H8` 절이 이미 기록돼 있다)

## 배경

두 개의 숫자가 실측 없이 정해져 있다.

1. **업로드 한도 4MB** (`A7`) — Vercel 서버리스 함수의 본문 한도(4.5MB로 알려짐)보다
   확실히 아래로 잡은 값이다. 실제 시트가 4MB를 넘으면 **탭별 분할 업로드(UC-04)가
   예외 경로가 아니라 기본 경로**가 되고, `/upload` 화면의 안내 문구부터 달라진다.
2. **압축 폭탄 방어 한도** (`S2`, T5 완료 기준 6) — 해제 총량 50MB / **시트 20개** /
   **셀 20,000개** / 타임아웃 8초. 이 숫자들은 방어선인데, 실제 시트가 이미 그 한도를
   넘으면 **정상 업무 파일이 공격으로 오탐되어 거부된다.** T5에서 발견하면 방어 로직과
   한도를 동시에 고쳐야 하지만, 지금 알면 숫자만 고치면 된다.

덧붙여 이 step은 **exceljs가 실제 내보내기 파일을 열 수 있는지**를 처음으로 확인한다.
T2 전체가 그 위에 서 있으므로, 여기서 못 열리면 T2 착수 자체가 막힌다.

## 작업

### 1. `scripts/smoke/sheet-metrics.mjs` 작성

Node ESM 스크립트다. TypeScript로 쓰지 마라.

인터페이스:

```
node scripts/smoke/sheet-metrics.mjs [xlsx경로]
```

- 인자를 생략하면 `smoke-input/`에서 첫 번째 `.xlsx`를 자동으로 찾는다.
  `~$`로 시작하는 오피스 임시 파일은 건너뛴다.
- 파일이 없으면 명확한 메시지와 함께 비정상 종료(exit 1)한다.

측정 항목:

| 항목 | 근거 |
|---|---|
| 파일 크기 (바이트, MB 소수 2자리) | `A7` — 4MB 한도 |
| 4MB 한도 대비 여유 (비율 또는 남은 MB) | `A7` |
| 워크시트 개수 | `S2` — 시트 20개 한도 |
| 시트별 `rowCount`·`columnCount`·`dimensions` | 구조 파악 |
| 시트별 실제 셀 개수 (값이 있는 셀) | `S2` — 셀 20,000개 한도 |
| 전체 셀 합계 | `S2` |
| 시트 이름 목록 | 탭 판별(T2)의 사전 정보 |
| exceljs가 파일을 열었는가 (성공/실패 + 실패 시 에러 종류) | T2 착수 가능 여부 |

`exceljs`는 `new ExcelJS.Workbook()` 후 `workbook.xlsx.readFile(path)`로 읽는다.
셀 개수는 워크시트를 순회해 값이 있는 셀만 센다 — `rowCount × columnCount`는
빈 영역까지 포함해 실제보다 크게 나오므로 **두 숫자를 모두 출력**하고 어느 쪽이
`S2` 판정 기준인지 명시하라 (방어 로직이 세게 될 값, 즉 큰 쪽이 보수적 기준이다).

판정을 명시적으로 찍는다:

- 파일 크기 ≤ 4MB → `PASS (단일 업로드 가능)`, 초과 → `FAIL (탭별 분할 업로드가 기본 경로)`
- 시트 수 ≤ 20 그리고 셀 수 ≤ 20,000 → `PASS (S2 한도 유효)`,
  초과 → `FAIL (S2 한도가 정상 파일을 오탐 — T5 착수 전 상향 필요)`

### 2. `scripts/smoke/RESULT.md`에 절 추가

step 1이 만든 `# T1 스모크 테스트 실측 결과` 문서에 아래 절을 **덧붙인다.**
기존 `## H8` 절을 수정하거나 지우지 마라.

```markdown
## A7 — 시트 크기·규모 실측 (`.xlsx`)

- **파일 크기**: N,NNN,NNN bytes (N.NN MB)
- **4MB 한도 판정**: PASS / FAIL — (FAIL이면 탭별 분할 업로드가 기본 경로)
- **워크시트**: N개 — 시트 이름 목록
- 시트별 rowCount / columnCount / 값 있는 셀 수 표
- **전체 셀**: 값 있는 셀 N개 / rowCount×columnCount 기준 N개
- **S2 한도 판정**: 시트 20개·셀 20,000개 대비 PASS / FAIL
- **exceljs 열기**: 성공 / 실패 (실패 시 에러 종류)
- **T5에 주는 결론** — 4MB 한도와 S2 한도를 그대로 쓸 수 있는가, 고쳐야 하는가
```

**기록 금지**: 셀 값, 담당자 실명, 연락처, 문의자 계정, 업무명. 시트 이름·행 수·열 수·
셀 개수·바이트 수만 적는다. 시트 이름은 구조 정보이므로 기록해도 된다
(`00_통합 대시보드`, `01_편집팀` 형태).

## Acceptance Criteria

```bash
# 스크립트가 실제 파일로 끝까지 돌고 판정을 출력한다
node scripts/smoke/sheet-metrics.mjs

# 산출물에 A7 절과 판정이 기록돼 있다
grep -q 'A7' scripts/smoke/RESULT.md
grep -q 'S2' scripts/smoke/RESULT.md
grep -q 'H8' scripts/smoke/RESULT.md   # step 1의 절이 보존됐다

# 실업무 파일이 여전히 git에 노출되지 않는다 (출력이 비어 있어야 함)
git status --porcelain | grep -E 'smoke-input|\.xlsx|\.docx' ; test $? -eq 1

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트를 확인한다:
   - `src/` 아래에 파일이 생기지 않았는가? (T1 범위 Out)
   - `RESULT.md`에 셀 값·실명·연락처가 들어가지 않았는가?
   - step 1의 `## H8` 절이 그대로 남아 있는가?
   - 판정이 숫자와 함께 확정됐는가? (완료 기준 3)
3. 결과에 따라 `phases/t1-smoke-tests/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "실측 파일 크기(MB) + 시트 수 + 전체 셀 수 +
     4MB·S2 판정을 포함한 한 줄 요약"`. step 3이 이 숫자를 PLAN.md에 옮기므로 반드시 담을 것.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

**주의**: 4MB 초과나 `S2` 한도 초과는 **에러가 아니라 판정 결과다.** FAIL이어도
`"status": "completed"`다. 단 exceljs가 파일을 아예 열지 못하면 그건 T2를 막는
사건이므로 `error`로 처리하고 에러 종류를 남긴다.

## 금지사항

- `src/lib/sheet/`에 파서를 만들지 마라. 이유: `workbook-reader`·`header-resolver` 등은
  T2의 범위다. 이 step은 크기와 규모만 잰다.
- 셀 값을 읽어 출력하거나 헤더 문자열을 나열하지 마라. 이유: 실업무 데이터이고
  `RESULT.md`는 커밋된다. 시트 이름과 개수까지만이다.
- `src/` 어디에도 `exceljs`를 import하지 마라. 이유: `CLAUDE.md`의 CRITICAL 규칙대로
  제품 코드의 import 위치는 `workbook-reader.ts`·`assignment-writer.ts` 두 파일뿐이다.
  이 step의 예외는 `scripts/smoke/` 안에서만 유효하다.
- 실업무 `.xlsx`를 `src/lib/fixtures/`로 복사하지 마라. 이유: 그 경로는 gitignore
  예외라 실제로 커밋된다. 익명화 픽스처 제작은 T2의 범위다.
- 4MB 초과를 발견했다고 `docs/`의 한도 숫자를 여기서 고치지 마라. 이유: 문서 반영은
  step 3에서 두 실측 결과를 함께 본 뒤에 한다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
