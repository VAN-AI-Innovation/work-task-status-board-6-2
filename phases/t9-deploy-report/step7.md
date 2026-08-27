# Step 7: clean-clone

## 읽어야 할 파일

- `CLAUDE.md` — 전부
- `docs/PRD.md` — **「성공 기준」 1번**(100행): `.env` 없이 클론 → `npm install && npm run dev` →
  빈 상태 → `[샘플 데이터 불러오기]` → 대시보드
- `docs/TICKETS.md` — T9 완료 기준 **2**·**3**·**5**
- step 6의 `summary` — **README를 따라 했을 때 어긋난 지점**이 적혀 있다. 이 step이 그것을 고친다
- `README.md` — step 6이 쓴 「시작하기」 절
- `.env.example`
- `src/lib/store/store-factory.ts` — `STORAGE_DRIVER`가 없을 때 어느 구현이 서는지
- `src/app/api/uploads/seed/route.ts` — `[샘플 데이터 불러오기]`가 부르는 자리
- `src/lib/env-guard.test.ts` — `npm run guard:env`가 무엇을 막는지

## 배경

완료 기준 2는 **문서가 아니라 실행으로 증명해야 하는 것**이다. 그리고 지금 이 저장소에서
개발하던 사람은 `.env.local`을 갖고 있어서 **키가 없는 상태를 한 번도 겪지 않았다.**
`.env.local`이 있는 채로 아무리 돌려 봐도 이 기준은 검증되지 않는다.

그래서 이 step은 **진짜로 깨끗한 클론을 만들어서** 돌린다.

## 작업

### 1. 깨끗한 클론을 만든다

작업 디렉토리 **바깥**의 임시 경로에 현재 브랜치를 클론한다. `/tmp` 아래처럼 저장소와 무관한
자리를 쓴다.

- **`.env.local`이 따라가지 않는 것을 확인하라** (`.gitignore`에 있다). 클론한 쪽에
  `.env.local`이 있으면 이 검증은 무의미하다
- 셸에 `STORAGE_DRIVER`·`SUPABASE_*`·`NEXT_PUBLIC_SUPABASE_*` 같은 환경변수가 **남아 있지 않은지**
  확인하고, 남아 있으면 **그 프로세스에서만 unset**하고 돌린다
- `node_modules`를 복사해 오지 마라. **`npm install`부터 실제로 돌린다** — 성공 기준이 그것이다

### 2. README에 적힌 순서 그대로 실행한다

step 6이 쓴 「시작하기」를 **한 줄씩 그대로** 따라간다. 사람이 처음 클론했을 때와 같은 조건이다.

확인할 것:

- `npm install`이 **에러 없이** 끝나는가? (`peer dependency` 경고는 에러가 아니다)
- `npm run dev`가 뜨는가? **`.env` 없이 뜨는 것이 요점이다.** 키를 요구하며 죽으면 그것이 버그다
- 첫 화면이 **빈 상태**이고, 그 빈 상태가 **왜 비었는지 말해 주는가?**
  (`lib/view/empty-reason.ts`의 갈래 중 「저장소가 빈 것」이어야 한다)
- **`[샘플 데이터 불러오기]` 버튼이 실제로 있는가?** 눌러서 대시보드가 뜨는가?
- 네 화면(`/`, `/teams/[teamSlug]`, `/upload`, `/extract`)과 **`/report`가 전부 200인가?**
  데모 모드는 인증 면제다 — **로그인으로 튕기면 안 된다**
- `npm run lint && npm run build && npm run test`가 통과하는가? (PRD 성공 기준 4번)
  **라이브 DB 계약 테스트는 키가 없으면 건너뛰어야 한다** — 키 없는 클론에서 계약이 빨갛게
  터지면 그것도 고칠 대상이다

### 3. 어긋난 것을 고친다

**이 step은 코드를 고쳐도 된다.** 단 **키 없는 실행 경로를 살리는 데 필요한 만큼만** 고친다.

자주 나오는 어긋남:

- 환경변수가 없을 때 기본값이 없어 죽는 자리 → 기본값을 준다
- `.env.example`에 없는 키를 코드가 읽는 자리 → `.env.example`에 더한다
- README의 명령·문구가 실제와 다른 자리 → README를 고친다
- 라이브 DB 계약이 키 없이도 돌려고 해서 실패하는 자리 → 건너뛰는 조건을 확인한다

**요청받지 않은 개선을 끼워 넣지 마라.** 「키 없이 뜬다」와 무관한 리팩토링·스타일 정리는 금지다.

### 4. 결과를 문서에 남긴다

`docs/TICKETS.md`의 T9 절에 **「키 없는 클론 실측」**을 적는다. 실행한 명령, 각 단계의 결과,
고친 것을 적는다. **고칠 게 없었으면 없었다고 적는다** — 그것도 결과다.

## Acceptance Criteria

깨끗한 클론에서 (임시 경로, `.env.local` 없음):

```bash
npm install
npm run lint
npm run build
npm run test
npm run dev &                                                   # 백그라운드
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/         # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/upload   # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/extract  # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/report   # 200 (데모는 인증 면제)
curl -s localhost:3000/api/health | head -c 200                  # driver=memory, mode=demo
curl -s -X POST localhost:3000/api/uploads/seed -o /dev/null -w '%{http_code}\n'   # 시드가 들어간다
curl -s localhost:3000/ | grep -c "업무"                          # 시드 후 대시보드에 내용이 있다
```

원래 저장소에서:

```bash
npm run lint && npm run build && npm run test    # 키 있는 환경에서도 그대로 통과
git status --short                                # 임시 클론이 저장소 안에 없다
```

**검증이 끝나면 임시 클론을 지운다.** 저장소 안에 남기지 마라.

## 검증 절차

1. 위 AC를 **깨끗한 클론에서** 실행한다. 원래 저장소에서 돌리고 통과했다고 적으면 이 step은 실패다.
2. 체크리스트:
   - 클론에 `.env.local`이 **없는 것을 실제로 확인**했는가?
   - 셸에 Supabase 환경변수가 남아 있지 않았는가?
   - 고친 것이 **전부 「키 없이 뜬다」에 직접 연결되는가?**
3. `phases/t9-deploy-report/index.json`의 step 7을 갱신한다:
   - 성공 → `completed` + `summary`. **실행한 경로와 고친 것을 구체적으로** 적는다.
     고친 게 없으면 「없었다」고 적는다.
   - 실패 → `error` / 개입 필요 → `blocked`

## 금지사항

- **원래 저장소에서 돌려 놓고 통과했다고 적지 마라.** 이유: `.env.local`이 있어서 검증이 안 된다.
- **임시 클론을 저장소 안(하위 디렉토리)에 만들지 마라.** 이유: `git status`가 더러워지고
  실수로 커밋된다.
- **키 없는 실행과 무관한 리팩토링을 하지 마라.** 이유: 이 step의 diff는 전부 완료 기준 2에
  연결돼야 한다.
- **테스트를 건너뛰게 만들어서 통과시키지 마라.** 이유: 라이브 DB 계약이 키 없이 건너뛰는 것은
  설계지만, 실패하는 테스트를 `skip`으로 덮는 것은 다른 이야기다.
- **`.env.example`에 실제 키를 넣지 마라.**
- 기존 테스트를 깨뜨리지 마라.
