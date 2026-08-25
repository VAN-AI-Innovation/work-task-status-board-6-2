# Step 6: docx-reader

## 읽어야 할 파일

- `CLAUDE.md` — TDD, `src/lib/` 파일명 전역 유니크, 실업무 데이터 커밋 금지(픽스처는 익명화)
- `docs/ADR.md` — `ADR-010` (제품이 받는 입력은 `.docx` 하나. 마크다운은 픽스처 전용)
- `docs/TICKETS.md` — T7 완료 기준 **2** (두 리더가 **같은 `OutlineNode[]`**를 만든다)
- `docs/PLAN.md` — `H8` (mammoth 실측: **기본 옵션에서 인식된다. styleMap 커스터마이즈 불필요**)
- `scripts/smoke/RESULT.md` — 「H8」 전문. `docx-reader.ts`는 `mammoth.convertToHtml`을
  **옵션 없이** 부른다는 결론이 여기 있다
- 이전 step 산출물:
  - `src/types/doc.ts` — `OutlineNode`
  - `src/lib/doc/markdown-reader.ts` — **출력이 같아야 하는 상대**
  - `src/lib/fixtures/sample-workload.md`
- 참고: `scripts/smoke/docx-headings.mjs` (T1이 실측에 쓴 스크립트), `scripts/fixtures/build-sample-workbook.mjs`
  (픽스처 생성 스크립트의 기존 형식·주석 어투)

## 배경

`H8`은 T1에서 **PASS로 끝났다.** 실제 Google Docs 내보내기에서 mammoth 기본 옵션이
`h2` 12건·`h3` 50건을 인식했다. 그러니 이 step에 남은 위험은 mammoth가 아니라 **경계**다:
리더 둘이 같은 출력을 내지 않으면 아래 세 계층이 입력 형식을 알게 된다.

`.docx`는 바이너리라 픽스처로 최악이다(`ADR-010`). 그래서 이 step은 두 겹으로 검증한다.

1. **HTML → `OutlineNode[]` 순수 함수**를 따로 뽑아 마크다운 리더와 출력을 대조한다 (완료 기준 2)
2. **손으로 만든 최소 `.docx`** 하나로 mammoth 경로까지 실제로 통과시킨다

## 작업

### 1. `scripts/fixtures/build-sample-workload-docx.mjs` — 최소 docx 생성기

`src/lib/fixtures/sample-workload.docx`를 만든다. `.gitignore`에 `!src/lib/fixtures/*.docx`
예외가 이미 있어 커밋된다.

**검증된 레시피다. 그대로 따르면 동작한다** (이 phase를 설계하며 실제로 돌려 확인했다):

- ZIP 엔트리 3개면 mammoth가 읽는다: `[Content_Types].xml` · `_rels/.rels` · `word/document.xml`
- **압축하지 않는다** (method 0 = stored). 로컬 헤더 + 중앙 디렉토리 + EOCD를 직접 쓴다.
  CRC-32는 표를 만들어 계산한다 (외부 의존성 없이 `node:zlib` 없이 가능하다)
- 문단은 `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">…</w:t></w:r></w:p>`
- `word/styles.xml` 없이도 **`Heading1`·`Heading2`·`Heading3`은 `h1`·`h2`·`h3`으로 인식된다.**
  mammoth 기본 styleMap이 스타일 **ID**로도 걸기 때문이다. 경고 메시지는 나오지만 변환은 된다
- `ListParagraph`는 styles.xml이 없으면 `<p>`로 떨어진다. **문제가 되지 않는다** — 리더가
  `p`와 `li`를 같은 「본문 줄」로 다루기 때문이다. 이걸 고치려고 styles.xml을 만들지 마라
- 내용은 `sample-workload.md`의 **일부를 그대로 옮긴다**(대분류 1개 + 과제 2개 + 번호 없는 절 1개
  + 워크로드 공유 절). 전부 옮길 필요는 없다 — 이 파일이 증명하는 것은 mammoth 경로가
  살아 있다는 사실이지 아웃라인 로직이 아니다
- `package.json`에 스크립트를 추가한다: `"fixture:docx": "node scripts/fixtures/build-sample-workload-docx.mjs"`
  (기존 `seed:build`와 같은 자리)

### 2. `src/lib/doc/docx-reader.test.ts` 를 **먼저** 쓴다

```ts
/** mammoth가 뱉은 HTML → 아웃라인. **순수 함수**라 바이너리 없이 검증된다 */
export function outlineFromHtml(html: string): OutlineNode[];
/** 제품 경로. mammoth를 **옵션 없이** 부른다 (`H8`) */
export function readDocxOutline(buffer: Buffer | Uint8Array): Promise<OutlineNode[]>;
```

케이스:

| 입력 | 기대 |
|---|---|
| `<h2>1. 대분류</h2>` | `{level:2, text:'1. 대분류', lines:[]}` |
| `<h3>1-1. 과제 (中上)</h3>` | `text` 원문 그대로 |
| `<p>본문</p>` | 직전 노드의 `lines` |
| `<ul><li>가</li><li>나</li></ul>` | 직전 노드의 `lines`에 두 줄 |
| 중첩 `<ul><li>가<ul><li>나</li></ul></li></ul>` | 평평하게 두 줄. 바깥 항목 텍스트에 안쪽이 섞이지 않는다 |
| `<ol><li>…</li></ol>` | `ul`과 같게 |
| `<p><strong>굵게</strong> 섞임</p>` | 텍스트만 (`굵게 섞임`) |
| `&amp;`·`&lt;` 엔티티 | 디코드된 문자 |
| 제목 앞 `<p>` | `level:0` 서두 노드 (마크다운 리더와 **같은 규칙**) |
| 빈 `<p></p>` | `lines`에 빈 문자열을 넣지 않는다 |
| `<table>` | 무시 (실측 0건). 예외를 던지지 않는다 |
| **대조 테스트** | 같은 내용의 md와 html을 넣어 `readMarkdownOutline(md)`와 `outlineFromHtml(html)`이 **깊은 동등**이다 ← 완료 기준 2 |
| `readDocxOutline(sample-workload.docx)` | 노드가 나오고, `h2`·`h3`이 level 2·3으로 잡힌다 |
| 손상된 바이트(`Buffer.from('not a docx')`) | **예외를 던진다.** 잡는 것은 `doc-pipeline`(step 7)이다 |

### 3. `src/lib/doc/docx-reader.ts` 를 구현한다

- `mammoth.convertToHtml({ buffer })` — **옵션·styleMap을 주지 마라** (`H8` 결론).
  `messages`는 읽지 않는다. 경고에 스타일 이름이 담기고 그것은 사용자에게 보여줄 것이 아니다.
- `node-html-parser`의 `parse(html)`로 루트의 자식을 **순서대로** 훑는다.
  `h1`~`h6` → 새 노드 / `p` → `lines` / `ul`·`ol` → 각 `li` 텍스트를 `lines` / 그 밖 → 무시.
- 텍스트는 `.text`(또는 `.structuredText`가 아닌 평문)를 쓰고 `trim()`. **엔티티 디코드는
  라이브러리에 맡긴다.**
- 마크다운 리더와 **규칙을 맞춘다**: 빈 줄 제외, `trim()`만, 제목 앞 본문은 `level:0` 노드.
  규칙이 갈리면 완료 기준 2가 깨진다.
- `exceljs`를 import하지 마라. 이 파일이 아는 라이브러리는 `mammoth`와 `node-html-parser`뿐이다.

## Acceptance Criteria

```bash
npm run fixture:docx
ls -l src/lib/fixtures/sample-workload.docx
npm run test -- src/lib/doc/docx-reader.test.ts
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 대조 테스트(완료 기준 2)가 **깊은 동등**을 재는가? 노드 개수만 세고 있지 않은가?
   - `mammoth.convertToHtml`에 옵션을 넘기지 않았는가?
   - `.docx` 픽스처에 실명·실업무 내용이 없는가?
   - 생성 스크립트를 다시 돌려도 **같은 바이트**가 나오는가? (타임스탬프를 0으로 고정했는가 —
     매번 diff가 생기면 픽스처가 커밋 잡음이 된다)
3. `phases/t7-doc-extract/index.json`의 step 6을 갱신한다.

## 금지사항

- styleMap을 커스터마이즈하지 마라. 이유: `H8`이 기본 옵션 PASS로 끝났고, 커스터마이즈는
  실측 없이 추측으로 규칙을 늘리는 일이다.
- 문단 텍스트 패턴 매칭 대안(3차 안)을 구현하지 마라. `PLAN.md`가 탈출구로만 남긴 것이다.
- `smoke-input/`의 실업무 `.docx`를 픽스처로 커밋하지 마라. `.gitignore`가 막지만 규칙이 먼저다.
- 마크다운 리더를 고쳐 출력을 맞추려 하지 마라. 규칙이 갈렸다면 **어느 쪽이 옳은지** 판단하고
  `summary`에 남긴다.
- 기존 테스트를 깨뜨리지 마라.
