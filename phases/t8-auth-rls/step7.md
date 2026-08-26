# Step 7: viewer-storage

## 읽어야 할 파일

- `CLAUDE.md` — 외부 연동은 `src/lib/store/`가 감싼다 · `src/lib/` 파일명 전역 유니크
- `docs/TICKETS.md` — T8 완료 기준 **5**(조회가 사용자 JWT로 나가 RLS가 실제로 걸린다.
  `service_role`은 서버의 업로드 커밋·시드 경로에만)
- step 0 산출물: `docs/ADR.md` `ADR-024`, `docs/PLAN.md`「T8 착수 시 확정」 결정 B의 4줄 표
- step 6 산출물: `src/lib/auth/session-client.ts`·`viewer-session.ts`
- 고칠 일이 **없는지** 확인할 파일:
  - `src/lib/store/store-factory.ts` — **머리말 전체를 읽는다.** 특히 `getStorage()`가
    전역 심볼에 캐시되는 이유(RSC 번들과 라우트 번들이 갈린다)와 `demo`/`fallback` 구분
  - `src/lib/store/supabase-task-store.ts` — `createSupabaseTaskStore(client)`가 클라이언트를
    **인자로** 받는다는 것. 이 step이 성립하는 근거다

## 배경

완료 기준 5는 「조회가 사용자 JWT로 나간다」인데, 지금 조회는 전부 `getStorage()`를 지나고
그것은 **`service_role` 클라이언트를 담은 프로세스 전역 싱글턴**이다. `service_role`은 RLS를
우회하므로 step 4의 정책이 조회에 대해서는 **한 줄도 걸리지 않는다.**

싱글턴에 사용자 토큰을 넣을 수는 없다 — 요청마다 다르고, 넣는 순간 한 사용자의 토큰이 다음
요청의 다른 사용자에게 샌다. 그래서 **요청 스코프 핸들을 따로 만든다.**

이 파일이 하는 일은 조건 하나다: **라이브 저장소이고 세션 클라이언트가 있으면 조회 저장소를
그 클라이언트로 만든다. 아니면 기존 것을 그대로 쓴다.** 그 이상을 하지 마라.

## 작업

### 1. `src/lib/store/viewer-storage.test.ts` 를 **먼저** 쓴다

```ts
export interface ViewerContext {
  /** **조회 전용.** 라이브+세션이면 사용자 JWT를 실은 저장소, 아니면 `base.repo` */
  repo: TaskRepository;
  session: SessionOutcome;
  /** 업로드 확정·시드·업로드 이력이 쓰는 `service_role` 핸들. 그대로 통과시킨다 */
  base: StorageHandle;
}

export async function resolveViewerContext(
  base: StorageHandle,
  client: SupabaseClient | null
): Promise<ViewerContext>;
```

**갈래는 둘이다.**

| 조건 | `repo` | `session` |
|---|---|---|
| `base.mode === 'live'` **그리고** `client !== null` | `createSupabaseTaskStore(client)` | `await resolveSession(client)` |
| 그 밖 (`demo`·`fallback`, 또는 자격증명 없음) | `base.repo` | `{ status: 'anonymous' }` |

라이브인데 로그인하지 않은 경우에도 **JWT 저장소를 쓴다.** 그러면 RLS가 0행을 돌려주고,
그것이 정직한 결과다. 여기서 `base.repo`로 되돌리면 「로그인 안 했는데 전부 보인다」가 된다.

테스트 케이스 (가짜 `StorageHandle`·가짜 클라이언트를 손으로 짓는다):

- `mode:'live'` + 클라이언트 있음 → `repo !== base.repo`이고 `resolveSession`이 **불렸다**
- `mode:'live'` + 클라이언트 `null` → `repo === base.repo`, `session.status === 'anonymous'`
- `mode:'demo'` + 클라이언트 **있음** → `repo === base.repo`.
  **데모에서 세션을 보지 않는다** — 메모리 저장소에는 그 사용자의 행이 없다
- `mode:'fallback'` + 클라이언트 있음 → `repo === base.repo` (같은 이유 + 읽기 전용이다)
- 모든 갈래에서 `base`가 **그대로** 통과한다 (`uploads`·`readOnly`·`driver`·`mode`)
- 캐시하지 않는다 — 같은 인자로 두 번 불러도 매번 새로 만든다
  (같은 `client`로 두 번 불러 `resolveSession` 호출 수가 2인지 잰다)

### 2. `src/lib/store/viewer-storage.ts` 를 구현한다

- `process.env`를 읽지 마라. `base`와 `client`가 인자의 전부다.
- 전역 캐시를 만들지 마라 (`store-factory`의 `Symbol.for` 패턴을 **따라 하지 마라**).
  그 캐시가 있는 이유는 「프로세스당 하나」이기 때문이고, 이것은 「요청당 하나」다.
- `store-factory.ts`를 **고치지 마라.** import만 한다 (`StorageHandle` 타입,
  그리고 `createSupabaseTaskStore`는 `supabase-task-store.ts`에서 직접).
- 파일 머리말에 남길 것: 왜 싱글턴에 못 넣는지, 라이브인데 미인증일 때 왜 JWT 저장소를
  그대로 쓰는지, `base`가 왜 함께 실려 다니는지(업로드 경로는 여전히 `service_role`이다).

### 3. 아직 호출부를 바꾸지 않는다

이 step은 **부품만 만든다.** 화면·라우트가 이것을 쓰기 시작하는 것은 step 8이다.
지금 조회 경로를 갈아 끼우면 「범위 판정」(step 8)이 없는 채로 화면이 RLS만 보게 되고,
데모 모드에서 역할 구분이 통째로 사라진다.

## Acceptance Criteria

```bash
npm run test -- src/lib/store/viewer-storage.test.ts
npm run lint && npm run build && npm run test
grep -rn 'process.env\|Symbol.for' src/lib/store/viewer-storage.ts   # 0줄
git diff --stat src/lib/store/store-factory.ts                        # 변경 없음
grep -rn 'viewer-storage' src/app src/components                      # 0줄 (아직 아무도 안 쓴다)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 변이 테스트 셋을 넣어 보고 잡히는지 확인한다 (통과 후 되돌린다):
   - `demo`에서도 세션 클라이언트를 쓰게 바꾼다 → 데모 케이스가 잡아야 한다
   - 라이브+미인증에서 `base.repo`로 되돌리게 바꾼다 → 해당 케이스가 잡아야 한다
   - 결과를 모듈 지역 변수에 캐시한다 → 「두 번 부르면 두 번 만든다」가 잡아야 한다
3. 체크리스트:
   - `service_role` 클라이언트가 이 파일에 등장하지 않는가?
   - `base`가 손실 없이 통과하는가? (업로드 경로가 여전히 `service_role`이다)
4. `phases/t8-auth-rls/index.json`의 step 7을 갱신한다.

## 금지사항

- `getStorage()`의 캐시를 없애거나 요청 스코프로 바꾸지 마라. 그것은 업로드·시드 경로가
  기대는 성질이고(`store-factory` 머리말의 T6 완료 기준 8 사례), 바꾸면 「마지막 반영」이
  다시 깨진다.
- `TaskRepository` 인터페이스를 고치지 마라.
- 라우트·페이지·컴포넌트를 고치지 마라.
- `viewer-storage.ts`에서 권한을 판정하지 마라 — 범위는 `viewer-scope.ts`(step 1)와
  RLS(step 4)가 진다. 세 번째 자리를 만들지 마라.
- 기존 테스트를 깨뜨리지 마라.
