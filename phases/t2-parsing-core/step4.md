# Step 4: tab-detector

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙, TDD, 파서는 하드 실패 금지
- `docs/TICKETS.md` — `## T2` 완료 기준 **1**, `## T5` 완료 기준 7(「알려진 탭 0개」는 중단)
- `docs/ARCHITECTURE.md` — 「엑셀 → 조회」의 `tab-detector` 줄, 에러 코드
  `NO_KNOWN_TAB`·`SETTINGS_TAB_MISSING`
- `docs/PLAN.md` — 「A. 엑셀」 탭 5종, `E6~E8`의 `00_통합 대시보드` 방침(**읽지 않는다.
  단 대조 검증용**)
- `scripts/smoke/RESULT.md` — `A7` 절: **설정 탭 실제 이름이 `설정`이 아니라 `99_설정`이라
  부분 일치가 필요하다**
- 이전 step 산출물: `src/lib/sheet/header-resolver.ts`(밴드 후보), `src/types/sheet.ts`

## 배경

탭 판별이 틀리면 그 뒤가 전부 틀린다. 그래서 **이름과 헤더 시그니처 두 축으로** 본다.

- **이름만 보면 안 되는 이유**: 사람이 탭 이름을 바꾼다. 실제로 설정 탭은 `설정`이 아니라
  `99_설정`이었다 (T1 실측). 정확 일치로 짰으면 T1에서 이미 깨졌을 것이다.
- **시그니처만 보면 안 되는 이유**: 헤더가 비슷한 탭이 생기면 갈린다. 이름이 보조 근거로 남는다.

**시그니처가 이름을 이긴다.** 헤더는 데이터 구조라 함부로 바뀌지 않고, 이름은 사람이 언제든
바꾸기 때문이다. 완료 기준 1의 "탭 이름을 바꿔도 판별된다"가 이 우선순위를 요구한다.

`00_통합 대시보드`도 **판별은 한다.** 읽지 않기로 한 것은 파이프라인의 결정(T3)이고,
판별기가 "모르는 탭"으로 뱉으면 T5의 `NO_KNOWN_TAB` 판정이 오염된다.

## 작업

### 1. 타입 (`src/types/sheet.ts`에 추가)

```ts
export type SheetTabKind =
  | 'dashboard' | 'edit_team' | 'shoot_team' | 'marketing_team' | 'settings' | 'unknown';

export interface TabMatch {
  signatureKey: string;   // 어느 시그니처가 맞았는지 (마케팅 A/B 구분에 쓴다)
  band: HeaderBand;
  matched: string[];      // 실제로 맞은 필수 컬럼 이름들
}

export interface TabDetection {
  sheet: string;
  kind: SheetTabKind;
  matchedBy: 'signature' | 'name' | 'both' | 'none';
  matches: TabMatch[];    // 시그니처가 맞은 밴드들. 마케팅 탭은 2개가 나온다
}
```

`matches`가 밴드를 들고 나가는 이유: `03_마케팅·관리팀`은 한 탭에 A 섹션과 B 섹션의
헤더가 따로 있다. 여기서 이미 "어느 행이 어느 섹션의 헤더인지"를 알아냈는데 버리면
T3의 `section-splitter`가 같은 탐색을 다시 한다.

### 2. `src/lib/sheet/tab-detector.test.ts`를 **먼저** 쓴다

```ts
export function detectTab(sheet: SheetGrid): TabDetection
```

### 3. 시그니처 레지스트리 — 선언적으로 쓴다

절차적 if문으로 짜지 마라. 탭이 늘면 표 한 줄만 추가되어야 한다.

```ts
const TAB_SIGNATURES = [
  { key: 'edit_team',          kind: 'edit_team',       namePattern: /편집/,
    required: ['업무명', '담당자', '배정일', '컨셉·레퍼런스', '제작 진행', '최종본·업로드'] },
  { key: 'shoot_team',         kind: 'shoot_team',      namePattern: /촬영|기획/,
    required: ['업무ID', '프로젝트명', '기획 담당자', '촬영 담당자', '섭외 상태'] },
  { key: 'marketing_inquiry',  kind: 'marketing_team',  namePattern: /마케팅|관리/,
    required: ['문의 ID', '문의 접수일', '답변 상태', '답변 기한'] },
  { key: 'marketing_goal',     kind: 'marketing_team',  namePattern: /마케팅|관리/,
    required: ['마케팅 과제명', '목표 KPI', '목표 수치', '실제 성과', '달성률'] },
  { key: 'settings',           kind: 'settings',        namePattern: /설정/,
    required: ['공통_진행 상태', '공통_우선순위', '공통_승인 상태', '공통_리스크 상태', '기본 SLA 설정_항목'] },
  { key: 'dashboard_kpi',      kind: 'dashboard',       namePattern: /통합|대시보드/,
    required: ['전체 활성 업무', '전체 완료율', '이번 주 마감'] },
  { key: 'dashboard_summary',  kind: 'dashboard',       namePattern: /통합|대시보드/,
    required: ['팀', '전체 업무', '완료율'] },
];
const MIN_SIGNATURE_MATCH = 3;   // PLAN.md「4. 엑셀 파싱 파이프라인」의 "필수 컬럼 3개 이상"
```

**컬럼 일치 규칙**: `resolveHeaders`가 낸 각 `HeaderColumn`의 `path` 요소 중 하나가
필수 문자열로 **시작하면** 일치로 본다. 정확 일치가 아니라 접두 일치인 이유는
그룹 라벨이 `컨셉·레퍼런스 (+2일)`처럼 접미사를 달고 있기 때문이다 (step 3에서 원문을
보존하기로 했다). 접두 일치는 `담당자`가 `기획 담당자`를 잡지 않으므로 안전하다.

**이름 일치 규칙**: `namePattern`을 시트 이름에 **부분 일치**로 건다.
`99_설정`·`02_촬영·기획팀`처럼 번호 접두사가 붙어 있다 (T1 실측).

### 4. 판정 절차

1. `findHeaderBands(sheet)`로 후보를 전부 얻는다.
2. 후보 × 시그니처를 모두 대조해, 맞은 컬럼이 `MIN_SIGNATURE_MATCH` 이상인 조합을 모은다.
3. 시그니처가 하나라도 맞으면 그 `kind`를 채택한다 (`matchedBy: 'signature'`,
   이름도 맞으면 `'both'`).
   - **서로 다른 `kind`의 시그니처가 동시에 맞으면**: 맞은 컬럼 수가 많은 쪽 → 동수면
     이름까지 맞는 쪽 → 그래도 동수면 레지스트리 정의 순서. 이 우선순위를 코드 주석에 남긴다.
   - 같은 `kind`의 시그니처 여러 개가 맞으면(마케팅 A·B, 대시보드 KPI·요약표)
     **`matches`에 전부 담는다.**
4. 시그니처가 하나도 안 맞고 이름만 맞으면 그 `kind` + `matchedBy: 'name'`,
   `matches`는 빈 배열.
5. 둘 다 아니면 `kind: 'unknown'`, `matchedBy: 'none'`. **예외를 던지지 마라** —
   모르는 탭은 정상적인 결과다. 「알려진 탭 0개」의 중단 판정은 T5가 파이프라인 수준에서 한다.

### 5. 테스트 케이스

픽스처로:

1. **5개 탭이 각각 올바른 `kind`로 판별된다** (완료 기준 1의 앞쪽 절반)
2. **`03_마케팅·관리팀`의 `matches`에 `marketing_inquiry`와 `marketing_goal`이 둘 다 있고,
   두 `band.labelRow`가 서로 다르다**
3. `99_설정`이 **부분 일치**로 이름도 맞는다 (`matchedBy: 'both'`) — 정확 일치로 짰다면
   여기서 깨진다

이름을 바꿔서 (격자의 `name`만 바꾼 사본으로):

4. **5개 탭 이름을 전부 무의미한 문자열(`Sheet1`…)로 바꿔도 `kind`가 그대로 나온다**
   (완료 기준 1의 핵심. `matchedBy`는 `'signature'`가 된다)
5. 이름은 `편집팀`인데 헤더가 촬영팀 시그니처인 격자를 만들면 **`shoot_team`으로 판별된다**
   (시그니처가 이름을 이긴다)

작은 격자로:

6. 필수 컬럼이 2개만 맞으면 `unknown`이다 (3개 이상 규칙)
7. 헤더가 하나도 없는 빈 시트는 `unknown`이고 예외가 나지 않는다

## Acceptance Criteria

```bash
npx vitest run src/lib/sheet/tab-detector.test.ts

# 계층 경계 (출력이 비어야 함)
grep -n "exceljs" src/lib/sheet/tab-detector.ts ; test $? -eq 1

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 체크리스트:
   - 탭 이름을 바꾼 테스트가 실제로 있는가? (완료 기준 1은 이것이 없으면 미충족)
   - 시그니처 레지스트리가 **선언적 배열**인가? if문 사슬이면 다시 써라
   - 설정 탭 판별이 **부분 일치**인가?
   - 모르는 탭에서 예외를 던지지 않는가?
3. `phases/t2-parsing-core/index.json`의 step 4를 갱신한다:
   - 성공 → `"status": "completed"` + `"summary"` (판별된 5탭과 `matchedBy`,
     마케팅 밴드 2개 검출 여부, 이름 변경 테스트 통과 여부, 테스트 개수)
   - 3회 시도 후 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `NO_KNOWN_TAB`·`SETTINGS_TAB_MISSING`을 여기서 던지지 마라. 이유: 그 판정은 워크북
  전체를 본 뒤에 내려야 하고, `ARCHITECTURE.md`상 T5 파이프라인의 책임이다.
- 탭 이름 정확 일치를 쓰지 마라. 이유: 실제 이름이 `99_설정`이다 (T1 실측).
- 데이터를 읽거나 태스크를 만들지 마라. 이유: 어댑터(T3)의 범위다.
- `00_통합 대시보드`를 `unknown`으로 두지 마라. 이유: 읽지 않는 것과 모르는 것은 다르다.
- 시그니처를 픽스처에 맞춰 임의로 줄이지 마라. 이유: 픽스처 헤더는 실제 시트에서 그대로
  가져왔다. 안 맞으면 시그니처가 아니라 픽스처나 step 3의 결합을 의심하라.
- `exceljs`를 import하지 마라. 이유: `CLAUDE.md` CRITICAL.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
