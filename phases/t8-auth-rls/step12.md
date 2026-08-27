# Step 12: t8-audit

## 읽어야 할 파일

- `CLAUDE.md` — **전체.** CRITICAL 항목을 하나씩 대조한다
- `docs/TICKETS.md` — `## T8` 전문. **완료 기준 7개가 이 step의 체크리스트다**
- `docs/PLAN.md`·`docs/ARCHITECTURE.md`·`docs/ADR.md`·`docs/UI_GUIDE.md` — 이 phase가
  손댄 절 전부
- `phases/t8-auth-rls/index.json` — step 0~11의 `summary`. **거기 적힌 주장을 다시 확인한다**
- `docs/TICKETS.md`의 T7「구현 결과」 소절 — 이 step이 만들 문서의 **형식 본보기**

## 배경

이 step은 기능을 추가하지 않는다. **완료 기준 7개를 하나씩 직접 실행해 증명하고**, 문서를
실제 구현에 맞춘다. T7 감사에서 그랬듯이, 「그럴 것이다」로 넘어간 자리가 여기서 드러난다.

특히 T8은 **문서가 코드보다 먼저 쓰인 부분이 많다**(step 0). 구현이 결정과 달라졌다면
**문서를 고친다** — 코드를 결정에 맞추려고 되돌리는 것은 이 step의 일이 아니고, 다르다는
사실을 숨기는 것은 더 나쁘다.

## 작업

### 1. 완료 기준 7개를 실행해 증명한다

**결과를 숫자·응답 코드와 함께 기록한다.** 「통과」만 적지 마라.

#### 기준 1 — 세 역할로 로그인해 각각 다른 범위가 보인다
라이브 `npm run dev` + step 5 계정 셋. `/api/tasks`의 건수와 대시보드 표의 행수를 **둘 다** 잰다.
`admin > lead > member ≥ 1`이고 셋이 서로 다름을 보인다. `service_role`로 센 전체 건수와
`admin`의 건수가 같은지도 확인한다.

#### 기준 2 — `member`의 타인 건 `PATCH`가 `FORBIDDEN`
티켓이 **`curl`을 지정**했다. step 10의 절차대로 로그인 쿠키를 받아:
```
PATCH /api/tasks/<타인_id>   → 403 { "error": { "code": "FORBIDDEN", … } }
PATCH /api/tasks/<본인_id>   → 200   (되돌려 놓는다)
PATCH (쿠키 없이)            → 401 UNAUTHENTICATED
```
세 응답을 **그대로** 기록한다. 이것이 T8에서 가장 중요한 한 줄이다.

#### 기준 3 — RLS 정책이 무한 재귀하지 않는다
`pg_policies`의 `qual`·`with_check`에 `profiles`를 **직접 select하는 정책이 없음**을 보인다.
그리고 실제로 재귀가 없다는 것은 기준 1이 응답을 받은 것으로 증명된다(재귀면 조회가 에러다).
`select * from profiles`를 로그인 상태로 한 번 더 실행해 1행이 오는 것을 확인한다.

#### 기준 4 — `my_role()`·`my_team()`·`my_member_id()`의 `search_path` 고정
```sql
select proname, prosecdef, proconfig
from pg_proc where pronamespace='public'::regnamespace
  and proname in ('my_role','my_team','my_member_id');
```
3행, `prosecdef=true`, `proconfig`에 `search_path=`가 있음을 출력 그대로 기록한다.
함수 본문(`prosrc`)에 스키마가 명시돼 있는지도 확인한다.
`mcp__supabase__get_advisors(type:'security')`에 `function_search_path_mutable`이 **없어야** 한다.

#### 기준 5 — 조회는 사용자 JWT, `service_role`은 업로드 커밋·시드만
정적으로:
```bash
grep -rn 'SUPABASE_SERVICE_ROLE_KEY' src/ --include=*.ts --include=*.tsx | grep -v test
grep -rn 'getStorage' src/app --include=*.ts --include=*.tsx | grep -v test
```
`service_role`을 읽는 자리가 `store-factory.ts`·`supabase-task-store.ts` 둘뿐이고,
`getStorage()`를 부르는 라우트가 **업로드 3종 + 시드 + health**뿐임을 보인다.
동적으로: 로그아웃 상태에서 `/api/tasks`가 0건/401이고, `member` 세션에서 본인 건만 오는 것으로
RLS가 실제로 걸렸음을 보인다(RLS가 안 걸리면 전건이 온다).

#### 기준 6 — 프로덕션 빌드 + Supabase 연결에서 `?as=admin`이 무시된다
```bash
npm run build && NODE_ENV=production npm run start   # .env.local = 라이브
```
- 쿠키 없이 `GET /api/tasks?as=admin` → 401 (프록시가 API를 막는다)
- `member` 쿠키 + `GET /api/tasks?as=admin` → **본인 건만**, `meta.role === 'member'`
- `member` 쿠키 + `GET /?as=admin` → 화면 건수가 그대로

셋을 다 기록한다. **개발 서버로 재고 「프로덕션에서도 될 것」이라고 적지 마라.**

#### 기준 7 — 로그아웃 상태에서 보호 라우트 → 로그인 리다이렉트
`/`·`/teams/edit`·`/upload`·`/extract` 각각 `302/307` → `/login?next=…`.
`/login`·`/api/health`는 그대로 200.

### 2. 데모 경로가 살아 있는지 확인한다 (회귀 검사)

```bash
STORAGE_DRIVER=memory npm run dev
```
- 리다이렉트 없이 대시보드가 뜬다 (결정 E)
- `?as=admin`/`?as=member`가 배치를 바꾼다 (`ADR-013`)
- 시드 불러오기·시트 업로드·`/extract` 왕복이 **그대로 동작한다**

**이것이 깨지면 T8은 완료가 아니다.** `.env` 없이 클론하는 심사자 경로다.

### 3. CRITICAL 대조 (`CLAUDE.md`)

```bash
grep -rn "from 'exceljs'" src/ --include=*.ts | grep -v test        # 2줄
grep -rn 'NEXT_PUBLIC_.*SERVICE_ROLE' src/ .env.example              # 0줄
npm run guard:env
grep -rLn "runtime = 'nodejs'" $(find src/app/api -name route.ts)    # 없음
grep -rn 'new Date()\|Date.now()' src/lib/domain/ | grep -v test     # 0줄
ls src/services 2>/dev/null                                          # 없음
# src/lib basename 중복 0건
find src/lib -name '*.ts' ! -name '*.test.ts' -exec basename {} \; | sort | uniq -d
git status --short                                                   # 실업무 데이터·.env.local 없음
```

그리고 **API 응답에 `raw`가 없는지**를 실제 응답으로 확인한다 (`/api/tasks`를 admin으로
받아 `raw` 키 검색 → 0건). 민감 `extras`가 `member`에게 `null`인지도 실제 응답으로 본다.

### 4. 문서를 구현에 맞춘다

- `docs/TICKETS.md` T8에 **「구현 결과」** 소절을 신설한다 (T7의 형식 그대로):
  - 산출물 표 (파일 경로 + 한 줄 설명)
  - **완료 기준 7개의 증명 표** — 무엇을 실행해 무엇이 나왔는가
  - 범위 Out으로 남긴 것
  - 감사에서 발견했으나 **고치지 않은 것**과 그 이유
- `docs/PLAN.md`에 **「T8 구현 중 확정」** 소절을 잇는다. step 1~11에서 결정 A~F와 달라진 것,
  새로 정해진 것(예: `PATCH`가 404 대신 403을 내는 이유)을 남긴다.
- `docs/ARCHITECTURE.md`「권한 (T8)」의 정책 표·함수 시그니처·디렉토리 구조를 **실제와 대조**해
  틀린 곳을 고친다. 디렉토리 블록에 `src/lib/auth/`·`src/proxy.ts`·`src/app/login/`·
  `src/app/api/auth/`가 들어 있는지 확인한다.
- `docs/ADR.md` — `ADR-024`~`ADR-026`의 내용이 실제 구현과 맞는지 확인하고, 어긋나면 고친다.
  구현 중 새로 생긴 되돌리기 어려운 결정이 있으면 `ADR-027`로 추가한다.
- `README.md` — 「화면」 절에 `/login`, 「명령어」에 `npm run seed:auth`,
  환경변수 절에 `T8_SEED_PASSWORD`(값 없이). **비밀번호를 적지 마라.**
- `scripts/smoke/README.md`·`RESULT.md` — `rls-check.mjs`와 그 실행 결과가 들어 있는지 확인.

### 5. 남은 위험을 적는다

고치지 말고 **기록만** 한다 (T7의 「고리의 남은 한 칸」처럼):

- `members`가 시트 이름으로만 서 있어 **동명이인·개명**에 취약하다는 것
- `?as=`가 데모에서 범위를 바꾸지 않는다는 것 (배치·마스킹만)
- `uploads`에 정책이 없어 **업로드 이력은 서버만 본다**는 것
- 그 밖 감사 중 발견한 것

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

그리고 위 1~3의 **모든 명령 출력**이 `summary`에 숫자로 남아 있을 것.
완료 기준 7개 각각에 대해 「무엇을 실행했고 무엇이 나왔는가」가 한 줄씩 있어야 한다.

## 검증 절차

1. 완료 기준 7개를 순서대로 실행한다. **하나라도 실패하면 그 사실을 `summary`에 적고**
   고칠 수 있으면 고친다. 고칠 수 없으면 `error`로 기록한다 — 통과한 것처럼 적지 마라.
2. 데모 경로 회귀 검사(2번)를 실행한다.
3. 문서 갱신 후 `git diff --stat`으로 **제품 코드가 바뀌지 않았음**을 확인한다.
   이 step에서 `src/` 아래를 고쳤다면 무엇을 왜 고쳤는지 `summary`에 남긴다.
4. `phases/t8-auth-rls/index.json`의 step 12를 갱신한다.

## 금지사항

- 기능을 추가하지 마라. 이 step은 검증과 문서다.
- 실패한 완료 기준을 「부분 통과」로 적지 마라.
- 테스트의 기대값을 느슨하게 바꿔 게이트를 통과시키지 마라.
- 원격 DB의 실업무 행·계약 행·계정을 지우지 마라.
- 비밀번호·키를 문서·`summary`에 적지 마라.
- 완료 기준 문장을 약화시키지 마라. 구현이 못 미치면 **구현이 못 미친 것**이다.
