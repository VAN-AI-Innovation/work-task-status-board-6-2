'use client';

/**
 * 배정표 미리보기 표. **props 받아 JSX만 뱉는다** (`CLAUDE.md`).
 *
 * 여기서 세는 것은 요약 줄의 건수 셋뿐이고 그 밖의 판정은 하지 않는다 — 난이도·마감·우선순위를
 * 정하는 것은 `lib/doc/assignment-mapper.ts`이고, 이 표는 그것이 낸 값을 그대로 보여 준다.
 *
 * 컬럼 순서는 `lib/xlsx/assignment-writer.ts`의 `ASSIGNMENT_COLUMNS`와 같다. 그 상수를
 * **import하지 않는다** — 그 파일이 `exceljs`를 열기 때문에(`ADR-003`) 끌어오면 라이브러리가
 * 통째로 클라이언트 번들에 실린다. 컬럼 순서의 계약은 여전히 저쪽에 있고 여기는 눈으로 보는
 * 사본이다.
 *
 * **누르면 그 행만 펼쳐진다.** 세부항목은 문단 여럿이라 접어 두지 않으면 이 표가 문서가 되고,
 * 잘라 두기만 하면 「…」 뒤에 무엇이 있는지 xlsx를 받아 봐야 안다. 그래서 두 줄로 접어 두되
 * **누른 행만** 전문을 편다 — 여러 행을 동시에 펴 둘 수 있다(옆 행과 견주는 것이 이 표의 용도다).
 *
 * **행을 편집하게 만들지 않는다.** 사람이 채우는 자리는 내려받은 xlsx다 (`ADR-001` — 이 웹은
 * 입력 UI를 만들지 않는다). 그래서 빈 칸 넷(담당자·상태·진행률·비고)도 컬럼으로 남겨
 * 「채울 자리가 여기 있다」를 화면에서 보이게만 한다.
 */

import { useState } from 'react';

import type { AssignmentRow } from '@/types/doc';

/** 배정표 컬럼 11개와 같은 순서. 뒤 넷은 사람이 채울 빈 칸이다 */
const HEADERS: readonly string[] = [
  '카테고리',
  '번호',
  '과제명',
  '난이도',
  '마감',
  '우선순위',
  '세부항목',
  '담당자',
  '상태',
  '진행률',
  '비고',
];

/**
 * 셀 하나의 규격. **첫 칸과 끝 칸은 한 단계 더 띄운다** — `px-3`으로 균일하게 두면 표가
 * 카드 테두리에 붙어 답답하고, 가로로 스크롤되는 표라 양끝이 잘린 것처럼도 보인다.
 */
const CELL = 'px-4 py-2 first:pl-6 last:pr-6';

/** 사람이 채울 빈 칸. 값이 아니라 자리라는 것이 보여야 한다 */
function Blank() {
  return <span className="text-ink-faint">—</span>;
}

function Text({ value }: { value: string | null }) {
  if (value === null || value === '') return <Blank />;
  return <>{value}</>;
}

export function AssignmentPreview({
  rows,
  warnings,
}: {
  rows: readonly AssignmentRow[];
  warnings: readonly string[];
}) {
  /** 펼쳐 둔 행. 여럿을 동시에 펼 수 있다 — 옆 행과 견주는 것이 이 표의 용도다 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const withDifficulty = rows.filter((row) => row.difficulty !== null).length;
  const withDeadline = rows.filter((row) => row.deadlineDate !== null).length;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-brand text-sm font-semibold">미리보기 · 배정표</h2>
        <p className="text-ink-muted mt-1 text-xs">
          과제 <span className="text-ink tabular-nums">{rows.length}</span>건 · 난이도 표기{' '}
          <span className="text-ink tabular-nums">{withDifficulty}</span>건 · 마감일{' '}
          <span className="text-ink tabular-nums">{withDeadline}</span>건
        </p>
      </div>

      {/* 경고 코드 원문(`NO_CATEGORY:1-2` 같은 것)을 사용자에게 보이지 않는다 — 읽을 수
          없는 영문 대문자는 「고장」으로 읽힌다. 값은 어느 경우에도 보존되므로 건수만 알린다 */}
      {warnings.length > 0 && (
        <p className="border-warn-line bg-warn-bg text-warn rounded border px-3 py-2 text-sm">
          문서에서 확인이 필요한 항목 <span className="tabular-nums">{warnings.length}</span>건이
          있습니다. 값은 그대로 배정표에 담깁니다.
        </p>
      )}

      <div className="border-line bg-panel overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1280px] border-collapse text-sm">
          <thead>
            <tr className="bg-brand-soft text-brand text-xs font-medium">
              {HEADERS.map((header) => (
                // 「난이도」·「우선순위」가 세로로 쪼개지면 표가 깨진 것처럼 보인다
                <th key={header} className={`sticky top-0 text-left whitespace-nowrap ${CELL}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = `${row.taskNo}:${index}`;
              const open = expanded.has(key);
              const hasDetails = row.details !== '';

              return (
                <tr
                  key={key}
                  /* 줄 전체가 누르는 자리다. 세부항목이 없는 행은 펼칠 것이 없어 그대로 둔다 */
                  onClick={hasDetails ? () => toggle(key) : undefined}
                  className={`border-line hover:bg-brand-soft border-b align-top ${
                    hasDetails ? 'cursor-pointer' : ''
                  }`}
                >
                  {/* 카테고리·과제명은 **한 줄로 둔다.** 「…업무 자동 / 화」처럼 끝 글자가
                      혼자 다음 줄로 넘어가면 같은 카테고리가 행마다 다른 모양으로 읽힌다.
                      넘치는 폭은 표 전체가 가로로 스크롤해서 감당한다 */}
                  <td className={`text-ink-body whitespace-nowrap ${CELL}`}>
                    <Text value={row.category} />
                  </td>
                  {/* `1-1`이 두 줄로 쪼개지면 번호가 두 개처럼 읽힌다 */}
                  <td className={`text-ink-body whitespace-nowrap tabular-nums ${CELL}`}>
                    {row.taskNo}
                  </td>
                  <td className={`text-ink whitespace-nowrap ${CELL}`}>{row.title}</td>
                  <td className={`text-ink-body whitespace-nowrap ${CELL}`}>
                    <Text value={row.difficulty} />
                  </td>
                  {/*
                   * 셀에 실제로 들어갈 값과 같은 규칙이다 — 연도 추론에 성공하면 날짜,
                   * 실패하면 문서에 적힌 표기 원문(`추후 협의`)이 그대로 간다.
                   *
                   * **왼쪽 정렬이다.** 이 표는 대부분의 행이 마감 없는 `—`라, 오른쪽에 붙여
                   * 두면 빈 칸 표시만 헤더에서 멀리 떨어져 어느 컬럼 것인지 흐려진다.
                   * (업무 표의 「날짜는 우측 정렬」 규칙과 다른 자리다 — `UI_GUIDE.md`)
                   */}
                  <td className={`text-ink-body whitespace-nowrap tabular-nums ${CELL}`}>
                    <Text value={row.deadlineDate ?? row.deadlineRaw} />
                  </td>
                  <td className={`text-ink-body whitespace-nowrap ${CELL}`}>
                    <Text value={row.priority} />
                  </td>
                  {/*
                   * 접힌 상태는 두 줄, 펼치면 전문이다. 어포던스는 **줄 전체의 hover 배경과
                   * 커서**가 진다 — 「더 보기」 글자를 행마다 두면 열 줄짜리 표에 같은 문구가
                   * 열 번 서서, 정작 읽어야 할 세부항목보다 눈에 먼저 든다.
                   *
                   * 글자는 없애도 **버튼은 남긴다.** 키보드로 이 칸에 와서 Enter로 펴는 경로가
                   * 그것뿐이고, `aria-expanded`가 접힘 여부를 읽어 준다.
                   */}
                  <td className={`text-ink-body max-w-[26rem] min-w-[22rem] ${CELL}`}>
                    {hasDetails ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        /*
                         * 버튼도 스스로 토글한다 — 키보드로 여기 와서 Enter를 누르는 경로가
                         * 이것뿐이다. 다만 행 핸들러까지 타면 두 번 뒤집혀 제자리이므로
                         * 전파를 끊는다.
                         */
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(key);
                        }}
                        className="w-full cursor-pointer text-left"
                      >
                        {/* 접히면 **한 줄**이다. 두 줄이면 행 높이가 들쭉날쭉해 표를 훑기
                            어렵고, 어차피 전문은 눌러야 보인다 */}
                        <span className={`whitespace-pre-line ${open ? '' : 'line-clamp-1'}`}>
                          {row.details}
                        </span>
                      </button>
                    ) : (
                      <Blank />
                    )}
                  </td>
                  <td className={CELL}>
                    <Blank />
                  </td>
                  <td className={CELL}>
                    <Blank />
                  </td>
                  <td className={CELL}>
                    <Blank />
                  </td>
                  <td className={CELL}>
                    <Blank />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
