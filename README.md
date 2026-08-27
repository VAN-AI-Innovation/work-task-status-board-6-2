# work-task-status-board

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 프로젝트.
[harness_framework](https://github.com/minseokhan/harness_framework) 기반의 에이전트 하네스가 적용되어 있다.

Google Sheets에 팀별로 16/70/20 컬럼씩 흩어진 업무를 **시트 업로드만으로** 통합 조회하고,
Google Docs 워크로드 문서를 **업무 배정표 xlsx로 뽑는다.** 이 둘이 최우선 산출물이다.

## 시작하기

**`.env` 없이 그대로 뜬다.** 키를 요구하지 않는다 — 설정이 아예 없으면 **데모 모드**로 서고
메모리 드라이버에 익명화 시드 9건이 이미 들어 있다 (`docs/ADR.md` ADR-029).

```bash
git clone <저장소>
cd work-task-status-board
npm install
npm run dev            # http://localhost:3000
```

`/`에 들어가면 보이는 것 (실측):

| 자리 | 내용 |
|---|---|
| 맨 위 | 저장소 상태 배너 (아래 표 참고) |
| 본문 | KPI 10칸 → 팀별 현황 + 팀별 완료율 → 알림 + 상태 분포 → 접힌 카드 셋(목표·브리핑·승인 대기) → 업무 표 **9행** |
| 왼쪽 | 대시보드 · 주간 보고 · 팀 탭 셋 · 시트 업로드 · 독스 → 배정표 |
| 로그인 | 필요 없다. 오른쪽 위 역할 전환(`?as=admin` · `lead` · `member`)이 산다 |

`cp .env.example .env.local`은 **하지 않아도 된다** — 아무 설정이 없으면 앱이 데모로 선다.
실저장소(Supabase)에 붙일 때만 `.env.local`을 만든다.

⚠ **배너 문구는 두 갈래이고 섞이지 않는다. 하나는 의도이고 하나는 사고다**
(`docs/ADR.md` ADR-005 · ADR-029).

| 시작 방법 | `GET /api/health` | 배너 | 쓰기 |
|---|---|---|---|
| `npm run dev` (아무 설정 없음) | `mode=demo` · `readOnly=false` | **샘플 데이터 모드** | 된다 |
| `STORAGE_DRIVER=memory npm run dev` | `mode=demo` · `readOnly=false` | **샘플 데이터 모드** | 된다 |
| 키를 **일부만** 줬거나 `STORAGE_DRIVER=supabase`인데 붙지 않는다 | `mode=fallback` · `readOnly=true` | **읽기 전용 — 저장소 연결 실패** | 전부 `503` |

마지막 줄은 **사고**다. 조회는 전부 되지만 업로드 확정 · `[샘플 데이터 불러오기]` · 상태 수정이
`503`으로 거부된다 — 폴백 중 쓰기를 메모리에 받으면 재시작 때 조용히 사라지기 때문이다.
설정을 아예 하지 않은 것은 사고가 아니므로 이 줄에 걸리지 않는다.

**빈 상태 화면은 메모리 드라이버에서 볼 수 없다.** 메모리 저장소는 만들어질 때 시드 9건을
넣으므로 「데이터 0건」을 거치지 않고 바로 대시보드가 뜬다. `[샘플 데이터 불러오기]` 버튼과
빈 상태 문구는 **실저장소가 비어 있을 때** 나오는 화면이다.

## 과제 요구 대조표

과제 원문 요구 7개(`docs/PRD.md`「과제 원문 요구사항 대조」)와 이 저장소의 구현을 맞춘 표다.
요구 문구는 그 문서에서 그대로 가져왔다.

| # | 요구사항 | 구현 | 어디서 보나 |
|---|---|---|---|
| 1 | 부서·팀·담당자·업무·기한·진행률·지연 사유 통합 관리 | 시트 파서 → 공통 컬럼 + `extras jsonb` + `task_stages`. 매핑 안 된 컬럼은 자동으로 `extras` | `/` 업무 표 · `/teams/edit` · `/teams/shoot` · `/teams/marketing` · 행을 누르면 열리는 사이드 패널(`?task=`)에 `extras` 전량 |
| 2 | 예정·진행·검토·완료·지연 상태 시각적 구분 | `toDisplayStatus`가 시트 10단계를 5색으로 매핑하고, **지연 판정이 다른 색을 덮어쓴다.** 배지 + 지연 행 좌측 3px 붉은 보더 | `/` 업무 표 · 팀 탭 · 상태 분포 차트 |
| 3 | 마감 임박·장기 미갱신·담당자 미지정 자동 알림 | 알림 패널 **5묶음** (요구 셋 + 기한 미설정 + 담당자 오타 의심). **화면 알림까지다 — 디스코드·메일 발송은 없다**(T10 미구현) | `/` 알림 카드 · 팀 탭 알림 카드 |
| 4 | 부서별 목표와 실제 성과 비교 | 시트 B섹션 → `goal_metrics`. 달성률은 시트 값을 믿지 않고 `actual/target`으로 **재계산**하고, 어긋나면 시트 값을 병기 | `/`「목표 대비 성과」(접힌 카드) · 팀 탭 |
| 5 | 회의 전 자동 요약 및 대표·실장용 주간 보고서 | `buildWeeklyReport`가 마크다운을 만든다. 주 단위 이동(`?week=`) · 복사 · `.md` 내려받기 | **`/report`** · `/` 주간 브리핑 카드 |
| 6 | 권한별 열람·수정 범위 구분 | Supabase Auth + RLS 정책 11개 + `security definer` 함수 셋. 조회는 사용자 JWT로 나가고 `service_role`은 업로드 확정·시드에만 | `/login` 후 전 화면 (`admin` 전사 / `lead` 자기 팀 / `member` 본인 건) |
| 7 | 향후 출결·평가·경고·활동인증서 연계 | `members`를 신원 단일 소스로 잡고 `auth_user_id`로 계정과 이었다. **연계 기능 자체는 만들지 않았다 — 자리만 있다** | 화면 없음 (`supabase/migrations/`) |

담당자 지시 2건(엑셀→조회 / 독스→엑셀)은 `/upload`와 `/extract`가 진다. 위 7개보다 우선이다.

## 환경변수

`.env.example`을 `.env.local`로 복사해 채운다. **값은 저장소에 넣지 않는다.**

| 키 | 언제 필요한가 |
|---|---|
| `STORAGE_DRIVER` | `memory`(데모) 또는 `supabase`(실저장소). **정하지 않고 키도 없으면 데모다** — 키를 일부만 주면 폴백(읽기 전용)으로 내려앉는다 |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 실저장소·로그인. 브라우저에 나가도 되는 키다 |
| `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용.** 업로드 확정·시드만 쓴다. `NEXT_PUBLIC_`을 붙이면 `npm run guard:env`가 빌드를 실패시킨다 |
| `T8_SEED_PASSWORD` | `npm run seed:auth`가 만드는 역할 계정의 비밀번호. 비워 두면 스크립트가 난수를 만들어 `.env.local`에 덧붙인다 |
| `T8_SEED_EMAIL_DOMAIN` | 같은 계정들의 이메일 도메인 (기본 `example.com`) |

## 화면

| 경로 | 하는 일 |
|---|---|
| `/` | 통합 대시보드 (역할별 진입 화면 — `?as=admin\|lead\|member`) |
| `/report` | 주간 보고 전용 화면 (`?week=YYYY-MM-DD`) |
| `/teams/edit` · `/teams/shoot` · `/teams/marketing` | 부서별 탭 |
| `/upload` | 팀 시트 `.xlsx` 업로드 → 미리보기 → 확정 |
| `/extract` | 워크로드 `.docx` → 업무 배정표 `.xlsx` |
| `/login` | 로그인. 세션이 있으면 역할·열람 범위를 **서버가** 정한다 (`?as=`는 무시된다) |

로그인 계정은 `npm run seed:auth`가 만든다 — 역할마다 하나씩 **`admin` · `lead` · `member`**
셋이다. 이메일·비밀번호는 `.env.local`에 있고 저장소·문서 어디에도 적지 않는다.
`STORAGE_DRIVER=memory`(데모)에서는 로그인이 필요 없고 `?as=`가 그대로 역할을 정한다.

### `/report` — 주간 보고

회의 직전에 열어 마크다운을 그대로 회의록에 붙여 넣는 화면이다.

1. 기본은 **이번 주**(KST 월~일)다. `[← 이전 주]` · `[이번 주]` · `[다음 주 →]`로 옮기면
   주소가 `?week=YYYY-MM-DD`로 바뀌므로 **그 주를 링크로 공유할 수 있다.** 갈 수 없는 곳
   (미래 주)은 링크가 아니라 흐린 글자로 남는다
2. 본문은 마크다운 **원문**이다 (HTML로 렌더하지 않는다). `[복사]`는 클립보드로,
   `[.md 내려받기]`는 `weekly-<주 시작일>.md` 파일로 나간다 (예: `weekly-2026-08-24.md`)
3. 「이번 주 변경」 건수는 그 주에 실제로 값이 바뀐 업무 수다. 이력을 읽지 못하는 경우
   **0건이라고 말하지 않고 「집계되지 않음」**이라고 밝힌다
4. 미래 주나 형식이 틀린 `?week=`는 **에러가 아니라** 이번 주로 되돌리고 그 사실을 배너로 알린다

역할로 막지 않는다 — 보이는 범위는 로그인 세션과 RLS가 이미 자른 뒤다. 그래서 같은 주라도
`admin` · `lead` · `member`가 각각 다른 숫자를 본다.

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

## 배포

**배포 URL: _(step 8에서 배포 후 기록)_** — 아직 배포되지 않았다.

배포처는 Vercel이다. 로컬이 죽어도 URL, URL이 죽어도 로컬이 남게 하는 이중화가 목적이다.

배포 환경변수는 `.env.example`의 키 중 **넷만** 넣는다.

| 키 | 값 |
|---|---|
| `STORAGE_DRIVER` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 |

`T8_SEED_PASSWORD` · `T8_SEED_EMAIL_DOMAIN`은 **넣지 않는다.** `npm run seed:auth`가 쓰는
로컬 시드 전용이고 배포된 앱은 읽지 않는다.

⚠ **`SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` 접두사를 붙이지 마라.** 붙이면 브라우저
번들에 그대로 실려 RLS를 우회하는 키가 공개된다. `npm run guard:env`는 **저장소 안의 파일만**
검사하므로 배포 대시보드에 손으로 넣은 이름은 잡지 못한다 — 여기서만 사람이 막을 수 있다.

⚠ **Supabase 무료 티어는 7일 미접속 시 프로젝트를 일시중지한다.** 멈추면 앱이 읽기 전용
폴백으로 내려앉는다. **발표·심사 전에 대시보드를 한 번 열어 깨워 둘 것.**

## 스크린샷

_(사용자가 촬영해 추가)_ — 파일은 `docs/screenshots/`에 아래 이름으로 둔다.

| 파일 | 화면 |
|---|---|
| `docs/screenshots/dashboard.png` | `/` 통합 대시보드 (1280px, `admin`) |
| `docs/screenshots/upload.png` | `/upload` 미리보기 단계 |
| `docs/screenshots/extract.png` | `/extract` 배정표 미리보기 |
| `docs/screenshots/report.png` | `/report` 주간 보고 |

⚠ **실업무 데이터가 찍힌 스크린샷은 커밋 금지다.** 실제 시트에는 실명·연락처·문의자
SNS 계정이 들어 있다. 반드시 `STORAGE_DRIVER=memory`(익명화 시드)로 띄워 촬영한다.

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 (`prebuild`로 `guard:env`가 먼저 돈다) |
| `npm run start` | 빌드 산출물 실행 |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run guard:env` | `service_role` 키 노출 가드 단독 실행 |
| `npm run seed:auth` | 원격 Supabase에 역할 계정·구성원·시드를 만든다 (T8, 멱등) |
| `npm run seed:build` | 실제 시트를 파서로 돌려 익명화 시드 JSON을 다시 만든다 |
| `npm run fixture:docx` | 테스트용 `sample-workload.docx`를 재생성한다 (같은 바이트) |

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
- `docs/PLAN.md` — 근거 문서. 결정이 바뀌면 코드보다 여기를 먼저 고친다
- `docs/ARCHITECTURE.md` — 디렉토리 구조·데이터 흐름·상태 관리
- `docs/ADR.md` — 기술 결정 기록
- `docs/UI_GUIDE.md` — UI 가이드
- `docs/TICKETS.md` — 작업 단위 T0~T10
- `CLAUDE.md` — 에이전트 가드레일 (하네스가 매 step 주입)

## GitHub Actions

`.github/workflows/ci.yml` 하나뿐이다. push·pull_request에서 `npm ci` 후
로컬과 동일한 세 커맨드(`npm run lint` → `npm run build` → `npm test`)를 순서대로 돌린다.
`npm run build`는 `prebuild` 훅으로 `service_role` 키 노출 가드를 함께 실행한다.
