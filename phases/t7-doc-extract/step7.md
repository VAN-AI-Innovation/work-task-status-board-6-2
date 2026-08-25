# Step 7: doc-pipeline

## 읽어야 할 파일

- `CLAUDE.md` — **CRITICAL: 비즈니스 로직은 `src/lib/`에만. 라우트는 호출만 하고 계산하지 않는다.**
  파서 하드 실패 금지(경고에 담고 값 보존), 단 「알려진 탭이 하나도 없음」류는 중단
- `docs/ARCHITECTURE.md` — 「독스 → 배정표」 그림, 「에러 처리」 코드 목록
  (step 0이 `DOCUMENT_CORRUPT`·`NO_OUTLINE_TASK`를 추가해 뒀다)
- `docs/PLAN.md` — `S2`(압축 폭탄·파싱 타임아웃 8초), step 0이 추가한 **결정 C·D**
- 이전 step 산출물: `src/lib/doc/`의 `docx-reader`·`markdown-reader`·`outline-builder`·
  `workload-parser`·`assignment-mapper`, `src/lib/fixtures/sample-workload.docx`
- **본떠야 할 기존 코드**:
  - `src/lib/sheet/sheet-pipeline.ts` — 단계를 잇는 오케스트레이터의 형태
  - `src/lib/upload/parse-runner.ts` — 타임아웃·실패를 **예외가 아니라 값**으로 접는 방식.
    이 파일의 구조를 그대로 따른다

## 배경

라우트가 리더→빌더→파서→매퍼를 순서대로 부르면 그 순간 계산이 라우트로 샌다
(`CLAUDE.md` CRITICAL). 시트 쪽은 `sheet-pipeline` + `parse-runner`가 그 자리를 맡았고,
독스 쪽에도 같은 자리가 필요하다.

이 파일이 지는 판단은 셋이다.

1. **네 계층을 순서대로 잇는다** — 여기 말고는 그 순서를 아는 곳이 없어야 한다
2. **어떤 결말도 값이다** — 예외를 위로 던지지 않는다 (`parse-runner`와 같은 규율)
3. **과제 0건은 중단이다** — 「알려진 탭이 하나도 없음」과 같은 강도다. 빈 배정표를 내려보내면
   사람은 그게 빈 문서인지 파서 고장인지 알 수 없다

## 작업

### 1. `src/lib/doc/doc-pipeline.test.ts` 를 **먼저** 쓴다

```ts
export type DocFailureCode = 'DOCUMENT_CORRUPT' | 'NO_OUTLINE_TASK' | 'PARSE_TIMEOUT';

export type DocExtractOutcome =
  | { ok: true; result: { rows: AssignmentRow[]; warnings: string[] } }
  | { ok: false; code: DocFailureCode; message: string };

/** `.docx` 바이트 → 배정표 행. `baseYear`도 `timeoutMs`도 **주입받는다** */
export function runDocExtract(
  input: Buffer | Uint8Array,
  ctx: { baseYear: number; timeoutMs?: number }
): Promise<DocExtractOutcome>;

/** 마크다운 경로. **테스트·픽스처 전용이며 라우트에서 부르지 않는다** (`ADR-010`) */
export function extractFromOutline(
  nodes: readonly OutlineNode[],
  ctx: { baseYear: number }
): { rows: AssignmentRow[]; warnings: string[] };
```

케이스:

| 입력 | 기대 |
|---|---|
| `sample-workload.docx` | `ok:true`, `rows.length >= 1` |
| `sample-workload.md` → `readMarkdownOutline` → `extractFromOutline` | 픽스처의 과제 수만큼 행 |
| 손상 바이트 | `ok:false, code:'DOCUMENT_CORRUPT'`. **예외가 새어 나오지 않는다** |
| 과제 0건짜리 문서(제목만 있는 html/md) | `ok:false, code:'NO_OUTLINE_TASK'` |
| `timeoutMs: 0` | `ok:false, code:'PARSE_TIMEOUT'` |
| 실패 `message` | 한국어 한 문장이고 **줄바꿈·`at `·`/src/`·`Error:`를 담지 않는다** (`X1`) |
| 같은 입력 두 번 | 같은 결과 (부수효과 없음) |

### 2. `src/lib/doc/doc-pipeline.ts` 를 구현한다

```
readDocxOutline → buildOutline ─┬→ buildAssignmentRows → rows
                                └→ parseWorkloadPriorities ┘
```

- `extractFromOutline`이 위 세 줄을 담당하고, `runDocExtract`는 「바이트 → 노드」와
  타임아웃·실패 접기만 담당한다. 이렇게 갈라야 마크다운 경로가 mammoth를 건드리지 않는다.
- 타임아웃은 `parse-runner.ts`의 `Promise` + `setTimeout` 패턴을 **그대로** 쓴다.
  기본값은 `upload-limits.ts`의 `PARSE_TIMEOUT_MS`를 재사용한다 — 숫자를 새로 만들지 마라.
- 실패 문구는 step 0이 `ARCHITECTURE.md`에 확정한 문장과 **글자까지 같게** 둔다.
  step 8의 `api-error.ts` 표와 두 문장이 갈리면 같은 실패가 두 가지로 읽힌다.
- 경고는 `outline-builder`의 것을 그대로 올린다. 여기서 늘리지 마라.
- 예외를 던지지 마라. 모든 결말이 `DocExtractOutcome`이다.

## Acceptance Criteria

```bash
npm run test -- src/lib/doc/doc-pipeline.test.ts
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `new Date()`·`Date.now()`를 부르지 않는가? (`baseYear`는 인자다 — `CLAUDE.md` CRITICAL)
   - 실패 메시지에 예외 원문·경로가 섞이지 않는가?
   - `PARSE_TIMEOUT_MS`를 재사용했는가, 새 숫자를 만들었는가?
3. `phases/t7-doc-extract/index.json`의 step 7을 갱신한다.

## 금지사항

- 여기서 파일 크기·ZIP 엔트리를 검사하지 마라. 문 앞의 판정은 `upload-guard.ts`가 이미 한다
  (step 8이 라우트에서 부른다). 두 곳에서 재면 한도가 두 벌이 된다.
- 저장소(`getStorage`)를 부르지 마라. `/extract`는 아무것도 저장하지 않는다 (결정 C).
- 기존 테스트를 깨뜨리지 마라.
