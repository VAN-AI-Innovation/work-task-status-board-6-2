# Step 10: t7-audit

## 읽어야 할 파일

- `docs/TICKETS.md` — `## T7` 완료 기준 **6개 전문**. 이 step이 그 여섯 줄을 하나씩 실행해 증명한다
- `docs/TEAM_RULES.md` — 3.4 공통 Definition of Done
- `CLAUDE.md` — CRITICAL 규칙 전부 (이 step이 마지막 대조다)
- `docs/PLAN.md`·`docs/ARCHITECTURE.md`·`docs/ADR.md`·`docs/UI_GUIDE.md` — 문서와 코드가
  어긋난 곳을 찾는다
- `phases/t7-doc-extract/index.json` — step 0~9의 `summary` 누적본. **구현 중 바뀐 결정이 여기 있다**
- 참고: `phases/t6-dashboard/step10.md` (같은 성격의 감사 step)

## 배경

T6에서와 같은 자리다. 열 개 step이 각자 자기 AC만 봤으므로, **티켓의 완료 기준을 처음부터
끝까지 한 번에 실행해 본 사람은 아직 없다.** 그리고 구현하면서 바뀐 결정이 문서에 반영되지
않은 채 남아 있기 쉽다.

이 step은 기능을 추가하지 않는다. **증명하고 기록한다.**

## 작업

### 1. 완료 기준 6개를 하나씩 실행해 증명한다

각 항목마다 **실행한 커맨드와 결과**를 남긴다. "통과했다"만 적지 마라.

| # | 완료 기준 | 증명 방법 |
|---|---|---|
| 1 | `/extract`가 `.docx`만 받는다 | `uploads/doc` 라우트 테스트의 `.xlsx` 거부 케이스 + 화면의 `accept` |
| 2 | 두 리더가 같은 `OutlineNode[]` | `docx-reader.test.ts`의 대조 테스트 |
| 3 | `中上`이 `中`으로 잘못 매칭되지 않는다 | `assignment-mapper.test.ts` + 픽스처 왕복에서 난이도 5종 확인 |
| 4 | 생성 xlsx의 `상태`·`난이도`·`우선순위`에 드롭다운 | `assignment-writer.test.ts`의 데이터 검증 확인 케이스 |
| 5 | 수식 주입 방어 | `=cmd\|'/c calc'!A1` 픽스처로 만든 파일을 되읽어 프리픽스·텍스트 타입 확인 |
| 6 | 왕복 테스트 | md → rows → xlsx → 시트 파서 재파싱 → rows 동일 |

### 2. 실제로 한 번 돌려 본다 (`PLAN.md` 시나리오 6·17)

```bash
npm run dev
```

1. `/extract`에 `src/lib/fixtures/sample-workload.docx`를 올린다 → 미리보기가 뜬다
2. 배정표 xlsx를 내려받는다
3. **받은 파일을 되읽어** 드롭다운·프리픽스를 확인한다. 엑셀을 열 수 없는 환경이므로
   확인 스크립트를 쓴다면 `scripts/smoke/`에 두고, `src/lib/`에는 남기지 마라
4. 그 파일을 `/upload`에 올려 본다. **거부되는 것이 정상이다** — 배정표는 팀 탭 시그니처가
   아니므로 `NO_KNOWN_TAB`이 뜬다. 이 사실을 **「고리의 남은 한 칸」으로 기록한다**
   (사람이 배정표를 팀 시트 형식으로 옮겨 적는 단계가 아직 사람 몫이라는 뜻이다).
   여기서 파서를 고치지 마라 — T7 범위가 아니고, 시트 시그니처를 배정표에 맞추면
   `tab-detector`의 판별이 느슨해진다

### 2-B. 게이트를 **스위치 없이** 한 번 돌려 본다

이 phase는 `SKIP_LIVE_DB=1`로 실행됐다(이슈 #20 — 원격 DB에 남은 행 때문에 계약 스위트가
전체 건수 단언에서 깨진다). 감사에서는 **스위치 없이** 한 번 돌려 실패가 T7과 무관함을 확인한다.

```bash
npm run test 2>&1 | tail -30
```

- 실패가 `src/lib/store/supabase-task-store.test.ts`의 **계약 스위트에만** 있으면 T7과 무관하다.
  그 사실과 실패 건수를 `summary`에 적는다
- 다른 파일에서 실패가 나오면 **그것은 T7이 만든 회귀다.** 고친다
- 계약 테스트를 고치거나 원격 DB 행을 지우지 마라. 이슈 #20이고 사용자 승인 사항이다

### 3. `CLAUDE.md` CRITICAL 대조

```bash
grep -rn "from 'exceljs'" src/ --include=*.ts | grep -v test     # 2줄만
grep -rn "new Date()\|Date.now()" src/lib/doc src/lib/xlsx        # 0건
grep -rn "runtime = 'nodejs'" src/app/api/uploads/doc src/app/api/export/assignment
ls src/lib/**/*.ts | xargs -n1 basename | sort | uniq -d          # 중복 파일명 0건
```

### 4. 문서를 실제 구현에 맞춘다

- `docs/PLAN.md`·`docs/ARCHITECTURE.md`·`docs/ADR.md`에서 **구현과 어긋난 서술**을 고친다.
  step 0~9의 `summary`에 「…로 바꿨다」가 있으면 그 결정이 문서에 있는지 확인한다
- `docs/TICKETS.md` T7에 **「구현 결과」** 소절을 추가한다: 실제 파일 목록, 증명한 완료 기준,
  남긴 한계(위 2-4의 「고리의 남은 한 칸」 포함)
- `README.md`에 `/extract` 사용법이 없으면 한 문단 추가한다 (T9가 README를 다루지만,
  지금 없으면 이 기능을 아는 사람이 만든 사람뿐이다)
- 없는 것을 있다고 적지 마라. **문서가 코드보다 앞서 가면 다음 사람이 그것을 믿는다**

### 5. 남은 것을 정직하게 기록한다

- T7 범위 Out이라 하지 않은 것(LLM 보강 · DB 저장 · `.md` 업로드 UI)
- 발견했지만 고치지 않은 것 — 있다면 무엇을·왜
- 후속 티켓이 필요하면 `docs/TICKETS.md`에 적기만 한다. **GitHub 이슈를 만들지 마라**
  (`CLAUDE.md`: 커밋·PR·이슈는 사용자가 요청할 때만)

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

+ 위 1·3의 커맨드 전부, 그리고 그 출력을 `summary`에 요약.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 완료 기준 6개에 각각 **증명이 붙었는가?** 하나라도 증명 못 하면 그 사실을 적는다
   - 문서에 「구현했다」고 적었는데 실제로 없는 것이 있는가?
   - 실업무 데이터가 커밋에 섞이지 않았는가? (`git status`)
3. `phases/t7-doc-extract/index.json`의 step 10을 갱신한다.

## 금지사항

- 기능을 추가하지 마라. 감사에서 발견한 결함이 작으면 고치고 `summary`에 적되,
  새 모듈·새 화면을 만들지 마라. 그것은 다음 티켓이다.
- 완료 기준을 증명하지 못했는데 `completed`로 적지 마라. 그러라고 있는 step이다.
- GitHub 이슈·PR을 만들지 마라.
- 기존 테스트를 깨뜨리지 마라.
