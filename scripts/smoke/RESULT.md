# T1 스모크 테스트 실측 결과

## H8 — mammoth heading 인식 (`.docx`)

- **판정**: **PASS**
- **경로**: **기본 옵션** (styleMap 불필요)
- 측정 스크립트: `node scripts/smoke/docx-headings.mjs`
- 대상: `smoke-input/`의 워크로드 `.docx` 1개 (실업무 원본 — 커밋 대상 아님)
- 라이브러리: `mammoth@1.12.1`, `node-html-parser@9.0.1`

### 태그별 개수

| 태그 | 개수 |
|---|---|
| h1 | 16 |
| h2 | 12 |
| h3 | 50 |
| h4 | 0 |
| h5 | 0 |
| h6 | 0 |
| p | 81 |
| table | 0 |
| ul | 54 |
| ol | 1 |

### 번호 접두사 매칭

| 태그 | `N.` | `N-M.` | (없음) |
|---|---|---|---|
| h1 | 1 | 0 | 15 |
| h2 | **9** | 0 | 3 |
| h3 | 0 | **20** | 30 |

`## N. 대분류` → `h2` (9건), `### N-M. 과제명` → `h3` (20건)이 그대로 성립한다.
`PLAN.md`「5. 독스 → 배정표」가 전제한 매핑이 실측으로 확인됐다.

### `p`로 강등된 번호 문단

**6건.** `h2`·`h3`이 각각 12·50건 잡힌 상태이므로 heading 강등 신호가 아니다.
본문 안의 번호 목록(「워크로드 공유」 절의 P0/P1 블록 등)으로 보이며, `PLAN.md`가
이미 `workload-parser.ts`로 분리 파싱하기로 한 영역과 겹친다.

### mammoth `messages` — 스타일 경고

```
[warning] Unrecognised paragraph style: 'Title' (Style ID: Title)
```

**경고는 이 1건뿐이다.** 문서 제목 스타일이며 `h1~h3` 아웃라인과 무관하다.
`Heading 1~3`·`제목 1~3` 계열은 경고가 없다 — mammoth 기본 styleMap이 전부 인식했다.

### 필요한 styleMap

**없다.** 기본 옵션으로 PASS했으므로 `docx-reader.ts`는 `mammoth.convertToHtml({ path })`를
옵션 없이 호출하면 된다. (`Title`을 아웃라인에 넣고 싶다면 선택적으로
`"p[style-name='Title'] => h1:fresh"` 한 줄을 붙일 수 있으나, 문서 제목은 과제 아웃라인이
아니므로 T7에서 필요해질 때 판단한다.)

### T7에 주는 결론

- **T7 예상시간 `L`을 유지한다.** `ADR-010`·`TICKETS.md` T7의 최대 변수(mammoth 인식)가
  해소됐고, styleMap 커스터마이즈 작업이 불필요하다.
- 3차 대안(문단 텍스트 패턴 매칭)은 **쓰지 않는다.** `PLAN.md` `H8`의 탈출구로만 남긴다.
- `h3` 50건 중 아웃라인 과제는 `N-M.` 접두사를 가진 20건이다. 나머지 30건은 과제가 아닌
  절 제목이므로, `outline-builder`는 **태그 깊이만이 아니라 번호 접두사도 함께** 봐야 한다.
  이 판별은 T7 범위다.
