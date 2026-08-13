# work-task-status-board

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 프로젝트.
[harness_framework](https://github.com/minseokhan/harness_framework) 기반의 에이전트 하네스가 적용되어 있다.

## 시작하기

```bash
npm install
npm run dev      # http://localhost:3000
```

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |

## 하네스

문서(`docs/`) → step 분해 → 순차 자동 실행 구조.

```bash
python3 scripts/execute.py <phase-dir> [--push]   # phase의 step을 순차 실행
python3 -m pytest scripts/test_execute.py         # 하네스 자체 테스트
```

- `/harness` — step 설계 및 `phases/` 파일 생성 워크플로우
- `/review` — 아키텍처·스택·테스트·CRITICAL 규칙 체크리스트 리뷰

가드레일은 `.claude/settings.json`(Claude Code)과 `.codex/hooks.json`(Codex)에 정의되어 있다:
위험 명령 차단, 테스트 없는 소스 편집 차단(TDD), 턴 종료 시 `lint`/`build`/`test` 실행.

## 문서

- `docs/PRD.md` — 제품 요구사항
- `docs/ARCHITECTURE.md` — 디렉토리 구조·데이터 흐름·상태 관리
- `docs/ADR.md` — 기술 결정 기록
- `docs/UI_GUIDE.md` — UI 가이드
- `CLAUDE.md` / `AGENTS.md` — 에이전트 가드레일 (하네스가 매 step 주입)

## GitHub Actions

`.github/workflows/`의 두 워크플로우는 데모 저장소에서 가져온 **문법 참고용 기본 틀**이다:

- `auto-assign.yml` — 이슈/PR 생성 시 담당자 자동 배정
- `proof-html.yml` — HTML 유효성·링크 검사
