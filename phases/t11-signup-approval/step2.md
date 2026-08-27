# Step 2: route-guard-signup

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 「권한 (T8)」의 `proxy` 도식
- `/docs/ADR.md` — ADR-026 · ADR-027 · ADR-029
- `src/lib/auth/route-guard.ts` — **이 step이 고치는 본체.** 머리말을 반드시 읽어라
- `src/lib/auth/route-guard.test.ts`
- `src/proxy.ts` · `src/proxy.test.ts`
- `src/lib/auth/viewer-session.ts` — step 1이 `pending`·`rejected`를 더했다
- `src/lib/api/api-error.ts` — 에러 코드 표

step 1이 만든 것: `SessionOutcome`에 `pending`·`rejected` 갈래가 생겼고, 둘 다
`userId`·`email`·`teamId`·`displayName`을 싣는다.

## 작업

**TDD다. `route-guard.test.ts`를 먼저 늘리고 통과시킨다.**

### 1. `/signup`을 공개 경로로 연다

`PUBLIC_PREFIXES`에 `/signup`과 `/api/auth`(이미 있다)를 확인한다. 가입 라우트는
`/api/auth/signup`으로 만들 예정이라 `/api/auth` 접두사에 이미 걸린다 — **더 넓히지 마라.**

`/signup`을 더할 때 기존 주석의 규칙을 지킨다: 접두사 비교는 `pathname === prefix ||
pathname.startsWith(prefix + '/')`다. 단순 `startsWith`로 바꾸면 `/signups`가 뚫린다.

### 2. `/pending`은 공개가 아니다

**`/pending`을 `PUBLIC_PREFIXES`에 넣지 마라. 이유: 대기 사용자는 로그인한 상태다.**
공개로 두면 로그아웃 상태에서도 열려 아무 의미가 없는 화면이 노출되고, `proxy`가 세션
갱신을 건너뛰어 토큰이 조용히 만료된다. `page`로 두면 미인증은 `/login`으로 가고
인증된 대기 사용자는 통과한다 — 그것이 맞다.

### 3. 대기 사용자를 `/pending`으로 보내는 자리

**`proxy.ts`에서 하지 마라. 이유: `proxy`는 DB를 조회하지 않는다** (Next 문서가
「Proxy는 느린 데이터 조회용이 아니다」라고 못박고 있고, `ARCHITECTURE.md`가 그것을
설계로 확정했다). `proxy`가 아는 것은 「사용자가 있느냐」 하나다.

대신 **판정을 순수 함수로** `src/lib/auth/pending-gate.ts`에 둔다:

```ts
export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string }   // 화면
  | { kind: 'deny' };                  // API — 403

export function gateForSession(
  outcome: SessionOutcome,
  pathname: string
): GateDecision
```

규칙:

```
status === 'ok' 또는 'anonymous'          → allow (앞단이 이미 처리한 상태다)
pathname이 이미 /pending 또는 그 아래       → allow (무한 리다이렉트 방지)
pathname이 /api/auth/** 이면               → allow (로그아웃·재요청이 막히면 갇힌다)
pending·rejected·no_profile + /api/**      → deny
pending·rejected·no_profile + 그 밖         → redirect '/pending'
```

**`no_profile`을 같이 태우는 것이 의도다.** 트리거가 어떤 이유로 실패해 `profiles` 행이
없는 계정도 지금은 아무것도 못 보는 화면에 갇혀 있다. `/pending`이 그 계정에도 할 말을
갖게 된다 (「프로필이 준비되지 않았습니다」).

**무한 리다이렉트 방지가 이 함수에서 제일 중요하다.** `/pending` 자신을 `allow`하지 않으면
브라우저가 리다이렉트 루프에 빠지고, 사용자는 원인을 알 수 없는 `ERR_TOO_MANY_REDIRECTS`를
본다. 테스트로 반드시 못박아라.

### 4. 호출부 둘

- **화면**: `src/app/layout.tsx`(또는 보호 대상 페이지가 공통으로 지나는 서버 컴포넌트)에서
  `resolveSession` → `gateForSession` → `redirect()`. 기존에 세션을 읽는 자리가 이미 있으면
  **그 자리를 쓰고 왕복을 늘리지 마라.** 없으면 어디에 두는 것이 최소 변경인지 코드를 읽고
  판단하라.
- **API**: `src/lib/auth/request-viewer.ts`의 `currentViewerContext` 부근. 대기 상태면
  `PENDING_APPROVAL` 에러 코드로 **403**을 낸다.
  `src/lib/api/api-error.ts`에 코드를 더한다. **401을 쓰지 마라. 이유: 401은 「로그인하라」는
  뜻이고 이 사람은 이미 로그인했다.** 화면이 로그인 폼을 다시 띄우게 된다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm test

npx vitest run src/lib/auth/route-guard.test.ts src/lib/auth/pending-gate.test.ts src/proxy.test.ts

# /pending이 공개 목록에 들어가지 않았는지 (결과가 비어 있어야 한다)
grep -n "'/pending'" src/lib/auth/route-guard.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `gateForSession`에 대해 **`/pending` 자신이 `allow`인지** 테스트가 있는지 확인한다.
   없으면 추가한다 — 리다이렉트 루프는 이 step의 유일한 치명적 실수 경로다.
3. `proxy.ts`가 여전히 DB를 조회하지 않는지 확인한다
   (`grep -n "from(" src/proxy.ts` → 결과 없음).
4. 아키텍처 체크리스트:
   - 판정이 `src/lib/`의 순수 함수인가? 라우트·`proxy`가 계산하지 않는가?
   - `src/lib/` 아래 파일명이 전역 유니크한가? (`pending-gate.ts`는 새 이름이다 — 중복 확인)
   - `src/app/api/**`에 `export const runtime = 'nodejs'`가 있는가? (이 step이 라우트를
     만들었다면)
5. `phases/t11-signup-approval/index.json`의 step 2를 업데이트한다.
   `summary`에 `gateForSession`의 시그니처와 새 에러 코드 이름을 적는다.

## 금지사항

- **`proxy.ts`에서 `profiles`를 조회하지 마라.** 이유: 3번 절에 근거가 있다.
- **`/pending`을 공개 경로로 만들지 마라.** 이유: 2번 절에 근거가 있다.
- **`route-guard.ts`의 `demo-open` 우선순위를 바꾸지 마라.** 이유: `.env` 없이 클론한
  심사자에게는 로그인할 계정 자체가 없다 (`PRD.md` 성공 기준 1번). 그 사람이 빈 로그인
  화면 하나만 보고 평가를 끝내면 안 된다.
- **가입·대기 화면의 UI를 만들지 마라.** 이유: 이 step은 가드 레이어만 다룬다. 화면은
  step 3·4가 만든다. 여기서는 `/pending`이 라우팅상 존재하기만 하면 된다 (최소한의
  placeholder는 허용).
- 기존 테스트를 깨뜨리지 마라
