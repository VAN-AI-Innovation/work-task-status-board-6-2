# 프로젝트: work-task-status-board

## 기술 스택
- Next.js 16.3 (App Router)
- TypeScript strict mode
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- Vitest (테스트 러너)
- import alias: `@/*` → `./src/*`

## 아키텍처 규칙
- TODO: 이 프로젝트의 CRITICAL 규칙을 확정할 것. 아래는 하네스 기본 예시이며 검토 전까지는 잠정값이다.
- CRITICAL: 모든 API 로직은 `src/app/api/` 라우트 핸들러에서만 처리할 것
- CRITICAL: 클라이언트 컴포넌트에서 외부 API를 직접 호출하지 말 것
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, 비즈니스 로직은 `src/lib/`에 분리할 것

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)

## 협업 규칙 (VAN AI Innovation 학회)
전문은 `docs/TEAM_RULES.md`. 아래는 매 작업에서 지켜야 할 항목.

- CRITICAL: `main` 브랜치로 직접 push 금지. 모든 변경은 PR을 거칠 것.
- CRITICAL: 작업 시작 전 GitHub 이슈를 먼저 발행하고, 이슈 번호로 브랜치를 만들 것.
- 브랜치: `main`에서 분기 → `main`으로 PR (dev 미사용). 명명은 `type/#번호` (예: `feat/#12`)
- 커밋 메시지: `{type}: {설명}` — feat, fix, docs, style, refactor, test, chore
- PR 제목: `[Type] 작업 요약` (예: `[Feat] 카카오 로그인 기능 구현`)
- PR 본문 필수: 변경 사항 설명 / 관련 이슈 번호(`#12`) / 테스트 통과 여부 (UI 변경 시 스크린샷)
- 머지 후 브랜치 삭제. 리뷰는 셀프 리뷰 (갠플이라 승인자 없음)
- 커밋·PR·이슈는 사용자가 요청할 때만 생성할 것.

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # Vitest
