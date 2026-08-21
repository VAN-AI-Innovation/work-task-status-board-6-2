# Step 7: task-panel

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` 완료 기준 **4**(사이드 패널 슬라이딩·Esc·오버레이, `extras`
  전량 + stage 타임라인)·**6**(`?task=` 딥링크)·**12**(`http`·`https`만 앵커)·**13**(민감 키 마스킹)
- `docs/PLAN.md` — 「보안」 `S6`·`S7`, `UC-15`
- `docs/UI_GUIDE.md` — 「링크 렌더링 (보안)」·「애니메이션」(패널 200ms ease-out)·
  사이드 패널 `w-[480px]`·`rounded-none`
- `docs/ADR.md` — `ADR-002`(`extras`는 라벨-값 나열로만 보여준다)
- `src/lib/domain/extras-visibility.ts` — `SENSITIVE_EXTRA_KEYS`·`isSensitiveExtraKey`·`maskExtras`
- `src/types/task.ts` — **`ExtraValue`의 하이퍼링크 변형**(`{ text, hyperlink }`)·`TaskStage`
- `src/lib/api/read-context.ts` — `read.stages`가 무엇을 담는지
- step 1·5 산출물: `dashboard-query.ts`(`buildHref`)·`status-badge.ts`

## 배경

**촬영·기획팀 70컬럼을 쓸 수 있게 만드는 것이 이 패널이다** (`ADR-002`·`UC-15`).
표는 공통 8칸만 보여주기로 했고, 나머지 60여 칸은 여기서 라벨-값으로 나열된다.
패널이 없으면 그 팀의 데이터는 화면에서 영영 안 보인다.

그리고 이 패널이 **T6에서 보안 규칙이 가장 많이 걸리는 자리**다. `extras`에는
출연자 연락처와 문의자 SNS 계정이 실제로 들어 있고(`S6`), 시트 셀에서 온 하이퍼링크가
그대로 앵커가 될 수 있다(`S7`). 완료 기준 12·13이 여기서 판정된다.

다행히 **마스킹은 이미 끝나 있다.** `toTaskListResponse`가 역할에 따라 민감 키의 값을
`null`로 만든 결과를 넘겨받는다. **패널이 마스킹을 다시 하지 마라** — 두 곳에서 거르면
한쪽만 고쳐졌을 때 어느 쪽이 진짜인지 알 수 없다. 패널이 하는 일은
「이 `null`이 원래 빈 값인가, 가려진 값인가」를 **표시**하는 것뿐이다.

## 확정

### 열고 닫기는 URL이 한다

`?task=<id>`가 있으면 열린다. 닫기는 `buildHref(pathname, query, { task: null })`로 **이동**한다.
Esc·오버레이 클릭·닫기 버튼 셋 다 같은 이동이다.

이유: 딥링크(완료 기준 6)와 뒤로 가기가 공짜로 따라온다. 클라이언트 상태로 열면
「링크를 보냈는데 상대는 패널이 안 열린 화면을 본다」가 된다.

### 링크 렌더 규칙 (`S7` · 완료 기준 12)

- 스킴이 **`http:` 또는 `https:`일 때만** `<a>`. 비교는 소문자화 후 **접두사 정확 비교**다.
  `javascript:`·`data:`·`vbscript:`·`file:`·`mailto:`는 전부 **텍스트로만** 표시한다.
- **`javascript`가 들어 있는지 `includes`로 찾지 마라.** `https://x.com/javascript-tips`가
  차단된다. 검사 대상은 스킴 하나다.
- 앵커에는 **`rel="noopener noreferrer"` + `target="_blank"`**.
- 앞뒤 공백·제어문자를 제거한 뒤 판정한다 (` javascript:alert(1)`이 통과하면 안 된다).

### `null`의 세 가지 뜻

| 상황 | 표시 |
|---|---|
| 값이 원래 없음 | `—` |
| 민감 키인데 `member`라서 가려짐 | `(비공개)` + `text-ink-faint` |
| 값이 빈 문자열 | `—` |

**키는 절대 지우지 않는다** (`extras-visibility.ts`의 결정). 무엇이 가려졌는지 사용자가
알아야 하고, 가려진 것과 원래 없는 것이 구분돼야 한다.

## 작업

### 1. `src/lib/view/extras-render.ts` — 테스트를 **먼저** 쓴다

```ts
export interface ExtraCell {
  label: string;
  /** 화면에 그릴 문자열. 마스킹이면 '(비공개)', 빈 값이면 '—' */
  text: string;
  /** `http`·`https`일 때만 값이 있다. 그 외엔 null이고 text만 그린다 */
  href: string | null;
  masked: boolean;
}

/** `http`·`https`만 통과. 그 외·형식 오류는 null. **예외를 던지지 않는다** */
export function safeHref(value: string): string | null;

/** 키 코드포인트 순 정렬. **입력을 고치지 않는다** */
export function toExtraCells(
  extras: Record<string, ExtraValue>,
  role: ViewerRole
): ExtraCell[];
```

- `masked`는 **`role === 'member'` && `isSensitiveExtraKey(key)` && 값이 `null`**일 때만 true다.
  `admin`·`lead`에게는 마스킹이 없으므로 같은 `null`이 `—`로 나온다 — 정확한 표시다.
- 하이퍼링크 변형(`{ text, hyperlink }`)은 `text ?? hyperlink`를 문자열로,
  `safeHref(hyperlink)`를 `href`로.
- `boolean`·`number`는 문자열로 접는다. `false`와 `0`이 `—`가 되면 안 된다.
- **정렬은 코드포인트 순**이다. `localeCompare` 금지 (환경마다 결과가 다르다).

테스트: `javascript:alert(1)` / ` javascript:alert(1)`(선행 공백) / `JAVASCRIPT:` /
`data:text/html,x` / `mailto:a@b.c` → **전부 `href: null`**;
`https://x.com` / `HTTP://x.com` → 통과; 마스킹 3역할 × 민감/일반 키;
`false`·`0`이 `—`가 아님; 빈 객체; 정렬 결정성; 입력 불변.

### 2. `src/components/tasks/task-panel.tsx` — 패널

`'use client'` (Esc 키 처리). props:
`{ task: TaskResponse; stages: TaskStage[]; cells: ExtraCell[]; closeHref: string }`

**`extras`를 컴포넌트 안에서 변환하지 마라.** 서버가 `toExtraCells`를 부른 결과를 받는다.

구성:

1. 헤더 — 업무명 + 상태 배지(`status-badge.tsx` 재사용) + 닫기 버튼
2. 공통 필드 — 팀·담당자·공동 담당·상태 원문·승인·우선순위·리스크·진행률·
   배정일·마감·D-DAY·다음 조치·다음 조치 담당·다음 조치 기한·지연 사유·비고
3. **stage 타임라인** — `seq` 순. 각 단계: 라벨 · 계획일 · 실제일 · 확인 상태 · 내용 ·
   SLA. **실제일이 계획일보다 늦으면 그 날짜만 `text-warn`** (행 전체를 칠하지 마라)
4. **`extras` 전량** — `cells`를 라벨-값 2열로. 개수를 제한하지 마라 (완료 기준 4는 「전량」이다)
5. 출처 — `sourceSheetTab` · `sourceRowIndex` (「시트 어디서 왔는가」가 신뢰의 근거다)

동작:

- 오버레이(`fixed inset-0 bg-canvas/70`) 클릭 → `closeHref`로 이동.
  **`backdrop-blur`를 쓰지 마라** — 안티패턴이다.
- Esc → 같은 이동. `useEffect`로 `keydown` 리스너를 달고 **반드시 정리(cleanup)한다.**
- 슬라이딩: `translate-x` **200ms ease-out**, 폭 `w-[480px]`, `rounded-none`.
  그 외 애니메이션 금지.
- **포커스**: 열릴 때 패널의 닫기 버튼으로 포커스를 옮긴다. 키보드로 표를 훑던 사람이
  패널을 열면 포커스가 뒤에 남는다.

### 3. `src/app/page.tsx`·`src/app/teams/[teamSlug]/page.tsx`에 끼운다

```ts
const openId = query.task;
const openTask = openId === null ? null : tasks.find((t) => t.id === openId) ?? null;
```

- **`tasks`(응답 모양)에서 찾는다.** 저장 모델에서 찾아 넘기면 `raw`가 새어 나간다.
- 목록에 없는 id(필터에 걸려 빠졌거나 존재하지 않음)면 **패널을 열지 않는다.**
  에러를 띄우지 마라 — 오래된 링크를 열었을 뿐이다. 다만 **필터 때문에 빠진 경우를 위해
  「이 업무는 현재 필터 밖에 있습니다 · [필터 초기화]」 한 줄**을 표 위에 띄운다.
  아무 반응이 없으면 링크가 고장 난 것으로 보인다.
- 단계는 `read.stages`에서 `taskId`로 거른다. 이미 조회돼 있으니 **다시 조회하지 마라.**
- 두 페이지가 같은 코드를 쓰므로 **`src/components/tasks/task-panel-slot.tsx`** 같은
  얇은 래퍼 하나로 묶어라. 두 페이지에 같은 열 줄을 복사하면 한쪽만 고쳐진다.

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 스킴 검사가 접두사 비교다 (출력이 비어야 함)
grep -n "includes('javascript" src/lib/view/extras-render.ts ; test $? -eq 1

# 외부 링크 방어 (출력이 있어야 함)
grep -rn "noopener noreferrer" src/components/tasks/task-panel.tsx

# 패널이 마스킹을 다시 하지 않는다 (출력이 비어야 함)
grep -rn "maskExtras\|SENSITIVE_EXTRA_KEYS" src/components/ ; test $? -eq 1

# 저장 모델이 패널로 새지 않는다 (출력이 비어야 함)
grep -rn "\.raw" src/components/ ; test $? -eq 1

# 안티패턴 — blur 없음 (출력이 비어야 함)
grep -rniE "backdrop-blur|backdrop-filter" src/components/tasks/ ; test $? -eq 1

# 애니메이션이 규격대로다 (출력이 있어야 함)
grep -rn "duration-200\|200ms" src/components/tasks/task-panel.tsx

# Esc 리스너를 정리한다 (removeEventListener가 있어야 함)
grep -n "removeEventListener" src/components/tasks/task-panel.tsx

# dangerouslySetInnerHTML 없음 (출력이 비어야 함)
grep -rn "dangerouslySetInnerHTML" src/ ; test $? -eq 1

# 안티패턴·라이트 팔레트 0건 (둘 다 출력이 비어야 함)
grep -rniE "bg-gradient|bg-clip-text|purple|violet|indigo|blur-3xl|drop-shadow|hover:scale" src/app src/components ; test $? -eq 1
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]" src/app src/components ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `STORAGE_DRIVER=memory npm run dev`로 **손으로** 확인한다:
   - `/teams/shoot`에서 업무를 클릭 → 패널이 오른쪽에서 슬라이딩하는가?
   - **`extras`가 전량 나오는가?** (70컬럼 팀에서 개수를 세어 보라)
   - stage 타임라인이 `seq` 순으로 나오는가?
   - **Esc로 닫히는가? 오버레이 클릭으로 닫히는가?** 닫으면 URL에서 `task=`가 사라지는가?
   - **패널이 열린 URL을 복사해 새 탭에서 열면 패널이 열린 채로 뜨는가?** (완료 기준 6)
   - 뒤로 가기로 패널이 닫히는가?
   - `?as=member`로 같은 업무를 열면 **연락처·계정이 `(비공개)`인가?** (완료 기준 13)
     `?as=admin`에서는 값이 보이는가?
   - 필터로 그 업무를 밖으로 밀어낸 뒤 같은 `?task=` 링크를 열면 안내 한 줄이 뜨는가?
3. **`javascript:` 링크 확인** — 시드에 그런 셀이 없다면 `extras-render.test.ts`의
   테스트가 그 검증이다. 테스트가 실제로 그 케이스를 덮는지 눈으로 확인하라.
4. `phases/t6-dashboard/index.json`의 step 7을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 URL로 열고 닫는 결정, 스킴 화이트리스트, `null`의 세 가지 뜻,
   테스트 개수를 남겨라.

## 금지사항

- 패널을 클라이언트 상태로 열지 마라. 이유: 딥링크(완료 기준 6)와 뒤로 가기가 죽는다.
- 마스킹을 패널에서 다시 하지 마라. 이유: 거르는 곳은 응답 계층 하나다 (`S6`).
  두 곳이 되면 한쪽만 고쳐졌을 때 어느 쪽이 진짜인지 모른다.
- 스킴 검사를 `includes`로 하지 마라. 이유: 정상 URL이 차단되고, 우회도 쉽다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 값이 시트 셀에서 온다.
- `backdrop-blur`로 오버레이를 만들지 마라. 이유: 안티패턴 1번이다. 불투명도만 쓴다.
- `extras` 표시 개수를 제한하거나 「더 보기」로 접지 마라. 이유: 완료 기준 4가 「전량」이다.
- 패널에서 값을 수정할 수 있게 만들지 마라. 이유: `UC-16`은 T8 이후다.
- 없는 `?task=`에 에러 화면을 띄우지 마라. 이유: 오래된 링크를 연 것뿐이다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
