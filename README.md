# work-task-status-board

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 프로젝트.
[harness_framework](https://github.com/minseokhan/harness_framework) 기반의 에이전트 하네스가 적용되어 있다.

## 시작하기

```bash
npm install
npm run dev      # http://localhost:3000
```

## 화면

| 경로 | 하는 일 |
|---|---|
| `/` | 통합 대시보드 (역할별 진입 화면 — `?as=admin\|lead\|member`) |
| `/teams/edit` · `/teams/shoot` · `/teams/marketing` | 부서별 탭 |
| `/upload` | 팀 시트 `.xlsx` 업로드 → 미리보기 → 확정 |
| `/extract` | 워크로드 `.docx` → 업무 배정표 `.xlsx` |
| `/login` | 로그인. 세션이 있으면 역할·열람 범위를 **서버가** 정한다 (`?as=`는 무시된다) |

로그인 계정은 `npm run seed:auth`가 만든다 — 역할마다 하나씩 **`admin` · `lead` · `member`**
셋이다. 이메일·비밀번호는 `.env.local`에 있고 저장소·문서 어디에도 적지 않는다.
`STORAGE_DRIVER=memory`(데모)에서는 로그인이 필요 없고 `?as=`가 그대로 역할을 정한다.

### `/extract` — 독스에서 배정표 뽑기

Google Docs 워크로드 문서를 `.docx`로 내보내 올리면, 사람이 이어서 채울 수 있는
**배정표 `.xlsx`** 가 떨어진다.

1. `/extract`에서 `.docx`를 드롭한다 (**`.docx`만 받는다** — 판별은 확장자가 아니라
   ZIP 내부 엔트리로 하므로 이름만 바꿔서는 통과하지 않는다)
2. 미리보기 표에서 카테고리·번호·과제명·난이도·마감·우선순위·세부항목을 확인한다.
   연도가 없는 마감(`9/1까지`)은 화면에 밝힌 기준 연도로 붙고, 추론에 실패해도
   원문은 버리지 않는다
3. `[배정표 내려받기]`로 `.xlsx`를 받는다. `난이도`·`우선순위`·`상태` 컬럼에는
   **드롭다운**이 박혀 있고, `담당자`·`상태`·`진행률`·`비고` 네 칸은 사람이 채울 자리로 비어 있다

이 화면은 **아무것도 저장하지 않는다.** 업로드 이력도 추출 이력도 남지 않으므로
저장소가 읽기 전용으로 떨어져도 그대로 동작한다 (`docs/ADR.md` ADR-022).

받은 배정표를 채운 뒤에는 그 값을 팀 시트에 옮겨 적고 `/upload`에 올린다 —
배정표 파일 자체를 `/upload`에 올리면 `NO_KNOWN_TAB`으로 거부되는 것이 정상이다
(팀 탭 시그니처가 아니다). 자세한 이유는 `docs/TICKETS.md` T7「고리의 남은 한 칸」.

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run seed:auth` | 원격 Supabase에 역할 계정·구성원·시드를 만든다 (T8, 멱등) |

## 하네스

문서(`docs/`) → step 분해 → 순차 자동 실행 구조.

```bash
python3 scripts/execute.py <phase-dir>      # phase의 step을 순차 실행
python3 -m pytest scripts/test_execute.py   # 하네스 자체 테스트
```

step 실행은 `claude -p`(Claude Code CLI)로 한다. **구독 인증(OAuth)만 사용**하며,
`ANTHROPIC_API_KEY` 같은 종량 과금 환경변수는 자식 프로세스에서 제거된다.

- `/harness` — step 설계 및 `phases/` 파일 생성 워크플로우
- `/review` — 아키텍처·스택·테스트·CRITICAL 규칙 체크리스트 리뷰

가드레일은 `.claude/settings.json`에 정의되어 있다:
위험 명령 차단, 테스트 없는 소스 편집 차단(TDD), 턴 종료 시 `lint`/`build`/`test` 실행.

## 문서

- `docs/PRD.md` — 제품 요구사항
- `docs/ARCHITECTURE.md` — 디렉토리 구조·데이터 흐름·상태 관리
- `docs/ADR.md` — 기술 결정 기록
- `docs/UI_GUIDE.md` — UI 가이드
- `CLAUDE.md` — 에이전트 가드레일 (하네스가 매 step 주입)

## GitHub Actions

`.github/workflows/ci.yml` 하나뿐이다. push·pull_request에서 `npm ci` 후
로컬과 동일한 세 커맨드(`npm run lint` → `npm run build` → `npm test`)를 순서대로 돌린다.
`npm run build`는 `prebuild` 훅으로 `service_role` 키 노출 가드를 함께 실행한다.
