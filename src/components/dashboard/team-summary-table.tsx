/**
 * `summarizeAllTeams`가 낸 `TeamSummary[]`를 그대로 표로 옮긴다. 합계도 비율도 여기서
 * 만들지 않는다 (`CLAUDE.md` — 컴포넌트는 props 받아 JSX만 뱉는다).
 *
 * **태스크가 0건인 팀도 행으로 나온다.** 그 함수가 이미 그렇게 만들고, 화면이 숨기지 않는다 —
 * 「우리 팀이 안 보인다」가 「데이터가 없다」보다 나쁜 화면이다.
 *
 * 지연이 있는 팀은 **그 셀만** 붉다. 행 전체를 칠하는 것은 업무 표의 규칙(`UI_GUIDE.md`)이고,
 * 팀이 셋뿐인 요약표에 쓰면 화면의 3분의 1이 붉어져 지연 강조가 흔해진다.
 */

import type { TeamSummary } from '@/lib/domain/progress-stats';
import { formatCount, formatPercent } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';

/** 헤더 라벨과 값 뽑기를 한 배열로 묶는다. 컬럼이 늘 때 고칠 곳이 갈라지지 않는다 */
const COLUMNS: readonly { label: string; of: (summary: TeamSummary) => string }[] = [
  { label: '전체', of: (s) => formatCount(s.total) },
  { label: '활성', of: (s) => formatCount(s.active) },
  { label: '진행', of: (s) => formatCount(s.inProgress) },
  { label: '검토', of: (s) => formatCount(s.reviewWaiting) },
  { label: '승인 대기', of: (s) => formatCount(s.approvalWaiting) },
  { label: '완료', of: (s) => formatCount(s.done) },
  { label: '지연', of: (s) => formatCount(s.overdue) },
  { label: '완료율', of: (s) => formatPercent(s.completionRate) },
  { label: '평균 진행률', of: (s) => formatPercent(s.avgProgress) },
];

export function TeamSummaryTable({ teams }: { teams: TeamSummary[] }) {
  return (
    <section className="border-line bg-panel rounded-md border p-4">
      <h2 className="text-brand text-sm font-semibold">팀별 현황</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-brand-soft text-brand text-xs font-medium">
            <th className="px-3 py-2 text-left">팀</th>
            {COLUMNS.map((column) => (
              <th key={column.label} className="px-3 py-2 text-right">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teams.map((summary) => (
            <tr key={summary.teamKey} className="border-line hover:bg-brand-soft h-10 border-b">
              <td className="text-ink-body px-3 py-2">{teamLabel(summary.teamKey)}</td>
              {COLUMNS.map((column) => (
                <td
                  key={column.label}
                  className={`px-3 py-2 text-right tabular-nums ${
                    column.label === '지연' && summary.overdue > 0 ? 'text-late' : 'text-ink'
                  }`}
                >
                  {column.of(summary)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
