/**
 * 접힌 경고 목록. `buildUploadPreview`가 `code + sheet`로 이미 묶어 두었으므로
 * 여기서는 줄을 그리기만 한다 — **세거나 다시 묶지 않는다.**
 */

import type { PreviewWarning } from '@/lib/upload/upload-preview';

/**
 * 코드는 그대로 두고 설명을 덧붙인다. 코드를 지우면 사용자가 검색해 물어볼 단서가 없어지고,
 * 설명이 없으면 영문 대문자만 남아 아무도 읽지 않는다.
 *
 * 없는 코드는 **코드 그대로** 보여준다 — 여기 없는 경고가 생겼을 때 목록이 침묵하면 안 된다.
 */
const WARNING_LABELS: Readonly<Record<string, string>> = {
  SETTINGS_TAB_MISSING: '설정 탭을 찾지 못했습니다',
  DUPLICATE_SOURCE_KEY: '같은 업무 키가 중복됩니다',
  UNKNOWN_TAB: '인식하지 못한 탭',
  HEADER_BAND_NOT_FOUND: '헤더를 찾지 못했습니다',
  TAB_PARSE_FAILED: '탭을 읽지 못했습니다',
  FORMULA_WITHOUT_RESULT: '수식 결과가 비어 있습니다',
  CELL_ERROR: '셀이 오류 값입니다',
  DATE_OUT_OF_RANGE: '날짜 범위를 벗어난 값입니다',
  HIDDEN_COLUMN: '숨겨진 열이 있습니다',
};

export function WarningList({ warnings }: { warnings: readonly PreviewWarning[] }) {
  // 빈 표는 잡음이다. 경고가 없으면 목록 자체를 그리지 않는다
  if (warnings.length === 0) return null;

  return (
    <section className="rounded-md border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold text-ink">경고</h2>
      <p className="mt-1 text-xs text-ink-muted">
        값은 그대로 보존됩니다. 확정을 막지 않습니다.
      </p>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-raise text-xs font-medium text-ink-muted">
            <th className="px-3 py-2 text-left">코드</th>
            <th className="px-3 py-2 text-left">설명</th>
            <th className="px-3 py-2 text-left">시트</th>
            <th className="px-3 py-2 text-right">건수</th>
            <th className="px-3 py-2 text-right">첫 행</th>
          </tr>
        </thead>
        <tbody>
          {warnings.map((warning) => (
            <tr
              key={`${warning.code}:${warning.sheet}`}
              className="h-10 border-b border-line hover:bg-raise"
            >
              <td className="px-3 py-2 text-ink-body">{warning.code}</td>
              <td className="px-3 py-2 text-ink-body">
                {WARNING_LABELS[warning.code] ?? warning.code}
              </td>
              <td className="px-3 py-2 text-ink-body">{warning.sheet || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink">
                {warning.count}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                {warning.firstRow ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
