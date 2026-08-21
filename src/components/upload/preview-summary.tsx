/**
 * 미리보기 숫자를 **그대로** 렌더한다. 합계·퍼센트를 여기서 만들지 않는다 —
 * `buildUploadPreview`가 낸 값과 화면 값이 갈라지면 미리보기는 숫자만 그럴듯한 거짓이 된다
 * (`CLAUDE.md` — 컴포넌트는 props 받아 JSX만 뱉는다).
 */

import { WarningList } from '@/components/upload/warning-list';
import type { UploadPreview } from '@/lib/upload/upload-preview';
import type { TeamKey } from '@/types/task';

/**
 * 팀 이름. 가운뎃점은 `·`(U+00B7)로 시트 원문과 같다.
 * T6이 대시보드에서 같은 이름을 쓰게 되면 그때 `lib/`으로 올린다 — 지금은 이 화면 하나뿐이라
 * 테스트가 붙는 자리를 만들지 않는다.
 */
const TEAM_LABELS: Readonly<Record<TeamKey, string>> = {
  edit: '편집팀',
  shoot: '촬영·기획팀',
  marketing: '마케팅·관리팀',
};

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-200 bg-white p-4">
      <div className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

export function PreviewSummary({ preview }: { preview: UploadPreview }) {
  const { totals } = preview;

  return (
    <div className="space-y-6">
      {/* 신규 건수가 예상보다 크면 사람이 알아채야 한다 (`E5`·`H5`). 크게 보여 주는 것이
          그 장치의 전부이고, 임계값 경고를 자동으로 만들지 않는다 — 기준이 없다 */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-900">
          미리보기 · 업무 {totals.taskCount}건
        </h2>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <Tile label="신규" value={totals.created} />
          <Tile label="변경" value={totals.updated} />
          <Tile label="유지" value={totals.unchanged} />
          <Tile label="경고" value={totals.warningCount} />
        </div>
      </section>

      {preview.skippedSheets.length > 0 && (
        <p className="rounded border border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          건너뛴 탭: {preview.skippedSheets.join(' · ')} — 이 탭의 내용은 반영되지 않습니다.
        </p>
      )}

      {preview.untouchedTeams.length > 0 && (
        <p className="rounded border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
          이번 업로드에 없는 팀: {preview.untouchedTeams.map((key) => TEAM_LABELS[key]).join(' · ')}{' '}
          (기존 데이터는 그대로 유지됩니다)
        </p>
      )}

      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-900">탭별 내역</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-100 text-xs font-medium text-neutral-500">
              <th className="px-3 py-2 text-left">시트</th>
              <th className="px-3 py-2 text-left">팀</th>
              <th className="px-3 py-2 text-right">업무</th>
              <th className="px-3 py-2 text-right">신규</th>
              <th className="px-3 py-2 text-right">변경</th>
              <th className="px-3 py-2 text-right">유지</th>
              <th className="px-3 py-2 text-left">상태</th>
            </tr>
          </thead>
          <tbody>
            {preview.tabs.map((tab) => (
              <tr key={tab.sheet} className="h-10 border-b border-neutral-200 hover:bg-neutral-50">
                <td className="px-3 py-2 text-neutral-700">{tab.sheet}</td>
                <td className="px-3 py-2 text-neutral-700">
                  {tab.teamKey === null ? '—' : TEAM_LABELS[tab.teamKey]}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-900">
                  {tab.taskCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-900">{tab.created}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-900">{tab.updated}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                  {tab.unchanged}
                </td>
                <td
                  className={`px-3 py-2 ${tab.skipped ? 'text-amber-700' : 'text-neutral-500'}`}
                >
                  {tab.skipped ? '건너뜀' : '반영 예정'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <WarningList warnings={preview.warnings} />
    </div>
  );
}
