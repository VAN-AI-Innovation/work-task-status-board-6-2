# 스모크 검증 스크립트

## 목적

T1(`docs/TICKETS.md`)의 선행 확인 2건 — `H8`(mammoth heading 인식)과 `A7`(시트 크기) —
을 실제 파일로 실측하는 **일회성 검증 스크립트 모음**이다. 제품 경로가 아니며
`next build` 번들에 포함되지 않는다.

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
