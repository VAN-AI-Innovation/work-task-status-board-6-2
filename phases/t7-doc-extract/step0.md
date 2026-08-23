# Step 0: doc-decisions

## 읽어야 할 파일

- `CLAUDE.md` — 아키텍처 규칙(`exceljs` import는 두 파일만, `src/lib/` 파일명 전역 유니크,
  도메인 함수는 `now` 주입), 보안 규칙(수식 주입 방어, 실업무 데이터 커밋 금지),
  **결정이 바뀌면 코드보다 `docs/PLAN.md`를 먼저 고친다**
- `docs/TICKETS.md` — `## T7 · 독스 → 업무 배정표 xlsx 추출` 전문 (완료 기준 6개)
- `docs/PLAN.md` — 「5. 독스 → 배정표 — `.docx` 단일 입력」, 「독스 추출 루프」, `S1`(수식 주입),
  `H8`(mammoth 실측 결과)
- `docs/ARCHITECTURE.md` — 「독스 → 배정표」 그림, 디렉토리 구조의 `lib/doc/`·`lib/xlsx/`,
  「에러 처리」 코드 목록
- `docs/ADR.md` — `ADR-003`(ExcelJS 단독) · `ADR-010`(독스는 `.docx` 단일) ·
  `ADR-012`(수식 주입은 쓰기 쪽에서 막는다). 마지막 번호는 `ADR-020`이다
- `scripts/smoke/RESULT.md` — 「H8」 실측 (mammoth 기본 옵션 PASS, `h3` 50건 중 과제는 `N-M.` 20건)
- `src/types/sheet.ts`·`src/types/task.ts` — 기존 타입 주석의 밀도와 어투. 새 타입도 같은 결로 쓴다
- `src/lib/domain/task-semantic.ts` — `STATUS_SEMANTIC_MAP` (상태 원문 10개의 **유일한 출처**)
- `src/lib/api/api-error.ts` — 에러 코드·상태·문구 표 (이 step에서 코드는 **문서에만** 추가한다)

## 배경

T7은 담당자 지시 ②다. `.docx` 워크로드 문서를 넣으면 **드롭다운이 붙은 배정표 xlsx**가 나오고,
그 파일을 사람이 채워 `/upload`에 다시 올리면 현황판에 반영된다 — 고리가 닫히는 지점이다.

이 step은 코드를 거의 쓰지 않는다. **뒤 step 열 개가 딛고 설 결정 4건을 문서에 박고**,
타입과 픽스처를 놓는다. 결정을 코드에 먼저 쓰면 `CLAUDE.md`의 「결정이 바뀌면 PLAN.md를 먼저
고친다」를 어기게 되고, 무엇보다 뒤 step들이 서로 다른 전제로 갈라진다.


## 게이트 주의 — `SKIP_LIVE_DB=1`로 돌고 있다

이 phase는 하네스를 `SKIP_LIVE_DB=1`로 실행한다. 원격 Supabase에 계약 테스트 것이 아닌 행이
남아 있어 계약 스위트가 **전체 건수 단언**에서 깨지기 때문이다(`expected 1, got 10` · 이슈 #20).
T7은 저장소 계층을 건드리지 않으므로 그 실패는 이 phase의 코드와 무관하다.

- `npm run test`에서 「저장소 계약: supabase」가 **skip으로 찍히는 것이 정상**이다.
  스위트가 조용히 사라지지 않고 `it.skip`으로 흔적을 남긴다
- **그 스위치를 없애거나 계약 테스트를 고치려 하지 마라.** 이 phase의 범위가 아니다
- 원격 DB 행을 지우지 마라. 파괴적이고 사용자 승인이 필요하다

## 작업

### 1. 결정 4건을 문서에 반영한다

`docs/PLAN.md`「5. 독스 → 배정표」 절을 **고쳐 쓰지 말고 이어 붙인다.** 기존 문단은 근거로 남는다.

#### 결정 A — 우선순위는 시트 enum 값으로 옮겨 적는다

문서의 「워크로드 공유」 절은 우선순위를 `P0`·`P1`로 적는다. 그런데 배정표의 `우선순위` 컬럼은
**시트의 `공통_우선순위` 드롭다운**(`긴급`·`높음`·`보통`·`낮음`)을 달고 나간다. `P0`을 그대로
쓰면 셀 값이 드롭다운 목록 밖이라 엑셀이 경고를 띄우고, 그 파일을 `/upload`에 재업로드하면
`task-semantic.ts`의 미등록 enum 경고(`UNREGISTERED_PRIORITY`)가 뜬다. **고리가 닫히지 않는다.**

확정 매핑 (표를 `PLAN.md`에 그대로 싣는다):

| 문서 | 배정표 `우선순위` |
|---|---|
| `P0` | `긴급` |
| `P1` | `높음` |
| `P2` | `보통` |
| `P3` | `낮음` |
| 그 밖 · 조인 실패 | 빈칸 (경고도 내지 않는다 — `TICKETS.md` T7 「조인 실패는 무시」) |

원문(`P0`)은 버리지 않는다. 행이 `priorityRaw`로 들고 있고 배정표에는 매핑된 값만 쓴다.

#### 결정 B — 드롭다운 값의 출처

`PLAN.md`는 "값은 `설정` 탭에서 읽은 `enum_options` 재사용"이라고 적었다. **T7 시점에 그 값을
읽을 곳이 없다** — `enum_options` 테이블은 있지만 `TaskRepository`에 읽기 메서드가 없고,
`/extract`는 시트 업로드와 무관하게 단독으로 돈다(`TICKETS.md`가 T7을 T2 직후에 두는 이유).

확정: **드롭다운 목록은 `assignment-writer`가 인자로 받는다.** 기본값은 코드에 이미 있는
단일 출처에서 만든다.

| 컬럼 | 기본 목록 | 출처 |
|---|---|---|
| `상태` | 시트 10단계 | `STATUS_SEMANTIC_MAP`의 키 순서 (`lib/domain/task-semantic.ts`) |
| `난이도` | `上`·`中上`·`中`·`中下`·`下` | `assignment-mapper.ts`의 `DIFFICULTY_LEVELS` |
| `우선순위` | `긴급`·`높음`·`보통`·`낮음` | `assignment-mapper.ts`의 `PRIORITY_LEVELS` (`공통_우선순위` 실측값) |

상태 문자열을 `assignment-writer.ts`에 다시 적지 않는다. 한 글자만 달라져도(`게시·이관 대기`의
가운뎃점) 재업로드에서 조용히 미매핑된다.

#### 결정 C — `/extract`는 아무것도 저장하지 않는다. 왕복 두 번이다

`TICKETS.md` T7 범위 Out에 「DB 저장」이 있다. 따라서 `ADR-008`의 미리보기→확정 2단계를
쓰지 않는다 — 확정할 저장소가 없다. 대신 라우트 두 개다 (`ARCHITECTURE.md`가 이미 적어 둔 이름):

```
POST /api/uploads/doc        .docx  → 배정표 행 미리보기(JSON). uploads 행을 만들지 않는다
POST /api/export/assignment  행 JSON → 배정표 .xlsx 바이트 (Content-Disposition: attachment)
```

`uploads` 행을 만들지 않는 이유는 스코프만이 아니다. 그 행의 `parse_result`에 문서 본문이
통째로 남는데, 워크로드 문서에는 사람 이름이 들어 있다 (`S6`).

#### 결정 D — 에러 코드 2개 추가

`ARCHITECTURE.md`「에러 처리」 코드 목록에 아래 둘을 추가한다. `api-error.ts` 주석이
「여기서 늘리지 않는다 — 필요하면 문서를 먼저 고친다」이므로 **문서가 먼저다.** 코드 수정은
step 8이 한다.

| 코드 | 상태 | 문구 | 왜 기존 코드로 안 되는가 |
|---|---|---|---|
| `DOCUMENT_CORRUPT` | 422 | 문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다. | `WORKBOOK_CORRUPT`의 문구는 "워크북"이다. `.docx`를 올린 사람에게 워크북이라고 말하면 무엇을 잘못했는지 알 수 없다 |
| `NO_OUTLINE_TASK` | 422 | 문서에서 과제를 찾지 못했습니다. `N-M.` 형식의 제목이 있는지 확인해 주세요. | 「알려진 탭이 하나도 없음」과 같은 강도의 중단이다. 과제 0건짜리 배정표를 내려보내면 사람은 그게 빈 문서인지 파서 고장인지 모른다 |

#### 문서 반영 위치

- `docs/PLAN.md` — 「5. 독스 → 배정표」 절 끝에 결정 A·B·C를 **「T7 착수 시 확정」** 소절로 추가.
  같은 절의 「생성물은 사람이 이어서 입력할 파일이어야 한다」 아래 "값은 `설정` 탭에서 읽은
  `enum_options` 재사용" 문장에는 결정 B를 가리키는 한 줄을 덧붙인다 (**지우지 마라** — 원래
  의도가 근거로 남아야 한다). `X1` 코드 목록이 있으면 결정 D의 두 코드를 함께 넣는다.
- `docs/ADR.md` — `ADR-021`(결정 A) · `ADR-022`(결정 C)를 기존 형식(**결정**/**이유**/**트레이드오프**)
  으로 추가한다. 결정 B·D는 ADR을 만들지 않는다 — 되돌릴 수 있는 구현 선택이고 PLAN에 근거가 남는다.
- `docs/ARCHITECTURE.md` — 「에러 처리」 코드 블록에 두 코드 추가. 「독스 → 배정표」 그림에
  `doc-pipeline`을 넣고, 디렉토리 구조의 `lib/doc/` 줄에 `doc-pipeline`을 추가한다.
- `docs/TICKETS.md` — T7 **산출물** 줄을 실제 구성으로 고친다:
  `src/lib/doc/` 6개(`docx-reader`·`markdown-reader`·`outline-builder`·`workload-parser`·`assignment-mapper`·`doc-pipeline`)
  + `src/lib/xlsx/assignment-writer.ts` + 라우트 2개 + `/extract` 페이지.
  완료 기준 6개는 **한 글자도 약화시키지 마라.**
- 다른 문서·다른 절은 건드리지 마라.

### 2. `src/types/doc.ts` — 계층 4개가 주고받는 타입

TDD 가드는 `src/types/`를 통과시킨다. **뒤 step에서 쓸 것 같은 타입을 미리 만들지 마라.**

```ts
/** 리더 두 개(`docx-reader`·`markdown-reader`)의 공통 출력. 그 아래는 입력 형식을 모른다 */
export interface OutlineNode {
  /** 1~6 (`h1`~`h6` / `#`~`######`) */
  level: number;
  /** 제목 원문. 번호·난이도 표기를 **자르지 않는다** */
  text: string;
  /** 이 제목에 딸린 본문 줄. 불릿 기호는 떼고 텍스트만, 문서 순서 그대로 */
  lines: string[];
}

/** `outline-builder`가 고른 과제 하나 */
export interface OutlineTask {
  /** 직전 `N.` 대분류 제목에서 번호를 뗀 이름. 없으면 null */
  category: string | null;
  /** `1-2` 형태. 조인 키다 */
  taskNo: string;
  /** 제목 원문 (번호 접두사 포함). 난이도·마감 추출의 근거 */
  headingRaw: string;
  /** 문서에 나온 순서, 0부터 */
  orderIndex: number;
  details: string[];
}

/** `workload-parser`가 「워크로드 공유」 절에서 뽑은 우선순위 한 건 */
export interface WorkloadEntry {
  taskNo: string;
  /** `P0`·`P1` 원문 */
  priorityRaw: string;
}

/** 배정표 한 줄. 컬럼 11개와 1:1이다 (`PLAN.md` 5절) */
export interface AssignmentRow {
  category: string | null;
  taskNo: string;
  title: string;
  /** `上`·`中上`·`中`·`中下`·`下` 중 하나 또는 null */
  difficulty: string | null;
  /** 문서에 적힌 마감 표기 원문(`9/1까지`). 연도 추론이 실패해도 **이건 남는다** */
  deadlineRaw: string | null;
  /** `YYYY-MM-DD` 또는 null */
  deadlineDate: string | null;
  /** 시트 `공통_우선순위` 값으로 옮긴 것. 조인 실패면 null */
  priority: string | null;
  /** 문서의 `P0`·`P1` 원문. 배정표 셀에는 쓰지 않는다 */
  priorityRaw: string | null;
  /** 세부항목을 개행으로 이은 것. 빈 문자열 가능 */
  details: string;
}
```

`담당자`·`상태`·`진행률`·`비고`는 **사람이 채울 빈 칸**이라 행 타입에 두지 않는다.
컬럼 정의는 `assignment-writer.ts`가 진다.

### 3. `src/lib/fixtures/sample-workload.md` — 익명화 픽스처

`.docx`는 바이너리라 픽스처로 최악이다(`ADR-010`). 아웃라인 로직은 전부 이 파일로 검증한다.
**실업무 문서를 그대로 옮기지 마라** — 실명·팀 내부 정보가 들어간다 (`CLAUDE.md` 보안 규칙).
`scripts/smoke/RESULT.md`가 실측한 **구조**만 재현한다.

들어가야 하는 것 (뒤 step의 테스트가 전부 이 파일 하나를 본다):

1. `# ` 문서 제목 1개 (과제가 아니다)
2. `## N. 대분류` **3개 이상**
3. `### N-M. 과제명` 형태의 과제 **6개 이상**. 그 안에 아래가 섞여 있어야 한다
   - 난이도 다섯 종이 **모두** 한 번씩: `上`·`中上`·`中`·`中下`·`下`
     — **`中上`·`中下`가 반드시 있어야 한다.** 완료 기준 3(정규식 순서)을 재는 것이 이 두 줄이다
   - 마감 있는 과제(`(9/1까지)`)와 없는 과제
   - 연도 추론이 **실패하는** 마감 하나 (예: `(추후 협의)`) — `deadlineRaw`만 남는 경로
   - 난이도·마감이 아예 없는 과제 하나
4. **번호 없는 `###` 절 제목** 2개 이상 (실제 문서의 `h3` 50건 중 30건이 이것이다).
   과제로 잡히면 안 된다
5. 각 과제 아래 불릿 세부항목 1~4줄
6. **수식 주입 페이로드** — 과제 하나의 세부항목에 `=cmd|'/c calc'!A1`을 넣는다.
   `+`·`-`·`@`·탭·개행으로 시작하는 값도 한 줄씩 넣는다. 완료 기준 5를 재는 줄이다
7. 마지막에 `## 워크로드 공유` 절. `P0`·`P1` 블록이 있고 각 블록에 과제 번호가 나열되며,
   `①②③④` 항목이 섞여 있다. **존재하지 않는 과제 번호 하나**를 넣는다 (조인 실패 무시 경로)

파일 맨 위에 HTML 주석으로 「익명화된 테스트 픽스처다. 실업무 문서가 아니다」를 한 줄 남긴다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -c '中上' src/lib/fixtures/sample-workload.md      # 1 이상
grep -c '中下' src/lib/fixtures/sample-workload.md      # 1 이상
grep -c "=cmd|'/c calc'!A1" src/lib/fixtures/sample-workload.md   # 1 이상
grep -n 'DOCUMENT_CORRUPT\|NO_OUTLINE_TASK' docs/ARCHITECTURE.md  # 2줄 이상
grep -n 'ADR-021\|ADR-022' docs/ADR.md                  # 각 1줄 이상
git status --short                                       # 실업무 .docx·.xlsx가 스테이징되지 않았다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 픽스처에 실명·연락처·실제 팀 내부 정보가 없는가?
   - `src/types/doc.ts`가 `exceljs`·`mammoth`를 import하지 않는가? (타입만 있어야 한다)
   - `PLAN.md`의 기존 문단을 지우지 않고 **덧붙였는가?**
   - T7 완료 기준 6개가 약화되지 않았는가?
3. `phases/t7-doc-extract/index.json`의 step 0을 갱신한다
   (`completed` + `summary`, 실패면 `error` + `error_message`, 사용자 개입 필요면 `blocked`).

## 금지사항

- 구현 코드를 쓰지 마라. 이 step의 `.ts`는 `src/types/doc.ts` 하나다. 이유: 리더·빌더·매퍼는
  각자 TDD로 가는 별도 step이고, 여기서 미리 만들면 테스트 없는 코드가 들어간다.
- `.docx` 픽스처를 만들지 마라. step 6의 일이다.
- `src/lib/api/api-error.ts`를 고치지 마라. 문서가 먼저고 코드는 step 8이다.
- `smoke-input/`의 실업무 파일을 열어 내용을 픽스처에 옮기지 마라. 구조만 재현한다.
- 기존 테스트를 깨뜨리지 마라.
