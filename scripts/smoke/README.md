# 스모크 검증 스크립트

## 목적

문서가 「그렇다」고 적은 것을 **실제 파일로** 확인하는 검증 스크립트 모음이다.
제품 경로가 아니며 `next build` 번들에 포함되지 않는다.

| 스크립트 | 무엇을 재나 |
|---|---|
| `docx-headings.mjs` | `H8` — mammoth가 `.docx`의 heading을 `h1~h3`으로 인식하는가 (T1) |
| `sheet-metrics.mjs` | `A7`·`S2` — 시트 `.xlsx`의 크기·시트 수·셀 수 (T1) |
| `assignment-xlsx.mjs` | T7 완료 기준 4·5 — **내려받은** 배정표에 드롭다운이 붙었는가, 수식 셀이 0개인가 |
| `rls-check.mjs` | T8 완료 기준 5 — 세 계정으로 **실제 로그인해** anon 키로 조회했을 때 역할마다 보이는 건수가 다른가 |

`assignment-xlsx.mjs`는 앞의 둘과 성격이 다르다 — 실업무 원본이 아니라 **라우트가 방금
내려보낸 파일**을 받는다. 단위 테스트는 `buildAssignmentWorkbook`의 출력 버퍼를 보지만
이 스크립트는 직렬화·응답 헤더를 거쳐 나온 바이트를 보므로, 그 구간에서 무언가 달라지면
여기서만 드러난다.

```bash
# 예: 라우트에서 받아 그대로 검사
curl -s -X POST localhost:3000/api/export/assignment \
  -H 'Content-Type: application/json' --data-binary @rows.json -o /tmp/a.xlsx
node scripts/smoke/assignment-xlsx.mjs /tmp/a.xlsx
```

`rls-check.mjs`도 실업무 원본을 받지 않는다 — **원격 저장소의 상태**를 본다. `anon` 키로
세 계정에 로그인해 보이는 건수를 재고, `service_role`은 기대값을 세는 용도로만 쓴다.
두 키가 같으면 스크립트가 스스로 죽는다 — `service_role`로 재면 RLS가 우회돼 아무것도
재지 않으면서 전부 통과하기 때문이다. 계정은 `npm run seed:auth`가 먼저 만들어야 한다.

```bash
npm run seed:auth                                          # 계정·구성원·시드 (멱등)
node --env-file=.env.local scripts/smoke/rls-check.mjs     # 10개 항목
```

## 입력 파일 배치 규약

실업무 원본은 저장소 루트의 `smoke-input/`에 둔다. 이 디렉토리는 `.gitignore`로
디렉토리째 차단된다 (확장자 무관 — 내보내기 임시 파일·PDF·스크린샷까지 막기 위함).

- 워크로드 문서 `.docx` 1개, 업무 시트 `.xlsx` 1개
- 파일명은 자유다. 스크립트가 확장자로 찾는다
- **실업무 파일을 저장소에 커밋하지 않는다** (`CLAUDE.md` 보안·데이터 규칙).
  실명·연락처·문의자 계정이 익명화되지 않은 원본이다

## 실행법

```bash
node scripts/smoke/<script>.mjs [파일경로]
```

경로를 생략하면 `smoke-input/`에서 해당 확장자 파일을 자동으로 찾는다.

## 결과 기록

판정 결과는 `scripts/smoke/RESULT.md`에 남기고, 확정된 결론만 `docs/PLAN.md`의
`H8`·`A7` 항목에 반영한다.

## 기록 금지 항목

셀 값, 담당자 실명, 연락처, 문의자 계정, 과제 본문 텍스트를 스크립트 출력이나
`RESULT.md`에 담지 않는다 (`CLAUDE.md` — 로그에 셀 값을 담지 않는다).
남기는 것은 **구조 정보뿐**이다 — 태그 이름, 개수, 시트명, 바이트 수, 번호 접두사.

## exceljs·mammoth import 예외

`CLAUDE.md`의 import 제한(`workbook-reader.ts`·`assignment-writer.ts` 두 파일)은
**`src/` 아래 제품 코드에 적용되는 규칙**이다. `scripts/smoke/`는 제품 경로가 아니고
번들에 들어가지 않으므로, 이 디렉토리의 검증 스크립트는 두 라이브러리를 직접
import한다. 이 예외는 `scripts/smoke/`에만 해당한다.
