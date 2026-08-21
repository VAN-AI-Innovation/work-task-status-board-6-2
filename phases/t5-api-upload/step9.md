# Step 9: upload-page

## 읽어야 할 파일

- `CLAUDE.md` — **컴포넌트는 props 받아 JSX만 뱉는다**, 비즈니스 로직은 `src/lib/`에만
- `docs/TICKETS.md` — `## T5` 완료 기준 **2**(드롭에서 확정까지 3분)·**3**·**8**·**12**
- `docs/PLAN.md` — 「업로드 상태 전이 (실패 경로 포함)」 **다이어그램 전체**, `UC-01`~`UC-04`,
  「에러 핸들링」 `X2`·`X3`
- `docs/UI_GUIDE.md` — **전문.** 특히 「AI 슬롭 안티패턴」 표, 「색상」, 「컴포넌트」(버튼·표·배너),
  「레이아웃」, 「타이포그래피」
- `docs/ADR.md` — `ADR-008`(2단계), `ADR-005`(읽기 전용 배너 문구), `ADR-014`(1280px 기준),
  `ADR-007`
- step 7 산출물: `POST /api/uploads/sheet`·`POST /api/uploads/[id]/commit`의 응답 모양

## 배경

**주간 루프의 진입점이다. 여기가 귀찮으면 시스템 전체가 죽는다** (T5 목적문).
드롭에서 확정까지 **3분 이내**가 완료 기준 2다 — 즉 화면이 물어보는 것이 적어야 한다.

`ADR-008`의 2단계가 화면에서 그대로 보여야 한다. 사용자가 **확정 버튼을 누르기 전까지
아무 일도 일어나지 않는다**는 것을 화면이 말해 줘야 취소가 안심하고 가능하다 (`UC-02`).

그리고 **`UI_GUIDE.md`의 안티패턴 위반 0건**은 T6의 완료 기준이지만, 이 화면이 그 규칙의
첫 적용 사례다. 여기서 어기면 T6이 그 스타일을 복사한다.

⚠ 이 step에서 만드는 파일은 **TDD 가드 예외**다(`page.tsx`·`components/`).
그래서 더 엄격하게 지켜야 한다: **컴포넌트 안에서 계산하지 마라.** 서버가 준 숫자를 그대로
렌더한다. 로직이 생기면 `src/lib/`로 옮기고 테스트를 붙인다.

## 작업

```
src/app/upload/page.tsx                       서버 컴포넌트
src/components/upload/sheet-upload-panel.tsx  'use client' — 드롭존 + 상태 머신 + fetch
src/components/upload/preview-summary.tsx     신규/변경/유지/경고 4타일 + 탭별 표
src/components/upload/warning-list.tsx        접힌 경고 목록
```

### 1. `src/app/upload/page.tsx` (서버 컴포넌트)

- `getStorage()`를 **직접** 부른다. 자기 API를 `fetch`하지 마라 (`ADR-007`).
- 넘길 props: `readOnly`, `mode`.
- `mode === 'fallback'`이면 **"읽기 전용 — 저장소 연결 실패"** 배너(`bg-amber-50 border-b
  border-amber-600 text-amber-700`), `mode === 'demo'`면 **"샘플 데이터 모드"**
  배너(`bg-neutral-100 border-b border-neutral-300 text-neutral-600`).
  **두 문구와 색을 절대 섞지 마라** — 하나는 사고고 하나는 의도다 (`UI_GUIDE.md`).
- 레이아웃은 `max-w-[1280px] mx-auto px-6`.

### 2. `src/components/upload/sheet-upload-panel.tsx` (`'use client'`)

상태 머신을 `PLAN.md`「업로드 상태 전이」 **그대로** 옮긴다. 이름을 바꾸지 마라.

```
idle → validating → parsing → previewing → committing → done
         ↓ rejected              ↓ 취소(idle, 무변경)
         ↓ failed                ↓ failed → previewing (재시도)
```

- `useState`로 단계·미리보기·에러를 들고 있는다. 전역 스토어를 만들지 마라.
- `validating`·`parsing`은 **화면 상태**다 — 서버 왕복 한 번(`POST /api/uploads/sheet`)을
  두 단계로 보여 주는 것이고, 실제 DB 행은 `previewing`부터 생긴다(step 3에서 확정).
- 드롭존: `<input type="file" accept=".xlsx">` + 드래그 오버 상태.
  **`accept`만 믿지 마라** — 서버가 최종 판별한다. 클라이언트 검사는 편의일 뿐이다.
- 확정 버튼은 `previewing`에서만 활성. `readOnly`면 `opacity-50 cursor-not-allowed`로
  비활성하고 이유를 배너로 이미 말하고 있으므로 툴팁을 덧붙이지 마라.
- 취소 = `idle`로 되돌리기. **아무 요청도 보내지 않는다** — 미리보기 단계에서 저장소에
  쓰인 것이 없기 때문이다. 이 사실을 화면에 한 줄로 적어라:
  "확정 전에는 저장되지 않습니다."
- 에러 응답은 `{ error: { code, message } }`다. **`message`를 그대로 보여준다.**
  코드별 문구를 클라이언트에서 다시 만들지 마라 (문구가 두 곳에 생긴다).
- 성공(`done`) 시: "N건 반영" 요약을 보여주고 `/`로 가는 링크를 준다.
  자동 이동은 하지 마라 — 사용자가 결과 숫자를 읽을 시간을 뺏는다.
- **fetch 외에 계산하지 마라.** 합계·퍼센트를 클라이언트에서 만들지 마라.

### 3. `src/components/upload/preview-summary.tsx`

props로 받은 `preview`를 그대로 렌더한다.

- 4타일: **신규 / 변경 / 유지 / 경고**. `text-2xl font-semibold tabular-nums`,
  라벨은 `text-xs text-neutral-500`. 타일은 `rounded p-4`.
- 탭별 표: 시트 / 팀 / 업무 / 신규 / 변경 / 유지 / 상태. 헤더 `bg-neutral-100 text-neutral-500
  text-xs`, 행 높이 40px, 숫자는 `tabular-nums` 우측 정렬.
- **`skippedSheets`가 비어 있지 않으면 반드시 표시한다** — "건너뛴 탭: …"
  (완료 기준 8: 부분 실패 시 빠진 탭 명시). 앰버 색.
- **`untouchedTeams`가 비어 있지 않으면 반드시 표시한다** —
  "이번 업로드에 없는 팀: 촬영·기획팀 · 마케팅·관리팀 (기존 데이터는 그대로 유지됩니다)".
  `UC-04`에서 사용자가 가장 불안해하는 지점이고, 이 한 줄이 그 불안을 없앤다.
- 신규 건수가 예상보다 크면 사람이 알아채야 한다(`E5`·`H5`). **숫자를 크게** 보여주는 것이
  그 장치의 전부다 — 임계값 경고를 자동으로 만들지 마라(기준이 없다).

### 4. `src/components/upload/warning-list.tsx`

`PreviewWarning[]`(코드·시트·건수·첫 행)을 표로. 코드는 그대로 노출하되 **자주 나오는 코드에는
한글 설명을 붙여라**(`SETTINGS_TAB_MISSING` → "설정 탭을 찾지 못했습니다",
`DUPLICATE_SOURCE_KEY` → "같은 업무 키가 중복됩니다", `UNKNOWN_TAB` → "인식하지 못한 탭"). 매핑은
**이 컴포넌트 안의 상수 객체**로 두고, 없는 코드는 코드 그대로 보여준다.
경고가 0건이면 목록 자체를 그리지 마라(빈 표는 잡음이다).

### 5. UI 규칙 — 위반 0건

`UI_GUIDE.md`의 안티패턴을 **하나도** 쓰지 마라: `backdrop-filter blur` / gradient-text /
보라·인디고 / 글로우 애니메이션 / 배경 gradient orb / 모든 카드에 동일한 `rounded-2xl`.
색은 무채색 + 지연(빨강)·주의(앰버) 둘뿐이다. **완료를 초록으로 칠하지 마라.**

## Acceptance Criteria

```bash
# 안티패턴 (전부 출력이 비어야 함)
grep -rnE "backdrop-blur|bg-gradient|from-purple|from-indigo|violet-|indigo-|blur-3xl|animate-pulse" src/app/upload src/components/upload ; test $? -eq 1
grep -rn "rounded-2xl" src/app/upload src/components/upload ; test $? -eq 1
grep -rnE "text-green-|bg-green-|emerald-" src/app/upload src/components/upload ; test $? -eq 1

# 두 배너 문구가 섞이지 않았다 (둘 다 출력이 있어야 함)
grep -rn "읽기 전용 — 저장소 연결 실패" src/app/upload
grep -rn "샘플 데이터 모드" src/app/upload

# 부분 업로드 고지가 있다 (둘 다 출력이 있어야 함)
grep -rn "건너뛴" src/components/upload
grep -rn "그대로 유지" src/components/upload

# 서버 컴포넌트가 자기 API를 부르지 않는다 (출력이 비어야 함)
grep -n "fetch(" src/app/upload/page.tsx ; test $? -eq 1

# 컴포넌트가 계산하지 않는다 (출력이 비어야 함)
grep -rnE "\.reduce\(|Math\.round|\.filter\(.*isOverdue" src/components/upload ; test $? -eq 1

# 클라이언트 경계 (출력이 있어야 함)
grep -rn "'use client'" src/components/upload/sheet-upload-panel.tsx

# 게이트
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **개발 서버를 띄워 실제로 올려 보라.** 이것이 완료 기준 2의 유일한 검증이다:
   ```bash
   STORAGE_DRIVER=memory npm run dev
   # /upload 에서 src/lib/fixtures/sample-workbook.xlsx 를 드롭
   ```
   - 미리보기 숫자가 뜨는가?
   - **취소했을 때 `/`의 건수가 그대로인가?** (`UC-02`)
   - 확정하면 "N건 반영"이 뜨는가?
   - **드롭에서 확정까지 클릭이 몇 번인가? 3번을 넘으면 화면을 줄여라** (완료 기준 2).
   - 1280px과 1024px에서 레이아웃이 유지되는가? (`ADR-014`)
3. 체크리스트:
   - 확정 전에 "확정 전에는 저장되지 않습니다"가 보이는가?
   - `skippedSheets`·`untouchedTeams`가 실제로 화면에 나오는가?
     (한 탭만 든 파일을 만들어 확인하라 — 픽스처에서 탭 하나만 남긴 워크북)
   - 읽기 전용 모드에서 확정 버튼이 비활성인가?
   - 안티패턴 위반 0건인가?
4. `phases/t5-api-upload/index.json`의 step 9를 갱신한다 (형식은 step 0과 동일).
   `"summary"`에 드롭→확정 클릭 수와 실제로 걸린 시간을 적어라 — 완료 기준 2의 증거다.

## 금지사항

- 컴포넌트에서 합계·퍼센트·판정을 계산하지 마라. 이유: `CLAUDE.md` — 컴포넌트는 props 받아
  JSX만 뱉는다. 계산이 컴포넌트에 들어가면 TDD 가드 밖이라 테스트 없이 자란다.
- 서버 컴포넌트에서 자기 API를 `fetch`하지 마라. 이유: `ADR-007`.
- 에러 문구를 클라이언트에서 다시 만들지 마라. 이유: 문구가 두 곳에 생기면 갈라진다.
  서버가 준 `message`를 그대로 쓴다.
- 취소할 때 서버에 요청을 보내지 마라. 이유: 미리보기 단계에서 저장소에 쓰인 것이 없다.
- 확정 성공 후 자동으로 페이지를 이동하지 마라. 이유: 사용자가 반영 건수를 읽지 못한다.
- 읽기 전용 배너와 데모 배너의 문구·색을 섞지 마라. 이유: 하나는 사고고 하나는 의도다 (`ADR-005`).
- `UI_GUIDE.md` 안티패턴을 쓰지 마라. 이유: 위반 0건이 T6의 완료 기준이고, 이 화면이 첫 사례다.
- 완료·성공을 초록색으로 칠하지 마라. 이유: 화면에서 색을 갖는 것은 지연(빨강)과 주의(앰버)뿐이다.
- 대시보드·차트·필터 바를 만들지 마라. 이유: T6의 범위다.
- 새 UI 라이브러리를 설치하지 마라. 이유: Tailwind로 충분하고, 의존성은 T0에서 고정됐다.
- `git commit`을 직접 실행하지 마라. 이유: 커밋은 하네스가 확정된 제목으로 처리한다.
