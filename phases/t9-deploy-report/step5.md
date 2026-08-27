# Step 5: report-page

## 읽어야 할 파일

- `CLAUDE.md` — **「컴포넌트는 props 받아 JSX만 뱉는다」**, 「서버 컴포넌트는 자기 API 라우트를
  fetch하지 않는다」, 「비즈니스 로직은 `src/lib/`에만」
- `docs/UI_GUIDE.md` — **전체를 읽는다.** 특히 「AI 슬롭 안티패턴 — 하지 마라」(27행) ·
  「색상」(52행) · 「컴포넌트」(132행) · 「레이아웃」(296행) · 「로그인 상태 표시」(236행) ·
  **「빈 화면은 다섯 갈래다」(259행)**
- step 0의 결정 **N**(역할로 막지 않는다)·**O**(마크다운은 `<pre>`로 원문, 다운로드는 클라이언트 `Blob`)
- step 4의 `summary` — **API 응답 필드 모양**(`markdown`·`period`·`meta`)
- `src/app/page.tsx` — **전체를 읽는다.** 서버 컴포넌트가 저장소를 어떻게 부르고 props를
  어떻게 내리는지. 주간 브리핑 카드가 있는 자리
- `src/app/extract/page.tsx` — 전용 화면의 선례. 화면 하나가 어디까지 하는지
- `src/components/shell/` — 앱 셸·세션 배지. **상단 바는 이미 있다. 다시 만들지 마라**
- `src/lib/view/empty-reason.ts` · `src/lib/view/role-label.ts` — T8이 만든 화면용 판정 함수.
  **컴포넌트가 판정하지 않는다**는 규칙의 실체다
- `src/lib/domain/report-period.ts` — step 3의 `resolveReportPeriod`

## 배경

`/report`는 **대표·실장이 열어서 주간 보고 마크다운을 복사해 가는 화면**이다 (`UC-08`,
과제 요구 5번). 자동 발송은 T10 영역이고, 여기서는 **사람이 열어서 복사**하는 데까지다.

대시보드(`/`)에도 브리핑 카드가 이미 있다. 이 화면은 그것의 **확장**이다 — 기간을 고를 수 있고,
팀별로 갈라 보고, 복사·다운로드할 수 있다.

**이 화면의 핵심 제약은 「마크다운을 렌더하지 않는다」이다** (`S7`, 결정 O). 서버에서 HTML로
바꾸는 순간 sanitize가 필요해지고, 시트 셀에서 온 문자열이 그대로 DOM이 된다. 화면은
**원문을 `<pre>`로 보여주고 복사·다운로드까지만** 한다.

## 작업

### 1. `src/app/report/page.tsx` — 서버 컴포넌트

- **자기 API 라우트를 fetch하지 마라** (CLAUDE.md CRITICAL). `src/lib/`를 직접 부른다.
  `src/app/page.tsx`가 하는 방식 그대로다
- 기간은 `searchParams`의 `week`에서 받아 `resolveReportPeriod`에 넘긴다.
  **페이지가 날짜를 계산하지 않는다**
- 마크다운은 `buildWeeklyReport`가 만든 문자열을 그대로 내린다
- **판정은 전부 `lib/`에서 하고 컴포넌트에는 결과만 내린다.** 역할 문자열(`'admin'` 등)이
  컴포넌트 파일에 나타나면 안 된다 — T8이 세운 규칙이고 grep으로 검사된다

### 2. 컴포넌트 — `src/components/report/` 아래

**props 받아 JSX만 뱉는다.** 최소 구성:

- **기간 선택** — 이전 주 / 다음 주 / 이번 주로. `<a href="?week=...">`로 충분하다.
  **달력 위젯을 만들지 마라** — 요청받지 않았고 이 화면의 요점이 아니다.
  `fellBack`이 `true`면 **되돌렸다는 사실을 배너로 알린다** (UI_GUIDE 「배너」)
- **마크다운 원문** — `<pre>`. 가로로 긴 표가 들어가므로 **`overflow-x: auto`로 자기 안에서
  스크롤**시킨다. 페이지 본문이 가로로 밀리면 안 된다
- **복사 버튼** — `navigator.clipboard.writeText`. 클라이언트 컴포넌트다.
  성공·실패를 사용자에게 알린다. **실패를 조용히 삼키지 마라**
- **다운로드 버튼** — 클라이언트에서 `Blob`으로 만들어 내린다 (결정 O).
  **파일을 주는 라우트를 새로 만들지 마라.** 파일명에 기간을 넣는다 (예: `weekly-2026-08-24.md`)
- **팀별 섹션** — step 3이 마크다운 안에 이미 만들었다면 **화면이 또 자르지 마라.**
  마크다운을 파싱해서 섹션을 나누는 짓은 하지 않는다

### 3. 빈 화면과 접근 경로

- 빈 상태는 **`lib/view/empty-reason.ts`의 갈래를 따른다** (UI_GUIDE 259행). 새 문구를
  화면에 직접 적지 마라 — 갈래가 늘어야 하면 `empty-reason.ts`에 더한다
- 앱 셸의 네비게이션에 `/report`로 가는 자리를 만든다. **기존 셸 컴포넌트를 고쳐서** 넣고
  새 네비게이션을 만들지 마라
- 로그인은 필요하지만 **역할로 막지 않는다** (결정 N). `member`가 열면 자기 업무만 담긴
  보고서가 나온다 — 그것이 의도다

### 4. UI_GUIDE 갱신

「주간 보고 화면」 절을 더한다. 기간 선택·복사·다운로드의 규칙과 **「마크다운을 렌더하지 않는
이유」**를 적는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
ls src/app/report/page.tsx
grep -rn "'admin'\|'lead'\|'member'" src/components/report/        # 0줄
grep -rn "dangerouslySetInnerHTML" src/                            # 0줄
grep -rn "marked\|markdown-it\|remark\|rehype" package.json        # 0줄 (렌더러를 넣지 않았다)
grep -rn "taskInScope\|canEditTask" src/components/report/         # 0줄
```

라이브 확인 (개발 서버 + 실제 세션 쿠키 3종):

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/report            # 307 → /login?next=%2Freport
curl -s -b admin.txt  'localhost:3000/report' -o /dev/null -w '%{http_code}\n'   # 200
curl -s -b member.txt 'localhost:3000/report' -o /dev/null -w '%{http_code}\n'   # 200 (막지 않는다)
curl -s -b admin.txt  'localhost:3000/report?week=2026-08-17' | grep -c '2026-08-17'
curl -s -b admin.txt  'localhost:3000/report?week=쓰레기'      | grep -c '되돌'   # 배너가 뜬다
```

**세 역할이 서로 다른 보고서를 본다**는 것을 확인하라 — 마크다운 안의 업무 건수가
admin ≥ lead ≥ member여야 한다.

브라우저로 실제 확인 (헤드리스 가능):

- 복사 버튼 → 클립보드에 마크다운 원문이 들어간다
- 다운로드 버튼 → `.md` 파일이 떨어지고 **내용이 화면의 `<pre>`와 같다**
- **1280·1024 두 폭에서 가로 스크롤이 0px이다** (표는 자기 안에서 스크롤)
- 콘솔 에러 0 · page error 0

데모 모드(`STORAGE_DRIVER=memory`)에서도 `/report`가 **200**이고 리다이렉트되지 않는지 본다.

## 검증 절차

1. 위 AC를 실행한다.
2. 아키텍처 체크리스트:
   - 서버 컴포넌트가 **자기 API를 fetch하지 않는가?**
   - 컴포넌트가 **판정하지 않는가?** (역할 문자열·범위 함수 0줄)
   - UI_GUIDE의 「AI 슬롭 안티패턴」에 해당하는 것이 없는가?
   - 마크다운 렌더러 의존성을 **새로 넣지 않았는가?**
3. `phases/t9-deploy-report/index.json`의 step 5를 갱신한다:
   - 성공 → `completed` + `summary`. **만든 파일 목록과 세 역할 실측 건수**를 적어라
   - 실패 → `error` / 개입 필요 → `blocked`

## 금지사항

- **마크다운을 HTML로 렌더하지 마라.** 이유: `S7`. sanitize가 필요해지고 셀 값이 DOM이 된다.
  `dangerouslySetInnerHTML`도 마크다운 라이브러리도 쓰지 않는다.
- **파일 다운로드용 라우트를 만들지 마라.** 이유: 결정 O. 클라이언트 `Blob`으로 충분하다.
- **역할로 화면을 막지 마라.** 이유: 결정 N. 범위는 이미 데이터에서 잘렸다.
- **달력 위젯·기간 프리셋 드롭다운을 만들지 마라.** 이유: 요청받지 않은 기능이다.
  이전/다음/이번 주 링크로 끝낸다.
- **새 앱 셸·새 상단 바를 만들지 마라.** 이유: T8이 만든 것이 있다. 두 벌이 된다.
- **마크다운 문자열을 파싱해서 화면을 구성하지 마라.** 이유: 보고서 형식이 바뀌면 화면이 조용히 깨진다.
- 기존 테스트를 깨뜨리지 마라.
