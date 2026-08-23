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
 * **행을 편집하게 만들지 않는다.** 사람이 채우는 자리는 내려받은 xlsx다 (`ADR-001` — 이 웹은
 * 입력 UI를 만들지 않는다). 그래서 빈 칸 넷(담당자·상태·진행률·비고)도 컬럼으로 남겨
 * 「채울 자리가 여기 있다」를 화면에서 보이게만 한다.
 */

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
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-brand-soft text-brand text-xs font-medium">
              {HEADERS.map((header) => (
                <th key={header} className="sticky top-0 px-3 py-2 text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.taskNo}:${index}`}
                className="border-line hover:bg-brand-soft h-10 border-b"
              >
                <td className="text-ink-body px-3 py-2">
                  <Text value={row.category} />
                </td>
                <td className="text-ink-body px-3 py-2 tabular-nums">{row.taskNo}</td>
                <td className="text-ink px-3 py-2">{row.title}</td>
                <td className="text-ink-body px-3 py-2">
                  <Text value={row.difficulty} />
                </td>
                {/* 셀에 실제로 들어갈 값과 같은 규칙이다 — 연도 추론에 성공하면 날짜,
                    실패하면 문서에 적힌 표기 원문(`추후 협의`)이 그대로 간다 */}
                <td className="text-ink-body px-3 py-2 text-right tabular-nums">
                  <Text value={row.deadlineDate ?? row.deadlineRaw} />
                </td>
                <td className="text-ink-body px-3 py-2">
                  <Text value={row.priority} />
                </td>
                {/* 세부항목은 여러 줄이다. 두 줄까지만 보인다 — 다 펼치면 미리보기가 아니라
                    문서가 된다 */}
                <td className="text-ink-body max-w-[22rem] px-3 py-2">
                  <span className="line-clamp-2 whitespace-pre-line">
                    <Text value={row.details} />
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Blank />
                </td>
                <td className="px-3 py-2">
                  <Blank />
                </td>
                <td className="px-3 py-2 text-right">
                  <Blank />
                </td>
                <td className="px-3 py-2">
                  <Blank />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
