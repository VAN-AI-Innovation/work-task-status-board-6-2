/**
 * 목표 대비 성과 (과제 요구 4번 · `UC-10` · T6 완료 기준 3). 한 행에
 * **`목표 수치 → 실제 성과 → 달성률`** 과 직전 기간 대비 변화가 나란히 선다.
 *
 * 세 가지가 이 화면의 규칙이다.
 *
 * - **미달을 빨강으로 칠하지 않는다.** 빨강은 업무 지연 전용이고, 두 뜻이 되면 지연이 묻힌다
 *   (`UI_GUIDE.md`「목표 대비 성과의 톤」). 미달은 앰버, 그 외(초과 달성·미측정)는 무채색이다.
 * - **시트 값과 어긋난 행에만 병기한다.** 재계산값을 띄우되 시트 값을 지우지 않는다 —
 *   그 불일치 건수가 파서 정확성의 실측 지표다.
 * - **지표가 0건이어도 섹션을 숨기지 않는다.** 사라지면 요구 4번이 미구현으로 보인다.
 *
 * 업무 필터의 영향을 받지 않는다. 성과 지표는 업무가 아니라 목표값 대 실적값 축으로
 * 움직여서 같은 필터가 성립하지 않는다 (`ADR-002`).
 */

import type { TeamGoalSummary } from '@/lib/domain/goal-stats';
import type { GoalRow } from '@/lib/view/goal-view';
import { formatPercent } from '@/lib/view/kpi-format';
import { teamLabel } from '@/lib/view/team-slug';

const COLUMNS: readonly { label: string; numeric?: true }[] = [
  { label: '팀' },
  { label: '과제' },
  { label: '목표 KPI' },
  { label: '목표 수치', numeric: true },
  { label: '실제 성과', numeric: true },
  { label: '달성률', numeric: true },
  { label: '직전 대비' },
];

export function GoalSection({
  rows,
  byTeam,
  mismatchCount,
}: {
  rows: GoalRow[];
  byTeam: TeamGoalSummary[];
  /**
   * `summarizeGoals`가 낸 경고 건수. 달성률 불일치와 **목표 수치 0**이 함께 세어지므로
   * 병기가 붙은 행 수보다 클 수 있다. 경고에는 좌표와 코드만 있고 셀 값이 없다.
   */
  mismatchCount: number;
}) {
  return (
    <section className="border-line bg-panel rounded-md border p-5">
      <h2 className="text-ink text-sm font-semibold">목표 대비 성과</h2>
      <p className="text-ink-muted mt-1 text-xs">
        달성률은 실적 ÷ 목표로 다시 계산한 값이다 · 업무 필터의 영향을 받지 않는다
      </p>

      {rows.length === 0 ? (
        <p className="text-ink-muted mt-4 text-sm">
          목표 지표가 없습니다 — 시트의 목표 탭을 업로드하면 표시됩니다
        </p>
      ) : (
        <>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            {byTeam.map((summary) => (
              <li key={summary.teamKey} className="text-ink-muted text-xs">
                <span className="text-ink-body">{teamLabel(summary.teamKey)}</span> 평균{' '}
                <span className="text-ink tabular-nums">
                  {formatPercent(summary.avgAchievement)}
                </span>{' '}
                · 달성 {summary.onTargetCount} / 미달 {summary.belowTargetCount} / 산출 불가{' '}
                {summary.unmeasurableCount}
              </li>
            ))}
          </ul>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-raise text-ink-muted text-xs font-medium">
                  {COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      className={`px-3 py-2 ${column.numeric ? 'text-right' : 'text-left'}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.teamKey}:${row.title}:${row.kpiName}`}
                    className="border-line hover:bg-raise h-10 border-b"
                  >
                    <td className="text-ink-muted px-3 py-2 text-xs">{row.teamLabel}</td>
                    <td className="text-ink-body px-3 py-2">{row.title}</td>
                    <td className="text-ink-muted px-3 py-2 text-xs">{row.kpiName}</td>
                    <td className="text-ink px-3 py-2 text-right tabular-nums">{row.target}</td>
                    <td className="text-ink px-3 py-2 text-right tabular-nums">{row.actual}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {/* 미달만 앰버다. 초과 달성을 초록으로 칠하지 않는다 */}
                      <span className={row.belowTarget ? 'text-warn' : 'text-ink'}>{row.rate}</span>
                      {row.sheetRate !== null && (
                        <span className="text-ink-faint ml-2 text-xs">
                          ⚠ 시트 값 {row.sheetRate}
                        </span>
                      )}
                    </td>
                    <td className="text-ink-muted px-3 py-2 text-xs">
                      {/* 원문 그대로다. 화살표를 붙이려면 파싱해야 하고, 자유 입력이라 틀린다 */}
                      {row.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-ink-muted mt-3 text-xs">
            파싱 경고 {mismatchCount}건 — 시트 달성률과 어긋나거나 목표 수치가 0인 행
          </p>
        </>
      )}
    </section>
  );
}
