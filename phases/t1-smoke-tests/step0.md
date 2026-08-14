# Step 0: smoke-input-guard

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 특히 「보안·데이터 규칙」의 실업무 데이터 커밋 금지 CRITICAL 규칙
- `docs/TICKETS.md` — `## T1` 절 전체 (목적·범위 In/Out·완료 기준 4·리스크)
- `docs/PLAN.md` — 「확인 필요」 절의 선행 확인 2건, `H8`, `A7`
- `.gitignore` — 현재 실업무 데이터 차단 규칙
- `package.json` — 실행 가능한 스크립트

## 배경

T1은 코드를 만드는 티켓이 아니라 **미검증 전제 2건을 실제 파일로 재는 티켓**이다.

1. `H8` — Google Docs에서 내보낸 `.docx`의 heading 스타일을 mammoth가 `h1~h3`으로 인식하는가
2. `A7` — 실제 시트를 `.xlsx`로 내보냈을 때 파일 크기가 앱 업로드 한도 4MB 아래인가

그런데 그 실제 파일에는 **실명·연락처·문의자 계정이 들어 있다.** 익명화 전 원본이므로
절대 커밋되면 안 된다. 이 step은 후속 step들이 딛고 설 **입력 파일 배치 규약을 확정하고,
차단이 실제로 동작하는지 실증**하는 것만 한다. 파싱도 실측도 하지 않는다.

파일 배치 규약은 이미 정해져 있다:

- 위치: 저장소 루트의 `smoke-input/` 디렉토리 (디렉토리는 이미 존재한다)
- 내용: 워크로드 문서 `.docx` 1개, 업무 시트 `.xlsx` 1개
- 이 디렉토리는 **git에 절대 올라가지 않는다**

## 작업

### 1. 입력 파일 존재 확인 — 없으면 즉시 blocked

`smoke-input/` 안에 `.docx` 1개 이상과 `.xlsx` 1개 이상이 있는지 확인하라.

```bash
ls -la smoke-input/
```

**하나라도 없으면 다른 작업을 일절 하지 말고 즉시 중단하라.**
`phases/t1-smoke-tests/index.json`의 step 0을 `"status": "blocked"`로 바꾸고
`blocked_reason`에 어떤 확장자가 비어 있는지 적는다. 이유: T1의 모든 완료 기준이 실제 파일
실측이라, 파일 없이 진행하면 스크립트만 남고 판정이 나오지 않는다. 합성 파일로
대체하지 마라 — Google Docs 내보내기의 스타일 이름이 표준이 아닐 수 있다는 것이
바로 검증 대상이므로, 직접 만든 `.docx`로는 `H8`을 판정할 수 없다.

### 2. `.gitignore`에 `smoke-input/` 추가

현재 `*.xlsx`·`*.docx` 규칙이 이미 있지만, 그것만으로는 부족하다. 실제 내보내기 과정에서
`~$파일명.xlsx` 임시 파일, PDF 내보내기, 스크린샷 같은 **다른 확장자의 실업무 파일**이
같은 디렉토리에 섞일 수 있다. 디렉토리 자체를 막는다.

「실업무 데이터」 주석 블록 아래에 `smoke-input/` 한 줄을 추가하라. 기존 규칙은 건드리지 마라.

### 3. 차단이 실제로 동작하는지 실증 (완료 기준 4)

아래 두 가지가 모두 참이어야 한다.

- `git status --porcelain`에 `smoke-input/`이나 실업무 파일이 **한 줄도 나타나지 않는다**
- `git check-ignore -v`가 `*.xlsx`·`*.docx` 규칙과 `smoke-input/` 규칙을 각각 짚어준다

`git check-ignore`는 파일이 실제로 없어도 경로만으로 판정한다. 확인용 더미 파일을
만들지 마라.

### 4. `scripts/smoke/README.md` 작성

`scripts/smoke/` 디렉토리를 만들고 README를 쓴다. 후속 step 1·2가 여기에 검증
스크립트를 넣는다. 아래 내용을 담아라 (분량은 40줄 이내로 짧게):

- **목적** — T1(`docs/TICKETS.md`)의 선행 확인 2건을 실측하는 일회성 검증 스크립트 모음.
  제품 경로가 아니며 `next build` 번들에 포함되지 않는다.
- **입력 파일 배치 규약** — `smoke-input/`에 실업무 원본을 두고, 이 디렉토리는 gitignore로
  차단된다. 파일명은 자유이며 스크립트가 확장자로 찾는다. 실업무 파일을 저장소에
  커밋하지 않는다 (`CLAUDE.md` 보안·데이터 규칙).
- **실행법** — `node scripts/smoke/<script>.mjs [파일경로]` 형태이며, 경로를 생략하면
  `smoke-input/`에서 해당 확장자 파일을 자동으로 찾는다.
- **결과 기록** — 판정 결과는 `scripts/smoke/RESULT.md`에 남기고, 확정된 결론만
  `docs/PLAN.md`의 `H8`·`A7`에 반영한다.
- **기록 금지 항목** — 셀 값, 담당자 실명, 연락처, 문의자 계정, 과제 본문 텍스트를
  스크립트 출력이나 `RESULT.md`에 담지 않는다. 구조 정보(태그 이름, 개수, 시트명,
  바이트 수, 번호 접두사)만 남긴다 (`CLAUDE.md` — 로그에 셀 값을 담지 않는다).
- **exceljs·mammoth import 예외** — `CLAUDE.md`의 import 제한(`workbook-reader.ts`·
  `assignment-writer.ts` 두 파일)은 **`src/` 아래 제품 코드에 적용되는 규칙**이다.
  `scripts/smoke/`는 제품 경로가 아니고 번들에 들어가지 않으므로 이 디렉토리의
  검증 스크립트는 두 라이브러리를 직접 import한다. 이 예외는 `scripts/smoke/`에만 해당한다.

### 5. `CLAUDE.md`의 import 제한 규칙에 적용 범위 명시

`CLAUDE.md`「아키텍처 규칙」의 `exceljs` import 제한 CRITICAL 항목에 **`src/` 아래
기준이며 `scripts/smoke/`의 일회성 검증 스크립트는 예외**라는 범위 문구를 덧붙여라.

규칙의 의도(제품 코드 전반으로 exceljs 의존이 번지지 않게 한다)는 그대로 두고 적용
범위만 명확히 하는 것이다. **규칙을 약화시키거나 다른 CRITICAL 항목을 손대지 마라.**
`src/lib/` 안의 두 파일 제한은 한 글자도 바꾸지 않는다.

## Acceptance Criteria

```bash
# 입력 파일이 있다 (없으면 blocked)
ls smoke-input/*.docx && ls smoke-input/*.xlsx

# 실업무 파일이 git에 노출되지 않는다 (출력이 비어 있어야 함)
git status --porcelain | grep -E 'smoke-input|\.xlsx|\.docx' ; test $? -eq 1

# 차단 규칙이 실제로 매칭된다 (각각 규칙 줄을 출력해야 함)
git check-ignore -v smoke-input/probe.pdf
git check-ignore -v docs/probe.xlsx
git check-ignore -v docs/probe.docx

# 산출물이 있다
test -f scripts/smoke/README.md
grep -q "scripts/smoke" CLAUDE.md

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트를 확인한다:
   - `src/` 아래에 새 파일이 생기지 않았는가? (이 step은 문서·설정만 건드린다)
   - `.gitignore`의 기존 규칙을 지우거나 바꾸지 않았는가?
   - `CLAUDE.md`의 다른 CRITICAL 규칙을 건드리지 않았는가?
   - `smoke-input/` 안의 파일이 `git status`에 나타나지 않는가?
3. 결과에 따라 `phases/t1-smoke-tests/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약. smoke-input/에 실제로
     있는 .docx·.xlsx 파일명은 적지 말고 확장자별 개수만 적을 것"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 입력 파일 부재 등 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `smoke-input/` 안의 파일을 열거나 파싱하지 마라. 이유: 실측은 step 1·2의 범위이고,
  이 step은 배치 규약과 차단 확인까지다.
- 실업무 파일명을 `index.json`의 summary나 커밋 메시지, README에 적지 마라.
  이유: 파일명에 팀명·기수·담당자가 들어 있고 그건 커밋되는 정보다.
- `git add`로 `smoke-input/`을 강제 추가(`-f`)하지 마라. 이유: 차단을 우회하는 행위다.
- 검증용 더미 `.xlsx`·`.docx` 파일을 만들지 마라. 이유: `git check-ignore`는 파일 없이
  경로만으로 판정한다. 만들면 그 자체가 정리해야 할 잔재가 된다.
- `src/` 아래에 코드를 쓰지 마라. 이유: T1 범위 Out — 제품 코드는 T2 이후다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
