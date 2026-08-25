# Step 2: outline-builder

## 읽어야 할 파일

- `CLAUDE.md` — TDD, 파서 하드 실패 금지, 경고에 원문을 담지 않는다
- `docs/TICKETS.md` — T7 완료 기준 2, 그리고 **리스크·미결**의 세 번째 항목
  (「`h3` 50건 중 아웃라인 과제는 `N-M.` 접두사를 가진 20건이고 나머지 30건은 절 제목이다」)
- `scripts/smoke/RESULT.md` — 「H8」 태그·접두사 실측표. 이 step이 존재하는 이유가 그 표다
- 이전 step 산출물:
  - `src/types/doc.ts` — `OutlineNode`·`OutlineTask`
  - `src/lib/doc/markdown-reader.ts` — 입력을 만드는 리더
  - `src/lib/fixtures/sample-workload.md`

## 배경

실측이 말해 준 사실 하나가 이 step 전체다: **태그 깊이는 과제를 가려내지 못한다.**
실제 문서의 `h3` 50건 중 과제는 20건뿐이고 30건은 절 제목이다. `h3`을 전부 과제로 잡으면
배정표에 「배경」·「목표」 같은 유령 과제 30줄이 생긴다.

판별 기준은 **번호 접두사**다.

```
## 3. 데이터 파이프라인       → 대분류 (category)
### 3-1. 시트 통합 파서       → 과제 (taskNo = '3-1')
### 검토 포인트               → 과제가 아니다. 현재 과제의 세부항목으로 흡수한다
```

절 제목을 **버리지 않고 흡수**하는 이유: 실제 문서에서 그 30건 아래에 세부 불릿이 달려 있다.
버리면 배정표의 세부항목이 비고, 사람이 문서를 다시 열어야 한다.

## 작업

### 1. `src/lib/doc/outline-builder.test.ts` 를 **먼저** 쓴다

```ts
export interface OutlineBuildResult {
  tasks: OutlineTask[];
  /** 코드만 담는다. 원문·사람 이름을 담지 않는다 */
  warnings: string[];
}

export function buildOutline(nodes: readonly OutlineNode[]): OutlineBuildResult;
```

케이스:

| 입력 | 기대 |
|---|---|
| `## 3. 데이터` → `### 3-1. 파서` | `tasks[0] = {category:'데이터', taskNo:'3-1', headingRaw:'3-1. 파서', orderIndex:0}` |
| 번호 없는 `### 검토 포인트` + 그 아래 불릿 | 과제가 되지 않고, **직전 과제의 `details`에 흡수**된다. 절 제목 자체도 한 줄로 남긴다 |
| 과제 앞에 나온 번호 없는 절 (직전 과제 없음) | 어디에도 붙지 않고 조용히 버려진다. 경고 1건 |
| `#### 3-1-1. 하위` (level 4, 번호 두 단) | 과제가 아니다 — `N-M.`만 과제다. 직전 과제에 흡수 |
| 대분류 없이 나온 `### 5-1.` | `category: null`. 경고 1건. **과제는 버리지 않는다** |
| `## 워크로드 공유` 절 안의 모든 노드 | 과제로 잡지 않는다 (step 3이 따로 파싱한다) |
| 같은 `taskNo`가 두 번 | 둘 다 남긴다. `orderIndex`로 구분. 경고 1건 (`DUPLICATE_TASK_NO`) |
| `### 3-1.과제` (점 뒤 공백 없음) | 과제로 잡는다 |
| `### 3-1) 과제` | 과제로 잡는다 (`.`·`)` 둘 다 허용) |
| 빈 배열 | `{tasks: [], warnings: []}` |
| 픽스처 전체 | 과제 6건 이상, **번호 없는 `###` 절이 과제로 잡히지 않는다** |

경고 코드는 문자열 상수로 두고 최소로 유지한다:
`NO_CATEGORY` · `ORPHAN_SECTION` · `DUPLICATE_TASK_NO`. **원문을 담지 마라** — 문서 본문에는
사람 이름이 있다 (`CLAUDE.md` 보안 규칙). 필요하면 `taskNo`까지만 붙인다.

### 2. `src/lib/doc/outline-builder.ts` 를 구현한다

```
대분류 정규식:  /^(\d+)[.)]\s*(.+)$/       → category = 캡처 2 (번호를 뗀 이름)
과제   정규식:  /^(\d+-\d+)[.)]?\s*(.*)$/  → taskNo = 캡처 1
```

- **과제 판별에 `level`을 쓰지 마라.** 실측이 `h2`·`h3` 어느 쪽에도 번호가 붙을 수 있음을
  보였고, 문서 스타일이 바뀌면 깊이는 흔들린다. 접두사가 진실이다.
- 단, 대분류와 과제를 가르는 것은 **번호의 모양**이다(`3.` 대 `3-1.`). 과제 정규식을 먼저 시험한다
  — `3-1.`은 대분류 정규식에도 걸린다.
- `headingRaw`는 제목 **원문 전체**다 (번호 포함). 난이도·마감을 뽑는 것은 step 4이고,
  그 재료가 이 문자열이다.
- 「워크로드 공유」 절의 경계: `WORKLOAD_SECTION_PATTERN`을 **`workload-parser.ts`가 소유**하는데
  그 파일은 step 3에서 생긴다. 이 step에서는 `outline-builder.ts`가 상수를 들고 있고,
  step 3이 그것을 import한다. 두 곳에 적지 마라.
  절의 범위는 「그 제목부터, 같거나 더 얕은 level의 다음 제목 직전까지」다.
- `details`는 흡수한 절 제목과 그 `lines`를 **문서 순서 그대로** 이은 배열이다.
- 예외를 던지지 않는다.

## Acceptance Criteria

```bash
npm run test -- src/lib/doc/outline-builder.test.ts
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 번호 없는 절 제목이 과제로 잡히지 않는가? (T7의 실측 리스크 그 자체다)
   - 경고 문자열에 문서 본문·사람 이름이 섞이지 않았는가?
   - `now`·`Date`를 쓰지 않았는가? (이 계층에 시간은 필요 없다)
3. `phases/t7-doc-extract/index.json`의 step 2를 갱신한다.

## 금지사항

- 난이도·마감·우선순위를 여기서 파싱하지 마라. 이유: step 4가 그 셋을 한 곳에서 다뤄야
  「긴 것부터 정렬」(완료 기준 3) 같은 규칙이 한 파일에 모인다.
- 과제 0건일 때 예외를 던지지 마라. 그 판정은 `doc-pipeline`(step 7)이 한다.
- 기존 테스트를 깨뜨리지 마라.
