/**
 * 독스 계층이 주고받는 자체 타입. `mammoth`·엑셀 라이브러리를 import하지 않는다.
 * 그 라이브러리를 아는 파일은 `lib/doc/docx-reader.ts`와 `lib/xlsx/assignment-writer.ts`
 * 둘뿐이고, 아래 타입은 전부 평범한 JS 값이라 그대로 기술할 수 있다 (ADR-003·ADR-010).
 */

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
  /** 시트 `공통_우선순위` 값으로 옮긴 것. 조인 실패면 null (ADR-021) */
  priority: string | null;
  /** 문서의 `P0`·`P1` 원문. 배정표 셀에는 쓰지 않는다 */
  priorityRaw: string | null;
  /** 세부항목을 개행으로 이은 것. 빈 문자열 가능 */
  details: string;
}
