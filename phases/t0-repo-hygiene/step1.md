# Step 1: test-gate

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 특히 「개발 프로세스」의 TDD 규칙과 「보안·데이터 규칙」
- `docs/ARCHITECTURE.md` — 「디렉토리 구조」와 「파일명 규칙 — TDD 가드를 역이용한다」
- `docs/PLAN.md` — `A6`(Vitest가 `@/*` 경로를 못 푼다), `S5`(키 관리와 RLS 함정)
- `docs/TICKETS.md` — `## T0` 절의 완료 기준 3·4
- `package.json` · `tsconfig.json` — 현재 상태
- `.claude/hooks/tdd-guard.sh` — 이 훅이 구현 파일 작성을 막는다. 아래 「작업 순서」 참고
- 이전 step 산출물: `src/app/page.tsx`, `.gitignore`

## 배경

지금 `npm test`는 `vitest run --passWithNoTests`다. 테스트가 0개여도 통과하므로 게이트가
무력화돼 있다. 동시에 `vitest.config.ts`가 없어서 `@/` 경로 별칭이 풀리지 않는다.
**Vitest는 `tsconfig.json`의 `paths`를 자동으로 읽지 않는다** (`PLAN.md` A6). 첫 테스트에서
바로 `Cannot find module '@/lib/...'`이 난다.

`--passWithNoTests`를 테스트 없이 먼저 제거하면 Stop 훅(`npm run lint && build && test`)이
계속 실패한다. 그래서 **첫 테스트 추가와 플래그 제거를 이 step에서 함께** 한다.

첫 테스트의 대상은 `src/lib/env-guard.ts`다. T0가 어차피 만들어야 하는 유일한 `src/lib/`
모듈이라(`PLAN.md` S5), 별칭 검증용 더미 모듈을 따로 만들지 않는다.

## 작업

### 작업 순서 — TDD 가드 때문에 순서가 강제된다

`.claude/hooks/tdd-guard.sh`가 `src/lib/*.ts` 작성을 **대응 테스트 파일이 없으면 차단**한다.
따라서 반드시 이 순서로 하라:

1. `vitest.config.ts` 작성 (`*.config.*`는 가드 예외라 통과한다)
2. `src/lib/env-guard.test.ts` 작성 — 실패하는 테스트
3. `src/lib/env-guard.ts` 작성 — 테스트를 통과시키는 구현
4. `package.json`에서 `--passWithNoTests` 제거

### 1. `vitest.config.ts` 신설

`@/*` → `./src/*` 별칭이 풀려야 한다. `vite-tsconfig-paths` 플러그인을 쓰거나
`resolve.alias`를 직접 지정한다. **새 의존성을 추가하지 않는 쪽을 우선하라.**

`environment`는 기본값(`node`)으로 둔다. 이유: 이 step의 테스트 대상은 순수 함수이고,
DOM 테스트는 T5 이후에 필요해지면 그때 붙인다.

### 2. `src/lib/env-guard.ts` — 순수 탐지 함수

`service_role` 키에 `NEXT_PUBLIC_` 접두사가 붙으면 브라우저에 그대로 노출된다. 가장 흔한
Supabase 사고이고(`PLAN.md` S5), T0 완료 기준 8이 이걸 빌드 실패로 막으라고 요구한다.

이 step은 **탐지 로직(순수 함수)만** 만든다. 저장소 스캔과 빌드 연결은 step 3이다.

시그니처:

```ts
export interface EnvGuardViolation {
  /** 위반이 발견된 파일 경로 (저장소 루트 기준 상대 경로) */
  file: string;
  /** 1부터 시작하는 줄 번호 */
  line: number;
  /** 탐지된 환경변수 이름. 값은 절대 담지 않는다 */
  name: string;
}

export function findServiceRoleViolations(
  files: { path: string; content: string }[]
): EnvGuardViolation[];
```

핵심 규칙 — 벗어나면 안 된다:

- **탐지 패턴은 `NEXT_PUBLIC_`로 시작하고 `SERVICE_ROLE`을 포함하는 식별자다.**
  `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SERVICE_ROLE` 모두 잡아야 한다.
- **`name`에 환경변수 이름만 담고, 값이나 줄 전체를 담지 마라.** 이유: `CLAUDE.md`의
  "에러 메시지·로그에 셀 값을 담지 말 것"과 같은 원칙이다. `.env` 파일을 스캔하면
  `NEXT_PUBLIC_..._SERVICE_ROLE_KEY=eyJhbGci...` 형태라, 줄 전체를 담으면 가드가
  **키를 CI 로그에 유출하는 도구**가 된다.
- **파일 I/O를 하지 마라.** 호출자가 읽어서 넘긴다. 이 함수는 인자만 보고 판단한다.
- 한 파일에 여러 줄이 걸리면 전부 반환한다.
- 위반이 없으면 빈 배열을 반환한다.

### 3. `src/lib/env-guard.test.ts` — 단위 테스트

최소한 아래를 덮어라:

- `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`가 든 줄을 잡는다
- 서버 전용 `SUPABASE_SERVICE_ROLE_KEY`(접두사 없음)는 **잡지 않는다** — 오탐이면 못 쓴다
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 잡지 않는다
- 여러 파일·여러 줄에서 정확한 `file`·`line`을 반환한다
- 위반이 없으면 빈 배열
- **반환된 `name`에 키 값이 섞여 있지 않다** (예: `=` 뒷부분이 포함되지 않는다)

import는 반드시 `@/lib/env-guard` 형태로 하라. 상대 경로(`./env-guard`)로 쓰면 이 step의
목적인 **별칭 검증(완료 기준 4)이 무의미해진다.**

### 4. `package.json` — `--passWithNoTests` 제거

`"test": "vitest run --passWithNoTests"` → `"test": "vitest run"`.

## Acceptance Criteria

```bash
npm run lint     # 경고·에러 없음
npm run build    # 컴파일 에러 없음
npm test         # 테스트 통과 (테스트 0개면 이제 실패해야 정상)
```

추가로 아래가 모두 참이어야 한다:

```bash
test -f vitest.config.ts
! grep -q 'passWithNoTests' package.json
grep -q "@/lib/env-guard" src/lib/env-guard.test.ts   # 별칭 import 사용 확인
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/lib/` 파일명이 전역 유니크한가? (`CLAUDE.md` CRITICAL — TDD 가드가 basename만 본다)
   - `findServiceRoleViolations`가 순수 함수인가? (파일 I/O·`Date.now()` 없음)
   - 반환값에 키 값이 섞이지 않는가?
3. 결과에 따라 `phases/t0-repo-hygiene/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 저장소 전체를 스캔하는 코드나 `package.json`의 `prebuild` 훅을 만들지 마라.
  이유: step 3의 범위다. 이 step은 순수 함수와 단위 테스트까지다.
- `jsdom`·`@testing-library/*`·`happy-dom`을 설치하지 마라. 이유: 이 step에 DOM 테스트가 없고,
  T0 범위 Out이 화면 코드를 T2 이후로 미룬다.
- `exceljs`·`zod` 등 제품 의존성을 설치하지 마라. 이유: step 2의 범위다.
- 구현을 먼저 쓰고 테스트를 나중에 쓰지 마라. 이유: `CLAUDE.md`가 TDD를 CRITICAL로 규정하고,
  TDD 가드 훅이 실제로 편집을 차단한다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
