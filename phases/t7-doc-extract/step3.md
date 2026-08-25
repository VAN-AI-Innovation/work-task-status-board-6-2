# Step 3: workload-parser

## 읽어야 할 파일

- `CLAUDE.md` — TDD, 파서 하드 실패 금지
- `docs/TICKETS.md` — T7 **리스크·미결** 마지막 항목
  (「「워크로드 공유」 섹션의 P0/P1과 ①②③④는 별도 블록이므로 `workload-parser.ts`로 분리 파싱 후
  과제 번호로 조인해 `priority`를 채운다. **조인 실패는 무시**」)
- `docs/PLAN.md` — 「5. 독스 → 배정표」의 「T7 착수 시 확정」 소절(step 0이 추가한 결정 A: 우선순위 매핑표)
- 이전 step 산출물:
  - `src/types/doc.ts` — `WorkloadEntry`
  - `src/lib/doc/outline-builder.ts` — `WORKLOAD_SECTION_PATTERN`을 여기서 import한다
  - `src/lib/fixtures/sample-workload.md` — 「워크로드 공유」 절

## 배경

문서 뒷부분의 「워크로드 공유」 절은 아웃라인과 **다른 문법**으로 쓰여 있다. 우선순위가
`P0`·`P1` 블록으로 묶여 있고 항목이 `①②③④`로 나열된다. 아웃라인 파서로 읽으면 이 절이
과제 목록을 한 벌 더 만들어 배정표가 두 배가 된다.

그래서 분리 파싱이다. 여기서 나오는 것은 **과제가 아니라 `taskNo → 우선순위` 대응표**뿐이다.

**이 파서는 실패해도 된다.** 문서 작성자가 절 제목을 바꾸거나 형식을 흩뜨리면 우선순위 칸이
빌 뿐 배정표는 그대로 나온다. 우선순위를 못 채운다고 파이프라인을 세우지 마라.

## 작업

### 1. `src/lib/doc/workload-parser.test.ts` 를 **먼저** 쓴다

```ts
export function parseWorkloadPriorities(nodes: readonly OutlineNode[]): WorkloadEntry[];
```

케이스:

| 입력 (「워크로드 공유」 절 안) | 기대 |
|---|---|
| `P0: 1-1, 2-3` | `[{taskNo:'1-1',priorityRaw:'P0'}, {taskNo:'2-3',priorityRaw:'P0'}]` |
| `P0 (최우선)` 다음 줄들에 `① 1-1 시트 파서` `② 2-3 …` | 두 건 다 `P0`. **블록은 다음 `P` 토큰까지 이어진다** |
| `P1` 블록이 뒤따름 | 그 아래 번호는 `P1` |
| 같은 번호가 두 블록에 | **먼저 나온 것이 이긴다** (문서 위쪽이 더 강한 우선순위다) |
| 절이 아예 없음 | `[]` |
| 절은 있는데 `P` 토큰이 없음 | `[]` |
| 절 **밖**의 `P0: 9-9` | 무시 — 절 안만 본다 |
| `P0`·`p0` | 둘 다 인식 (대소문자 무시) |
| 한 줄에 번호 여러 개 (`P0: 1-1, 1-2, 1-3`) | 세 건 |
| 존재하지 않는 번호 (`9-9`) | **그대로 담는다.** 조인 실패 판단은 step 4의 일이다 |

### 2. `src/lib/doc/workload-parser.ts` 를 구현한다

- 절 찾기: `outline-builder.ts`의 `WORKLOAD_SECTION_PATTERN`을 import한다. **정규식을 다시 적지 마라**
  — 두 곳에 있으면 한쪽만 고쳐지고, 그때 절이 두 파서 모두에서 사라지거나 두 번 읽힌다.
- 절의 범위는 `outline-builder`와 **같은 규칙**이다(그 제목부터 같거나 더 얕은 level의 다음 제목 직전까지).
  범위 계산 헬퍼가 두 파일에 생기면 `outline-builder.ts`에서 export해 공유한다.
- 스캔 대상은 그 절 안의 모든 노드의 `text`와 `lines`를 문서 순서로 이은 줄 목록이다.
- 우선순위 토큰: `/\bP([0-9])\b/i`. 줄에 토큰이 있으면 **현재 우선순위가 그것으로 바뀐다.**
- 과제 번호 토큰: `/\b(\d+-\d+)\b/g`. 현재 우선순위가 정해진 뒤 나온 번호만 담는다.
  같은 줄에 토큰과 번호가 함께 있으면(`P0: 1-1`) 그 줄의 번호도 담는다.
- 중복은 **처음 것만** 남긴다.
- 예외를 던지지 않는다. 경고도 내지 않는다 — 이 절은 없어도 정상이다.

## Acceptance Criteria

```bash
npm run test -- src/lib/doc/workload-parser.test.ts
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `WORKLOAD_SECTION_PATTERN`이 한 곳에만 있는가?
   - 절 밖의 `P0`을 줍지 않는가?
   - 우선순위를 시트 enum 값(`긴급`…)으로 **여기서** 바꾸지 않았는가? (`priorityRaw` 원문만 담는다.
     매핑은 step 4다 — 결정 A)
3. `phases/t7-doc-extract/index.json`의 step 3을 갱신한다.

## 금지사항

- 이 절에서 과제·세부항목을 만들지 마라. 이유: 아웃라인 과제와 중복돼 배정표가 두 배가 된다.
- 조인을 여기서 하지 마라. 이 파서는 `OutlineTask`를 모른다.
- 기존 테스트를 깨뜨리지 마라.
