# Step 8: deploy

## 이 step은 반드시 `blocked`로 끝난다

**시작하자마자 이 사실을 알고 들어가라.** Vercel 배포에는 사용자 계정 인증이 필요하고,
하네스는 `claude -p` 비대화형 세션이라 `vercel login`의 브라우저 인증을 통과할 수 없다.
**사용자가 T9 착수 시 이 방식을 명시적으로 선택했다** — 여기서 멈추는 것이 설계다.

**따라서 이 step의 일은 「배포하는 것」이 아니라 「사용자가 5분 안에 배포할 수 있게 준비해 두고
정확한 사유로 멈추는 것」이다.**

우회로를 만들지 마라:

- `vercel login`을 시도하지 마라 — 대화형 프롬프트에서 세션이 멈춘다
- 토큰을 요구하거나 `.env.local`에 없는 키를 지어내지 마라
- 다른 호스팅(Cloudflare·Netlify·Railway)으로 갈아타지 마라 — 사용자가 Vercel을 골랐다
- **GitHub Actions로 배포를 자동화하지 마라** — 요청받지 않았고 시크릿이 또 필요하다

## 읽어야 할 파일

- `CLAUDE.md` — **「사용자 개입(API 키, 인증, 수동 설정 등)이 필요하면 즉시 `blocked` 처리하고
  중단할 것」**과 「`service_role` 키에 `NEXT_PUBLIC_` 접두사를 붙이지 말 것」
- `docs/TICKETS.md` — T9 완료 기준 **1**·**6**, 「리스크·미결」 전부
- step 6이 쓴 `README.md`의 **「배포」 절** — 자리를 만들어 뒀다
- step 7의 `summary` — 키 없는 클론이 실제로 도는지의 결과
- `.env.example` · `next.config.ts` · `package.json`
- `docs/PLAN.md` — **`A7`**(업로드 4MB 한도). 완료 기준 6이 배포 환경에서 이것을 다시 잰다

## 사용자가 확정한 것

- **Vercel 계정은 있고, 이 프로젝트는 아직 배포돼 있지 않다.** 프로젝트를 새로 만드는 절차가 필요하다.
- 저장소: `VAN-AI-Innovation/work-task-status-board-6-2` (GitHub 연동으로 붙이면 된다)

## 작업

### 1. 배포 전 점검을 **무인으로 할 수 있는 데까지** 한다

```bash
npm run lint && npm run build && npm run test
grep -rn "NEXT_PUBLIC_.*SERVICE_ROLE\|NEXT_PUBLIC_.*SECRET" src .env.example    # 0줄
npm run guard:env
```

- 프로덕션 빌드가 **실제로 통과하는지** 확인한다. 배포 실패의 대부분이 여기서 미리 잡힌다
- `next.config.ts`에 배포를 막을 설정이 있는지 본다. **없으면 손대지 마라** — Vercel은 Next.js
  기본 설정으로 붙는다. `vercel.json`을 **추측으로 만들지 마라**
- **업로드 본문 한도**를 확인한다 (`A7`). 앱이 4MB에서 막는 자리를 찾아 두고,
  **Vercel 서버리스 함수의 본문 한도가 그보다 먼저 걸릴 수 있다**는 것을 문서에 적는다.
  실측은 배포 후 step 9가 한다

### 2. `README.md`의 「배포」 절을 **사용자가 그대로 따라 할 수 있는 절차서**로 채운다

이것이 이 step의 진짜 산출물이다. 아래를 **순서대로, 화면에 보이는 이름 그대로** 적는다.

1. Vercel에서 **New Project** → GitHub 저장소 `work-task-status-board-6-2` 임포트
2. Framework Preset이 **Next.js**로 잡히는지 확인 (Root Directory는 저장소 루트)
3. **환경변수 입력** — 어떤 키를 넣고 어떤 키는 넣지 않는지 표로 적는다:
   - `STORAGE_DRIVER` — 배포에서 `supabase`로 할지 `memory`로 할지 **사용자가 고를 수 있게
     두 갈래를 다 적는다.** `memory`면 심사자가 키 없이 시드로 보고, `supabase`면 실제 데이터가 뜬다
   - `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 브라우저에 나가도 되는 키
   - `SUPABASE_SERVICE_ROLE_KEY` — **서버 전용. `NEXT_PUBLIC_` 접두사를 절대 붙이지 않는다.**
     이 경고를 절차서 안에 굵게 남긴다 (빌드 가드는 코드만 보고 배포 설정은 못 막는다)
   - `T8_SEED_*` — **넣지 않는다.** 로컬 시드 스크립트용이다
   - **실제 키 값은 절차서에 적지 마라.** 「`.env.local`의 같은 이름 값을 복사」라고만 쓴다
4. **Deploy** → 빌드 로그에서 확인할 것 (`npm run build` 통과, `prebuild`의 `guard:env` 통과)
5. 배포 후 **바로 확인할 URL 목록** — `/`, `/login`, `/report`, `/api/health`
6. **Supabase가 잠들어 있으면 깨운다** — 무료 티어는 7일 미접속 시 일시중지된다.
   발표 직전에도 다시 확인하라는 경고

### 3. `blocked`로 기록하고 즉시 중단한다

`phases/t9-deploy-report/index.json`의 step 8을:

```json
{ "status": "blocked", "blocked_reason": "..." }
```

`blocked_reason`에 **아래를 전부** 담는다:

- 왜 멈췄는가 — Vercel 계정 인증이 필요하고 비대화형 세션이 통과할 수 없다
- 사용자가 할 일 — **README의 「배포」 절을 따라 배포하고, 얻은 URL을 알려 준다**
- 재개 방법 — `status`를 `pending`으로 바꾸고 `blocked_reason`을 지운 뒤 하네스를 다시 실행하면
  step 8부터 이어진다. **step 9가 그 URL로 완료 기준 1·6을 잰다**
- **URL을 어디에 적어야 하는지** — 재개할 세션이 URL을 찾을 수 있어야 한다.
  `README.md`의 배포 URL 자리에 적어 달라고 명시하라

**`blocked_reason`에 키 값을 담지 마라.**

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
npm run guard:env
grep -n "New Project\|환경변수\|NEXT_PUBLIC_" README.md          # 절차서가 있다
grep -c "sb_secret_\|sb_publishable_\|eyJ" README.md              # 0 (실제 키 조각 없음)
grep -c "https://.*vercel\.app" README.md                         # 0 (URL을 지어내지 않았다)
python3 -c "import json;print([s['status'] for s in json.load(open('phases/t9-deploy-report/index.json'))['steps']][8])"   # blocked
```

## 검증 절차

1. 위 AC를 실행한다.
2. 체크리스트:
   - 절차서를 **처음 보는 사람이 따라갈 수 있는가?** 화면에 없는 버튼 이름을 지어내지 않았는가?
   - `service_role` 경고가 절차서에 있는가?
   - **배포 URL을 지어내지 않았는가?**
   - `blocked_reason`에 재개 방법과 URL을 적을 자리가 명시돼 있는가?
3. step 8을 **`blocked`로** 갱신하고 **즉시 중단한다.** `completed`로 적지 마라.

## 금지사항

- **`vercel login`·`vercel deploy`를 실행하지 마라.** 이유: 대화형 인증에서 세션이 멈춘다.
- **이 step을 `completed`로 적지 마라.** 이유: 배포되지 않았다. 완료로 적으면 step 9가
  없는 URL로 완료 기준 1·6을 재려 하다 실패한다.
- **배포 URL을 추측해서 적지 마라** (`work-task-status-board-6-2.vercel.app` 같은 것).
  이유: 실제 URL은 프로젝트 이름과 팀에 따라 달라진다.
- **다른 호스팅으로 갈아타지 마라.** 이유: 사용자가 Vercel을 골랐다.
- **`vercel.json`을 추측으로 만들지 마라.** 이유: 기본 설정으로 붙는다. 틀린 설정이
  배포를 깨는 쪽이 더 흔하다.
- **`blocked_reason`이나 README에 실제 키 값을 적지 마라.**
- 기존 테스트를 깨뜨리지 마라.
