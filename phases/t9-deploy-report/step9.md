# Step 9: t9-audit

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL 규칙 전부.** 이 step이 그것을 전수 대조한다
- `docs/TICKETS.md` — **T9 절 전체.** 완료 기준 6개가 이 step의 명세다
- `docs/PRD.md` — 「요구 7개」(54~64행) · 「성공 기준」(100~103행)
- `docs/PLAN.md` — `A7`(4MB) · `S6` · `S7`, step 0이 쓴 「T9 착수 시 확정」(결정 K~P)
- `docs/ADR.md` — ADR-028
- step 0~8의 `summary` **전부** — 각 step이 무엇을 만들었고 어떤 숫자를 실측했는지
- `README.md` — **배포 URL이 적혀 있어야 한다.** step 8이 blocked로 섰고 사용자가 배포한 뒤
  거기에 URL을 적어 재개했다
- `phases/t9-deploy-report/index.json` — step 8이 `completed`인지 확인 (blocked면 아직 배포 전이다)

## 배경

T8의 감사 step(step 12)이 선례다. 그 step은 **제품 코드를 한 줄도 고치지 않고** 완료 기준을
전부 실행 검증한 뒤 문서를 구현에 맞췄다. 이 step도 같은 성격이다.

**다른 점이 하나 있다.** 완료 기준 1·6은 **배포 URL이 있어야만** 잴 수 있다. step 8이
사용자를 기다렸다가 재개된 흐름이므로, **URL을 못 찾으면 여기서 다시 `blocked`다.**

## 작업

### 0. 배포 URL을 확보한다 (없으면 즉시 `blocked`)

`README.md`의 배포 절에서 URL을 찾는다. **없거나 `(step 8에서 배포 후 기록)` 자리표시자
그대로면 즉시 `blocked`** 로 적고 중단한다 — 사유에 「배포 URL이 README에 적혀 있지 않다」와
어디에 적어야 하는지를 명시한다. **URL을 추측하지 마라.**

URL을 찾으면 **살아 있는지부터** 확인한다:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$URL"
```

### 1. 완료 기준 6개를 하나씩 실행 검증한다

각 기준마다 **실행한 명령과 실제 출력**을 근거로 남긴다. 「통과했다」만 적지 마라.

1. **배포 URL이 열리고 샘플 데이터로 대시보드가 렌더된다.**
   - `/`가 200이고 업무 내용이 실제로 그려지는가?
   - 배포의 `STORAGE_DRIVER`가 무엇인지 `/api/health`로 확인한다.
     `memory`면 시드가 뜨고, `supabase`면 로그인 후에 뜬다 — **어느 쪽인지 적는다**
   - `/login`·`/report`·`/api/health`도 확인한다

2. **`.env` 없이 클론 → `npm install && npm run dev` → 빈 상태 → `[샘플 데이터 불러오기]` → 대시보드.**
   - step 7이 이미 깨끗한 클론으로 쟀다. **그 결과를 여기서 다시 확인한다** —
     step 7 이후에 코드가 바뀌었으므로(step 8까지) 다시 재는 것이 맞다
   - 짧게 재현하되 **실제로 클론해서** 한다

3. **README에 로컬 실행법·배포 URL·과제 요구 7개 대조표가 있고, 실행법대로 따라 하면 실제로 뜬다.**
   - 대조표의 요구 문구가 **PRD와 글자 그대로 같은가?**
   - 배포 URL이 실제 URL인가?
   - 실행법의 명령을 다시 돌려 본다

4. **`/report`에서 주간 보고 마크다운이 생성되고 복사·다운로드된다** (`UC-08`).
   - 로컬에서 세 역할로 확인한다. **세 역할의 보고서 내용이 다른가?**
   - 기간 이동(이전/다음 주)이 되는가? 잘못된 `week` 값이 **500이 아니라 되돌림 + 배너**인가?
   - 복사·다운로드가 실제로 되는가? (헤드리스 브라우저로 클릭)
   - **변경 건수가 「집계되지 않음」이 아니라 실제 숫자인가?** step 4가 회수한 빚이다

5. **`.env.example`에 필요한 키가 모두 있고 실제 키 값이 들어 있지 않다.**
   - 코드가 읽는 환경변수를 전수 조사해 대조한다
   - 키 조각(`sb_secret_`·`sb_publishable_`·`eyJ`)이 저장소 어디에도 없는지 본다

6. **배포 환경에서 업로드 4MB 한도가 실측으로 재확인된다** (`A7`).
   - **더미 파일로 잰다. 실업무 데이터를 배포 환경에 올리지 마라** (CLAUDE.md CRITICAL)
   - 4MB **아래**와 **위** 두 번 쏴서 경계가 어디서 걸리는지 본다
   - **앱의 4MB 한도가 먼저 걸리는지, Vercel의 본문 한도가 먼저 걸리는지**를 구분해 적는다.
     티켓의 리스크가 지적한 것이 정확히 이것이다. 앱보다 플랫폼이 먼저 걸리면
     **에러 메시지가 사용자에게 무엇으로 보이는지**까지 적는다
   - 이것은 **고치는 자리가 아니라 재는 자리다.** 플랫폼 한도가 먼저 걸린다면 그 사실을
     「남은 위험」에 남긴다

### 2. CRITICAL 규칙 전수 대조

T8 감사가 한 것과 같은 목록을 돌린다:

```bash
grep -rn "from 'exceljs'\|require('exceljs')" src | grep -v node_modules   # 2줄 (읽기·쓰기)
npm run guard:env
grep -rLn "runtime = 'nodejs'" src/app/api --include=route.ts              # 0
grep -rn "new Date()\|Date.now()" src/lib/domain/                          # 0줄
ls src/services 2>/dev/null || echo "없음"                                  # 없음
# src/lib 아래 basename 중복 0
find src/lib -name '*.ts' ! -name '*.test.ts' -exec basename {} \; | sort | uniq -d
git status --short                                                          # 실업무 데이터·.env.local 없음
```

`get_advisors`(security)도 다시 돌린다. **step 2가 정책을 하나 더했으므로 INFO가 3건에서
2건으로 줄어야 한다** (`task_events`가 빠진다). 줄지 않았으면 정책이 안 붙은 것이다.

### 3. 문서를 구현에 맞춘다

- `docs/TICKETS.md` T9에 **「구현 결과」** 절을 신설한다. T8의 같은 절이 형식의 선례다:
  산출물 표 · 완료 기준 6개 증명 표 · 범위 Out · **고치지 않은 것과 그 이유**
- `README.md`에 배포 URL이 **실제 값으로** 들어가 있는지 확인한다
- `docs/PLAN.md`·`docs/ARCHITECTURE.md`에 **구현하며 달라진 것**이 있으면 반영한다.
  step 0이 정한 결정과 실제 구현이 어긋난 자리가 있으면 **어느 쪽이 맞는지 판단해 적는다**
- **`src/app/page.tsx`의 각주와 라우트의 ⚠ 주석이 정말 사라졌는지** 다시 확인한다 (step 4의 몫이었다)

### 4. 남은 위험을 기록한다

**고치지 말고 적는다.** 최소한 아래를 확인해 적는다:

- Supabase 무료 티어의 7일 일시중지 — **발표 직전 깨워야 한다**
- 배포 환경의 업로드 한도 (기준 6의 실측 결과)
- `upload-record-store` 계약의 `PGRST303` 간헐 실패 (T8이 남긴 것. 여전한지 확인)
- 스크린샷이 아직 없다면 그 사실 (사용자만 찍을 수 있다)
- T10(알림 발송)은 범위 밖이다

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
git diff --stat                       # docs/ + README.md 만. src/ 무변경
grep -c "https://" README.md          # 배포 URL이 있다
grep -rc "집계되지 않습니다" src/      # 0
curl -s -o /dev/null -w '%{http_code}\n' "$DEPLOY_URL"           # 200
curl -s "$DEPLOY_URL/api/health" | head -c 300
```

**제품 코드를 고치지 않는 것이 이 step의 성립 조건이다.** `git diff --stat`에 `src/`가 나오면
그 변경이 왜 필요했는지 `summary`에 적고, 감사가 아니라 수정이 된 것을 인정하라.

## 검증 절차

1. 배포 URL부터 확보한다. 없으면 **즉시 `blocked`.**
2. 위 AC와 완료 기준 6개를 전부 실행한다.
3. 체크리스트:
   - 완료 기준 6개 **각각에 실행 명령과 실제 출력**이 근거로 붙어 있는가?
   - 「통과했다」만 적은 기준이 없는가?
   - 배포 환경에 **실업무 데이터를 올리지 않았는가?**
   - advisors INFO가 3건 → 2건으로 줄었는가?
4. `phases/t9-deploy-report/index.json`의 step 9를 갱신한다:
   - 성공 → `completed` + `summary`. **완료 기준 6개의 판정과 남은 위험**을 압축해 적는다
   - URL 없음 → `blocked` + 사유
   - 실패 → `error` + `error_message`

## 금지사항

- **완료 기준을 「통과했다」로만 적지 마라.** 이유: 근거 없는 완료 표시가 가장 비싼 거짓말이다.
- **배포 URL을 추측하지 마라.** 없으면 `blocked`다.
- **배포 환경에 실업무 데이터를 올리지 마라.** 이유: CLAUDE.md CRITICAL. 더미로 잰다.
- **제품 코드를 고치지 마라.** 이유: 이 step은 감사다. 고쳐야 할 것이 나오면 적고 판단을 넘긴다.
  단 **완료 기준을 못 맞추는 명백한 버그**는 고치고 그 사실을 `summary`에 명시한다.
- **`TICKETS.md`의 기존 미결 항목을 지우지 마라.** 해소됐으면 「해소」로 적는다.
- **advisors WARN을 없애려고 `security definer` 함수의 `execute`를 회수하지 마라.**
  이유: 정책 평가가 깨진다 (T8이 확인했다).
- 기존 테스트를 깨뜨리지 마라.
