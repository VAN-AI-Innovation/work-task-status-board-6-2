/**
 * 빈 화면 두 가지. **문구를 한 파일에 나란히 두는 것이 요점**이다 — 둘을 섞으면 필터가 걸린
 * 화면에서 「데이터가 없습니다」가 뜨고, 그것을 본 사용자는 멀쩡한 데이터를 두고 업로드하러
 * 간다 (`X3`).
 *
 * 「조회 실패」는 여기가 아니라 `error.tsx`가 진다. 빈 결과와 실패는 다른 사실이고,
 * 실패를 빈 결과로 그리면 장애가 조용히 정상으로 보인다.
 *
 * `no-data`(전체 0건) 화면 자체는 `app/page.tsx`가 직접 쥐고 있다 — 거기에는 `[샘플 데이터
 * 불러오기]`·`[시트 업로드하기]` 두 진입점이 함께 붙고, 그 버튼들은 저장소 상태(읽기 전용)를
 * 알아야 하기 때문이다.
 */

import Link from 'next/link';

/** 둘을 나란히 둔다. 한쪽을 고칠 때 다른 쪽이 눈에 들어와야 한다 */
const MESSAGES: Readonly<Record<'no-data' | 'no-match', string>> = {
  'no-data': '아직 데이터가 없습니다',
  'no-match': '조건에 맞는 업무가 없습니다',
};

export function EmptyState({
  kind,
  resetHref,
}: {
  kind: 'no-data' | 'no-match';
  resetHref?: string;
}) {
  return (
    // `UI_GUIDE.md`가 중앙 정렬을 금지하면서 예외로 둔 자리다
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-ink-muted text-sm">{MESSAGES[kind]}</p>
      {resetHref !== undefined && (
        <Link
          href={resetHref}
          className="border-line bg-panel text-ink hover:bg-raise rounded border px-4 py-2 text-sm"
        >
          필터 초기화
        </Link>
      )}
    </div>
  );
}
