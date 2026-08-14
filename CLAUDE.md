# 프로젝트: work-task-status-board

## 기술 스택
- Next.js 16.3 (App Router)
- TypeScript strict mode
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- Vitest (테스트 러너)
- import alias: `@/*` → `./src/*`

## 무엇을 만드는 프로젝트인가
Google Sheets에 흩어진 팀별 업무(16/70/20 컬럼)를 **시트 업로드만으로** 통합 조회하고,
Google Docs 워크로드 문서를 **업무 배정표 xlsx로 뽑는** 웹. 이 둘이 최우선 산출물이다.
근거 문서는 `docs/PLAN.md` — **결정이 바뀌면 코드보다 PLAN.md를 먼저 고친다.**
설계 상세는 `docs/ARCHITECTURE.md`, 결정 이력은 `docs/ADR.md`, 화면 규칙은 `docs/UI_GUIDE.md`.
작업 단위는 `docs/TICKETS.md` (T0~T10, GitHub 이슈와 1:1).

## 아키텍처 규칙
- CRITICAL: 비즈니스 로직은 `src/lib/`에만 둔다. 라우트 핸들러와 서버 컴포넌트는 `src/lib/`를
  **호출만 하고 계산하지 않는다.** 서버 컴포넌트는 자기 API 라우트를 fetch하지 않는다.
- CRITICAL: 집계·판정은 `src/lib/domain/`의 **JS 순수 함수**로 한다. SQL 집계를 쓰지 않는다
  (memory·supabase 두 구현의 결과가 갈라진다).
- CRITICAL: 도메인 함수는 `now`(오늘 날짜)를 **인자로 주입**받는다. 함수 안에서 `Date.now()`·
  `new Date()`를 호출하지 않는다. KST 기준 오늘은 `lib/domain/kst-today.ts`가 산출한다.
- CRITICAL: `exceljs` import는 `src/lib/sheet/workbook-reader.ts`(읽기)와
  `src/lib/xlsx/assignment-writer.ts`(쓰기) **두 파일에서만**. 나머지는 자체 타입만 안다.
  적용 범위는 `src/` 아래 제품 코드다. `scripts/smoke/`의 일회성 검증 스크립트는 번들에
  들어가지 않으므로 예외이며, 이 예외는 `scripts/smoke/`에만 해당한다.
- CRITICAL: `src/lib/` 아래 파일명은 **전역 유니크**하게 짓는다. TDD 가드가 basename만 보고
  테스트를 찾아서, 같은 이름이 두 디렉토리에 있으면 테스트 하나로 둘 다 통과해버린다.
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, 비즈니스 로직은 `src/lib/`에 분리할 것.
  컴포넌트는 props 받아 JSX만 뱉는다.
- `src/app/api/**`에는 `export const runtime = 'nodejs'`를 명시할 것.
- `src/services/`는 쓰지 않는다. 외부 연동은 `src/lib/store/`가 감싼다.

## 보안·데이터 규칙
- CRITICAL: `service_role` 키에 `NEXT_PUBLIC_` 접두사를 붙이지 말 것. 브라우저에 그대로 노출된다.
- CRITICAL: 실업무 데이터(실명·연락처·문의자 계정이 든 `.xlsx`/`.docx`)를 커밋하지 말 것.
  테스트 픽스처는 반드시 익명화한다.
- CRITICAL: API 응답에 `tasks.raw`를 싣지 말 것 (zod 스키마로 강제). `extras`의 민감 키
  (`연락처`·`계정`·`이메일`·`전화`)는 admin·lead에게만 내려보낸다.
- CRITICAL: 생성하는 xlsx의 문자열 셀은 텍스트 타입으로 강제하고, `=`·`+`·`-`·`@`·탭·개행으로
  시작하면 `'` 프리픽스를 붙일 것 (수식 주입 방어). 읽을 때는 수식 셀의 `result`만 쓴다.
- 에러 메시지·로그에 셀 값을 담지 말 것. 위치(`시트명!행:열`)와 사유만 남긴다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 파서는 **하드 실패시키지 말 것.** 검증 실패·미등록 값은 `warnings[]`에 담고 값은 보존한다.
  단 "알려진 탭이 하나도 없음"은 중단이다 — 빈 결과로 기존 데이터를 덮으면 안 된다.

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

## 하네스 실행 규칙
`scripts/execute.py`가 각 step마다 이 파일과 `docs/*.md`를 가드레일로 주입한다.

- 각 step은 지시된 작업만 수행하고, 요청되지 않은 기능/파일을 만들지 말 것.
- 커밋은 하네스가 한다. step 세션은 `git commit`을 직접 실행하지 말 것. 커밋 제목은
  `phases/<phase>/index.json`의 `steps[].commit`에 미리 확정해 두며, 형식이 컨벤션
  (`docs/TEAM_RULES.md` 3.3)에 어긋나면 하네스가 실행 전에 중단한다.
- AC(Acceptance Criteria)를 직접 실행해 검증한 뒤 `phases/<phase>/index.json`의 step status를 갱신할 것.
- 사용자 개입(API 키, 인증, 수동 설정 등)이 필요하면 즉시 `blocked` 처리하고 중단할 것.
- 하네스는 브랜치를 만들거나 push하지 않는다. 팀 규칙의 브랜치명이 `type/#이슈번호`
  (`docs/TEAM_RULES.md` 2.1)라서 phase 이름으로 추론할 수 없기 때문이다.
  실행 전에 `git checkout -b 'chore/#3'`처럼 직접 브랜치를 만들 것.
  `main`·`master`에서 실행하면 하네스가 즉시 중단한다.

## 가드레일 (`.claude/settings.json`)
- `PreToolUse[Bash]` → 위험 명령(`rm -rf`, force push, `reset --hard`, `DROP TABLE`) 차단.
- `PreToolUse[Edit|Write]` → `.claude/hooks/tdd-guard.sh`. 소스 파일에 대응 테스트가 없으면 편집 차단.
  `components/`·`types/`·설정/스타일 파일은 예외.
- `Stop` → 턴 종료 시 `lint`/`build`/`test` 실행.

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # Vitest

## 하네스
python3 scripts/execute.py <phase-dir>      # phase의 step을 순차 실행 (claude -p 호출)
python3 -m pytest scripts/test_execute.py   # 하네스 테스트

하네스는 `claude` CLI를 **구독 인증(OAuth)** 으로만 호출한다. `ANTHROPIC_API_KEY` 등
종량 과금 환경변수는 자식 프로세스에서 제거된다 (`scripts/execute.py`의 `BILLED_AUTH_ENV`).
