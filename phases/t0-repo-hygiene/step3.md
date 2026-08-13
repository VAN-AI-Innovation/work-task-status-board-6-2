# Step 3: secret-guard

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `CLAUDE.md` — 「보안·데이터 규칙」 전체
- `docs/PLAN.md` — `S5`(키 관리와 RLS 함정 두 가지)
- `docs/TICKETS.md` — `## T0` 절의 완료 기준 8
- `.gitignore` — `.env*`가 무시 목록에 있다는 사실이 이 step의 핵심이다
- 이전 step 산출물: `src/lib/env-guard.ts`, `src/lib/env-guard.test.ts`, `vitest.config.ts`, `package.json`

`src/lib/env-guard.ts`의 `findServiceRoleViolations` 시그니처와 기존 테스트를 **반드시 먼저 읽어라.**
이 step은 그 순수 함수를 저장소 스캔에 연결하는 단계다.

## 배경

`service_role` 키에 `NEXT_PUBLIC_` 접두사를 붙이면 브라우저 번들에 그대로 실린다. Supabase에서
가장 흔한 사고다 (`PLAN.md` S5). step 1에서 탐지 **로직**은 만들었지만, 아직 아무것도 이걸
실행하지 않는다. 완료 기준 8은 이 패턴이 **빌드를 실패시킬 것**을 요구한다.

스캔 대상에 `.env*`를 반드시 포함해야 한다. `.gitignore`가 `.env*`를 무시하므로 git에 잡히지
않지만, **실제 유출 경로는 바로 거기다.** 로컬 `.env.local`에 잘못 적힌 키가 `npm run build`로
브라우저 번들에 들어간다.

## 작업

### 1. `src/lib/env-guard.test.ts`에 저장소 스캔 케이스 추가

기존 단위 테스트는 그대로 두고, **실제 저장소를 스캔하는 케이스**를 추가하라.

스캔 대상 파일 목록은 이렇게 만든다:

- `git ls-files`로 얻은 추적 파일 전부
- 저장소 루트의 `.env*` 파일 전부 (git에 없어도 읽는다. 존재하지 않으면 건너뛴다)

제외 대상:

- `node_modules/`, `.next/`, `phases/` 하위
- **`src/lib/env-guard.ts`와 `src/lib/env-guard.test.ts` 자기 자신** — 이유: 탐지 패턴 문자열과
  테스트 픽스처가 들어 있어서 제외하지 않으면 가드가 스스로를 위반으로 신고하고 영구 실패한다.

읽을 수 없는 파일(바이너리 등)은 건너뛴다. 실패시키지 마라.

`findServiceRoleViolations`에 넘긴 결과가 **빈 배열이어야 통과**한다. 실패 메시지에는
`file:line`과 환경변수 **이름만** 담아라. 이유: `CLAUDE.md`가 로그에 값을 담지 말라고 규정한다.
CI 로그는 공개될 수 있고, 위반한 줄을 통째로 출력하면 가드가 키를 유출하는 도구가 된다.

### 2. `package.json`에 빌드 가드 연결

npm 라이프사이클을 이용해 `npm run build` 앞에 가드를 끼운다.

```json
"guard:env": "vitest run src/lib/env-guard.test.ts",
"prebuild": "npm run guard:env"
```

이 방식을 쓰는 이유:

- `prebuild`는 `npm run build` 실행 시 npm이 자동으로 먼저 돌리고, **실패하면 빌드가 중단된다.**
  완료 기준 8의 "빌드를 실패시키는 가드"를 문자 그대로 충족한다.
- 별도 러너나 새 의존성이 필요 없다. 이미 있는 vitest를 그대로 쓴다.
- ESLint 규칙으로는 **`.env*` 파일을 볼 수 없다.** 실제 유출 경로를 못 막으므로 쓰지 않는다.

### 3. 가드가 실제로 빌드를 막는지 실증

임시 위반 파일을 만들어 `npm run build`가 **실패**하는지 직접 확인하라. 확인 후 반드시 지워라.

```bash
printf 'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=dummy-not-a-real-key\n' > .env.guard-check
npm run build; echo "빌드 종료 코드: $?  (0이 아니어야 정상)"
rm -f .env.guard-check
npm run build && echo "정리 후 빌드 정상"
```

`.env.guard-check`가 남아 있으면 이후 모든 빌드가 실패한다. **반드시 삭제됐는지 확인하고**
step을 마쳐라. 실제 키를 쓰지 마라 — 위 더미 문자열을 그대로 쓴다.

## Acceptance Criteria

```bash
npm run lint     # 경고·에러 없음
npm test         # 전체 테스트 통과 (저장소 스캔 케이스 포함)
npm run build    # prebuild 가드 통과 후 빌드 성공
```

추가로 아래가 모두 참이어야 한다:

```bash
node -e "const p=require('./package.json'); if(!p.scripts.prebuild) throw new Error('prebuild 스크립트 없음')"
test ! -e .env.guard-check    # 실증용 임시 파일이 남아 있지 않다
```

그리고 위 「3. 실증」의 커맨드를 실행했을 때 위반 파일이 있는 상태의 `npm run build`가
**0이 아닌 종료 코드**를 냈어야 한다.

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 실패 메시지에 환경변수 **값**이 들어가지 않는가? (`CLAUDE.md` 보안 규칙)
   - `findServiceRoleViolations`가 여전히 순수 함수인가? (파일 I/O는 테스트 쪽에 있는가)
   - 스캔이 `.env*`를 포함하는가? (여기를 빼면 가드의 의미가 없다)
3. 결과에 따라 `phases/t0-repo-hygiene/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실증용 `.env.guard-check`에 **진짜 키를 쓰지 마라.** 이유: `.env*`는 gitignore되지만
  하네스 로그와 step 출력에는 남는다.
- 실패 메시지에 위반한 줄 전체나 키 값을 출력하지 마라. 이유: CI 로그로 키가 유출된다.
- 스캔 대상에서 `.env*`를 빼지 마라. 이유: 실제 유출 경로가 거기다. git 추적 파일만 보면
  가드가 무의미해진다.
- ESLint 규칙으로 대체하지 마라. 이유: ESLint는 `.env*` 파일을 보지 않는다.
- `src/lib/env-guard.ts`의 `findServiceRoleViolations` 시그니처를 바꾸지 마라. 이유: step 1의
  단위 테스트가 이 시그니처에 묶여 있다. 필요하면 스캔 쪽 코드로 감싸라.
- `.github/workflows/`를 건드리지 마라. 이유: step 4의 범위다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
- 기존 테스트를 깨뜨리지 마라.
