# Step 6: teams-route

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T6` 범위 In의 `/teams/[teamSlug]`, 완료 기준 **14**(`app/teams/`에 `error.tsx`)
- `docs/PLAN.md` — 「부서별 탭 `/teams/[teamSlug]`」 문단, 1020행(`?as=lead`로 팀 화면 진입)
- `docs/PRD.md` — 「각 부서마다 new tabs」 요구
- `src/app/error.tsx` — **예외 문자열을 하나도 렌더하지 않는** 기존 구현. 그대로 따른다
- `src/lib/domain/progress-stats.ts` — `TEAM_KEYS`
- step 1~5 산출물 전부 — 이 라우트는 대시보드의 컴포넌트를 **재사용**한다

## 배경

과제 원문의 「각 부서마다 new tabs」를 라우트로 충족한다. 팀 3개이므로 화면 3개이고,
**내용물은 대시보드와 같은 컴포넌트**다 — 팀 하나로 좁힌 KPI·차트·표.

이 step에서 새로 만드는 것은 사실상 **슬러그 변환 하나**다. 나머지는 재사용이고,
재사용하지 못한다면 step 3~5가 팀 필터를 무시하도록 만들어졌다는 뜻이므로 그쪽을 고친다.

## 확정 — 슬러그는 ASCII다

`PLAN.md`가 예시로 `/teams/편집팀`을 적어 뒀다. **이 step에서 `/teams/edit`으로 바꾸고
`PLAN.md`를 고친다.**

근거: 이 화면의 존재 이유가 **링크 복사·공유**다 (`UC-11`). 한글 경로는 복사하면
`/teams/%ED%8E%B8%EC%A7%91%ED%8C%80`이 되어 사람이 읽을 수 없고, 메신저·이슈 본문에서
줄이 깨진다. 팀 키(`edit`·`shoot`·`marketing`)는 이미 `TeamKey`로 코드 전체에 있으므로
새 어휘를 만드는 것도 아니다.

| slug | `TeamKey` | 화면 라벨 |
|---|---|---|
| `edit` | `edit` | 편집팀 |
| `shoot` | `shoot` | 촬영·기획팀 |
| `marketing` | `marketing` | 마케팅·관리팀 |

**가운뎃점은 `·`(U+00B7)이다** — 시트 원문과 같다. `progress-stats.ts`의 KPI 라벨,
`weekly-report.ts`의 팀 이름이 같은 글자를 쓴다. 한 글자만 달라도 대조가 깨진다.

모르는 슬러그는 **404**다 (`notFound()`). 빈 화면이나 전사 대시보드로 넘기지 마라 —
오타 링크가 조용히 다른 화면을 보여주면 「우리 팀 데이터가 이상하다」는 오해가 생긴다.

## 작업

### 1. `src/lib/view/team-slug.ts` — 테스트를 **먼저** 쓴다

```ts
export const TEAM_SLUGS: Readonly<Record<TeamKey, string>>;
export const TEAM_LABELS: Readonly<Record<TeamKey, string>>;

/** 모르는 값은 null. 예외를 던지지 않는다 */
export function toTeamKey(slug: string): TeamKey | null;
export function toTeamSlug(teamKey: TeamKey): string;
/** 사이드바·표·차트가 쓰는 한글 이름 */
export function teamLabel(teamKey: TeamKey): string;
```

테스트: 세 팀 왕복, 모르는 슬러그·빈 문자열·대문자(`EDIT` → **null**. 소문자로만 받는다 —
같은 화면의 URL이 두 모양이 되면 안 된다), `TEAM_SLUGS`의 키가 `TEAM_KEYS`와 **정확히 같다**
(팀이 늘면 이 테스트가 먼저 깨져야 한다), `TEAM_LABELS`의 촬영팀 이름에 `·`(U+00B7)가
들어 있다(`'촬영·기획팀'.charCodeAt(2) === 0xb7`으로 확인).

### 2. `src/lib/view/chart-series.ts`를 고친다 — step 4가 미뤄 둔 것

`buildCompletionBars`의 라벨을 `teamLabel()`로 바꾼다. step 4가 「팀 한글 이름은 step 6에서
`team-slug.ts`가 생기면 그것을 쓴다」고 주석에 남겨 뒀다. **그 주석도 함께 지운다** —
해결된 메모가 남아 있으면 다음 사람이 아직 할 일이 있다고 읽는다.
`chart-series.test.ts`의 라벨 기대값도 함께 고친다.

### 3. `src/app/teams/[teamSlug]/page.tsx`

```tsx
export const runtime = 'nodejs';   // 없어도 되지만 API와 규칙을 맞춘다면 명시하지 않는다
export const dynamic = 'force-dynamic';

export default async function TeamPage({ params, searchParams }: PageProps<'/teams/[teamSlug]'>) { … }
```

- `params`·`searchParams` **둘 다 Promise**다 (Next 16).
- `toTeamKey`가 `null`이면 `notFound()`.
- 데이터는 대시보드와 **같은 경로**로 읽는다 (`getStorage` → `buildReadContext`).
  단 팀 필터를 **강제로 얹는다**: `filter.teamKeys = [teamKey]`.
  URL의 `?team=`이 다른 팀을 가리켜도 **경로가 이긴다** — `/teams/edit?team=shoot`이
  촬영팀을 보여주면 그 링크는 거짓말이다. (이 규칙을 코드 주석에 남겨라.)
- 화면 구성: `PageShell` → 팀 이름 제목 → **KPI 스트립(그 팀 기준)** → 도넛 →
  필터 바 → 업무 표. 팀별 요약표와 완료율 바는 **넣지 않는다** — 행이 하나뿐인 표와
  막대 하나짜리 차트는 정보가 아니다.
- 필터 바에서 **팀 칩은 숨긴다.** 이미 경로가 팀을 정했다. `filter-bar.tsx`에
  `showTeamChips?: boolean` props를 더한다.

### 4. `src/app/teams/error.tsx`

완료 기준 14가 `app/`과 `app/teams/` **둘 다** 요구한다.
`src/app/error.tsx`를 그대로 본떠 만든다 — **예외에 실려 온 문자열을 하나도 렌더하지 않는다**
(`X1`). `props`에서 예외 자체를 꺼내지 마라.

### 5. 사이드바에 팀 링크 3개를 더한다

step 2가 「없는 라우트로 가는 링크를 만들지 마라」고 미뤄 둔 것이다. 이제 라우트가 있다.
`TEAM_SLUGS`·`TEAM_LABELS`로 만든다 — 사이드바에 팀 이름을 손으로 적지 마라.

### 6. `docs/PLAN.md`를 고친다 — 코드보다 먼저다

1020행의 `?as=lead`로 `/teams/편집팀` 진입 예시를 `/teams/edit`으로 바꾸고,
「부서별 탭」 문단에 **슬러그를 ASCII로 둔 이유 한 줄**을 남겨라.
`docs/TICKETS.md`에 `/teams/[teamSlug]`는 그대로여도 된다(슬러그 값이 아니라 세그먼트 이름이다).

## Acceptance Criteria

```bash
npx vitest run src/lib/view src/app

# 라우트와 에러 바운더리가 있다 (둘 다 출력이 있어야 함)
ls "src/app/teams/[teamSlug]/page.tsx" src/app/teams/error.tsx

# 모르는 슬러그는 404다 (출력이 있어야 함)
grep -rn "notFound" "src/app/teams/[teamSlug]/page.tsx"

# 에러 화면이 예외 문자열을 렌더하지 않는다 (출력이 비어야 함)
grep -nE "error\.(message|stack|digest)" src/app/teams/error.tsx ; test $? -eq 1

# 팀 이름이 한 곳에서만 정의된다 (1이 나와야 함)
grep -rln "촬영·기획팀" src/lib/view src/components | wc -l

# 사이드바가 팀 이름을 손으로 적지 않는다 (출력이 비어야 함)
grep -n "편집팀\|촬영·기획팀\|마케팅·관리팀" src/components/shell/app-sidebar.tsx ; test $? -eq 1

# step 4가 남긴 메모가 해결됐다 (출력이 비어야 함)
grep -n "step 6" src/lib/view/chart-series.ts ; test $? -eq 1

# 문서가 새 슬러그를 가리킨다 (출력이 있어야 함 / 없어야 함)
grep -n "/teams/edit" docs/PLAN.md
grep -rn "/teams/편집팀" docs/ ; test $? -eq 1

# 안티패턴·라이트 팔레트 0건 (둘 다 출력이 비어야 함)
grep -rniE "backdrop-blur|bg-gradient|bg-clip-text|purple|violet|indigo|blur-3xl|drop-shadow|hover:scale" src/app src/components ; test $? -eq 1
grep -rnE "neutral-|bg-white|text-white|red-[0-9]|amber-[0-9]" src/app src/components ; test $? -eq 1

# 회귀
npx vitest run src/lib

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. `STORAGE_DRIVER=memory npm run dev`로:
   - `/teams/edit`·`/teams/shoot`·`/teams/marketing` 셋 다 뜨는가?
   - **`/teams/edit?team=shoot`이 편집팀을 보여주는가?** (경로가 이기는가)
   - `/teams/nope`이 404인가?
   - 팀 화면의 KPI 합이 전사 대시보드의 그 팀 열과 같은가?
   - 사이드바에서 현재 팀 항목이 활성 표시되는가?
   - `/teams/shoot`(70컬럼 팀)의 표가 공통 8칸인가? 가로로 안 터지는가?
3. 체크리스트:
   - `?overdue=1`을 얹은 팀 URL을 복사해 새 탭에서 같은 화면인가? (`UC-11`)
   - 팀 화면에도 「마지막 반영」이 있는가? (완료 기준 8은 **모든** 페이지다)
   - 팀 화면에 팀별 요약표·완료율 바를 넣지 않았는가?
4. `phases/t6-dashboard/index.json`의 step 6을 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 슬러그를 ASCII로 정한 이유, 경로가 `?team=`을 이긴다는 규칙,
   고친 문서를 남겨라.

## 금지사항

- 한글 슬러그를 쓰지 마라. 이유: 복사한 링크가 퍼센트 인코딩으로 깨져 공유가 안 된다.
- 모르는 슬러그를 전사 대시보드로 넘기지 마라. 이유: 오타 링크가 조용히 다른 화면을
  보여주면 데이터를 의심하게 된다.
- `?team=`이 경로를 덮게 두지 마라. 이유: `/teams/edit`이 촬영팀을 보여주는 링크는 거짓말이다.
- 팀 이름을 컴포넌트·차트·사이드바에 손으로 적지 마라. 이유: 가운뎃점 한 글자가 달라지면
  시트 대조가 깨진다.
- 팀별 요약표·완료율 바를 팀 화면에 넣지 마라. 이유: 행 하나짜리 표는 정보가 아니다.
- 팀 화면용 컴포넌트를 새로 만들지 마라. 이유: 대시보드와 같은 컴포넌트를 재사용하지
  못한다면 그 컴포넌트가 잘못 만들어진 것이다. 그쪽을 고친다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
