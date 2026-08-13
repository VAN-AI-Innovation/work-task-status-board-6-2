# Step 4: ci-workflow

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 「협업 규칙」과 「명령어」
- `docs/TEAM_RULES.md` — 2장(브랜치 전략)과 3장(이슈·PR·커밋 컨벤션)
- `docs/TICKETS.md` — `## T0` 절의 「삭제·교체」와 완료 기준 2
- `.github/workflows/proof-html.yml` · `.github/workflows/auto-assign.yml` — 교체·삭제 대상
- `package.json` — 이전 step들이 정리한 스크립트 목록
- 이전 step 산출물: `vitest.config.ts`, `src/lib/env-guard.ts`, `src/lib/env-guard.test.ts`

## 배경

CI가 무의미한 상태다.

- `proof-html.yml`은 `anishathalye/proof-html`로 저장소 루트의 정적 HTML을 검사한다.
  검사 대상이던 `index.html`은 **step 0에서 이미 삭제됐다.** 지금 이 워크플로우는 깨져 있고,
  살아 있었어도 Next 앱에 정적 HTML 링크 검사는 의미가 없다.
- `auto-assign.yml`은 새 이슈·PR의 담당자를 `Sanduduck`으로 하드코딩한다. 다른 데모 리포에서
  딸려온 조직 계정이다.

## 작업

### 1. `proof-html.yml` 삭제하고 `ci.yml` 신설

`.github/workflows/proof-html.yml`을 지우고 `.github/workflows/ci.yml`을 만든다.

요구 사항:

- 트리거: `push`와 `pull_request`
- `actions/checkout` + `actions/setup-node` — Node 버전은 `24`, npm 캐시 사용
- `npm ci`로 설치한다. `npm install`이 아니다. 이유: `package-lock.json`을 그대로 재현해야
  step 2에서 고정한 `exceljs@4.4.0`이 CI에서도 보장된다.
- 검증 커맨드는 **로컬과 동일하게** 세 개를 순서대로 돌린다:
  `npm run lint` → `npm run build` → `npm test`
  (`npm run build`는 step 3에서 붙인 `prebuild` 가드를 자동으로 함께 실행한다)
- 각 액션은 major 버전 태그로 고정한다 (예: `actions/checkout@v4`).

새 액션이나 부가 기능(커버리지 업로드, 배포, 캐시 서비스 등)을 추가하지 마라.

### 2. `auto-assign.yml` 삭제

파일을 삭제한다. 이유: `docs/TEAM_RULES.md`가 "리뷰는 셀프 리뷰(갠플이라 승인자 없음)"로
규정한다. 1인 작업에 자동 담당자 배정은 불필요하고, 지금 값은 이 프로젝트와 무관한
조직 계정이라 새 이슈마다 잘못된 담당자가 붙는다.

### 3. `README.md`의 GitHub Actions 절 갱신

`README.md`에 `## GitHub Actions` 절이 있다. 없어진 워크플로우를 가리키고 있으면
현재 상태(`ci.yml` 하나)에 맞게 고쳐라. 이미 맞으면 건드리지 마라.

`README.md`의 다른 절은 수정하지 마라.

## Acceptance Criteria

```bash
npm run lint     # 경고·에러 없음
npm run build    # prebuild 가드 포함 통과
npm test         # 전체 테스트 통과
```

추가로 아래가 모두 참이어야 한다:

```bash
test ! -e .github/workflows/proof-html.yml
test ! -e .github/workflows/auto-assign.yml
test -f .github/workflows/ci.yml
node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); for(const s of ['npm ci','npm run lint','npm run build','npm test']) if(!c.includes(s)) throw new Error('ci.yml에 없음: '+s)"
python3 -c "import sys; sys.exit(0)" && python3 - <<'PY'
import re, sys, pathlib
# YAML 파서 없이 최소 구조 확인 — 탭 문자는 YAML에서 금지다
text = pathlib.Path('.github/workflows/ci.yml').read_text()
assert '\t' not in text, 'ci.yml에 탭 문자가 있다 (YAML 금지)'
assert re.search(r'^on:', text, re.M), 'on: 트리거 없음'
assert re.search(r'^jobs:', text, re.M), 'jobs: 없음'
print('ci.yml 구조 OK')
PY
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CI가 도는 커맨드가 로컬 `npm run lint && npm run build && npm test`와 **완전히 같은가?**
     달라지면 로컬 통과 → CI 실패가 반복된다.
   - `npm ci`를 쓰는가? (`npm install`이면 버전 고정이 무너진다)
3. 결과에 따라 `phases/t0-repo-hygiene/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 배포(Vercel 등) 워크플로우를 만들지 마라. 이유: T9의 범위다.
- 브랜치 보호 규칙·PR 템플릿·이슈 템플릿을 만들지 마라. 이유: 요청되지 않았고 T0 범위 밖이다.
- 워크플로우에 시크릿(`secrets.*`)을 요구하는 스텝을 넣지 마라. 이유: 지금 설정된 시크릿이
  없어서 CI가 바로 실패한다. 필요해지면 T4·T9에서 다룬다.
- `auto-assign.yml`의 담당자만 바꿔서 남겨두지 마라. 이유: 1인 작업에 불필요하다.
- 액션 버전을 `@main`·`@master`로 참조하지 마라. 이유: 공급망 위험이고 재현이 안 된다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
