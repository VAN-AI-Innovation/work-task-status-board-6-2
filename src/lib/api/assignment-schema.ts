/**
 * 내려받기 요청(`POST /api/export/assignment`)의 문 앞 검증.
 *
 * 이 파일이 있는 이유는 `ADR-022`의 트레이드오프다 — `/extract`가 아무것도 저장하지 않아서
 * **행 JSON이 브라우저를 한 번 왕복한다.** 돌아온 것은 우리가 만든 값이 아니라 **신뢰할 수
 * 없는 입력**이고, 그것으로 **조직 사람들에게 배포될 xlsx**를 만든다(`S1`).
 *
 * 방어는 둘로 나뉜다. **내용**의 방어(`=`로 시작하는 셀)는 `assignment-writer.ts`가 한 곳에서
 * 지고(`ADR-012`), 여기서는 **모양과 규모**만 본다 — 모르는 키, 문자열 길이, 행 수, 파일명.
 * 둘을 한 곳에 모으지 않는 것은 쓰기 계층이 파일을 만드는 유일한 길이라 방어가 거기 있어야
 * 우회로가 없고, 반대로 「요청 하나가 얼마나 큰 파일을 만들 수 있나」는 라우트 문 앞에서만
 * 잴 수 있기 때문이다.
 *
 * 상한이 없으면 요청 하나로 수백 MB짜리 xlsx를 만들게 할 수 있다. 아래 숫자는 **거부가
 * 아니라 통과가 기본**이 되도록 잡았다 — 정상 문서를 막는 상한은 방어가 아니라 고장이다.
 */

import { z } from 'zod';

import type { AssignmentRow } from '@/types/doc';

/**
 * 행 수 상한. 실측 워크로드 문서의 과제는 **20건**이므로(`scripts/smoke/RESULT.md`「H8」)
 * 100배다. 이 선을 넘는 「문서」는 배정표가 아니라 다른 무엇이다.
 */
export const ASSIGNMENT_MAX_ROWS = 2_000;

/** 과제명. 문서 제목 한 줄이라 이보다 길면 제목이 아니다 */
export const ASSIGNMENT_MAX_TITLE_LENGTH = 500;

/**
 * 세부항목. 불릿 여러 줄을 개행으로 이은 값이라 한 칸치고는 크게 잡는다.
 * **한 요청이 만들 수 있는 파일 크기의 실질 상한이 이 숫자 × 행 수다.**
 */
export const ASSIGNMENT_MAX_DETAILS_LENGTH = 20_000;

/** 카테고리·번호·난이도·마감 표기·우선순위처럼 짧은 칸의 공통 상한 */
const SHORT_FIELD_LENGTH = 200;

/** 내려받기 파일명. 확장자를 포함한 전체 길이다 */
const FILENAME_MAX_LENGTH = 100;

const DOWNLOAD_EXTENSION = '.xlsx';

const shortText = z.string().max(SHORT_FIELD_LENGTH);

/**
 * `AssignmentRow`와 **1:1**이고 `.strict()`다. 모르는 키를 조용히 버리지 않고 던진다 —
 * 버리면 클라이언트가 잘못된 모양을 보내고도 200을 받아, 빠진 칸을 파일에서야 발견한다.
 */
const assignmentRowSchema: z.ZodType<AssignmentRow> = z
  .object({
    category: shortText.nullable(),
    taskNo: shortText,
    title: z.string().max(ASSIGNMENT_MAX_TITLE_LENGTH),
    difficulty: shortText.nullable(),
    deadlineRaw: shortText.nullable(),
    deadlineDate: shortText.nullable(),
    priority: shortText.nullable(),
    priorityRaw: shortText.nullable(),
    details: z.string().max(ASSIGNMENT_MAX_DETAILS_LENGTH),
  })
  .strict();

/**
 * 요청 본문. `rows: []`도 통과시킨다 — 「과제 0건」을 중단으로 판정하는 것은
 * `doc-pipeline`의 몫이고(`NO_OUTLINE_TASK`), 이 라우트는 준 것을 파일로 만들 뿐이다.
 */
export const assignmentExportSchema: z.ZodType<{ rows: AssignmentRow[]; filename?: string }> = z
  .object({
    rows: z.array(assignmentRowSchema).max(ASSIGNMENT_MAX_ROWS),
    filename: z.string().max(SHORT_FIELD_LENGTH).optional(),
  })
  .strict();

/** 파일명에서 지우는 것들 — 경로 구분자, 제어문자, 따옴표. 그 밖의 글자는 건드리지 않는다 */
const FILENAME_STRIP = /[/\\"\u0000-\u001f\u007f]/g;

/**
 * `Content-Disposition`에 실을 수 있는 이름으로 정리한다.
 *
 * **사용자 문자열을 헤더에 그대로 넣지 않는다.** 개행 하나면 그 뒤가 다른 헤더 줄이 되고,
 * 따옴표 하나면 `filename="..."`의 인용이 그 자리에서 끝난다. 경로 구분자를 지우는 것은
 * 받는 쪽 이야기다 — `../../etc/passwd`라는 이름의 파일을 받아 그대로 저장하는 도구가 있다.
 *
 * 지우고 나서 남는 것이 없으면 `fallback`이다. 확장자는 **항상** 붙이되 이미 있으면 다시
 * 붙이지 않는다(멱등).
 */
export function safeDownloadFilename(input: string | undefined, fallback: string): string {
  const stripped = (input ?? '')
    .replace(FILENAME_STRIP, '')
    // 경로 구분자를 지운 뒤에 남는 `..`도 없앤다. 없어질 때까지 반복하는 이유는 `....`이
    // 한 번만 지우면 다시 `..`가 되기 때문이다
    .replace(/\.{2,}/g, '')
    .trim();

  const base = stripped.toLowerCase().endsWith(DOWNLOAD_EXTENSION)
    ? stripped.slice(0, -DOWNLOAD_EXTENSION.length).trim()
    : stripped;

  if (base === '') return fallback;

  return base.slice(0, FILENAME_MAX_LENGTH - DOWNLOAD_EXTENSION.length) + DOWNLOAD_EXTENSION;
}
