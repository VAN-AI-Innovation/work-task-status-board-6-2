# Step 6: readme-env

## 읽어야 할 파일

- `CLAUDE.md` — 보안 규칙 전부. 특히 **「`service_role` 키에 `NEXT_PUBLIC_` 접두사를 붙이지 말 것」**과
  「실업무 데이터를 커밋하지 말 것」
- `docs/PRD.md` — **「요구 7개」(54~64행)**와 **「성공 기준」(100~103행)**. 대조표의 근거다
- `docs/TICKETS.md` — T9 완료 기준 **3**(README에 로컬 실행법·배포 URL·과제 요구 7개 대조표) ·
  **5**(`.env.example`에 필요한 키가 모두 있고 실제 키 값이 없다)
- `README.md` — **전체를 읽는다.** 현재 구조는 「시작하기 / 환경변수 / 화면 / 명령어 / 하네스 /
  문서 / GitHub Actions」다. **이 뼈대를 갈아엎지 말고 확장한다**
- `.env.example` — 현재 키 5종(`STORAGE_DRIVER`·`NEXT_PUBLIC_SUPABASE_URL`·
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`T8_SEED_*`)
- `package.json` — `scripts` 전체. README의 명령어 절이 이것과 어긋나면 안 된다
- `src/lib/env-guard.test.ts` — `npm run guard:env`가 무엇을 막는지
- step 5의 `summary` — `/report` 화면이 생겼으므로 README의 「화면」 절에 들어간다

## 배경

완료 기준 3은 **「실행법대로 따라 하면 실제로 뜬다」**이다. 문서가 코드와 어긋나면 그 자리에서
실패한다. 그래서 이 step은 **README에 적는 모든 명령을 직접 실행해 보고** 적는다.

배포 URL은 아직 없다. **step 8이 배포하고 step 9가 URL을 박는다.** 여기서는 **자리만 만든다** —
`(step 8에서 배포 후 기록)` 같은 명시적 표시를 남기고, 없는 URL을 지어내지 마라.

## 작업

### 1. `.env.example` 을 완성한다 (완료 기준 5)

- 현재 키 5종이 **전부 있는지** 확인한다. 코드가 읽는 환경변수를 전수 조사해 빠진 것을 찾아라:

```bash
grep -rn "process\.env\.[A-Z_]*" src scripts | grep -o "process\.env\.[A-Z_]*" | sort -u
```

- **실제 키 값이 들어 있으면 안 된다.** 값이 필요한 키는 빈 값으로 두고 **한 줄 주석**으로
  어디서 얻는지 적는다
- 기본값이 있어야 하는 것(`STORAGE_DRIVER=memory`, `T8_SEED_EMAIL_DOMAIN=example.com`)은
  값을 채운다 — **키 없이 클론했을 때 바로 도는 것이 이 파일의 목적이다**
- `NEXT_PUBLIC_` 접두사가 붙으면 안 되는 키에 **주석으로 경고**를 남긴다 (이미 있다. 지우지 마라)

### 2. README 「시작하기」를 완료 기준 2의 경로로 다시 쓴다

PRD 성공 기준 1번이 그대로 완료 기준 2다:

> `.env` 없이 클론 → `npm install && npm run dev` → 빈 상태 → `[샘플 데이터 불러오기]` → 대시보드

**이 순서를 그대로 적고, 각 단계에서 화면에 무엇이 보이는지도 적는다.** 「빈 상태」에서
무슨 문구가 뜨는지, 버튼이 어디 있는지를 실제로 보고 적어라.

**`.env.local` 없이도 돌아간다는 사실을 맨 앞에 명시한다.** 심사자가 키를 요구받는다고 오해하면
거기서 끝난다.

### 3. 「과제 요구 대조표」 절을 신설한다 (완료 기준 3)

`docs/PRD.md` 54~64행의 요구 7개를 **표로** 만든다. 각 행에:

| 요구 | 구현 | 어디서 보나 |

- **요구 번호와 문구는 PRD에서 그대로 가져온다.** 새로 요약해 쓰지 마라 — 대조표의 목적은
  「빠진 것이 없음」을 보이는 것이고, 문구가 달라지면 대조가 안 된다
- 「어디서 보나」에는 **실제 경로**를 적는다 (`/`, `/teams/edit`, `/upload`, `/extract`, `/report`)
- **아직 없는 것이 있으면 없다고 적는다.** 있는 척하지 마라. T10(알림 발송)은 범위 밖이다

### 4. 「화면」 절에 `/report`를 더한다

기존 화면 설명들의 형식을 따른다. `/extract` 항목이 상세한 선례다.

### 5. 「배포」 절을 신설한다 (자리만)

- 배포 URL 자리 — **`(step 8에서 배포 후 기록)`** 로 명시
- 배포 환경변수 목록 — `.env.example`의 키 중 **배포에 실제로 필요한 것만**.
  `T8_SEED_*`는 로컬 시드용이라 배포에는 필요 없다. 그 구분을 적어라
- **`NEXT_PUBLIC_` 접두사 경고**를 여기에도 남긴다 (배포 설정은 코드 밖이라 빌드 가드가 못 막는다 —
  티켓의 「리스크·미결」이 지적한 것이다)
- **Supabase 무료 티어는 7일 미접속 시 프로젝트를 일시중지한다.** 발표 전 깨워 두라는 경고를 적는다

### 6. 「스크린샷」 자리

완료 기준 3이 스크린샷을 요구한다. **이미지는 사용자만 찍을 수 있다** (실행 중인 브라우저가 필요하고,
익명화 시드로 촬영해야 한다). README에 **자리와 파일 경로 규약**만 만들고,
`(사용자가 촬영해 추가)`로 명시하라. **이미지 파일을 만들어내지 마라.**

**실업무 데이터가 찍힌 스크린샷은 커밋 금지다** (CLAUDE.md CRITICAL). 그 경고를 README에 적는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run guard:env

# .env.example에 실제 값이 없다
grep -E "^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|T8_SEED_PASSWORD)=." .env.example   # 0줄
grep -c "NEXT_PUBLIC_SUPABASE_SERVICE\|NEXT_PUBLIC_SERVICE_ROLE" .env.example README.md                                        # 0

# 코드가 읽는 환경변수가 .env.example에 전부 있다
for k in $(grep -rho "process\.env\.[A-Z_]*" src scripts 2>/dev/null | sed 's/process\.env\.//' | sort -u); do
  grep -q "^$k=" .env.example || echo "누락: $k"
done

grep -n "요구" README.md          # 대조표가 있다
grep -n "/report" README.md       # 화면 절에 있다
grep -c "sb_secret_\|sb_publishable_\|eyJ" README.md .env.example    # 0 (실제 키 조각이 없다)
```

**README의 명령을 위에서부터 실제로 실행해 보고** 적힌 대로 되는지 확인한다.
되지 않으면 **문서가 아니라 코드를 고쳐야 할 수도 있다** — 그때는 step 7이 그 일을 한다.
여기서는 **어긋난 지점을 `summary`에 적어 넘긴다.**

## 검증 절차

1. 위 AC를 실행한다.
2. 눈으로 확인:
   - 대조표의 요구 문구가 **PRD와 글자 그대로 같은가?**
   - 없는 것을 있다고 적지 않았는가?
   - 배포 URL 자리가 **비어 있다고 명시**돼 있는가? (지어낸 URL이 없는가)
   - 실제 키 값·키 조각이 어디에도 없는가?
3. `phases/t9-deploy-report/index.json`의 step 6을 갱신한다:
   - 성공 → `completed` + `summary`. **README를 따라 했을 때 어긋난 지점이 있으면 반드시 적어라** —
     step 7이 그것을 고친다.
   - 실패 → `error` / 개입 필요 → `blocked`

## 금지사항

- **배포 URL을 지어내지 마라.** 이유: 아직 배포되지 않았다. step 9가 실제 URL을 박는다.
- **스크린샷 이미지 파일을 만들지 마라.** 이유: 사용자가 익명화 시드로 촬영해야 한다.
- **`.env.example`에 실제 키 값을 넣지 마라.** 이유: 완료 기준 5이자 CLAUDE.md CRITICAL.
- **README의 기존 뼈대를 갈아엎지 마라.** 이유: 「하네스」·「GitHub Actions」 절은 이 phase와
  무관하고 현재 사실을 담고 있다. 확장하되 지우지 않는다.
- **코드를 고치지 마라.** 이유: 이 step은 문서와 `.env.example`까지다. 실행이 어긋나면
  step 7이 고친다.
- 기존 테스트를 깨뜨리지 마라.
