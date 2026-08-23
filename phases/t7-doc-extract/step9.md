# Step 9: extract-page

## 읽어야 할 파일

- `CLAUDE.md` — 컴포넌트는 `src/components/`에 두고 **props 받아 JSX만 뱉는다**(계산 금지),
  서버 컴포넌트는 자기 API를 fetch하지 않는다
- `docs/UI_GUIDE.md` — **전문.** 특히 「AI 슬롭 안티패턴」 표(위반 0건이 기준이다) ·
  색 토큰(`bg-panel`·`text-ink`… **Tailwind 팔레트 클래스 금지**) · 버튼 · 표 · 카드 · 폭 · 애니메이션
- `docs/PLAN.md` — 「독스 추출 루프」 그림(고리가 닫히는 지점), `UC-05`·`UC-06`
- `docs/TICKETS.md` — T7 완료 기준 **1**(`.docx`만 받는다)
- 이전 step 산출물: `/api/uploads/doc` · `/api/export/assignment` · `src/types/doc.ts`
- **본떠야 할 기존 화면**:
  - `src/app/upload/page.tsx` — 서버 컴포넌트가 `PageShell`에 넘기는 값들
  - `src/components/upload/sheet-upload-panel.tsx` — 드롭존·상태 머신·`fetch`·에러 문구 처리.
    **이 파일의 구조를 그대로 따른다** (문구를 서버 것으로 쓰는 규율 포함)
  - `src/components/shell/page-shell.tsx` · `src/components/shell/app-sidebar.tsx`
  - `src/components/upload/preview-summary.tsx` — 미리보기 카드의 밀도·어투

## 배경

`PLAN.md`가 「데모의 클라이맥스」라고 부르는 화면이다. 산문 문서를 올리면 배정표가 나오고,
그 파일을 채워 `/upload`에 올리면 현황판에 반영된다 — **고리가 닫힌다.**

그래서 이 화면이 마지막에 해야 하는 말은 「받았습니다」가 아니라 **「이제 채워서 /upload에
올리세요」**다. `sheet-upload-panel`이 완료 후 「현황판으로 가기」를 두는 것과 같은 이유다.

화면 상태는 업로드 패널보다 단순하다. 저장하는 것이 없으니 확정 단계도, 취소의 의미도 없다.

```
idle → validating → parsing → previewing → (다운로드) 
         ↓ rejected   ↓ failed
```

## 작업

### 1. `src/app/extract/page.tsx` — 서버 컴포넌트

`src/app/upload/page.tsx`와 같은 뼈대다. `getStorage()`로 배너·「마지막 반영」·역할을 만들고
`PageShell`에 넘긴 뒤 패널을 놓는다.

- `export const dynamic = 'force-dynamic'` — 이유는 `upload/page.tsx`의 주석과 같다
- **`readOnly`를 패널에 넘기지 마라.** 이 화면은 저장소에 쓰지 않으므로 읽기 전용 모드에서도
  정상 동작한다. 읽기 전용이라고 잠그면 「저장소가 죽었는데 배정표는 뽑을 수 있다」는
  사실을 화면이 부정하게 된다. 배너는 `PageShell`이 알아서 보여 준다
- 제목과 한 줄 설명: 「독스 → 배정표」 / 「워크로드 문서(.docx)를 올리면 드롭다운이 붙은
  업무 배정표 xlsx를 만들어 드립니다.」

### 2. `src/components/extract/doc-extract-panel.tsx` — 클라이언트 컴포넌트

`sheet-upload-panel.tsx`를 본뜨되 **단계는 넷**이다(`idle`·`validating`·`parsing`·`previewing` +
`rejected`·`failed`).

- 드롭존: `accept=".docx"`. **`accept`는 편의일 뿐이고 최종 판별은 서버가 한다**는 주석을
  같은 자리에 남긴다 (`S3`)
- `POST /api/uploads/doc` (multipart) → `{rows, warnings}`를 상태에 담는다
- 미리보기 아래에 **[배정표 xlsx 내려받기]** 버튼. 누르면 `POST /api/export/assignment`에
  `{rows}`를 보내고 `blob`을 받아 `URL.createObjectURL` + 임시 `<a download>`로 저장한 뒤
  **`revokeObjectURL`로 정리**한다
- 실패 문구는 **서버가 준 `message`를 그대로** 쓴다. 코드별 문구를 화면에서 다시 만들지 마라
- 다운로드 후: 「채워서 시트 업로드에 올리면 현황판에 반영됩니다」 + `/upload`로 가는 링크.
  **자동으로 이동시키지 마라**
- 계산 금지 규칙의 경계: 이 파일이 하는 것은 상태 전이와 `fetch`뿐이다. 행을 가공하지 않는다

### 3. `src/components/extract/assignment-preview.tsx` — 표 컴포넌트

props로 `rows: AssignmentRow[]`와 `warnings: string[]`을 받아 JSX만 뱉는다.

- `UI_GUIDE.md`「표」 규격 그대로: 헤더 `bg-brand-soft text-brand text-xs font-medium sticky top-0`,
  행 `border-b border-line hover:bg-brand-soft` 높이 40px, 숫자·날짜는 `tabular-nums` 우측 정렬
- 컬럼은 **배정표와 같은 순서**로 보여 준다. 빈 칸(담당자·상태·진행률·비고)도 컬럼으로 보여
  「사람이 채울 자리」가 화면에서 보이게 한다
- 세부항목은 여러 줄이다. 셀에서 2줄까지 보이고 넘치면 잘라 표시한다(`line-clamp-2`).
  표가 세로로 길어지면 미리보기가 아니라 문서가 된다
- 행 수 · 난이도별 건수 · 마감 있는 건수를 **한 줄 요약**으로 표 위에 둔다.
  이 계산은 컴포넌트가 아니라… **props로 받은 rows를 세는 정도는 여기서 한다**
  (`filter().length` 세 개다. 이것 때문에 `lib/view` 파일을 만들지 마라)
- 경고가 있으면 `bg-warn-bg border-warn-line text-warn` 한 줄로 건수만 알린다.
  경고 코드 원문을 사용자에게 그대로 보이지 마라 — 한국어 한 줄로 옮긴다
- 표가 넓으므로 `overflow-x-auto` 상자에 넣는다

### 4. 사이드바에 항목 추가

`src/components/shell/app-sidebar.tsx`의 `ITEMS`에 `/extract`를 추가한다.
「시트 업로드」 **바로 아래**다 — 둘 다 데이터를 넣는 화면이고, 순서가 곧 `UC-05`→`UC-06`이다.
아이콘은 인라인 SVG 16px `strokeWidth 1.5`(기존 규격). 문서에서 표가 나오는 모양이면 된다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
grep -rnE "\b(bg|text|border)-(neutral|red|amber|green|blue|indigo|purple|slate|gray|white)" src/app/extract src/components/extract
# → 0건 (토큰만 쓴다)
grep -rn "blur\|gradient\|shadow-\[|animate-pulse" src/app/extract src/components/extract
# → 0건 (AI 슬롭 안티패턴)
```

수동 확인 (다음 step의 감사에서도 다시 본다):

```bash
npm run dev   # /extract 에서 sample-workload.docx 업로드 → 미리보기 → 내려받기
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `UI_GUIDE.md` 안티패턴 표 위반 0건인가?
   - 색을 토큰 클래스로만 불렀는가?
   - 컴포넌트가 계산하지 않는가? (행 개수 세기 외의 판정이 있으면 `lib/`로 옮긴다)
   - 서버 컴포넌트가 자기 API를 `fetch`하지 않는가?
   - `accept=".docx"`가 있고, 그것이 방어가 아니라 편의라는 주석이 있는가?
3. `phases/t7-doc-extract/index.json`의 step 9를 갱신한다.

## 금지사항

- `sheet-upload-panel.tsx`를 고치지 마라. 비슷하다고 공통 컴포넌트로 묶지도 마라 —
  두 화면의 상태 머신이 다르고(하나는 확정이 있고 하나는 없다), 묶으면 둘 다 읽기 어려워진다.
- 진행률 바·스피너 애니메이션을 새로 만들지 마라. `UI_GUIDE.md`가 허용한 애니메이션은
  사이드 패널 슬라이딩과 스켈레톤 페이드뿐이다.
- 미리보기에서 행을 편집하게 만들지 마라. 사람이 채우는 자리는 xlsx다 (`ADR-001`: 입력 UI를
  만들지 않는다).
- 기존 테스트를 깨뜨리지 마라.
