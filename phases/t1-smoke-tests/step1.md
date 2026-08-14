# Step 1: docx-heading-smoke

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 보안·데이터 규칙(로그에 셀 값·본문 텍스트를 담지 않는다)
- `docs/TICKETS.md` — `## T1` 절의 범위 In 1번·완료 기준 1·2, `## T7` 절의 리스크(mammoth 인식이
  최대 변수이며 T1에서 판정이 나 있어야 한다)
- `docs/PLAN.md` — `H8` 가설, 「5. 독스 → 배정표」 절 (`.docx` → mammoth → `node-html-parser` →
  `OutlineNode[]` 경로와 T2 착수 전 선행 작업 문단)
- 이전 step 산출물: `scripts/smoke/README.md`, `.gitignore`, `CLAUDE.md`의 import 범위 문구

## 배경

T7(독스 → 업무 배정표 xlsx)의 파이프라인 첫 단계는 이렇다.

```
.docx → mammoth.convertToHtml(+styleMap) → node-html-parser 순회 → OutlineNode[]
```

여기서 전제하는 것: Google Docs에서 `.docx`로 내보내면 `## N. 대분류`가 `h2`,
`### N-M. 과제명`이 `h3`으로 변환된다. **이 전제가 검증된 적이 없다.**
Google Docs 내보내기의 스타일 이름은 표준이 아닐 수 있고(한국어 로케일에서
`제목 2`·`Heading 2`·`Title` 등으로 갈린다), mammoth의 기본 styleMap이 그것을 못 잡으면
모든 heading이 `p`로 떨어져 아웃라인이 통째로 사라진다.

**이 step의 산출물은 코드가 아니라 판정이다.** 예/아니오를 내고, 아니오면 대안을 확정한다.

mammoth의 진단 경로를 알아 두라: `convertToHtml`은 `{ value, messages }`를 반환하고,
인식하지 못한 스타일은 `messages`에 `warning`으로 **스타일 이름과 함께** 들어온다.
그 이름이 곧 `styleMap`에 써야 할 문자열이다. 추측하지 말고 `messages`를 읽어라.

## 작업

### 1. `scripts/smoke/docx-headings.mjs` 작성

Node ESM 스크립트다. TypeScript로 쓰지 마라 (실행에 빌드 단계가 필요해진다).

인터페이스:

```
node scripts/smoke/docx-headings.mjs [docx경로]
```

- 인자를 생략하면 `smoke-input/`에서 첫 번째 `.docx`를 자동으로 찾는다.
  `~$`로 시작하는 오피스 임시 파일은 건너뛴다.
- 파일이 없으면 명확한 메시지와 함께 비정상 종료(exit 1)한다.

동작:

1. `mammoth.convertToHtml({ path })`를 **기본 옵션으로** 먼저 실행한다 (styleMap 없이).
2. `node-html-parser`로 결과 HTML을 파싱해 아래를 집계한다.
   - 태그별 개수 — `h1`~`h6`, `p`, `table`, `ul`, `ol`
   - heading으로 인식된 노드마다: 태그 이름, **번호 접두사만** (`^\s*\d+\.` → `"N."`,
     `^\s*\d+-\d+\.` → `"N-M."`, 둘 다 아니면 `"(없음)"`), 텍스트 **길이**
   - `p`로 떨어진 문단 중 **번호 접두사를 가진 것의 개수** — heading이 `p`로 강등됐다는
     신호다. 이 숫자가 크고 `h2`·`h3`이 0이면 `H8`은 실패다.
3. `result.messages`를 전부 출력한다. 특히 인식되지 않은 스타일 이름을 그대로 보여준다.
4. **판정을 명시적으로 찍는다.**
   - `h2` ≥ 1 이고 `h3` ≥ 1 이며, `h2`의 번호 접두사가 `N.`, `h3`이 `N-M.` 형태로
     하나 이상 잡히면 → `PASS (기본 옵션)`
   - 아니면 → `FAIL (기본 옵션)`

### 2. FAIL이면 styleMap으로 재시도

기본 옵션에서 FAIL이 났을 때만 한다. `messages`에 나온 실제 스타일 이름으로 styleMap을
구성해 다시 변환하고 같은 집계를 낸다. `--styleMap` 같은 플래그로 두 경로를 모두
실행할 수 있게 만들어도 좋고, 스크립트가 FAIL 시 자동으로 2차 시도를 하게 해도 된다.
형태는 재량이다.

styleMap 문법 예시 (스타일 이름은 **반드시 `messages`에서 읽은 실제 값**을 쓴다):

```
"p[style-name='제목 2'] => h2:fresh"
"p[style-name='Heading 2'] => h2:fresh"
```

**스타일 이름을 추측해서 하드코딩하지 마라.** 이유: 추측이 맞아도 왜 맞았는지 모르고,
틀리면 실패 원인이 두 겹이 된다. `messages`가 알려주는 이름만 쓴다.

styleMap으로도 FAIL이면 그것으로 판정을 끝낸다. 3차 대안(문단 텍스트 패턴 매칭)은
`docs/PLAN.md`에 이미 적힌 탈출구이므로 **여기서 구현하지 말고 결론에만 적는다.**

### 3. `scripts/smoke/RESULT.md` 작성

스크립트를 실제로 실행하고, 그 출력을 근거로 결과를 기록한다. 아래 구조를 지켜라.
step 2가 이 파일에 자기 절을 덧붙이므로 제목 계층을 유지한다.

```markdown
# T1 스모크 테스트 실측 결과

## H8 — mammoth heading 인식 (`.docx`)

- **판정**: PASS / FAIL
- **경로**: 기본 옵션 / styleMap 필요 / 둘 다 실패
- 태그별 개수 표 (h1~h6, p, table, ul, ol)
- 번호 접두사 매칭 — `N.` 형태 N건, `N-M.` 형태 M건
- `p`로 강등된 번호 문단 개수
- mammoth `messages` 중 스타일 관련 경고 (스타일 이름 그대로)
- **필요한 styleMap** (있다면 그대로 복사 가능한 형태로)
- **T7에 주는 결론** — 예상(L) 유지 가능한가, 늘려야 하는가
```

**기록 금지**: 과제명·대분류의 본문 텍스트, 담당자 실명, 연락처, 계정. 태그 이름·개수·
번호 접두사·텍스트 길이만 적는다. 스타일 이름은 문서 서식 정보이므로 기록해도 된다.

### 4. lint가 `scripts/smoke/`를 문제 삼으면

`npm run lint`는 인자 없이 `eslint`를 돌려 저장소 전체를 검사한다. `.mjs` 스크립트가
Next.js ESLint 설정에 걸리면 `eslint.config.mjs`의 `globalIgnores` 배열에 `scripts/**`를
추가해도 된다. 그 외의 lint 설정은 바꾸지 마라.

## Acceptance Criteria

```bash
# 스크립트가 실제 파일로 끝까지 돌고 판정을 출력한다
node scripts/smoke/docx-headings.mjs

# 산출물에 판정이 기록돼 있다
grep -qE 'PASS|FAIL' scripts/smoke/RESULT.md
grep -q 'H8' scripts/smoke/RESULT.md

# 실업무 파일이 여전히 git에 노출되지 않는다 (출력이 비어 있어야 함)
git status --porcelain | grep -E 'smoke-input|\.xlsx|\.docx' ; test $? -eq 1

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트를 확인한다:
   - `src/` 아래에 파일이 생기지 않았는가? (T1 범위 Out — 검증 스크립트는 `scripts/smoke/`)
   - `RESULT.md`에 본문 텍스트·실명·연락처가 들어가지 않았는가?
   - 판정이 **예/아니오로 확정**됐는가? "될 것 같다" 같은 서술은 완료 기준 1을 만족하지 않는다.
   - FAIL인 경우 대안이 확정됐는가? (완료 기준 2)
3. 결과에 따라 `phases/t1-smoke-tests/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "판정(PASS/FAIL) + 필요한 styleMap 여부 +
     h2/h3 개수를 포함한 한 줄 요약"`. step 3이 이 요약을 근거로 PLAN.md를 고치므로
     판정 결과를 반드시 담을 것.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

**주의**: mammoth가 heading을 인식하지 못한 것(FAIL)은 **에러가 아니라 판정 결과다.**
FAIL이어도 `"status": "completed"`다. 이 step의 목적은 PASS를 만드는 게 아니라
사실을 확정하는 것이다.

## 금지사항

- `src/lib/doc/`에 파서를 만들지 마라. 이유: 그건 T7의 범위다. 이 step은 스모크 테스트다.
- `OutlineNode` 타입이나 `outline-builder`를 설계하지 마라. 이유: 같음.
- 스타일 이름을 추측해 하드코딩하지 마라. 이유: `messages`가 실제 이름을 알려준다.
  추측이 맞아도 근거가 남지 않는다.
- heading 본문 텍스트를 콘솔이나 `RESULT.md`에 출력하지 마라. 이유: 실업무 문서에는
  실명과 계정이 섞여 있고, `RESULT.md`는 커밋된다 (`CLAUDE.md` 보안·데이터 규칙).
- FAIL일 때 문단 텍스트 패턴 매칭 대안을 구현하지 마라. 이유: 완료 기준 2는 대안의
  **확정**을 요구하고 구현은 T7이다.
- 실업무 `.docx`를 `src/lib/fixtures/`로 복사하지 마라. 이유: 그 경로는 gitignore 예외라
  실제로 커밋된다. 익명화 픽스처 제작은 T2의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
